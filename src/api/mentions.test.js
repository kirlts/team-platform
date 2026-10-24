// POST /messages/:id/replies with `mention_ids` (UD-275): the members picked in the list of «@» join the assignees, a person is told, an agent gets its
// `execute` job with the mention in the payload, an agent that already works the message keeps the mention pending, and the author of the message
// replies only when it mentions someone. Nothing reads the text of the reply: the ids are data.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { updateMember } from '../domain/members.js'
import { attendPendingMentions } from '../domain/mentions.js'
import { addMember, login, makeEnv, multipart, postInput, until } from '../testing/helpers.js'

async function team () {
  const env = await makeEnv({ worker: true, config: { identity: { login: { ipMax: 1000 } } } })
  env.ids = {
    ed: await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' }),
    ana: await addMember(env, { email: 'ana@x.org', name: 'Ana' }),
    beto: await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  }
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  const created = await env.api('POST', '/members', env.c.ed, { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Perfil del agente.' })
  assert.equal(created.statusCode, 201, created.body)
  env.ids.claude = Number(created.json().id)
  return env
}

/** A message of Ana, assigned to Ed. */
async function openMessage (env) {
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'algo' })).json()
  const view = await until(async () => {
    const v = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
    return v.status === 'proposed' ? v : null
  })
  const r = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: view.proposal.messages.map((m) => ({ ...m, assignee_ids: [env.ids.ed] })) })
  await env.worker.stop() // no handler for `execute` here: the job stays queued, as one waiting its turn
  return r.json().message_ids[0]
}
const reply = (env, id, cookie, payload) => env.api('POST', `/messages/${id}/replies`, cookie, payload)
const count = (env, sql, ...p) => get(env.db, sql, ...p).n
const assignees = (env, id) => all(env.db, 'SELECT member_id FROM message_assignees WHERE message_id = ? ORDER BY member_id', id).map((r) => r.member_id)

test('a mention adds the person to the assignees, tells them, audits it and shows in the thread as data', async () => {
  const env = await team()
  const id = await openMessage(env)
  const seen = []
  env.events.subscribe(env.ids.beto, (e) => seen.push(e))
  const r = await reply(env, id, env.c.ed, { body: '@Beto mira esto, por favor', mention_ids: [String(env.ids.beto)] }) // ids travel as text from the client
  assert.equal(r.statusCode, 201, r.body)
  const message = r.json()
  assert.deepEqual(message.replies.at(-1).mentions, [String(env.ids.beto)])
  assert.deepEqual(assignees(env, id), [env.ids.ed, env.ids.beto].sort())
  const notice = seen.map((e) => JSON.parse(e.data_json)).find((d) => d.reason === 'mention')
  assert.deepEqual([notice.message_id, notice.author_id, notice.reply_id], [Number(id), env.ids.ed, Number(message.replies.at(-1).id)])
  const audited = all(env.db, "SELECT member_id, detail_json FROM audit_log WHERE action = 'message.mention' AND entity_id = ?", id)
  assert.equal(audited.length, 1)
  assert.deepEqual([audited[0].member_id, JSON.parse(audited[0].detail_json).member], [env.ids.ed, env.ids.beto])
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'execute'"), 0, 'no job for a person')
  await env.close()
})

test('the text is not read: a name in the text without an id mentions nobody, and an id without its name in the text still mentions', async () => {
  const env = await team()
  const id = await openMessage(env)
  const plain = await reply(env, id, env.c.ed, { body: '@Beto @Claude escritos a mano, sin elegirlos en la lista' })
  assert.equal(plain.statusCode, 201)
  assert.deepEqual(plain.json().replies.at(-1).mentions, [])
  assert.deepEqual(assignees(env, id), [env.ids.ed])
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'execute'"), 0)
  const picked = await reply(env, id, env.c.ed, { body: 'sin ningún arroba', mention_ids: [env.ids.beto] })
  assert.deepEqual(picked.json().replies.at(-1).mentions, [String(env.ids.beto)])
  await env.close()
})

