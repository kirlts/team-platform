// Recipients of a send (UD-291, H-3730): POST /inputs with `recipient_ids`. With recipients they are the assignees of the messages and the
// automatic routing does not reassign; without them it runs as before; an agent among them gets its `execute` job when the message is published.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { addAgent, addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

async function team () {
  const env = await makeEnv({ worker: true, autoPublish: true, config: { identity: { login: { ipMax: 1000 } } } })
  env.ids = {
    ana: await addMember(env, { email: 'ana@x.org', name: 'Ana' }),
    bruno: await addMember(env, { email: 'bruno@x.org', name: 'Bruno' }),
    ed: await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  }
  env.c = { ana: await login(env, 'ana@x.org'), ed: await login(env, 'ed@x.org') }
  await addAgent(env, env.c.ed, 'claude@x.org')
  env.ids.claude = get(env.db, "SELECT id FROM members WHERE email = 'claude@x.org'").id
  return env
}

const assigneesOf = (env, inputId) => all(env.db, 'SELECT DISTINCT a.member_id FROM message_assignees a JOIN messages m ON m.id = a.message_id WHERE m.input_id = ? ORDER BY a.member_id', inputId).map((r) => r.member_id)
const published = (env, id) => until(() => get(env.db, 'SELECT status FROM inputs WHERE id = ?', id).status === 'published')

test('recipients: with recipients they are the assignees and the automatic routing does not reassign', async () => {
  const env = await team()
  const res = await env.app.inject({ method: 'POST', url: '/api/inputs', headers: { cookie: env.c.ana, 'x-team-request': 'panel' }, payload: { text: 'Revisar la caldera', recipient_ids: [String(env.ids.bruno)] } })
  assert.equal(res.statusCode, 202, res.body)
  const id = Number(res.json().input_id)
  await published(env, id)
  assert.deepEqual(assigneesOf(env, id), [env.ids.bruno])
  assert.deepEqual((await env.app.inject({ method: 'GET', url: `/api/inputs/${id}`, headers: { cookie: env.c.ana, 'x-team-request': 'panel' } })).json().recipient_ids, [String(env.ids.bruno)])
  await env.close()
})

test('recipients: without recipients the automatic routing assigns as before', async () => {
  const env = await team()
  // Another member than the first one sends: the first is the author of nothing here, so the routing may assign them.
  const id = Number((await postInput(env, env.c.ed, { text: 'Sin destinatarios' })).json().input_id)
  await published(env, id)
  const first = get(env.db, 'SELECT id FROM members ORDER BY id LIMIT 1').id
  assert.deepEqual(assigneesOf(env, id), [first])
  assert.equal(get(env.db, 'SELECT recipient_ids_json AS r FROM inputs WHERE id = ?', id).r, '[]')
  await env.close()
})

test('recipients: an agent among them gets its execute job when the message is published, with no other route', async () => {
  const env = await team()
  const res = await postInput(env, env.c.ana, { text: 'Arreglar el botón desalineado', recipient_ids: [String(env.ids.claude), String(env.ids.bruno)] })
  assert.equal(res.statusCode, 202, res.body)
  const id = Number(res.json().input_id)
  await published(env, id)
  assert.deepEqual(assigneesOf(env, id), [env.ids.bruno, env.ids.claude].sort((a, b) => a - b))
  const messageId = get(env.db, 'SELECT id FROM messages WHERE input_id = ?', id).id
  const jobs = all(env.db, "SELECT json_extract(payload_json, '$.member_id') AS member_id FROM jobs WHERE kind = 'execute' AND message_id = ?", messageId)
  assert.deepEqual(jobs.map((j) => j.member_id), [env.ids.claude])
  await env.close()
})

test('recipients: an invalid id is 400 recipient_invalid in JSON and multipart, and nothing is created', async () => {
  const env = await team()
  const bad = [['999'], ['abc'], ['-1'], 'not a list']
  for (const value of bad) {
    const res = await env.app.inject({ method: 'POST', url: '/api/inputs', headers: { cookie: env.c.ana, 'x-team-request': 'panel' }, payload: { text: 'Hola', recipient_ids: value } })
    assert.equal(res.statusCode, 400, JSON.stringify(value))
    assert.equal(res.json().code, 'recipient_invalid')
  }
  const multi = await postInput(env, env.c.ana, { text: 'Hola', recipient_ids: ['999'] })
  assert.equal(multi.statusCode, 400)
  assert.equal(multi.json().code, 'recipient_invalid')
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM inputs').n, 0)
  await env.close()
})

