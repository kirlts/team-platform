// POST /messages/:id/forward (UD-272): the same message gets one more assignee and a reply of kind `forward` with the reason; no new message. The reason is
// required, the recipient is an active member other than whoever forwards, a closed message is refused, and an agent gets its `execute` job for the same message.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { updateMember } from '../domain/members.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

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

/** A message of Ana, assigned to Ana herself and Ed. */
async function openMessage (env) {
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'algo' })).json()
  const view = await until(async () => {
    const v = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
    return v.status === 'proposed' ? v : null
  })
  const r = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: view.proposal.messages.map((m) => ({ ...m, assignee_ids: [env.ids.ed] })) })
  return r.json().message_ids[0]
}
const forward = (env, messageId, cookie, payload) => env.api('POST', `/messages/${messageId}/forward`, cookie, payload)
const count = (env, sql, ...p) => get(env.db, sql, ...p).n

test('forward needs a reason: empty or blank is refused and nothing is written', async () => {
  const env = await team()
  const id = await openMessage(env)
  const before = count(env, 'SELECT COUNT(*) AS n FROM replies')
  for (const payload of [{ member_id: env.ids.beto }, { member_id: env.ids.beto, comment: '' }, { member_id: env.ids.beto, comment: '   \n ' }]) {
    const r = await forward(env, id, env.c.ed, payload)
    assert.ok(r.statusCode === 400, `${JSON.stringify(payload)} -> ${r.statusCode}`)
  }
  assert.equal((await forward(env, id, env.c.ed, { member_id: env.ids.beto, comment: '  ' })).json().code, 'forward_comment_required')
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM replies'), before)
  assert.deepEqual(all(env.db, 'SELECT member_id FROM message_assignees WHERE message_id = ?', id).map((r) => r.member_id), [env.ids.ed])
  await env.close()
})

test('forward to a person: the same message, one more assignee, one `forward` reply by whoever forwards, audited, and the person is told', async () => {
  const env = await team()
  const id = await openMessage(env)
  const messagesBefore = count(env, 'SELECT COUNT(*) AS n FROM messages')
  const seen = []
  env.events.subscribe(env.ids.beto, (e) => seen.push(e))
  const r = await forward(env, id, env.c.ed, { member_id: env.ids.beto, comment: ' Revisa esto antes del jueves. ' })
  assert.equal(r.statusCode, 201, r.body)
  const message = r.json()
  assert.equal(message.id, String(id))
  assert.deepEqual(message.assignee_ids.map(Number).sort(), [env.ids.ed, env.ids.beto].sort())
  const last = message.replies.at(-1)
  assert.deepEqual([last.kind, last.author_id, last.forwarded_to, last.body], ['forward', String(env.ids.ed), String(env.ids.beto), 'Revisa esto antes del jueves.'])
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM messages'), messagesBefore, 'no new message')
  const audited = all(env.db, "SELECT member_id, detail_json FROM audit_log WHERE action = 'message.forward' AND entity_id = ?", id)
  assert.equal(audited.length, 1)
  assert.deepEqual([audited[0].member_id, JSON.parse(audited[0].detail_json).to], [env.ids.ed, env.ids.beto])
  assert.ok(seen.some((e) => e.kind === 'message' && JSON.parse(e.data_json).message_id === Number(id)), 'Beto got the directed notice')
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'execute'"), 0, 'no job for a person')
  // Forwarding again to the same person adds the notice, not a second assignee.
  assert.equal((await forward(env, id, env.c.ed, { member_id: env.ids.beto, comment: 'Otra vez.' })).statusCode, 201)
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM message_assignees WHERE message_id = ?', id), 2)
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM replies WHERE message_id = ? AND kind = 'forward'", id), 2)
  await env.close()
})

