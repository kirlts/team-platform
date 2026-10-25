#!/usr/bin/env node
// `npm test` (UD-265): runs the tests of the areas a change touches, plus the guards that always run. The complete battery
// is `npm run test:completa`. A changed path without an area runs the tests of its own directory.
//
//   npm test                    changes against origin/main (and the working tree)
//   npm test -- --list          prints the selection and does not run it
//   npm test -- --base <ref>    compares against another reference
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
for (const file of changed) {
  if (file.startsWith('panel/') || file.startsWith('packages/client/')) touchesPanel = true
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
const files = [...selected].filter((f) => !/\.(live|docker)\.test\./.test(f)).sort()
console.error(`${changed.length} changed file(s) against ${base}: ${files.length} test file(s) selected (${config.always.length} guards always).`)
if (touchesPanel) console.error('The panel or the client package changed: also `npm run test:panel` (tsc and vitest) and `npm run test:client`.')
if (args.includes('--list')) { console.log(files.join('\n')); process.exit(0) }
// The browser tests serve panel/dist. They run in parallel, and `vite build` empties its folder: it is built here, once and before any of
// them starts, and they are told to read it (FIT_SIN_BUILD) instead of building each its own. A caller that set it owns the folder.
const env = { ...process.env }
if (files.some((f) => f.endsWith('.browser.test.mjs')) && !env.FIT_SIN_BUILD) {
  const built = spawnSync('npx', ['vite', 'build', '--logLevel', 'error'], { cwd: path.join(root, 'panel'), stdio: 'inherit' })
  if (built.status !== 0) process.exit(built.status ?? 1)
  env.FIT_SIN_BUILD = '1'
}
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=3', ...files], { cwd: root, env, stdio: 'inherit' })
process.exit(r.status ?? 1)
