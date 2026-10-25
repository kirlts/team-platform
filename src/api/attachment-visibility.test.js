// A file is readable by whoever its card is drawn for: the list of cards and the file come from one rule (`isInputParty`, `VISIBLE_MESSAGE`).
// Measured in production 2026-10-25: a member opened a card with three captures and all three answered 404 until the message was restored.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addMember, login, makeEnv, multipart, postInput, until } from '../testing/helpers.js'

const PDF = { field: 'files', name: 'captura.pdf', type: 'application/pdf', content: '%PDF-1.4 contenido' }

async function team () {
  const env = await makeEnv({ worker: true, config: { identity: { login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  const bruno = await addMember(env, { email: 'bruno@x.org', name: 'Bruno' })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  env.bruno = bruno
  env.c = { ana: await login(env, 'ana@x.org'), bruno: await login(env, 'bruno@x.org'), ed: await login(env, 'ed@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  env.status = async (url, cookie) => (await env.app.inject({ url: `/api${url}`, headers: { cookie } })).statusCode
  return env
}

async function proposed (env, cookie, fields = { text: 'algo con una captura' }) {
  const id = Number((await postInput(env, cookie, fields, [PDF])).json().input_id)
  const view = await until(async () => {
    const v = (await env.api('GET', `/inputs/${id}`, cookie)).json()
    return v.status === 'proposed' ? v : null
  })
  return { id, view, file: view.attachments[0] }
}

test('an input in analysis: its author reads the file, the rest of the team does not yet; published, all read it', async () => {
  const env = await team()
  const { id, view, file } = await proposed(env, env.c.ana)
  assert.equal(await env.status(`/attachments/${file.id}`, env.c.ana), 200)
  assert.equal(await env.status(`/attachments/${file.id}`, env.c.bruno), 404)
  const pub = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: [{ ...view.proposal.messages[0], attachment_ids: [file.id] }] })
  assert.equal(pub.statusCode, 200, pub.body)
  for (const who of ['ana', 'bruno', 'ed']) assert.equal(await env.status(`/attachments/${file.id}`, env.c[who]), 200, who)
  await env.close()
})

test('send as: the member who had the session reads the files of an input attributed to another, in analysis and published', async () => {
  const env = await team()
  const { id, view, file } = await proposed(env, env.c.ana, { text: 'algo con una captura', as_member_id: String(env.bruno) })
  assert.equal(view.author_id, String(env.bruno))
  assert.equal(view.sent_by_id !== null, true)
  // The sender sees the input in its own list (`getInputView`), so the file it lists is readable; the author of record reads it too.
  assert.equal(await env.status(`/attachments/${file.id}`, env.c.ana), 200, 'sender')
  assert.equal(await env.status(`/attachments/${file.id}`, env.c.bruno), 200, 'author')
  assert.equal(await env.status(`/attachments/${file.id}`, env.c.ed), 404, 'someone else, before publishing')
  const pub = await env.api('POST', `/inputs/${id}/publish`, env.c.bruno, { messages: [{ ...view.proposal.messages[0], attachment_ids: [file.id] }] })
  assert.equal(pub.statusCode, 200, pub.body)
  assert.equal(await env.status(`/attachments/${file.id}`, env.c.ed), 200, 'someone else, published')
  await env.close()
})

test('a deleted message: the people of the team who open it from Borrados read its files and the files of its replies', async () => {
  const env = await team()
  const { id, view, file } = await proposed(env, env.c.ana)
  const pub = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: [{ ...view.proposal.messages[0], attachment_ids: [file.id] }] })
  const messageId = pub.json().message_ids[0]
  const { payload, headers } = await multipart({ body: 'va el manual', kind: 'clarification' }, [PDF])
  const replied = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/replies`, payload, headers: { ...headers, cookie: env.c.ed, 'x-team-request': 'panel' } })
  assert.equal(replied.statusCode, 201, replied.body)
  const replyFile = replied.json().replies[0].attachments[0]
  assert.equal((await env.api('DELETE', `/messages/${messageId}?confirm=true`, env.c.ana)).statusCode, 204)
  // The card that Borrados draws (include_deleted) and its files answer the same.
  assert.equal((await env.api('GET', `/messages/${messageId}?include_deleted=true`, env.c.bruno)).statusCode, 200)
  assert.equal(await env.status(`/attachments/${file.id}`, env.c.bruno), 200)
  assert.equal(await env.status(`/replies/attachments/${replyFile.id}`, env.c.bruno), 200)
  // Restored, nothing changes for them.
  assert.equal((await env.api('POST', `/messages/${messageId}/restore`, env.c.bruno)).statusCode, 200)
  assert.equal(await env.status(`/attachments/${file.id}`, env.c.bruno), 200)
  assert.equal(await env.status(`/replies/attachments/${replyFile.id}`, env.c.bruno), 200)
  await env.close()
})
