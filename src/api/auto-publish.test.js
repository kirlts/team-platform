// UD-070: a valid proposal is published by the analysis itself, in the transaction that closes its job.
// Every check is a prohibition: nothing is published twice, nothing invalid is published, nobody confirms.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { parseTemplate } from '../domain/template-file.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'

async function team (opts = {}) {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, autoPublish: 'default', worker: true, ...opts })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  env.send = async (cookie, text) => (await postInput(env, cookie, { text })).json().input_id
  env.settled = (id, cookie = env.c.ana) => until(async () => {
    const v = (await env.api('GET', `/inputs/${id}`, cookie)).json()
    return ['published', 'proposed', 'failed'].includes(v.status) ? v : null
  })
  return env
}

const countMessages = (env) => get(env.db, 'SELECT COUNT(*) AS n FROM messages').n

/** Analyzer variants that return the shape of the real contract with a different proposal. */
const withProposal = (change) => async (bundle, opts) => {
  const r = await fakeAnalyze(bundle, opts)
  return { ...r, proposal: change(r.proposal, bundle) }
}

test('UD-070 · the default is automatic publication and a valid proposal is published with no confirmation', async () => {
  const env = await team()
  assert.equal((await env.api('GET', '/settings/publication', env.c.ana)).json().auto_publish, true)
  const id = await env.send(env.c.ana, 'algo que pasó')
  const view = await env.settled(id)
  assert.equal(view.status, 'published')
  assert.equal(view.error_code, null)
  assert.equal(countMessages(env), 1)
  assert.equal(view.message_ids.length, 1)
  assert.equal(view.messages[0].title, 'Mensaje de prueba')
  assert.equal(view.messages[0].status, 'open')
  const message = (await env.api('GET', `/messages/${view.message_ids[0]}`, env.c.beto)).json()
  assert.equal(message.author_id, String(get(env.db, 'SELECT id FROM members WHERE email = ?', 'ana@x.org').id))
  assert.equal(message.version, 1)
  assert.equal(message.edited_at, null)
  await env.close()
})

test('UD-070 · the publication notices reach the team and the job reports published with the message ids', async () => {
  const env = await team()
  const id = await env.send(env.c.ana, 'avisos')
  const view = await env.settled(id)
  const events = all(env.db, 'SELECT kind, member_id, data_json FROM job_events ORDER BY seq').map((e) => ({ ...e, data: JSON.parse(e.data_json ?? '{}') }))
  const notices = events.filter((e) => e.kind === 'message')
  assert.equal(notices.length, 1)
  assert.equal(notices[0].member_id, null) // the whole team, as with the manual publication
  assert.equal(notices[0].data.message_id, Number(view.message_ids[0]))
  const done = events.filter((e) => e.kind === 'done').at(-1)
  assert.equal(done.data.input_status, 'published')
  assert.deepEqual(done.data.message_ids, view.message_ids)
  await env.close()
})

test('UD-070 · an empty proposal publishes nothing and stays visible to its sender as proposed with publish_blocked', async () => {
  const env = await team({ modules: { analyze: withProposal((p) => ({ ...p, messages: [] })) } })
  const id = await env.send(env.c.ana, 'nada accionable')
  const view = await env.settled(id)
  assert.equal(view.status, 'proposed')
  assert.equal(view.error_code, 'publish_blocked')
  assert.equal(countMessages(env), 0)
  assert.deepEqual(view.message_ids, [])
  await env.close()
})