test('the recipient is an active member other than whoever forwards; the message exists and is open', async () => {
  const env = await team()
  const id = await openMessage(env)
  const refuse = async (messageId, cookie, payload, status, code) => {
    const r = await forward(env, messageId, cookie, payload)
    assert.equal(r.statusCode, status, r.body)
    if (code) assert.equal(r.json().code, code)
  }
  await refuse(id, env.c.ed, { member_id: env.ids.ed, comment: 'A mí mismo.' }, 400, 'forward_to_self')
  await refuse(id, env.c.ed, { member_id: 9999, comment: 'A nadie.' }, 404)
  await refuse(99999, env.c.ed, { member_id: env.ids.beto, comment: 'Mensaje que no existe.' }, 404)
  updateMember(env.db, env.ids.beto, { active: false })
  await refuse(id, env.c.ed, { member_id: env.ids.beto, comment: 'Desactivado.' }, 400, 'assignee_inactive')
  updateMember(env.db, env.ids.beto, { active: true })
  assert.equal((await env.api('POST', `/messages/${id}/close`, env.c.ed)).statusCode, 200)
  await refuse(id, env.c.ed, { member_id: env.ids.beto, comment: 'Cerrado.' }, 409, 'message_closed')
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM replies WHERE kind = 'forward'"), 0)
  assert.equal((await env.api('POST', `/messages/${id}/forward`, '', { member_id: env.ids.beto, comment: 'x' })).statusCode, 401)
  await env.close()
})

test('the author of the message also forwards it, and a forward does not count as an answer', async () => {
  const env = await team()
  const id = await openMessage(env)
  const r = await forward(env, id, env.c.ana, { member_id: env.ids.beto, comment: 'Mira si puedes tomarlo.' })
  assert.equal(r.statusCode, 201, r.body)
  assert.equal(r.json().status, 'open', 'a forward is not an answer: the message waits for its new recipient')
  await env.close()
})

test('an answered message goes back to open for the person it is forwarded to', async () => {
  const env = await team()
  const id = await openMessage(env)
  assert.equal((await env.api('POST', `/messages/${id}/replies`, env.c.beto, { body: 'Respondido.' })).json().status, 'answered')
  const r = await forward(env, id, env.c.ed, { member_id: env.ids.beto, comment: 'Mira el último punto.' })
  assert.equal(r.json().status, 'open')
  await env.close()
})

test('forward to an agent: its `execute` job for the same message, with the forward as context; a second one while it works is a 409 and writes nothing', async () => {
  const env = await team()
  const id = await openMessage(env)
  await env.worker.stop() // this test has no handler for `execute`: the job stays queued, as one waiting its turn
  const r = await forward(env, id, env.c.ed, { member_id: env.ids.claude, comment: 'Investiga por qué falla y dime qué recomiendas.' })
  assert.equal(r.statusCode, 201, r.body)
  assert.ok(r.json().assignee_ids.map(Number).includes(env.ids.claude))
  const jobs = all(env.db, "SELECT message_id, payload_json, status FROM jobs WHERE kind = 'execute'")
  assert.equal(jobs.length, 1)
  const payload = JSON.parse(jobs[0].payload_json)
  assert.deepEqual([jobs[0].message_id, jobs[0].status, payload.member_id, payload.requested_by], [Number(id), 'queued', env.ids.claude, env.ids.ed])
  const replyId = r.json().replies.at(-1).id
  assert.deepEqual(payload.forward, { reply_id: Number(replyId), by: env.ids.ed })
  const again = await forward(env, id, env.c.ed, { member_id: env.ids.claude, comment: 'Otra vez.' })
  assert.equal(again.statusCode, 409, again.body)
  assert.equal(again.json().code, 'execute_busy')
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM replies WHERE kind = 'forward'"), 1, 'the refused forward left no notice')
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'execute'"), 1)
  await env.close()
})

test('the reply route does not write forwards: a forward has a recipient and only `forward` gives it one', async () => {
  const env = await team()
  const id = await openMessage(env)
  const r = await env.api('POST', `/messages/${id}/replies`, env.c.beto, { body: 'Falso reenvío.', kind: 'forward' })
  assert.equal(r.statusCode, 400)
  await env.close()
})