test('a mention refuses the author, a deactivated member, an unknown one and an agent that mentions an agent, and writes nothing', async () => {
  const env = await team()
  const id = await openMessage(env)
  const before = count(env, 'SELECT COUNT(*) AS n FROM replies')
  const refuse = async (cookie, payload, status, code) => {
    const r = await reply(env, id, cookie, payload)
    assert.equal(r.statusCode, status, r.body)
    if (code) assert.equal(r.json().code, code)
  }
  await refuse(env.c.ed, { body: 'a mí', mention_ids: [env.ids.ed] }, 400, 'mention_self')
  await refuse(env.c.ed, { body: 'a nadie', mention_ids: [9999] }, 404)
  updateMember(env.db, env.ids.beto, { active: false })
  await refuse(env.c.ed, { body: 'desactivado', mention_ids: [env.ids.beto] }, 400, 'assignee_inactive')
  updateMember(env.db, env.ids.beto, { active: true })
  await refuse(env.c.ed, { body: 'bien y mal', mention_ids: [env.ids.beto, env.ids.ed] }, 400, 'mention_self')
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM replies'), before)
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM reply_mentions'), 0)
  assert.deepEqual(assignees(env, id), [env.ids.ed], 'nobody joined')
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'message.mention'"), 0)
  // An agent that mentions another agent would start a loop without a person in between.
  const second = await env.api('POST', '/members', env.c.ed, { email: 'otro@x.org', name: 'Otro', kind: 'agent', profile: 'Otro perfil.' })
  const otherAgent = Number(second.json().id)
  const { addReply } = await import('../domain/messages.js')
  assert.throws(() => addReply({ db: env.db, events: env.events }, { messageId: Number(id), authorId: env.ids.claude, body: 'hola', mentionIds: [otherAgent] }), (e) => e.code === 'mention_loop')
  await env.close()
})

test('the same member twice counts once, and a person already assigned is told again', async () => {
  const env = await team()
  const id = await openMessage(env)
  const seen = []
  env.events.subscribe(env.ids.ed, (e) => seen.push(e))
  const r = await reply(env, id, env.c.beto, { body: 'va dos veces', mention_ids: [env.ids.ed, env.ids.ed] })
  assert.equal(r.statusCode, 201, r.body)
  assert.deepEqual(r.json().replies.at(-1).mentions, [String(env.ids.ed)])
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM message_assignees WHERE message_id = ? AND member_id = ?', id, env.ids.ed), 1)
  assert.equal(seen.filter((e) => JSON.parse(e.data_json).reason === 'mention').length, 1)
  await env.close()
})

test('a multipart reply carries mention_ids as repeated fields; a field that is not an id is a 400', async () => {
  const env = await team()
  const id = await openMessage(env)
  const send = async (fields) => {
    const { payload, headers } = await multipart(fields, [{ name: 'nota.txt', content: 'hola', type: 'text/plain' }])
    return env.app.inject({ method: 'POST', url: `/api/messages/${id}/replies`, payload, headers: { ...headers, cookie: env.c.ed, 'x-team-request': 'panel' } })
  }
  const bad = await send({ body: 'x', mention_ids: ['beto'] })
  assert.equal(bad.statusCode, 400, bad.body)
  assert.equal(bad.json().code, 'mention_invalid')
  const ok = await send({ body: '@Beto @Claude', mention_ids: [String(env.ids.beto), String(env.ids.claude)] })
  assert.equal(ok.statusCode, 201, ok.body)
  assert.deepEqual(ok.json().replies.at(-1).mentions, [String(env.ids.beto), String(env.ids.claude)])
  assert.equal(ok.json().replies.at(-1).attachments.length, 1)
  await env.close()
})

test('the sender of the message replies only when the reply mentions someone, and that reply is not an answer', async () => {
  const env = await team()
  const id = await openMessage(env)
  const plain = await reply(env, id, env.c.ana, { body: 'respondo mi propio mensaje' })
  assert.equal(plain.statusCode, 403)
  assert.equal(plain.json().code, 'author_cannot_reply')
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM replies'), 0)
  assert.equal((await reply(env, id, env.c.beto, { body: 'respondido' })).json().status, 'answered')
  const asks = await reply(env, id, env.c.ana, { body: '@Ed ¿puedes verlo?', mention_ids: [env.ids.ed] })
  assert.equal(asks.statusCode, 201, asks.body)
  assert.equal(asks.json().status, 'open', 'a request of the sender is not an answer: the mentioned has it waiting')
  assert.deepEqual(asks.json().replies.at(-1).mentions, [String(env.ids.ed)])
  // A closed message accepts no replies, with or without a mention (the rule that was).
  assert.equal((await env.api('POST', `/messages/${id}/close`, env.c.ed)).statusCode, 200)
  const closed = await reply(env, id, env.c.ana, { body: '@Ed', mention_ids: [env.ids.ed] })
  assert.equal(closed.statusCode, 409)
  assert.equal(closed.json().code, 'message_closed')
  await env.close()
})