test('UD-070 · a proposal that does not validate (required template field missing) is not published; the sender fixes and publishes it by hand', async () => {
  const env = await team({
    modules: { analyze: withProposal((p, b) => ({ ...p, messages: p.messages.map((m) => ({ ...m, area_id: b.areas.find((a) => a.title === 'Error').id, template_id: b.templates.find((t) => t.area_id === b.areas.find((a) => a.title === 'Error').id).id, fields: {} })) })) }
  })
  const id = await env.send(env.c.ana, 'se rompe')
  const view = await env.settled(id)
  assert.equal(view.status, 'proposed')
  assert.equal(view.error_code, 'publish_blocked')
  assert.equal(countMessages(env), 0)
  const blocked = get(env.db, "SELECT detail_json FROM audit_log WHERE action = 'input.publish.blocked'")
  assert.equal(JSON.parse(blocked.detail_json).code, 'fields_invalid')

  const draft = { messages: [{ ...view.proposal.messages[0], fields: { steps: 'abrir', expected: 'guarda', actual: 'no guarda' } }], discarded: [] }
  assert.equal((await env.api('PATCH', `/inputs/${id}/proposal`, env.c.ana, draft)).statusCode, 200)
  const published = await env.api('POST', `/inputs/${id}/publish`, env.c.ana)
  assert.equal(published.statusCode, 200, published.body)
  const after = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
  assert.equal(after.status, 'published')
  assert.equal(after.error_code, null) // the block is cleared once it is published
  await env.close()
})

test('UD-070 · a failed analysis publishes nothing and its sender sees it as failed', async () => {
  const env = await team({ modules: { analyze: async () => ({ status: 'refusal', explanation: 'no' }) } })
  const id = await env.send(env.c.ana, 'rechazado')
  const view = await env.settled(id)
  assert.equal(view.status, 'failed')
  assert.equal(countMessages(env), 0)
  await env.close()
})

test('UD-070 · the Editor knob auto_publish returns to the review: the proposal waits as proposed until its sender publishes it', async () => {
  const env = await team()
  assert.equal((await env.api('PATCH', '/settings/publication', env.c.ana, { auto_publish: false })).statusCode, 403)
  assert.equal((await env.api('GET', '/settings/publication', env.c.ana)).json().auto_publish, true)
  const off = await env.api('PATCH', '/settings/publication', env.c.ed, { auto_publish: false })
  assert.equal(off.statusCode, 200)
  assert.equal(off.json().auto_publish, false)
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'settings.publication'").n, 1)

  const id = await env.send(env.c.ana, 'esperar')
  const view = await env.settled(id)
  assert.equal(view.status, 'proposed')
  assert.equal(view.error_code, null)
  assert.equal(countMessages(env), 0)
  assert.equal((await env.api('POST', `/inputs/${id}/publish`, env.c.beto)).statusCode, 404) // someone else's input does not exist
  assert.equal((await env.api('POST', `/inputs/${id}/publish`, env.c.ana)).statusCode, 200)
  assert.equal(countMessages(env), 1)

  // On again: the next input publishes by itself.
  await env.api('PATCH', '/settings/publication', env.c.ed, { auto_publish: true })
  const second = await env.settled(await env.send(env.c.ana, 'otra vez solo'))
  assert.equal(second.status, 'published')
  await env.close()
})

test('UD-070 · publishing never duplicates: a published input is a 409 to publish, a 409 to reprocess (sender and Editor) and a duplicate when sent again', async () => {
  const env = await team()
  const id = await env.send(env.c.ana, 'una sola vez')
  const view = await env.settled(id)
  assert.equal(countMessages(env), 1)

  const again = await env.api('POST', `/inputs/${id}/publish`, env.c.ana)
  assert.equal(again.statusCode, 409)
  assert.equal(again.json().code, 'already_published')
  for (const who of ['ana', 'ed']) {
    const r = await env.api('POST', `/inputs/${id}/reprocess`, env.c[who])
    assert.equal(r.statusCode, 409, `${who}: ${r.body}`)
    assert.equal(r.json().code, 'not_reprocessable')
  }
  const resent = await postInput(env, env.c.ana, { text: 'una sola vez' })
  assert.equal(resent.statusCode, 200)
  assert.equal(resent.json().duplicate, true)
  assert.equal(countMessages(env), 1)
  assert.deepEqual((await env.api('GET', `/inputs/${id}`, env.c.ana)).json().message_ids, view.message_ids)
  await env.close()
})

