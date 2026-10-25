// UD-240 (H-3700, H-3701): a published message and a reply are soft-deleted and restored. The sender or an Editor
// deletes a message; the author or an Editor deletes a reply. Every read ignores what is deleted: the list, the
// detail (404), the counts, the search, the thread, the summary and the attachment access. The message's state
// follows its live replies. Each deletion and restoration leaves its audit row.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { addAgent, addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

async function team () {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, worker: true })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

async function publish (env, cookie, title, assigned = []) {
  const { input_id: id } = (await postInput(env, cookie, { text: title })).json()
  const view = await until(async () => {
    const v = (await env.api('GET', `/inputs/${id}`, cookie)).json()
    return v.status === 'proposed' ? v : null
  })
  const areas = (await env.api('GET', '/areas', cookie)).json()
  const question = areas.find((a) => a.title === 'Pregunta')
  const r = await env.api('POST', `/inputs/${id}/publish`, cookie, { messages: [{ ...view.proposal.messages[0], title, body: `cuerpo ${title}`, area_id: question.id, template_id: question.templates[0].id, fields: { question: title }, assignee_ids: assigned }] })
  assert.equal(r.statusCode, 200, r.body)
  return { inputId: id, messageId: r.json().message_ids[0], areaId: question.id }
}

const ids = async (env, cookie, query = '') => (await env.api('GET', `/messages${query}`, cookie)).json().items.map((m) => m.id)
const auditRows = (env, action) => all(env.db, 'SELECT * FROM audit_log WHERE action = ? ORDER BY id', action)

