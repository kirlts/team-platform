// UD-258: the Editor reprocesses a published input. Its messages go to the trash (UD-240) with their replies, the
// proposal is dropped and the input is analyzed again with the current model and areas. Every check is a prohibition
// or a measurable effect: no live message of the old analysis, nothing lost, nothing for a member.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

async function team () {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, autoPublish: 'default', worker: true })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  env.published = async (text) => {
    const id = (await postInput(env, env.c.ana, { text })).json().input_id
    const view = await until(async () => {
      const v = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
      return v.status === 'published' ? v : null
    })
    return { id, view }
  }
  return env
}

test('UD-258 · the Editor reprocesses a published input: messages to the trash with their replies, input queued, then published again', async () => {
  const env = await team()
  const { id, view } = await env.published('algo que ya se procesó')
  const messageId = view.message_ids[0]
  assert.equal((await env.api('POST', `/messages/${messageId}/replies`, env.c.beto, { body: 'ya está' })).statusCode, 201)
  assert.equal((await env.api('POST', `/messages/${messageId}/close`, env.c.ed)).statusCode, 200)

  const res = await env.api('POST', `/inputs/${id}/reprocess`, env.c.ed)
  assert.equal(res.statusCode, 202, res.body)
  assert.deepEqual(res.json().set_aside, { messages: 1, replies: 1 })
  const audit = get(env.db, "SELECT member_id, detail_json FROM audit_log WHERE action = 'input.reprocess'")
  assert.equal(audit.member_id, get(env.db, 'SELECT id FROM members WHERE email = ?', 'ed@x.org').id)
  const detail = JSON.parse(audit.detail_json)
  assert.equal(detail.messages, 1)
  assert.equal(detail.replies, 1)
  assert.equal(detail.answered_or_closed, 1)

  // The old message is in the trash, not live, with its thread intact; the old proposal is gone.
  assert.equal((await env.api('GET', `/messages/${messageId}`, env.c.ed)).statusCode, 404)
  const trash = (await env.api('GET', '/messages?deleted=1', env.c.ed)).json().items
  assert.deepEqual(trash.map((m) => m.id), [String(messageId)])

  // The new analysis publishes again; the old one stays in the trash and comes back with its reply when restored.
  const again = await until(async () => {
    const v = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
    return v.status === 'published' && v.message_ids.every((m) => String(m) !== String(messageId)) ? v : null
  })
  assert.equal(again.message_ids.length, 1)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM messages WHERE input_id = ? AND deleted_at IS NULL', id).n, 1)
  const restored = await env.api('POST', `/messages/${messageId}/restore`, env.c.ed)
  assert.equal(restored.statusCode, 200)
  const back = restored.json()
  assert.equal(back.replies.length, 1)
  assert.equal(back.status, 'closed')
  await env.close()
})

test('UD-258 · only an Editor reprocesses a published input; nothing moves for anybody else', async () => {
  const env = await team()
  const { id } = await env.published('de Ana')
  const before = all(env.db, 'SELECT id, deleted_at FROM messages')
  assert.equal((await env.api('POST', `/inputs/${id}/reprocess`, env.c.beto)).statusCode, 404, 'another member: the input does not exist')
  assert.equal((await env.api('POST', `/inputs/${id}/reprocess`, env.c.ana)).statusCode, 403, 'its sender, not an Editor')
  assert.deepEqual(all(env.db, 'SELECT id, deleted_at FROM messages'), before)
  assert.equal(get(env.db, 'SELECT status FROM inputs WHERE id = ?', id).status, 'published')
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'input.reprocess'").n, 0)
  await env.close()
})

test('UD-258 · an in-flight input is still a 409 not_reprocessable', async () => {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, autoPublish: 'default' })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  const ed = await login(env, 'ed@x.org')
  const id = (await postInput(env, ed, { text: 'en cola' })).json().input_id
  const r = await env.app.inject({ method: 'POST', url: `/api/inputs/${id}/reprocess`, headers: { cookie: ed, 'x-team-request': 'panel' } })
  assert.equal(r.statusCode, 409)
  assert.equal(r.json().code, 'not_reprocessable')
  await env.close()
})