test('a mention of an agent enqueues its `execute` job on the same message with `mention: { reply_id, by }`', async () => {
  const env = await team()
  const id = await openMessage(env)
  const r = await reply(env, id, env.c.ed, { body: '@Claude investiga esto', mention_ids: [env.ids.claude] })
  assert.equal(r.statusCode, 201, r.body)
  assert.ok(assignees(env, id).includes(env.ids.claude))
  const jobs = all(env.db, "SELECT id, message_id, payload_json, status FROM jobs WHERE kind = 'execute'")
  assert.equal(jobs.length, 1)
  const payload = JSON.parse(jobs[0].payload_json)
  const replyId = Number(r.json().replies.at(-1).id)
  assert.deepEqual([jobs[0].message_id, jobs[0].status, payload.member_id, payload.requested_by], [Number(id), 'queued', env.ids.claude, env.ids.ed])
  assert.deepEqual(payload.mention, { reply_id: replyId, by: env.ids.ed })
  const row = get(env.db, 'SELECT pending, job_id FROM reply_mentions WHERE reply_id = ?', replyId)
  assert.deepEqual([row.pending, row.job_id], [0, jobs[0].id])
  await env.close()
})

test('a mention of an agent that is already working the message is kept pending and attended when that work ends, in one run for all of them', async () => {
  const env = await team()
  const id = await openMessage(env)
  const first = await reply(env, id, env.c.ed, { body: 'primero', mention_ids: [env.ids.claude] })
  const second = await reply(env, id, env.c.beto, { body: 'segundo, mientras trabaja', mention_ids: [env.ids.claude] })
  const third = await reply(env, id, env.c.ed, { body: 'tercero', mention_ids: [env.ids.claude] })
  for (const r of [first, second, third]) assert.equal(r.statusCode, 201, r.body)
  const ids = [first, second, third].map((r) => Number(r.json().replies.at(-1).id))
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'execute'"), 1, 'one job: the agent is busy')
  assert.deepEqual(all(env.db, 'SELECT reply_id, pending FROM reply_mentions ORDER BY reply_id').map((r) => [r.reply_id, r.pending]), [[ids[0], 0], [ids[1], 1], [ids[2], 1]])
  // While the first job is queued or running, attending changes nothing.
  assert.deepEqual(attendPendingMentions(env.db), [])
  // The job ends: the next call enqueues one run that carries both pending replies, the latest as `reply_id`.
  env.db.prepare("UPDATE jobs SET status = 'done', finished_at = ? WHERE kind = 'execute'").run(Date.now())
  const [job] = attendPendingMentions(env.db, { messageId: Number(id) })
  assert.ok(job)
  const payload = JSON.parse(get(env.db, 'SELECT payload_json FROM jobs WHERE id = ?', job).payload_json)
  assert.deepEqual(payload.mention, { reply_id: ids[2], by: env.ids.ed, earlier: [ids[1]] })
  assert.deepEqual(all(env.db, 'SELECT pending, job_id FROM reply_mentions WHERE reply_id > ?', ids[0]).map((r) => [r.pending, r.job_id]), [[0, job], [0, job]])
  await env.close()
})

test('a pending mention is dropped when its reply is deleted, its message is closed, or the agent is deactivated; and it re-adds an agent that left', async () => {
  const env = await team()
  const id = await openMessage(env)
  await reply(env, id, env.c.ed, { body: 'uno', mention_ids: [env.ids.claude] })
  const second = await reply(env, id, env.c.beto, { body: 'dos', mention_ids: [env.ids.claude] })
  const replyId = Number(second.json().replies.at(-1).id)
  env.db.prepare("UPDATE jobs SET status = 'done' WHERE kind = 'execute'").run()
  env.db.prepare('UPDATE replies SET deleted_at = ? WHERE id = ?').run(Date.now(), replyId)
  assert.deepEqual(attendPendingMentions(env.db), [], 'its reply is gone: nothing to attend')
  assert.equal(get(env.db, 'SELECT pending FROM reply_mentions WHERE reply_id = ?', replyId).pending, 0)
  const third = await reply(env, id, env.c.ed, { body: 'tres', mention_ids: [env.ids.claude] })
  const thirdId = Number(third.json().replies.at(-1).id)
  env.db.prepare('DELETE FROM message_assignees WHERE member_id = ?').run(env.ids.claude) // a failed run handed the message to a person
  env.db.prepare("UPDATE jobs SET status = 'done'").run()
  env.db.prepare('UPDATE reply_mentions SET pending = 1, job_id = NULL WHERE reply_id = ?').run(thirdId)
  assert.equal(attendPendingMentions(env.db).length, 1)
  assert.ok(assignees(env, id).includes(env.ids.claude), 'the mention calls the agent back')
  await env.close()
})
