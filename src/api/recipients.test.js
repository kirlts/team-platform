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
  const id = Number((await postInput(env, env.c.ana, { text: 'Sin destinatarios' })).json().input_id)
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
