// Handing a message over to a person (UD-269) end to end: `needs_decision` with its `decision_check` and `not_mine` leave the message in the tray
// of the person who decides in the area, `open` and with the agent out of the assignees; a `needs_decision` without a valid check reaches nobody;
// the invariant «no message waits for a person that nobody holds» is zero when healthy and turns red when it is broken on purpose.
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { addReply } from '../domain/messages.js'
import { buriedHandoffs, deciderOf } from '../domain/escalation.js'
import { updateMember } from '../domain/members.js'
import { createPipeline } from '../domain/pipeline.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { decisionCheckProblem, decisionLines } from './decision-check.js'
import { createExecuteHandler } from './handler.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
const PORT = 8647 // the range given to this work (8640 to 8649)
const CHECK = {
  searched: ['docs/USER-DECISIONS.md: UD-100 a UD-268', 'CLAUDE.md del anfitrión'], why_not_covered: 'Ninguna fija el precio.',
  recommendation: 'Cobrar al cierre del mes.', if_wrong: 'Si cobra al inicio, se devuelve; si al cierre y era al inicio, se pierde un mes.', question: '¿Se cobra al inicio o al cierre del mes?'
}

describe('handoff to a person', () => {
  let env, state, worker, editor, editorId, otherEditorId, author, agentId, vault, areaId
  const cookieHeaders = (cookie) => ({ cookie, 'x-team-request': 'panel' })
  const api = (method, url, cookie, payload) => env.app.inject({ method, url, headers: { ...cookieHeaders(cookie), ...(payload === undefined ? {} : { 'content-type': 'application/json' }) }, payload: payload === undefined ? undefined : JSON.stringify(payload) })

  function startWorker () {
    const config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, {
      execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000, capacityWaitMs: 300 }
    })
    const handlers = {
      ...createPipeline({ db: env.db, config, queue: env.queue, events: env.events, modules: env.modules }),
      execute: createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault })
    }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers })
    worker.start()
  }
  const assignees = (messageId) => env.db.prepare('SELECT member_id FROM message_assignees WHERE message_id = ? ORDER BY member_id').all(messageId).map((r) => r.member_id)
  const settle = (messageId) => until(() => {
    const jobs = env.db.prepare("SELECT status FROM jobs WHERE message_id = ? AND kind IN ('execute', 'deliver')").all(messageId)
    return jobs.length > 0 && jobs.every((j) => ['done', 'failed', 'cancelled'].includes(j.status))
  }, { timeoutMs: 40000 })
  const lastReply = (messageId) => env.db.prepare('SELECT author_id, kind, body FROM replies WHERE message_id = ? ORDER BY id DESC LIMIT 1').get(messageId)
  const status = (messageId) => env.db.prepare('SELECT status FROM messages WHERE id = ?').get(messageId).status
  const health = async (cookie) => (await env.app.inject({ url: '/health', headers: cookie ? { cookie } : {} })).json()

  async function runWith (text, extra) {
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify(extra)
    startWorker()
    const res = await postInput(env, author, { text })
    const inputId = res.json().input_id
    await until(() => env.db.prepare('SELECT status FROM inputs WHERE id = ?').get(inputId).status === 'proposed', { timeoutMs: 10000 })
    const pub = await api('POST', `/api/inputs/${inputId}/publish`, author, {})
    assert.equal(pub.statusCode, 200, pub.body)
    const messageId = env.db.prepare('SELECT id FROM messages WHERE input_id = ?').get(inputId).id
    await settle(messageId)
    await worker.stop()
    return messageId
  }

  before(async () => {
    const analyze = async (bundle, opts) => {
      const r = await fakeAnalyze(bundle, opts)
      r.proposal.messages[0].assignee_ids = bundle.members.filter((m) => m.name === 'Claude').map((m) => m.id)
      return r
    }
    env = await makeEnv({ telemetry: true, modules: { analyze } })
    state = join(env.dir, 'fake-state')
    mkdirSync(state)
    process.env.FAKE_EXECUTE_STATE = state
    vault = createVault(loadMasterKey({ dataDir: env.dir }))
    editorId = await addMember(env, { email: 'ed@x.org', role: 'editor' })
    otherEditorId = await addMember(env, { email: 'ed2@x.org', role: 'editor', name: 'Segundo' })
    editor = await login(env, 'ed@x.org')
    const created = await api('POST', '/api/members', editor, { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Perfil del agente: arreglo pantallas.' })
    agentId = Number(created.json().id)
    const authorId = await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    updateMember(env.db, authorId, { profile: 'Perfil de Ana: llevo la agenda de la clínica.' })
    author = await login(env, 'ana@x.org')
    await env.app.listen({ host: '127.0.0.1', port: PORT })
  })
  beforeEach(() => { process.env.FAKE_EXECUTE_MODE = 'ok'; process.env.FAKE_EXECUTE_REPLY = '1'; delete process.env.FAKE_EXECUTE_EXTRA })
  after(async () => { await worker?.stop(); await env.close() })

  it('needs_decision with its check: the message is open, in the tray of the first Editor, without the agent, and the reply is the question', async () => {
    const messageId = await runWith('Se cobra al inicio o al cierre del mes.', { outcome: 'needs_decision', decision_check: CHECK })
    assert.deepEqual(assignees(messageId), [editorId], 'the agent left, the person who decides joined')
    assert.equal(status(messageId), 'open')
    const reply = lastReply(messageId)
    assert.deepEqual([reply.author_id, reply.kind], [agentId, 'clarification'])
    assert.match(reply.body, /\*\*Pregunta\*\*: ¿Se cobra al inicio o al cierre del mes\?\n\n\*\*Recomendación\*\*: Cobrar al cierre del mes\.\n\n\*\*Si la respuesta es la equivocada\*\*: .+\n\n\*\*Revisado\*\*:\n- docs\/USER-DECISIONS\.md: UD-100 a UD-268\n- CLAUDE\.md del anfitrión/)
    assert.doesNotMatch(reply.body, /decision_check|searched/)
    const summary = (await api('GET', '/api/messages/summary', editor)).json()
    assert.ok(summary.items.some((i) => i.message_id === String(messageId) && i.status === 'open'), 'it is red for the person')
    const audited = env.db.prepare("SELECT member_id, detail_json FROM audit_log WHERE action = 'message.escalate' AND entity_id = ?").all(messageId)
    assert.equal(audited.length, 1)
    assert.deepEqual([audited[0].member_id, JSON.parse(audited[0].detail_json).to, JSON.parse(audited[0].detail_json).source], [agentId, editorId, 'execute'])
    assert.deepEqual(buriedHandoffs(env.db), [])
    assert.equal((await health()).status, 'ok')
    assert.equal((await health(editor)).handoffs.buried, 0)
  })

  it('the area names who decides: a handoff goes to that person, and only an active person can be named', async () => {
    areaId = env.db.prepare('SELECT area_id FROM messages ORDER BY id LIMIT 1').get().area_id // the area of the message of the first test
    const before = (await api('GET', '/api/areas', editor)).json().find((a) => a.id === String(areaId))
    assert.equal(before.escalation_member_id, String(editorId), 'by default, the first Editor')
    assert.equal((await api('PATCH', `/api/areas/${areaId}`, editor, { escalation_member_id: agentId })).statusCode, 422, 'an agent does not decide')
    const set = await api('PATCH', `/api/areas/${areaId}`, editor, { escalation_member_id: otherEditorId })
    assert.equal(set.statusCode, 200, set.body)
    assert.equal(set.json().escalation_member_id, String(otherEditorId))
    const messageId = await runWith('Otra pregunta de producto.', { outcome: 'not_mine', summary: 'Es de facturación, no de pantallas.' })
    assert.deepEqual(assignees(messageId), [otherEditorId])
    assert.equal(status(messageId), 'open')
    assert.equal(lastReply(messageId).kind, 'clarification')
    const week = (await api('GET', '/api/areas', editor)).json().find((a) => a.id === String(areaId)).handoffs
    assert.deepEqual(week, [{ member_id: String(editorId), count: 1 }, { member_id: String(otherEditorId), count: 1 }], 'the week counts each handoff by person')
    await api('PATCH', `/api/areas/${areaId}`, editor, { escalation_member_id: null })
    assert.equal(deciderOf(env.db, areaId), editorId, 'null goes back to the first Editor')
  })

  it('a needs_decision with an empty or absent check reaches no person: the job fails with invalid_output', async () => {
    for (const extra of [{ outcome: 'needs_decision' }, { outcome: 'needs_decision', decision_check: { ...CHECK, searched: [] } }]) {
      const messageId = await runWith(`Una decisión sin revisar fuentes ${JSON.stringify(extra).length}.`, extra)
      const job = env.db.prepare("SELECT status, last_error FROM jobs WHERE kind = 'execute' AND message_id = ? ORDER BY id DESC").get(messageId)
      assert.equal(job.status, 'failed')
      assert.match(job.last_error, /decision_check/)
      assert.deepEqual(assignees(messageId), [agentId], 'no person got it')
      assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM replies WHERE message_id = ? AND kind = 'clarification'").get(messageId).n, 0)
      assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'message.escalate' AND entity_id = ?").get(messageId).n, 0)
    }
  })

  it('the invariant turns red when it is broken on purpose, and the health probe says so', async () => {
    const messageId = await runWith('Una decisión que se entierra a propósito.', { outcome: 'needs_decision', decision_check: CHECK })
    assert.deepEqual(buriedHandoffs(env.db), [])
    // Breaking 1: whoever edits the message leaves nobody holding it.
    env.db.prepare('DELETE FROM message_assignees WHERE message_id = ?').run(messageId)
    assert.deepEqual(buriedHandoffs(env.db).map((b) => [b.message_id, b.result]), [[messageId, 'needs_decision']])
    assert.equal((await health()).status, 'degraded')
    const detail = (await health(editor)).handoffs
    assert.deepEqual([detail.buried, detail.messages[0].message_id, detail.messages[0].result], [1, String(messageId), 'needs_decision'])
    // Someone asking the agent again is not a buried message: its new result is on the way.
    env.db.prepare("INSERT INTO message_assignees (message_id, member_id) VALUES (?, ?)").run(messageId, agentId)
    env.db.prepare("INSERT INTO jobs (kind, message_id, payload_json, status, run_at, created_at) VALUES ('execute', ?, '{}', 'queued', 1, 1)").run(messageId)
    assert.deepEqual(buriedHandoffs(env.db), [])
    env.db.prepare("DELETE FROM jobs WHERE kind = 'execute' AND message_id = ? AND status = 'queued'").run(messageId)
    assert.equal(buriedHandoffs(env.db).length, 1, 'with nobody asking again it is buried again')
    // Breaking 2: the old behavior, a plain answer in the thread and the message only assigned to the agent.
    env.db.prepare('UPDATE messages SET status = ? WHERE id = ?').run('open', messageId)
    addReply({ db: env.db, events: env.events }, { messageId, authorId: agentId, body: 'Respuesta que queda como «respondido».', kind: 'answer' })
    assert.equal(buriedHandoffs(env.db).length, 1)
    // Closing it is a person dealing with it.
    await api('POST', `/api/messages/${messageId}/close`, editor)
    assert.deepEqual(buriedHandoffs(env.db), [])
  })

  it('the pieces of the check: the problem it names and the lines the person reads', () => {
    assert.equal(decisionCheckProblem({ outcome: 'done' }), null)
    assert.equal(decisionCheckProblem({ outcome: 'not_mine' }), null)
    assert.match(decisionCheckProblem({ outcome: 'needs_decision' }), /exige/)
    assert.match(decisionCheckProblem({ outcome: 'needs_decision', decision_check: { ...CHECK, searched: ['  '] } }), /searched/)
    assert.match(decisionCheckProblem({ outcome: 'needs_decision', decision_check: { ...CHECK, question: '' } }), /question/)
    assert.equal(decisionCheckProblem({ outcome: 'needs_decision', decision_check: CHECK }), null)
    assert.match(decisionLines(CHECK, 'en')[0], /^\*\*Question\*\*: /)
    assert.equal(decisionLines(null, 'en').length, 0)
  })
})
