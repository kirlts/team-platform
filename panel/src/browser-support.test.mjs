// A browser test that cannot start its browser fails at once, says which browser is missing, and leaves no example server behind.
// 2026-10-25, deploy server: the image carried the Chromium of another Playwright version, `launch` threw after the example server
// was already running, the server kept the process alive and the run hung 20 minutes with the machine idle and no Chromium.
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { assertBrowserInstalled } from './browser-support.mjs'
import { fileURLToPath } from 'node:url'

const panelDir = fileURLToPath(new URL('..', import.meta.url))
// The run ends in well under a second when it works (preflight: no build, no server). Ten seconds is the bound of this test, not of the product.
const LIMIT_MS = 10_000

test('without the browser installed, startPanel fails at once with the missing browser named and starts no server', async () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'tp-sin-navegador-'))
  try {
    const port = 8691
    const r = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `import { startPanel } from './src/browser-support.mjs'; await startPanel(${port}).then((p) => p.stop(), (e) => { console.error(e.message); process.exitCode = 1 })`],
      { cwd: panelDir, encoding: 'utf8', timeout: LIMIT_MS, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: empty, FIT_SIN_BUILD: '1' } },
    )
    assert.notEqual(r.signal, 'SIGTERM', `the run hung until the test cut it at ${LIMIT_MS} ms:\n${r.stderr}`)
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /falta el navegador chromium de Playwright \d/)
    assert.match(r.stderr, /npx playwright install chromium/)
    // No example server is left holding the port.
    const free = await new Promise((resolve) => {
      const s = net.createServer()
      s.once('error', () => resolve(false))
      s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)))
    })
    assert.ok(free, `the port ${port} is still taken`)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

let browserPresent = true
try { assertBrowserInstalled() } catch { browserPresent = false }

test('a launch that fails after the example server started takes the server down with it', { skip: !browserPresent && 'the browser of this Playwright version is not installed here' }, async () => {
  // Like a test runner, the process does not exit by itself on the error: it ends when nothing keeps its event loop alive. The browser is present for the preflight and the launch fails afterwards (a bad executable path): the old code kept the server alive and the process hung.
  const r = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `import * as pw from 'playwright'; pw.chromium.launch = () => Promise.reject(new Error('launch roto')); const { startPanel } = await import('./src/browser-support.mjs'); await startPanel(8692).catch((e) => { console.error(e.message); process.exitCode = 1 })`],
    { cwd: panelDir, encoding: 'utf8', timeout: LIMIT_MS, env: { ...process.env, FIT_SIN_BUILD: '1' } },
  )
  assert.notEqual(r.signal, 'SIGTERM', `the run hung until the test cut it at ${LIMIT_MS} ms:\n${r.stderr}`)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /launch roto/)
})
