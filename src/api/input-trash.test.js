// Soft-lock TP-01, TP-07, TP-08 (issue 8): what a person deleted or discarded is listed after the 8 s of the notice, and a deleted send
// is purged only once its retention is over. The retention is a knob (DELETED_INPUTS_RETENTION_DAYS, 30 days by default).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { get } from '../db/index.js'
import { purgeDeletedInputs } from '../domain/inputs.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

const DAY = 24 * 3600 * 1000

async function team () {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, worker: true })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

async function proposed (env, cookie, text) {
  const { input_id: id } = (await postInput(env, cookie, { text })).json()
  await until(async () => ((await env.api('GET', `/inputs/${id}`, cookie)).json().status === 'proposed' ? true : null))
  return id
}

test('GET /inputs?mine=1&deleted=1 lists the sends the person deleted, and restore takes them out of that list', async () => {
  const env = await team()
  const gone = await proposed(env, env.c.ana, 'se borra')
  const kept = await proposed(env, env.c.ana, 'se queda')
  const others = await proposed(env, env.c.beto, 'de otra persona')
  for (const [id, cookie] of [[gone, env.c.ana], [others, env.c.beto]]) assert.equal((await env.api('DELETE', `/inputs/${id}?confirm=true`, cookie)).statusCode, 200)
  const listed = async (cookie, query = '?mine=1&deleted=1') => (await env.api('GET', `/inputs${query}`, cookie)).json().items.map((i) => i.id)
  assert.deepEqual(await listed(env.c.ana), [gone], 'only the sends of the person that were deleted')
  assert.deepEqual(await listed(env.c.ana, '?mine=1'), [kept], 'the plain list still ignores them')
  assert.equal((await env.api('GET', '/inputs?mine=1&deleted=2', env.c.ana)).statusCode, 400)
  assert.equal((await env.api('POST', `/inputs/${gone}/restore`, env.c.ana)).statusCode, 200)
  assert.deepEqual(await listed(env.c.ana), [])
  await env.close()
})

test('the retention of a deleted send is a knob with a default of 30 days', async () => {
  const env = await team()
  assert.equal(env.config.worker.deletedInputsRetentionDays, 30)
  await env.close()
})

test('purgeDeletedInputs removes the sends deleted longer ago than the retention and keeps the younger ones', async () => {
  const env = await team()
  const old = await proposed(env, env.c.ana, 'borrado hace mucho')
  const recent = await proposed(env, env.c.ana, 'borrado ayer')
  const live = await proposed(env, env.c.ana, 'vivo')
  for (const id of [old, recent]) assert.equal((await env.api('DELETE', `/inputs/${id}?confirm=true`, env.c.ana)).statusCode, 200)
  const now = Date.now()
  env.db.prepare('UPDATE inputs SET deleted_at = ? WHERE id = ?').run(now - 31 * DAY, old)
  env.db.prepare('UPDATE inputs SET deleted_at = ? WHERE id = ?').run(now - 1 * DAY, recent)
  const result = await purgeDeletedInputs({ db: env.db, config: env.config, queue: env.queue, events: env.events, now: () => now }, 30)
  assert.equal(result.inputs, 1)
  assert.equal(get(env.db, 'SELECT 1 AS x FROM inputs WHERE id = ?', old), undefined, 'the old one is gone for good')
  assert.ok(get(env.db, 'SELECT 1 AS x FROM inputs WHERE id = ?', recent), 'the recent one is still restorable')
  assert.ok(get(env.db, 'SELECT 1 AS x FROM inputs WHERE id = ?', live))
  assert.equal((await env.api('POST', `/inputs/${recent}/restore`, env.c.ana)).statusCode, 200)
  assert.equal((await env.api('POST', `/inputs/${old}/restore`, env.c.ana)).statusCode, 404)
  await env.close()
})

test('GET /messages/:id?include_deleted=true lists the deleted replies of the thread, and restore brings one back', async () => {
  const env = await team()
  const id = await proposed(env, env.c.ana, 'con respuestas')
  const view = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
  const question = (await env.api('GET', '/areas', env.c.ana)).json().find((a) => a.title === 'Pregunta')
  const published = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: [{ ...view.proposal.messages[0], title: 'hilo', body: 'cuerpo', area_id: question.id, template_id: question.templates[0].id, fields: { question: 'hilo' }, assignee_ids: [] }] })
  assert.equal(published.statusCode, 200, published.body)
  const messageId = published.json().message_ids[0]
  const reply = await env.api('POST', `/messages/${messageId}/replies`, env.c.beto, { body: 'una respuesta' })
  assert.equal(reply.statusCode, 201, reply.body)
  const replyId = reply.json().replies[0].id
  assert.deepEqual((await env.api('GET', `/messages/${messageId}?include_deleted=true`, env.c.ana)).json().deleted_replies ?? [], [])
  assert.equal((await env.api('DELETE', `/messages/${messageId}/replies/${replyId}?confirm=true`, env.c.beto)).statusCode, 200)
  const withDeleted = (await env.api('GET', `/messages/${messageId}?include_deleted=true`, env.c.ana)).json()
  assert.deepEqual(withDeleted.deleted_replies.map((r) => r.id), [replyId])
  assert.ok(withDeleted.deleted_replies[0].deleted_at, 'each one carries deleted_at')
  assert.equal((await env.api('GET', `/messages/${messageId}`, env.c.ana)).json().deleted_replies, undefined, 'the plain read does not carry them')
  assert.equal((await env.api('POST', `/replies/${replyId}/restore`, env.c.beto)).statusCode, 200)
  assert.deepEqual((await env.api('GET', `/messages/${messageId}?include_deleted=true`, env.c.ana)).json().deleted_replies ?? [], [])
  await env.close()
})