test('UD-240 · a message is deleted by its sender or an Editor, disappears from every read, and comes back with restore', async () => {
  const env = await team()
  const { messageId, inputId, areaId } = await publish(env, env.c.ana, 'borrable', [3])
  const other = await publish(env, env.c.ana, 'queda', [3])
  assert.equal((await env.api('POST', `/messages/${messageId}/replies`, env.c.beto, { body: 'una respuesta con cormorán' })).statusCode, 201)
  const attachmentId = (await env.api('GET', `/messages/${messageId}`, env.c.ana)).json().attachments[0]?.id

  // Without confirmation nothing happens; an agent is refused (a person of the team deletes, UD-287); the sender deletes.
  assert.equal((await env.api('DELETE', `/messages/${messageId}`, env.c.ana)).statusCode, 400)
  const agent = await addAgent(env, env.c.ed)
  const refused = await agent('DELETE', `/messages/${messageId}?confirm=true`)
  assert.equal(refused.statusCode, 403)
  assert.equal(refused.json().code, 'not_message_author')
  assert.equal((await env.api('DELETE', `/messages/${messageId}?confirm=true`, env.c.ana)).statusCode, 204)
  assert.equal((await env.api('DELETE', `/messages/${messageId}?confirm=true`, env.c.ana)).statusCode, 404, 'already deleted')

  // Every read ignores it.
  assert.equal((await env.api('GET', `/messages/${messageId}`, env.c.ana)).statusCode, 404)
  assert.equal((await env.api('GET', `/messages/${messageId}`, env.c.ed)).statusCode, 404)
  assert.deepEqual(await ids(env, env.c.ana), [other.messageId])
  assert.deepEqual(await ids(env, env.c.beto, '?for=me'), [other.messageId])
  assert.deepEqual(await ids(env, env.c.beto, '?replies=1'), [])
  assert.deepEqual(await ids(env, env.c.ana, '?q=cormor%C3%A1n'), [], 'the text of a reply of a deleted message is not found')
  assert.deepEqual(await ids(env, env.c.ana, '?q=borrable'), [])
  const summary = (await env.api('GET', '/messages/summary', env.c.beto)).json()
  assert.equal(summary.mine.total, 1)
  assert.equal(summary.areas.find((a) => a.area_id === String(areaId)).open, 1)
  const area = (await env.api('GET', '/areas', env.c.ana)).json().find((a) => a.id === String(areaId))
  assert.equal(area.open_count, 1)
  assert.equal(area.unresolved_count, 1)
  const input = (await env.api('GET', `/inputs/${inputId}`, env.c.ana)).json()
  assert.deepEqual(input.messages, [], 'the input no longer lists the deleted message')
  if (attachmentId) {
    assert.equal((await env.api('GET', `/attachments/${attachmentId}`, env.c.beto)).statusCode, 404, 'the team no longer reads its attachments')
    assert.notEqual((await env.api('GET', `/attachments/${attachmentId}`, env.c.ana)).statusCode, 404, 'the input author still does')
  }
  // Writes on a deleted message are a 404 too.
  assert.equal((await env.api('POST', `/messages/${messageId}/replies`, env.c.beto, { body: 'tarde' })).statusCode, 404)
  assert.equal((await env.api('POST', `/messages/${messageId}/close`, env.c.beto)).statusCode, 404)
  assert.equal((await env.api('PATCH', `/messages/${messageId}`, env.c.ana, { version: 1, title: 'x' })).statusCode, 404)

  // An Editor sees it with include_deleted; a member does not.
  assert.equal((await agent('GET', `/messages/${messageId}?include_deleted=true`)).statusCode, 403)
  assert.equal((await env.api('GET', `/messages/${messageId}?include_deleted=true`, env.c.ana)).statusCode, 200) // any person of the team
  const seen = await env.api('GET', `/messages/${messageId}?include_deleted=true`, env.c.ed)
  assert.equal(seen.statusCode, 200)
  assert.ok(seen.json().deleted_at)
  assert.equal(seen.json().replies.length, 1, 'the thread is kept while deleted')

  // Restore: refused to another member, done by the sender, 409 when it is not deleted.
  assert.equal((await agent('POST', `/messages/${messageId}/restore`)).statusCode, 403)
  const back = await env.api('POST', `/messages/${messageId}/restore`, env.c.ana)
  assert.equal(back.statusCode, 200, back.body)
  assert.equal(back.json().deleted_at, null)
  assert.equal(back.json().status, 'answered')
  assert.equal(back.json().replies.length, 1)
  assert.equal((await env.api('POST', `/messages/${messageId}/restore`, env.c.ana)).json().code, 'not_deleted')
  assert.deepEqual(new Set(await ids(env, env.c.ana)), new Set([messageId, other.messageId]))
  assert.deepEqual(await ids(env, env.c.ana, '?q=cormor%C3%A1n'), [messageId])

  // An Editor who did not send it deletes and restores too.
  assert.equal((await env.api('DELETE', `/messages/${messageId}?confirm=true`, env.c.ed)).statusCode, 204)
  assert.equal((await env.api('POST', `/messages/${messageId}/restore`, env.c.ed)).statusCode, 200)

  // Audit: one row per deletion and per restoration, by who did it.
  assert.deepEqual(auditRows(env, 'message.delete').map((r) => [r.entity_id, r.member_id]), [[Number(messageId), 2], [Number(messageId), 1]])
  assert.deepEqual(auditRows(env, 'message.restore').map((r) => [r.entity_id, r.member_id]), [[Number(messageId), 2], [Number(messageId), 1]])
  assert.equal(get(env.db, 'SELECT deleted_at FROM messages WHERE id = ?', messageId).deleted_at, null)
  await env.close()
})

