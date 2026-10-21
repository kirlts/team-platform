// UD-042 (amends UD-029 and MASTER-SPEC §1.1): the state of a message is derived, never written by hand. Without replies it is
// open; with one or more replies it is answered, whatever the reply says; and closed only when somebody closed it. This
// is a prohibition: after any sequence of replying, closing, reopening, editing and reprocessing, no message may
// carry a state that contradicts its replies and its closing mark.
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

/** The state each message must have, from its replies and its closing mark only. */
function derivedState (row) {
  if (row.closed_at !== null) return 'closed'
  return row.replies > 0 ? 'answered' : 'open'
}

/** One pass over the whole database: every message, in every state it has. Returns the contradictions found. */
export function stateContradictions (db) {
  const rows = all(db, 'SELECT m.id AS id, m.status AS status, m.closed_at AS closed_at, (SELECT COUNT(*) FROM replies r WHERE r.message_id = m.id) AS replies FROM messages m')
  return rows.filter((row) => row.status !== derivedState(row)).map((row) => `message ${row.id}: status «${row.status}» with ${row.replies} replies and closed_at ${row.closed_at}`)
}

async function publish (env, cookie, title, area, assigned) {
  const { input_id: id } = (await postInput(env, cookie, { text: title })).json()
  const view = await until(async () => {
    const v = (await env.api('GET', `/inputs/${id}`, cookie)).json()
    return v.status === 'proposed' ? v : null
  })
  const fields = area.title === 'Idea' ? { idea: title, motivation: 'm' } : { question: title }
  const r = await env.api('POST', `/inputs/${id}/publish`, cookie, { messages: [{ ...view.proposal.messages[0], title, body: `cuerpo ${title}`, area_id: area.id, template_id: area.templates[0].id, fields, assignee_ids: assigned }] })
  return { inputId: id, messageId: r.json().message_ids[0] }
}

test('UD-042 · the state of every message is derived from its replies and its closing mark after any sequence of operations', async () => {
  const env = await team()
  const areas = (await env.api('GET', '/areas', env.c.ana)).json()
  const idea = areas.find((a) => a.title === 'Idea')
  const question = areas.find((a) => a.title === 'Pregunta')
  const a = await publish(env, env.c.ana, 'uno', idea, [3])
  const b = await publish(env, env.c.ana, 'dos', question, [3, 2])
  const c = await publish(env, env.c.beto, 'tres', question, [1])
  assert.deepEqual(stateContradictions(env.db), [], 'recién publicados')

  const as = { a: env.c.ana, b: env.c.ana, c: env.c.beto }
  const other = { a: env.c.beto, b: env.c.beto, c: env.c.ana }
  const ids = { a: a.messageId, b: b.messageId, c: c.messageId }
  // Every operation on every message, in an order that crosses the transitions: reply, a second reply, close, reply on a
  // closed one (refused), reopen with replies, reopen without, edit in each state, reprocess a published input (refused).
  const steps = [
    ['reply', 'a', 'ya está'],
    ['reply', 'a', 'una aclaración sin información nueva'],
    ['edit', 'a'],
    ['close', 'a'],
    ['reply', 'a', 'sobre un cerrado'],
    ['edit', 'a'],
    ['reopen', 'a'],
    ['close', 'b'],
    ['reopen', 'b'],
    ['reply', 'b', 'respuesta'],
    ['close', 'b'],
    ['reopen', 'b'],
    ['reply', 'c', 'ok'],
    ['edit', 'c'],
    ['reprocess', 'a'],
    ['reprocess', 'c'],
    ['close', 'c'],
    ['close', 'c'],
    ['reopen', 'c'],
    ['reopen', 'c'],
    ['reply', 'a', 'otra']
  ]
  const inputs = { a: a.inputId, b: b.inputId, c: c.inputId }
  for (const [op, key, text] of steps) {
    const id = ids[key]
    if (op === 'reply') await env.api('POST', `/messages/${id}/replies`, other[key], { body: text })
    if (op === 'close') await env.api('POST', `/messages/${id}/close`, env.c.ed)
    if (op === 'reopen') await env.api('POST', `/messages/${id}/reopen`, env.c.ed)
    if (op === 'edit') await env.api('PATCH', `/messages/${id}`, as[key], { title: `título ${Math.random().toString(36).slice(2, 6)}` })
    if (op === 'reprocess') await env.api('POST', `/inputs/${inputs[key]}/reprocess`, as[key])
    assert.deepEqual(stateContradictions(env.db), [], `tras «${op} ${key}»`)
  }

  // The reading also agrees: what the API serves is the derived state, for the list and for the detail.
  for (const m of (await env.api('GET', '/messages', env.c.ed)).json().items) {
    const detail = (await env.api('GET', `/messages/${m.id}`, env.c.ed)).json()
    assert.equal(m.status, detail.status)
    if (m.status !== 'closed') assert.equal(m.status, detail.replies.length > 0 ? 'answered' : 'open', `message ${m.id} served as «${m.status}» with ${detail.replies.length} replies`)
  }
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM replies').n > 0, true)
  await env.close()
})

test('UD-042 · the check detects a message whose state contradicts its replies', async () => {
  const env = await team()
  const idea = (await env.api('GET', '/areas', env.c.ana)).json().find((a) => a.title === 'Idea')
  const { messageId } = await publish(env, env.c.ana, 'cuatro', idea, [3])
  await env.api('POST', `/messages/${messageId}/replies`, env.c.beto, { body: 'listo' })
  env.db.prepare("UPDATE messages SET status = 'open' WHERE id = ?").run(messageId)
  assert.equal(stateContradictions(env.db).length, 1, 'un abierto con una respuesta se detecta')
  await env.close()
})