test('recipients: a deactivated member is 400 recipient_invalid', async () => {
  const env = await team()
  const res = await env.app.inject({ method: 'PATCH', url: `/api/members/${env.ids.bruno}`, headers: { cookie: env.c.ed, 'x-team-request': 'panel' }, payload: { active: false } })
  assert.equal(res.statusCode, 200, res.body)
  const sent = await postInput(env, env.c.ana, { text: 'Hola', recipient_ids: [String(env.ids.bruno)] })
  assert.equal(sent.statusCode, 400)
  assert.equal(sent.json().code, 'recipient_invalid')
  await env.close()
})

test('recipients: the same text to other recipients is another send', async () => {
  const env = await team()
  const a = await postInput(env, env.c.ana, { text: 'Mismo texto', recipient_ids: [String(env.ids.bruno)] })
  const b = await postInput(env, env.c.ana, { text: 'Mismo texto', recipient_ids: [String(env.ids.claude)] })
  const c = await postInput(env, env.c.ana, { text: 'Mismo texto', recipient_ids: [String(env.ids.bruno)] })
  assert.notEqual(a.json().input_id, b.json().input_id)
  assert.equal(c.json().input_id, a.json().input_id)
  assert.equal(c.json().duplicate, true)
  await env.close()
})

test('recipients: the author is not a recipient, 400 recipient_self, and nothing is created (UD-300)', async () => {
  const env = await team()
  for (const payload of [{ text: 'Para mí', recipient_ids: [String(env.ids.ana)] }, { text: 'Para mí y otro', recipient_ids: [String(env.ids.bruno), String(env.ids.ana)] }]) {
    const res = await env.app.inject({ method: 'POST', url: '/api/inputs', headers: { cookie: env.c.ana, 'x-team-request': 'panel' }, payload })
    assert.equal(res.statusCode, 400, res.body)
    assert.equal(res.json().code, 'recipient_self')
    assert.match(res.json().message, /no se envía a quien lo escribe/)
  }
  const multi = await postInput(env, env.c.ana, { text: 'Multipart', recipient_ids: [String(env.ids.ana)] })
  assert.equal(multi.statusCode, 400)
  assert.equal(multi.json().code, 'recipient_self')
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM inputs').n, 0)
  await env.close()
})

test('recipients: sending in the name of another member, the author is that member, not the session (UD-300)', async () => {
  const env = await team()
  const asBruno = (recipient) => env.app.inject({ method: 'POST', url: '/api/inputs', headers: { cookie: env.c.ana, 'x-team-request': 'panel' }, payload: { text: `Enviado por Ana, de Bruno ${recipient}`, as_member_id: String(env.ids.bruno), recipient_ids: [String(recipient)] } })
  const self = await asBruno(env.ids.bruno)
  assert.equal(self.statusCode, 400, self.body)
  assert.equal(self.json().code, 'recipient_self')
  const toSession = await asBruno(env.ids.ana)
  assert.equal(toSession.statusCode, 202, toSession.body)
  await env.close()
})

test('recipients: the automatic routing never assigns the author to the message they wrote (UD-300)', async () => {
  const env = await team()
  // The stub analyzer assigns the first member of the team; when that member is the author, the system drops them.
  const first = get(env.db, 'SELECT id FROM members ORDER BY id LIMIT 1').id
  const cookie = first === env.ids.ana ? env.c.ana : await login(env, get(env.db, 'SELECT email FROM members WHERE id = ?', first).email)
  const id = Number((await env.app.inject({ method: 'POST', url: '/api/inputs', headers: { cookie, 'x-team-request': 'panel' }, payload: { text: 'Un punto del primer miembro' } })).json().input_id)
  await published(env, id)
  assert.equal(get(env.db, 'SELECT author_id FROM inputs WHERE id = ?', id).author_id, first)
  assert.deepEqual(assigneesOf(env, id), [])
  await env.close()
})

test('recipients: a message is not assigned to its author by publishing or editing it (UD-300)', async () => {
  const env = await team()
  const id = Number((await env.app.inject({ method: 'POST', url: '/api/inputs', headers: { cookie: env.c.ana, 'x-team-request': 'panel' }, payload: { text: 'Revisar', recipient_ids: [String(env.ids.bruno)] } })).json().input_id)
  await published(env, id)
  const messageId = get(env.db, 'SELECT id FROM messages WHERE input_id = ?', id).id
  const version = get(env.db, 'SELECT version FROM messages WHERE id = ?', messageId).version
  const res = await env.app.inject({ method: 'PATCH', url: `/api/messages/${messageId}`, headers: { cookie: env.c.ana, 'x-team-request': 'panel' }, payload: { version, assignee_ids: [env.ids.bruno, env.ids.ana] } })
  assert.equal(res.statusCode, 400, res.body)
  assert.equal(res.json().code, 'assignee_self')
  assert.deepEqual(assigneesOf(env, id), [env.ids.bruno])
  await env.close()
})
