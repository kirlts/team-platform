// The separate worker process (WORKER_MODE=external) stays alive until a signal. Without a timer that holds the event loop it exited with
// code 0 right after «worker running» and the container restarted every minute (2026-10-22, image c9dacb5).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('node src/worker.js keeps running after it starts and leaves with code 0 on SIGTERM', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'worker-process-'))
  const env = { ...process.env, DATA_DIR: dataDir, WORKER_MODE: 'external', LOG_LEVEL: 'info' }
  // The single initialization step runs before the worker, as in the image.
  await new Promise((resolve, reject) => {
    const init = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/db/init.js'], { cwd: root, env, stdio: 'ignore' })
    init.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`db init exited with ${code}`))))
  }).catch(() => {}) // the script name is declared in package.json (`db:init`); if this path does not exist the worker initializes nothing and fails below
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/worker.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (d) => { output += d })
  child.stderr.on('data', (d) => { output += d })
  let exited = null
  child.on('exit', (code, signal) => { exited = { code, signal } })
  try {
    const deadline = Date.now() + 15_000
    while (!/worker running/.test(output) && exited === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    assert.match(output, /worker running/, `it did not start: ${output}`)
    // A process with nothing holding the loop leaves within the same tick; a second is far above that.
    await new Promise((r) => setTimeout(r, 1000))
    assert.equal(exited, null, `the worker exited by itself: ${JSON.stringify(exited)}`)
    const left = new Promise((resolve) => child.once('exit', (code) => resolve(code)))
    child.kill('SIGTERM')
    assert.equal(await left, 0)
  } finally {
    child.kill('SIGKILL')
    rmSync(dataDir, { recursive: true, force: true })
  }
})