test('UD-070 · a second analysis job for an already published input (queue retry, stray job) writes nothing', async () => {
  const env = await team()
  const id = await env.send(env.c.ana, 'reintento de la cola')
  await env.settled(id)
  assert.equal(countMessages(env), 1)
  const jobId = env.queue.enqueue('analyze', { input_id: Number(id) }, { inputId: Number(id) })
  await until(() => get(env.db, 'SELECT status FROM jobs WHERE id = ?', jobId).status === 'done')
  assert.equal(countMessages(env), 1)
  assert.equal((await env.api('GET', `/inputs/${id}`, env.c.ana)).json().status, 'published')
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'input.publish'").n, 1)
  await env.close()
})

test('UD-070 · two simultaneous manual publications of one proposal create the messages once', async () => {
  const env = await team({ autoPublish: false })
  const id = await env.send(env.c.ana, 'carrera')
  await env.settled(id)
  const results = await Promise.all([env.api('POST', `/inputs/${id}/publish`, env.c.ana), env.api('POST', `/inputs/${id}/publish`, env.c.ana)])
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409])
  assert.equal(countMessages(env), 1)
  await env.close()
})

test('UD-070 · the tray is the history: every state of one\'s own inputs, newest first, paginated, with the messages of the published ones', async () => {
  const env = await team({ modules: { analyze: async (bundle, opts) => (bundle.text === 'falla' ? { status: 'refusal' } : fakeAnalyze(bundle, opts)) } })
  const ok1 = await env.send(env.c.ana, 'uno')
  await env.settled(ok1)
  const bad = await env.send(env.c.ana, 'falla')
  await env.settled(bad)
  env.worker.stop?.()
  await env.worker.stop()
  const queued = await env.send(env.c.ana, 'en cola') // no worker running: stays queued
  await env.send(env.c.beto, 'de otra persona')

  const all3 = await env.api('GET', '/inputs?mine=1&order=desc', env.c.ana)
  assert.equal(all3.statusCode, 200)
  const body = all3.json()
  assert.equal(body.total, 3)
  assert.deepEqual(body.items.map((i) => i.id), [queued, bad, ok1].map(String))
  assert.deepEqual(body.items.map((i) => i.status), ['queued', 'failed', 'published'])
  assert.equal(body.items[2].messages.length, 1)
  assert.equal(body.items[2].messages[0].title, 'Mensaje de prueba')
  assert.equal(body.items[2].messages[0].edited_at, null)
  assert.ok(body.items[1].error)

  const page = (await env.api('GET', '/inputs?mine=1&order=desc&limit=2&page=2', env.c.ana)).json()
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].id, String(ok1))
  assert.equal(page.total, 3)
  await env.close()
})

test('UD-070 · the contract documents the knob, the history listing and the edit of a message with its conflict', async () => {
  const env = await team()
  const doc = (await env.app.inject({ method: 'GET', url: '/api/openapi.json' })).json()
  const publication = doc.paths['/api/settings/publication']
  assert.ok(publication.get.responses['200'] && publication.patch.responses['200'])
  assert.deepEqual(publication.patch.requestBody.content['application/json'].schema.required, ['auto_publish'])
  const inputsGet = doc.paths['/api/inputs'].get
  assert.match(inputsGet.description, /historial/)
  const item = inputsGet.responses['200'].content['application/json'].schema.properties.items.items.properties
  for (const key of ['status', 'messages', 'message_ids', 'error_code', 'updated_at', 'percent', 'phrase']) assert.ok(item[key], key)
  const detail = doc.paths['/api/messages/{id}'].get.responses['200'].content['application/json'].schema.properties
  for (const key of ['version', 'edited_at', 'edits']) assert.ok(detail[key], key)
  await env.close()
})
