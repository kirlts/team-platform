// H-900: a test never talks to a server that is not its own. A taken port makes startPanel fail, with the port in the message.
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { ROOT, startPanel } from './browser-support.mjs'

test('startPanel refuses a port that is already taken instead of talking to the other server', async () => {
  const port = Number(process.env.PANEL_PORT_TAKEN_PORT ?? 8918)
  const first = await startPanel(port, { build: false })
  try {
    await assert.rejects(() => startPanel(port, { build: false }), new RegExp(`puerto ${port}`))
  } finally {
    await first.stop()
  }
})

test('the example server leaves when the process that started it ends, so a killed run never keeps the port', async () => {
  const port = 8929
  const server = spawn('node', ['dev-server.mjs'], { cwd: ROOT, env: { ...process.env, PANEL_DEV_PORT: String(port), PANEL_DEV_EXIT_WITH_PARENT: '1' }, stdio: ['pipe', 'pipe', 'inherit'] })
  await new Promise((resolve) => server.stdout.on('data', (chunk) => String(chunk).includes('DEVELOPMENT DOUBLE SERVER') && resolve()))
  const left = new Promise((resolve) => server.once('exit', resolve))
  // The parent «dies»: its end of the pipe closes. The exit is the event the test waits for.
  server.stdin.end()
  assert.equal(await left, 0)
})