test('UD-240 · a reply is deleted by its author or an Editor; the message goes back to open and returns to answered on restore', async () => {
  const env = await team()
  const { messageId } = await publish(env, env.c.ana, 'con respuestas', [3])
  const first = (await env.api('POST', `/messages/${messageId}/replies`, env.c.beto, { body: 'primera con zorzal' })).json().replies[0]
  const second = (await env.api('POST', `/messages/${messageId}/replies`, env.c.ed, { body: 'segunda' })).json().replies[1]
  const detail = async (cookie = env.c.ana) => (await env.api('GET', `/messages/${messageId}`, cookie)).json()
  assert.equal((await detail()).status, 'answered')

  // Confirmation, permissions, wrong message.
  assert.equal((await env.api('DELETE', `/messages/${messageId}/replies/${first.id}`, env.c.beto)).statusCode, 400)
  const agent = await addAgent(env, env.c.ed)
  const refused = await agent('DELETE', `/messages/${messageId}/replies/${first.id}?confirm=true`)
  assert.equal(refused.statusCode, 403)
  assert.equal(refused.json().code, 'not_reply_author')
  assert.equal((await env.api('DELETE', `/messages/${Number(messageId) + 50}/replies/${first.id}?confirm=true`, env.c.beto)).statusCode, 404)

  // The author deletes the first: the second keeps the message answered; the thread, the count and the search ignore the deleted one.
  const afterFirst = await env.api('DELETE', `/messages/${messageId}/replies/${first.id}?confirm=true`, env.c.beto)
  assert.equal(afterFirst.statusCode, 200, afterFirst.body)
  assert.equal(afterFirst.json().status, 'answered')
  assert.deepEqual(afterFirst.json().replies.map((r) => r.id), [second.id])
  assert.equal(afterFirst.json().reply_count, 1)
  assert.deepEqual(await ids(env, env.c.ana, '?q=zorzal'), [], 'the text of a deleted reply is not found')
  assert.equal((await env.api('DELETE', `/messages/${messageId}/replies/${first.id}?confirm=true`, env.c.beto)).statusCode, 404, 'already deleted')
  const card = (await env.api('GET', '/messages', env.c.ana)).json().items.find((m) => m.id === messageId)
  assert.equal(card.last_reply.id, second.id)
  assert.deepEqual(await ids(env, env.c.beto, '?for=me&replies=1'), [messageId], 'Beto is still the assignee')

  // The Editor deletes the second (not his own author? it is his; delete as Editor the one left): no live reply, the message is open again.
  const afterSecond = await env.api('DELETE', `/messages/${messageId}/replies/${second.id}?confirm=true`, env.c.ed)
  assert.equal(afterSecond.statusCode, 200)
  assert.equal(afterSecond.json().status, 'open')
  assert.equal(afterSecond.json().reply_count, 0)
  assert.deepEqual(afterSecond.json().replies, [])
  assert.deepEqual(await ids(env, env.c.ana, '?replies=1'), [])
  const summary = (await env.api('GET', '/messages/summary', env.c.beto)).json()
  assert.equal(summary.mine.open, 1)
  assert.equal(summary.mine.answered, 0)

  // Restore the first: refused to another member, done by its author, the message is answered again; 409 twice.
  assert.equal((await agent('POST', `/replies/${first.id}/restore`)).statusCode, 403)
  const back = await env.api('POST', `/replies/${first.id}/restore`, env.c.beto)
  assert.equal(back.statusCode, 200, back.body)
  assert.equal(back.json().status, 'answered')
  assert.deepEqual(back.json().replies.map((r) => r.id), [first.id])
  assert.equal((await env.api('POST', `/replies/${first.id}/restore`, env.c.beto)).json().code, 'not_deleted')
  assert.deepEqual(await ids(env, env.c.ana, '?q=zorzal'), [messageId])
  // An Editor restores someone else's reply.
  assert.equal((await env.api('POST', `/replies/${second.id}/restore`, env.c.ed)).statusCode, 200)
  assert.equal((await detail()).replies.length, 2)

  // A closed message keeps `closed` when a reply is deleted or restored.
  assert.equal((await env.api('POST', `/messages/${messageId}/close`, env.c.ana)).statusCode, 200)
  assert.equal((await env.api('DELETE', `/messages/${messageId}/replies/${first.id}?confirm=true`, env.c.beto)).json().status, 'closed')
  assert.equal((await env.api('DELETE', `/messages/${messageId}/replies/${second.id}?confirm=true`, env.c.ed)).json().status, 'closed')
  assert.equal((await env.api('POST', `/messages/${messageId}/reopen`, env.c.ana)).json().status, 'open', 'reopening counts live replies only')
  assert.equal((await env.api('POST', `/replies/${first.id}/restore`, env.c.beto)).json().status, 'answered')

  assert.deepEqual(auditRows(env, 'reply.delete').map((r) => [r.entity_id, r.member_id]), [[Number(first.id), 3], [Number(second.id), 1], [Number(first.id), 3], [Number(second.id), 1]])
  assert.deepEqual(auditRows(env, 'reply.restore').map((r) => [r.entity_id, r.member_id]), [[Number(first.id), 3], [Number(second.id), 1], [Number(first.id), 3]])
  await env.close()
})
