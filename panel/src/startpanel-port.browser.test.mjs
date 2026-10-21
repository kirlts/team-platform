// H-900: a test never talks to a server that is not its own. A taken port makes startPanel fail, with the port in the message.
import assert from 'node:assert'
import { test } from 'node:test'
import { startPanel } from './browser-support.mjs'

test('startPanel refuses a port that is already taken instead of talking to the other server', async () => {
  const port = Number(process.env.PANEL_PORT_TAKEN_PORT ?? 8918)
  const first = await startPanel(port, { build: false })
  try {
    await assert.rejects(() => startPanel(port, { build: false }), new RegExp(`puerto ${port}`))
  } finally {
    await first.stop()
  }
})
