#!/usr/bin/env node
// `npm test` (UD-265): runs the tests of the areas a change touches, plus the guards that always run. The complete battery
// is `npm run test:completa`. A changed path without an area runs the tests of its own directory.
//
//   npm test                    changes against origin/main (and the working tree)
//   npm test -- --list          prints the selection and does not run it
//   npm test -- --base <ref>    compares against another reference
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'node:fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const baseIndex = args.indexOf('--base')
const base = baseIndex >= 0 ? args[baseIndex + 1] : 'origin/main'
const config = JSON.parse(readFileSync(path.join(root, 'src/testing/areas.json'), 'utf8'))

const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
const mergeBase = spawnSync('git', ['merge-base', 'HEAD', base], { cwd: root, encoding: 'utf8' }).stdout.trim() || base
const changed = [...new Set([...git('diff', '--name-only', mergeBase), ...git('ls-files', '--others', '--exclude-standard')])]

const selected = new Set(config.always.flatMap((g) => globSync(g, { cwd: root })))
const prefixes = Object.keys(config.areas).sort((a, b) => b.length - a.length)
let touchesPanel = false
let touchesClient = false
const panelChanged = []
for (const file of changed) {
  if (file.startsWith('panel/') || file.startsWith('packages/client/')) touchesPanel = true
  if (config.client.paths.some((p) => file === p || file.startsWith(p))) touchesClient = true
  if (file.startsWith('panel/')) panelChanged.push(file)
  const prefix = prefixes.find((p) => file === p || file.startsWith(p))
  if (prefix) {
    for (const g of config.areas[prefix]) for (const t of globSync(g, { cwd: root })) selected.add(t)
  } else if (file.endsWith('.js') || file.endsWith('.mjs')) {
    // Without an area: the tests next to the file.
    const dir = path.dirname(file)
    for (const t of globSync(`${dir}/*.test.{js,mjs}`, { cwd: root })) selected.add(t)
  }
  if (/\.test\.(js|mjs)$/.test(file)) selected.add(file)
}

// Browser tests of the panel. A change that is only in one page (panel/src/pages/<Page>.tsx) runs the tests that open that page's route; any other
// change in panel/ (a component, a style, the example server, the support files) can show in every page and runs them all. A test file that
// changed runs by itself (above). The route of each page is the one App.tsx declares.
const PAGE_ROUTES = { Areas: '/areas', AreaView: '/areas', Connections: '/connections', Messages: '/messages', MessageDetail: '/messages/', Settings: '/settings', Team: '/team' }
const isPanelTest = (f) => /\.(test|spec)\.[a-z]+$/.test(f)
const panelCode = panelChanged.filter((f) => !isPanelTest(f) && !/\.(md)$/.test(f))
const browserAll = globSync('panel/src/*.browser.test.mjs', { cwd: root })
const pageOnly = panelCode.length > 0 && panelCode.every((f) => PAGE_ROUTES[path.basename(f).replace(/\.tsx$/, '')] && f.startsWith('panel/src/pages/'))
if (panelCode.length) {
  if (pageOnly) {
    const routes = new Set(panelCode.map((f) => PAGE_ROUTES[path.basename(f).replace(/\.tsx$/, '')]))
    for (const t of browserAll) { const text = readFileSync(path.join(root, t), 'utf8'); if ([...routes].some((r) => text.includes(r))) selected.add(t) }
  } else for (const t of browserAll) selected.add(t)
}
// Tests on the built image (src/testing/areas.json, «image»): selected by the paths they walk. They skip without TEAM_PLATFORM_IMAGE, so selecting
// them costs nothing; building the image does (`npm run test:image`), and it is not part of this run.
const imageTests = new Set(config.image.tests)
const touchesImage = changed.some((file) => config.image.paths.some((p) => file === p || file.startsWith(p)))
if (touchesImage) for (const t of imageTests) selected.add(t)
// Tests on a real Docker daemon (src/testing/areas.json, «daemon»): they do not skip without Docker, they fail, so they run only when the change touches what they walk.
const daemonTests = new Set(config.daemon.tests)
const touchesDaemon = changed.some((file) => config.daemon.paths.some((p) => file === p || file.startsWith(p)))
if (touchesDaemon) for (const t of daemonTests) selected.add(t)
const files = [...selected].filter((f) => !/\.(live|docker)\.test\./.test(f) || imageTests.has(f) || daemonTests.has(f)).sort()
const browserFiles = files.filter((f) => f.endsWith('.browser.test.mjs'))
const nodeFiles = files.filter((f) => !f.endsWith('.browser.test.mjs'))
console.error(`${changed.length} changed file(s) against ${base}: ${files.length} test file(s) selected (${config.always.length} guards always), ${browserFiles.length} of them in the browser.`)
if (touchesImage && !process.env.TEAM_PLATFORM_IMAGE) console.error('The change touches what the tests on the image walk and they are skipped here (TEAM_PLATFORM_IMAGE is not set): `npm run test:image` builds the image and runs them.')
if (touchesPanel) console.error('The panel or the client package changed: the unit tests and browser tests of the panel run here; also `npm run test:panel` for tsc.')
if (touchesClient) console.error('The client package or what shapes the API changed: the suite of packages/client (vitest, against the real API) runs here.')
if (args.includes('--list')) { console.log([...files, ...(touchesClient ? [`${config.client.run} (vitest)`] : [])].join('\n')); process.exit(0) }
// A selection with browser tests needs the browser of this Playwright version: it is asked once, before anything starts, and a machine
// without it fails here in a second with the browser named (2026-10-25: the deploy server hung 20 minutes in the first browser test).
if (browserFiles.length) {
  const { assertBrowserInstalled } = await import(path.join(root, 'panel/src/browser-support.mjs'))
  try { assertBrowserInstalled() } catch (error) { console.error(`browser tests are selected and ${error.message}`); process.exit(1) }
}
// The browser files go to the pool of the panel (panel/scripts/browser-tests.mjs): one build for all of them, one process per file at a time with
// the width the cores allow. The rest run with one process per core.
let status = 0
if (nodeFiles.length) {
  const r = spawnSync(process.execPath, ['--test', `--test-concurrency=${availableParallelism()}`, ...nodeFiles], { cwd: root, stdio: 'inherit' })
  status = r.status ?? 1
}
// The unit tests of the panel take about four seconds (one jsdom per worker), so a change in the panel runs them all.
if (panelCode.length) {
  const r = spawnSync('npx', ['vitest', 'run'], { cwd: path.join(root, 'panel'), stdio: 'inherit' })
  status = status || (r.status ?? 1)
}
// The client package talks to the real API in process (about ten seconds): it is the one that notices a route, a role or a code of the server
// that changed under it.
if (touchesClient) {
  const r = spawnSync('npx', ['vitest', 'run'], { cwd: path.join(root, config.client.run), stdio: 'inherit' })
  status = status || (r.status ?? 1)
}
if (browserFiles.length) {
  const r = spawnSync(process.execPath, ['scripts/browser-tests.mjs', ...browserFiles.map((f) => path.relative('panel', f))], { cwd: path.join(root, 'panel'), stdio: 'inherit' })
  status = status || (r.status ?? 1)
}
process.exit(status)
