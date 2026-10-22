// UD-253 (H-3715): several messages are deleted and restored at once. One request, one transaction: if the actor may not
// delete one of them, nothing is deleted and the 403 lists which. Each message leaves its own audit row.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

async function team () {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, worker: true })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

/** Publishes `n` messages from one input of `cookie`; returns their ids. */
async function publish (env, cookie, n, prefix) {
  const { input_id: id } = (await postInput(env, cookie, { text: prefix })).json()
  const view = await until(async () => {
    const v = (await env.api('GET', `/inputs/${id}`, cookie)).json()
    return v.status === 'proposed' ? v : null
  })
  const question = (await env.api('GET', '/areas', cookie)).json().find((a) => a.title === 'Pregunta')
  const base = { ...view.proposal.messages[0], area_id: question.id, template_id: question.templates[0].id, assignee_ids: [] }
  const messages = Array.from({ length: n }, (_, i) => ({ ...base, title: `${prefix} ${i}`, body: `cuerpo ${i}`, fields: { question: `${prefix} ${i}` } }))
  const r = await env.api('POST', `/inputs/${id}/publish`, cookie, { messages })
  assert.equal(r.statusCode, 200, r.body)
  return r.json().message_ids.map(String)
}

const listed = async (env, cookie, query = '') => (await env.api('GET', `/messages${query}`, cookie)).json().items.map((m) => m.id).sort()
const auditOf = (env, action) => all(env.db, 'SELECT member_id, entity_id FROM audit_log WHERE action = ? ORDER BY id', action)

test('UD-253 · the sender deletes several messages in one request, and restore brings them all back', async () => {
  const env = await team()
  const ana = await publish(env, env.c.ana, 3, 'ana')
  const keep = await publish(env, env.c.ana, 1, 'queda')

  assert.equal((await env.api('POST', '/messages/delete', env.c.ana, { ids: ana })).statusCode, 400, 'without confirm=true nothing happens')
  const r = await env.api('POST', '/messages/delete?confirm=true', env.c.ana, { ids: [...ana, ana[0]] })
  assert.equal(r.statusCode, 200, r.body)
  assert.deepEqual(r.json().ids.sort(), [...ana].sort(), 'a repeated id counts once')
  assert.deepEqual(await listed(env, env.c.ana), keep)
  assert.deepEqual(await listed(env, env.c.ana, '?deleted=1'), [...ana].sort())

  const again = await env.api('POST', '/messages/delete?confirm=true', env.c.ana, { ids: [ana[0], keep[0]] })
  assert.equal(again.statusCode, 404)
  assert.deepEqual(again.json().ids, [ana[0]], 'the 404 names the one already deleted')
  assert.deepEqual(await listed(env, env.c.ana), keep, 'and the other one stays')

  const back = await env.api('POST', '/messages/restore', env.c.ana, { ids: ana })
  assert.equal(back.statusCode, 200, back.body)
  assert.deepEqual(await listed(env, env.c.ana), [...ana, ...keep].sort())
  const twice = await env.api('POST', '/messages/restore', env.c.ana, { ids: ana })
  assert.equal(twice.statusCode, 409)
  assert.equal(twice.json().code, 'not_deleted')
})

test('UD-253 · permissions are all or nothing: one message of someone else refuses the whole request with its id', async () => {
  const env = await team()
  const ana = await publish(env, env.c.ana, 2, 'ana')
  const beto = await publish(env, env.c.beto, 1, 'beto')

  const refused = await env.api('POST', '/messages/delete?confirm=true', env.c.beto, { ids: [...ana, ...beto] })
  assert.equal(refused.statusCode, 403)
  assert.equal(refused.json().code, 'not_message_author')
  assert.deepEqual(refused.json().ids.sort(), [...ana].sort())
  assert.deepEqual(await listed(env, env.c.beto), [...ana, ...beto].sort(), 'nothing was deleted, not even Beto’s own')
  assert.deepEqual(auditOf(env, 'message.delete'), [])

  // The Editor deletes messages of anyone; a member may not restore what is not theirs.
  assert.equal((await env.api('POST', '/messages/delete?confirm=true', env.c.ed, { ids: [...ana, ...beto] })).statusCode, 200)
  const notHers = await env.api('POST', '/messages/restore', env.c.beto, { ids: [...ana, ...beto] })
  assert.equal(notHers.statusCode, 403)
  assert.deepEqual(notHers.json().ids.sort(), [...ana].sort())
  assert.deepEqual(await listed(env, env.c.ed, '?deleted=1'), [...ana, ...beto].sort())
  assert.equal((await env.api('POST', '/messages/restore', env.c.ed, { ids: [...ana, ...beto] })).statusCode, 200)
})

test('UD-253 · each message of a bulk deletion and restoration leaves its own audit row', async () => {
  const env = await team()
  const ids = await publish(env, env.c.ana, 3, 'ana')
  await env.api('POST', '/messages/delete?confirm=true', env.c.ed, { ids })
  await env.api('POST', '/messages/restore', env.c.ana, { ids })
  const idOf = (email) => String(get(env.db, 'SELECT id FROM members WHERE email = ?', email).id)
  const [edId, anaId] = [idOf('ed@x.org'), idOf('ana@x.org')]
  assert.deepEqual(auditOf(env, 'message.delete').map((r) => [String(r.member_id), String(r.entity_id)]).sort(), ids.map((id) => [edId, id]).sort())
  assert.deepEqual(auditOf(env, 'message.restore').map((r) => [String(r.member_id), String(r.entity_id)]).sort(), ids.map((id) => [anaId, id]).sort())
})

test('UD-253 · the list of ids is validated: empty, not integers, or more than a page of the API is a 400', async () => {
  const env = await team()
  for (const ids of [[], ['x'], Array.from({ length: env.config.list.pageMax + 1 }, (_, i) => i + 1)]) {
    assert.equal((await env.api('POST', '/messages/delete?confirm=true', env.c.ana, { ids })).statusCode, 400, JSON.stringify(ids).slice(0, 40))
  }
})
