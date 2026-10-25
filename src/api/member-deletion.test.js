// DELETE /members/:id (UD-240): a member without history goes for good with their sessions; one with history is a 409
// with the counts unless `purge=true`, which takes their inputs, messages and replies too and frees the orphan files.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { test } from 'node:test'
import { get } from '../db/index.js'
import { deleteMember } from '../domain/members.js'
import { blobPath } from '../domain/storage.js'
import { addAgent, addMember, login, makeEnv, multipart, postInput, until } from '../testing/helpers.js'

async function team (opts = {}) {
  const env = await makeEnv({ ...opts, config: { identity: { login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' }) // id 1
  await addMember(env, { email: 'ana@x.org', name: 'Ana' }) // 2
  await addMember(env, { email: 'beto@x.org', name: 'Beto' }) // 3
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  env.publish = async (cookie, text, files = [], assigneeIds = []) => {
    const { input_id: id } = (await postInput(env, cookie, { text }, files)).json()
    const view = await until(async () => { const v = (await env.api('GET', `/inputs/${id}`, cookie)).json(); return v.status === 'proposed' ? v : null })
    const messages = view.proposal.messages.map((m) => ({ ...m, assignee_ids: assigneeIds, attachment_ids: view.attachments.map((a) => a.id) }))
    const r = await env.api('POST', `/inputs/${id}/publish`, cookie, { messages })
    assert.equal(r.statusCode, 200, r.body)
    return { inputId: id, messageId: r.json().message_ids[0] }
  }
  env.reply = async (cookie, messageId, body, files = []) => {
    const { payload, headers } = await multipart({ body }, files)
    const r = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/replies`, payload, headers: { ...headers, cookie, 'x-team-request': 'panel' } })
    assert.equal(r.statusCode, 201, r.body)
    return r.json()
  }
  return env
}

const png = (name, byte) => ({ name, type: 'image/png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47, byte]) })
const count = (env, sql, ...params) => get(env.db, sql, ...params).n

test('without history the member is deleted with credentials and sessions, and their open session dies', async () => {
  const env = await team()
  assert.equal((await env.api('GET', '/me', env.c.beto)).statusCode, 200)
  const r = await env.api('DELETE', '/members/3?confirm=true', env.c.ed)
  assert.equal(r.statusCode, 200, r.body)
  assert.deepEqual(r.json(), { member_id: '3', deleted: { inputs: 0, messages: 0, replies: 0 } })
  assert.equal(get(env.db, 'SELECT id FROM members WHERE id = 3'), undefined)
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM credentials WHERE member_id = 3'), 0)
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM sessions WHERE member_id = 3'), 0)
  assert.equal((await env.api('GET', '/me', env.c.beto)).statusCode, 401)
  assert.equal((await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'beto@x.org', password: 'una clave larga de prueba 1' } })).statusCode, 401)
  assert.equal((await env.api('GET', '/members', env.c.ed)).json().items.some((m) => m.id === '3'), false)
  const row = get(env.db, "SELECT member_id, detail_json FROM audit_log WHERE action = 'member.delete' AND entity_id = 3")
  assert.equal(row.member_id, 1)
  assert.equal(JSON.parse(row.detail_json).email, 'beto@x.org')
  await env.close()
})

test('without confirm=true nothing happens (400 confirm_required); an unknown member is 404', async () => {
  const env = await team()
  const r = await env.api('DELETE', '/members/3', env.c.ed)
  assert.equal(r.statusCode, 400)
  assert.equal(r.json().code, 'confirm_required')
  assert.ok(get(env.db, 'SELECT id FROM members WHERE id = 3'))
  assert.equal((await env.api('DELETE', '/members/999?confirm=true', env.c.ed)).statusCode, 404)
  await env.close()
})

test('with history the answer is 409 member_has_history with the counts, and nothing is deleted', async () => {
  const env = await team({ worker: true })
  const { messageId } = await env.publish(env.c.beto, 'de Beto')
  const { messageId: other } = await env.publish(env.c.ana, 'de Ana', [], [3])
  await env.reply(env.c.beto, other, 'respondo')
  await env.reply(env.c.beto, other, 'otra vez')
  await env.reply(env.c.ana, messageId, 'a Beto')
  const r = await env.api('DELETE', '/members/3?confirm=true', env.c.ed)
  assert.equal(r.statusCode, 409, r.body)
  assert.equal(r.json().code, 'member_has_history')
  assert.deepEqual({ inputs: r.json().inputs, messages: r.json().messages, replies: r.json().replies }, { inputs: 1, messages: 1, replies: 2 })
  assert.ok(get(env.db, 'SELECT id FROM members WHERE id = 3'))
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM replies'), 3)
  assert.equal((await env.api('GET', '/me', env.c.beto)).statusCode, 200) // the session is untouched
  await env.close()
})

test('an assignment alone is history: 409 without purge, and purge frees the member from the message', async () => {
  const env = await team({ worker: true })
  const { messageId } = await env.publish(env.c.ana, 'para Beto', [], [3])
  const refused = await env.api('DELETE', '/members/3?confirm=true', env.c.ed)
  assert.equal(refused.statusCode, 409)
  assert.deepEqual([refused.json().inputs, refused.json().messages, refused.json().replies], [0, 0, 0])
  assert.equal((await env.api('DELETE', '/members/3?confirm=true&purge=true', env.c.ed)).statusCode, 200)
  assert.deepEqual((await env.api('GET', `/messages/${messageId}`, env.c.ana)).json().assignee_ids, [])
  await env.close()
})

test('purge deletes inputs, messages and replies; a message of another member goes back to open; files shared stay and orphans go', async () => {
  const env = await team({ worker: true })
  const shared = png('shared.png', 1)
  const only = png('only.png', 2)
  // Beto: an input with two files, published with both; Ana publishes the same shared file.
  const mine = await env.publish(env.c.beto, 'de Beto con archivos', [shared, only])
  const anaWithShared = await env.publish(env.c.ana, 'de Ana con el compartido', [shared])
  // Ana's second message: Beto answers it (status answered) with a file of his own; Ana's third: Beto and Ana both answer.
  const answeredByBeto = await env.publish(env.c.ana, 'pregunta de Ana', [], [3])
  const replyFile = png('reply.png', 3)
  await env.reply(env.c.beto, answeredByBeto.messageId, 'mi respuesta', [replyFile])
  const answeredByBoth = await env.publish(env.c.ana, 'otra pregunta de Ana', [], [3])
  await env.reply(env.c.beto, answeredByBoth.messageId, 'Beto')
  await env.reply(env.c.ed, answeredByBoth.messageId, 'Ed')
  // Ed replies on Beto's message; Beto edits his own message.
  await env.reply(env.c.ed, mine.messageId, 'de Ed a Beto')
  assert.equal((await env.api('PATCH', `/messages/${mine.messageId}`, env.c.beto, { version: 1, title: 'Editado' })).statusCode, 200)
  const [sharedSha, onlySha, replySha] = ['shared.png', 'only.png', 'reply.png'].map((n) => get(env.db, 'SELECT sha256 FROM attachments WHERE name = ?', n)?.sha256 ?? get(env.db, 'SELECT sha256 FROM reply_attachments WHERE name = ?', n).sha256)
  for (const sha of [sharedSha, onlySha, replySha]) assert.ok(existsSync(blobPath(env.config, sha)), sha)
  assert.equal(get(env.db, 'SELECT status FROM messages WHERE id = ?', answeredByBeto.messageId).status, 'answered')

  const r = await env.api('DELETE', '/members/3?confirm=true&purge=true', env.c.ed)
  assert.equal(r.statusCode, 200, r.body)
  assert.deepEqual(r.json(), { member_id: '3', deleted: { inputs: 1, messages: 1, replies: 2 } })
  assert.equal(get(env.db, 'SELECT id FROM members WHERE id = 3'), undefined)
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM inputs WHERE author_id = 3'), 0)
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM messages WHERE author_id = 3'), 0)
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM replies WHERE author_id = 3'), 0)
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM replies WHERE message_id = ?', mine.messageId), 0) // Ed's reply on Beto's message went with it
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM message_edits WHERE member_id = 3'), 0)
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM message_assignees WHERE member_id = 3'), 0)
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM jobs WHERE input_id = ?', mine.inputId), 0)
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM proposals WHERE input_id = ?', mine.inputId), 0)
  assert.equal((await env.api('GET', `/messages/${mine.messageId}`, env.c.ed)).statusCode, 404)
  // The messages of others recompute their state: no reply left → open; a reply of someone else left → still answered.
  assert.equal(get(env.db, 'SELECT status FROM messages WHERE id = ?', answeredByBeto.messageId).status, 'open')
  assert.equal(get(env.db, 'SELECT status FROM messages WHERE id = ?', answeredByBoth.messageId).status, 'answered')
  assert.ok(get(env.db, 'SELECT id FROM messages WHERE id = ?', anaWithShared.messageId))
  // Files: the shared one stays (Ana references it), the ones only Beto referenced are gone.
  assert.equal(existsSync(blobPath(env.config, sharedSha)), true)
  assert.equal(existsSync(blobPath(env.config, onlySha)), false)
  assert.equal(existsSync(blobPath(env.config, replySha)), false)
  const detail = JSON.parse(get(env.db, "SELECT detail_json FROM audit_log WHERE action = 'member.delete' AND entity_id = 3").detail_json)
  assert.deepEqual({ inputs: detail.inputs, messages: detail.messages, replies: detail.replies, purge: detail.purge }, { inputs: 1, messages: 1, replies: 2, purge: true })
  assert.ok(count(env, 'SELECT COUNT(*) AS n FROM audit_log WHERE member_id IS NULL') >= 1) // Beto's own audit rows stay, unsigned
  await env.close()
})

test('a closed message of another member keeps closed when the last reply goes', async () => {
  const env = await team({ worker: true })
  const { messageId } = await env.publish(env.c.ana, 'para cerrar', [], [3])
  await env.reply(env.c.beto, messageId, 'listo')
  assert.equal((await env.api('POST', `/messages/${messageId}/close`, env.c.ana)).statusCode, 200)
  assert.equal((await env.api('DELETE', '/members/3?confirm=true&purge=true', env.c.ed)).statusCode, 200)
  assert.equal(get(env.db, 'SELECT status FROM messages WHERE id = ?', messageId).status, 'closed')
  await env.close()
})

test('nobody deletes themselves (409 cannot_delete_self) and the last active Editor stays (409 last_editor)', async () => {
  const env = await team()
  const self = await env.api('DELETE', '/members/1?confirm=true', env.c.ed)
  assert.equal(self.statusCode, 409)
  assert.equal(self.json().code, 'cannot_delete_self')
  assert.match(self.json().message, /propia cuenta/)
  assert.equal((await env.api('GET', '/me', env.c.ed)).statusCode, 200) // the session is untouched
  // Through the API the actor is an active editor other than the target, so the target is never the last one: the rule lives in the domain.
  assert.throws(() => deleteMember(env.db, 1, { actorId: 2 }), (error) => error.status === 409 && error.code === 'last_editor')
  assert.ok(get(env.db, 'SELECT id FROM members WHERE id = 1'))
  // An inactive editor does not count and can be deleted.
  const ed2 = await addMember(env, { email: 'ed2@x.org', name: 'Ed2', role: 'editor' })
  assert.equal((await env.api('PATCH', `/members/${ed2}`, env.c.ed, { active: false })).statusCode, 200)
  assert.throws(() => deleteMember(env.db, 1, { actorId: ed2 }), (error) => error.code === 'last_editor') // Ed is still the only active one
  assert.equal((await env.api('DELETE', `/members/${ed2}?confirm=true`, env.c.ed)).statusCode, 200)
  await env.close()
})

test('an agent receives 403 and nothing changes (a member is a person, UD-287)', async () => {
  const env = await team()
  const r = await (await addAgent(env, env.c.ed))('DELETE', '/members/3?confirm=true')
  assert.equal(r.statusCode, 403)
  assert.ok(get(env.db, 'SELECT id FROM members WHERE id = 3'))
  assert.equal((await env.api('GET', '/me', env.c.beto)).statusCode, 200)
  await env.close()
})
