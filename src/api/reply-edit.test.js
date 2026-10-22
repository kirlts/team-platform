// UD-253 (H-3714): the author of a reply edits its text in place, with the optimistic concurrency of a message edit
// (UD-071). Nobody else edits it, an Editor included. A deleted reply is a 404. The same text again does not bump the
// version. Attachments stay; only a reply with attachments may be left without text. Every real edit is audited.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all } from '../db/index.js'
import { addMember, login, makeEnv, multipart, postInput, until } from '../testing/helpers.js'

async function team () {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, worker: true })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

let inputs = 0

/** A message of Ana with one reply of Beto; returns their ids. */
async function threadWithReply (env, replyFields = { body: 'texto original' }) {
  const { input_id: id } = (await postInput(env, env.c.ana, { text: `consulta ${++inputs}` })).json()
  const view = await until(async () => {
    const v = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
    return v.status === 'proposed' ? v : null
  })
  const messageId = (await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: view.proposal.messages })).json().message_ids[0]
  const { payload, headers } = await multipart(replyFields, [])
  const r = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/replies`, payload, headers: { ...headers, cookie: env.c.beto, 'x-team-request': 'panel' } })
  assert.equal(r.statusCode, 201, r.body)
  const reply = r.json().replies.at(-1)
  return { messageId, replyId: reply.id, reply }
}

const edit = (env, cookie, messageId, replyId, payload) => env.api('PATCH', `/messages/${messageId}/replies/${replyId}`, cookie, payload)

test('the author edits the text of a reply: the version goes up, edited_at is set and the thread shows the new text', async () => {
  const env = await team()
  const { messageId, replyId, reply } = await threadWithReply(env)
  assert.equal(reply.version, 1)
  assert.equal(reply.edited_at, null)
  const r = await edit(env, env.c.beto, messageId, replyId, { body: 'texto corregido', version: 1 })
  assert.equal(r.statusCode, 200, r.body)
  const edited = r.json().replies.find((x) => x.id === replyId)
  assert.equal(edited.body, 'texto corregido')
  assert.equal(edited.version, 2)
  assert.ok(edited.edited_at)
  const seen = (await env.api('GET', `/messages/${messageId}`, env.c.ana)).json().replies.find((x) => x.id === replyId)
  assert.equal(seen.body, 'texto corregido')
})

test('another member and an Editor are refused with not_reply_author', async () => {
  const env = await team()
  const { messageId, replyId } = await threadWithReply(env)
  for (const cookie of [env.c.ana, env.c.ed]) {
    const r = await edit(env, cookie, messageId, replyId, { body: 'ajeno', version: 1 })
    assert.equal(r.statusCode, 403)
    assert.equal(r.json().code, 'not_reply_author')
  }
  const seen = (await env.api('GET', `/messages/${messageId}`, env.c.ana)).json().replies[0]
  assert.equal(seen.body, 'texto original')
})

test('a stale version is a 409 edit_conflict carrying the current version, and nothing is written', async () => {
  const env = await team()
  const { messageId, replyId } = await threadWithReply(env)
  assert.equal((await edit(env, env.c.beto, messageId, replyId, { body: 'primera', version: 1 })).statusCode, 200)
  const r = await edit(env, env.c.beto, messageId, replyId, { body: 'segunda', version: 1 })
  assert.equal(r.statusCode, 409)
  assert.equal(r.json().code, 'edit_conflict')
  assert.equal(r.json().version, 2)
  assert.equal((await env.api('GET', `/messages/${messageId}`, env.c.beto)).json().replies[0].body, 'primera')
})

test('repeating the same edit keeps the version and leaves no second audit row', async () => {
  const env = await team()
  const { messageId, replyId } = await threadWithReply(env)
  assert.equal((await edit(env, env.c.beto, messageId, replyId, { body: 'igual', version: 1 })).json().replies[0].version, 2)
  const again = await edit(env, env.c.beto, messageId, replyId, { body: 'igual', version: 2 })
  assert.equal(again.statusCode, 200)
  assert.equal(again.json().replies[0].version, 2)
  const rows = all(env.db, "SELECT * FROM audit_log WHERE action = 'reply.edit'")
  assert.equal(rows.length, 1)
  assert.equal(rows[0].entity, 'reply')
  assert.equal(String(rows[0].entity_id), String(replyId))
  assert.equal(JSON.parse(rows[0].detail_json ?? rows[0].detail).version, 2)
})

test('a deleted reply, or a reply of another message, is a 404', async () => {
  const env = await team()
  const { messageId, replyId } = await threadWithReply(env)
  const other = await threadWithReply(env)
  assert.equal((await edit(env, env.c.beto, other.messageId, replyId, { body: 'x', version: 1 })).statusCode, 404)
  assert.equal((await env.api('DELETE', `/messages/${messageId}/replies/${replyId}?confirm=true`, env.c.beto)).statusCode, 200)
  assert.equal((await edit(env, env.c.beto, messageId, replyId, { body: 'x', version: 1 })).statusCode, 404)
})

test('empty text is refused for a reply without attachments and accepted for one with them, which keep their attachments', async () => {
  const env = await team()
  const plain = await threadWithReply(env)
  const empty = await edit(env, env.c.beto, plain.messageId, plain.replyId, { body: '   ', version: 1 })
  assert.equal(empty.statusCode, 400)
  assert.equal(empty.json().code, 'reply_empty')

  const withLink = await threadWithReply(env, { body: 'con enlace', links: 'https://example.org/doc' })
  assert.equal(withLink.reply.attachments.length, 1)
  const r = await edit(env, env.c.beto, withLink.messageId, withLink.replyId, { body: '', version: 1 })
  assert.equal(r.statusCode, 200, r.body)
  const after = r.json().replies.find((x) => x.id === withLink.replyId)
  assert.equal(after.body, '')
  assert.deepEqual(after.attachments.map((a) => a.id), withLink.reply.attachments.map((a) => a.id))
})

test('the body requires body and version and refuses unknown fields', async () => {
  const env = await team()
  const { messageId, replyId } = await threadWithReply(env)
  assert.equal((await edit(env, env.c.beto, messageId, replyId, { body: 'x' })).statusCode, 400)
  assert.equal((await edit(env, env.c.beto, messageId, replyId, { body: 'x', version: 1, kind: 'fix' })).statusCode, 400)
})
