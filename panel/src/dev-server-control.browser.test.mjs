// H-901: the example server advances the simulated analysis only when the test says so, and goes back to its sample data on order.
// Without this a test that needs «a send being analyzed» raced the server's clock. No page is opened: it talks to the API.
import assert from 'node:assert'
import { after, before, test } from 'node:test'
import { PASSWORD, startPanel } from './browser-support.mjs'

let panel
let cookie = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_CONTROL_PORT ?? 8926), { build: false, stepMs: 20 })
  const res = await fetch(`${panel.origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-team-request': 'panel' }, body: JSON.stringify({ email: 'ana@dev.invalid', password: PASSWORD }) })
  cookie = res.headers.get('set-cookie').split(';')[0]
})

after(async () => {
  await panel?.stop()
})

const call = async (path, init = {}) => {
  const res = await fetch(`${panel.origin}/api${path}`, { ...init, headers: { cookie, 'x-team-request': 'panel', ...init.headers } })
  return res.status === 204 ? null : res.json()
}

const send = async (text) => {
  const form = new FormData()
  form.append('text', text)
  return (await call('/inputs', { method: 'POST', body: form })).input_id
}

test('a held analysis stays queued until the test steps it, and one explicit order finishes it', async () => {
  await panel.control.reset()
  await panel.control.hold()
  const id = await send('Un envío retenido.\n\nOtro punto.')
  assert.equal((await call(`/inputs/${id}`)).status, 'queued')
  await panel.control.step({ inputId: id })
  assert.equal((await call(`/inputs/${id}`)).status, 'analyzing', 'un paso mueve el envío')
  await panel.control.step({ inputId: id, finish: true })
  const done = await call(`/inputs/${id}`)
  assert.equal(done.status, 'proposed')
  assert.ok(done.proposed_count > 0)
})

test('release hands the analysis back to the clock and reset forgets sends and edits', async () => {
  await panel.control.reset()
  await panel.control.hold()
  const id = await send('Otro envío retenido.')
  await panel.control.release()
  // The state is read at the event that ends the analysis, not after a guessed pause.
  const stream = await fetch(`${panel.origin}/api/events`, { headers: { cookie } })
  const reader = stream.body.getReader()
  let said = ''
  while (!new RegExp(`event: done\\ndata: [^\\n]*${id}`).test(said)) {
    const { value, done } = await reader.read()
    assert.ok(!done, 'el flujo de eventos se cerró antes de terminar el análisis')
    said += Buffer.from(value).toString()
  }
  await reader.cancel()
  assert.equal((await call(`/inputs/${id}`)).status, 'proposed')
  await call('/settings/project', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: 'Editada por la prueba' }) })
  await panel.control.reset()
  assert.equal((await call('/inputs')).items.length, 0, 'sin envíos después de reiniciar')
  assert.notEqual((await call('/settings/project')).description, 'Editada por la prueba')
})
