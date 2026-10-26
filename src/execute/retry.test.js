// «Reintentar» (UD-282) by the real route: API -> queue -> handler with the fake `claude`. The new job carries the origin of the failed one (same message, same mention,
// same files), a second click enqueues nothing, a delivery in progress blocks it, and the day's spending cap holds it.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { createPipeline } from '../domain/pipeline.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { addMember, login, makeEnv, multipart, postInput, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { createExecuteHandler } from './handler.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
let PORT = 0 // ephemeral, set after listen: a fixed port made a second run of the same file cancel itself with EADDRINUSE (2026-10-26)
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('imagen-de-prueba')])

describe('retry of a failed session (UD-282)', () => {
  let env, state, worker, vault, edId, agentId, editor, anaCookie
  let cases = 0
  const api = (method, url, cookie, payload) => env.app.inject({ method, url, headers: { cookie, 'x-team-request': 'panel', ...(payload === undefined ? {} : { 'content-type': 'application/json' }) }, payload: payload === undefined ? undefined : JSON.stringify(payload) })

  function startWorker (config = {}) {
    const cfg = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, {
      execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000, capacityWaitMs: 300, deliverCommand: '', ...config }
    })
    const handlers = {
      ...createPipeline({ db: env.db, config: cfg, queue: env.queue, events: env.events, modules: env.modules }),
      execute: createExecuteHandler({ db: env.db, config: cfg, queue: env.queue, events: env.events, vault, getProviders: env.modules.getProviders })
    }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config: cfg, handlers })
    worker.start()
  }
  const calls = () => readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const settle = (messageId, n = 1) => until(() => {
    const jobs = env.db.prepare("SELECT status FROM jobs WHERE message_id = ? AND kind = 'execute'").all(messageId)
    return jobs.length >= n && jobs.every((j) => ['done', 'failed', 'cancelled'].includes(j.status))
  }, { timeoutMs: 40000 })
  const agentReplies = (id) => env.db.prepare('SELECT id, kind, body FROM replies WHERE message_id = ? AND author_id = ? ORDER BY id').all(id, agentId)

  async function publishedMessage (files = []) {
    const { payload, headers } = await multipart({ text: `La agenda queda en blanco (caso ${++cases}).` }, files)
    const res = await env.app.inject({ method: 'POST', url: '/api/inputs', payload, headers: { ...headers, cookie: anaCookie, 'x-team-request': 'panel' } })
    const inputId = res.json().input_id
    await until(() => env.db.prepare('SELECT status FROM inputs WHERE id = ?').get(inputId).status === 'proposed', { timeoutMs: 10000 })
    const pub = await api('POST', `/api/inputs/${inputId}/publish`, anaCookie, {})
    assert.equal(pub.statusCode, 200, pub.body)
    return env.db.prepare('SELECT id FROM messages WHERE input_id = ?').get(inputId).id
  }
  async function mention (id, cookie, body, files = []) {
    const { payload, headers } = await multipart({ body, mention_ids: [String(agentId)] }, files)
    const r = await env.app.inject({ method: 'POST', url: `/api/messages/${id}/replies`, payload, headers: { ...headers, cookie, 'x-team-request': 'panel' } })
    assert.equal(r.statusCode, 201, r.body)
    return Number(r.json().replies.at(-1).id)
  }

  before(async () => {
    env = await makeEnv({ telemetry: true })
    state = join(env.dir, 'fake-state')
    mkdirSync(state)
    process.env.FAKE_EXECUTE_STATE = state
    vault = createVault(loadMasterKey({ dataDir: env.dir }))
    edId = await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
    await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    editor = await login(env, 'ed@x.org')
    anaCookie = await login(env, 'ana@x.org')
    const created = await api('POST', '/api/members', editor, { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Perfil del agente.' })
    agentId = Number(created.json().id)
    await env.app.listen({ host: '127.0.0.1', port: 0 }); PORT = env.app.server.address().port
  })
  beforeEach(() => { env.config.execute.deliverCommand = ''; process.env.FAKE_EXECUTE_MODE = 'ok'; process.env.FAKE_EXECUTE_REPLY = '1'; delete process.env.FAKE_EXECUTE_EXTRA; delete process.env.FAKE_EXECUTE_SLEEP_MS; delete process.env.FAKE_EXECUTE_FAIL_FIRST })
  after(async () => { await worker?.stop(); await env.close() })

  const fail = () => { process.env.FAKE_EXECUTE_MODE = 'error'; process.env.FAKE_EXECUTE_REPLY = '0' }
  const jobsOf = (id) => env.db.prepare("SELECT id, status, payload_json, run_at FROM jobs WHERE message_id = ? AND kind = 'execute' ORDER BY id").all(id)
  const detail = async (id, cookie) => (await api('GET', `/api/messages/${id}`, cookie)).json()
  const noticeOf = (id) => agentReplies(id).at(-1)

  it('launches the same job again: same message and mention, the thread and its files read once more, with who retried audited', async () => {
    await worker?.stop()
    fail()
    startWorker()
    const id = await publishedMessage()
    const replyId = await mention(id, editor, '@Claude mira esta foto', [{ name: 'foto.png', content: PNG, type: 'image/png' }])
    await settle(id)
    const notice = noticeOf(id)
    assert.equal(notice.body, 'Claude no pudo responder: se alcanzó el tope de gasto.')
    const failed = jobsOf(id)[0]
    assert.equal(failed.status, 'failed')
    assert.equal(env.db.prepare('SELECT failed_job_id FROM replies WHERE id = ?').get(notice.id).failed_job_id, failed.id, 'the notice carries the job that failed')
    const before = await detail(id, anaCookie)
    assert.equal(before.replies.find((r) => Number(r.id) === notice.id).retryable, true)
    assert.equal(before.replies.find((r) => Number(r.id) === replyId).retryable, false)

    process.env.FAKE_EXECUTE_MODE = 'ok'
    process.env.FAKE_EXECUTE_REPLY = '1'
    const callsBefore = calls().length
    const res = await api('POST', `/api/messages/${id}/replies/${notice.id}/retry`, anaCookie)
    assert.equal(res.statusCode, 202, res.body)
    await settle(id, 2)
    const [first, second] = jobsOf(id)
    assert.equal(Number(res.json().job_id), second.id)
    assert.equal(second.status, 'done')
    const a = JSON.parse(first.payload_json)
    const b = JSON.parse(second.payload_json)
    assert.deepEqual(b.mention, a.mention, 'the same mention')
    assert.equal(b.message_id, a.message_id)
    assert.equal(b.member_id, a.member_id)
    assert.equal(b.requested_by, env.db.prepare("SELECT id FROM members WHERE email = 'ana@x.org'").get().id, 'who retried')
    const stdin = calls().slice(callsBefore).at(-1).stdin
    assert.ok(stdin.includes('@Claude mira esta foto'), 'the session reads the mention again')
    assert.match(stdin, new RegExp(`foto\\.png .*\\$TEAM_THREAD_DIR/reply-${replyId}/foto\\.png`), 'and its file')
    const row = env.db.prepare("SELECT member_id, detail_json FROM audit_log WHERE action = 'message.execute_retry'").get()
    assert.equal(row.member_id, b.requested_by)
    assert.deepEqual(JSON.parse(row.detail_json), { reply_id: notice.id, failed_job_id: failed.id, job_id: second.id })
    assert.equal((await detail(id, anaCookie)).replies.find((r) => Number(r.id) === notice.id).retryable, false, 'the button goes away')
    const again = await api('POST', `/api/messages/${id}/replies/${notice.id}/retry`, anaCookie)
    assert.equal(again.statusCode, 409)
    assert.equal(again.json().code, 'retry_stale')
    assert.equal(jobsOf(id).length, 2, 'a second click enqueues nothing')
  })

  it('a retry is acknowledged again, and if it fails too the thread says so again: the old notice is not the answer', async () => {
    await worker?.stop()
    fail()
    startWorker()
    const id = await publishedMessage()
    await mention(id, editor, '@Claude implementa esto')
    await settle(id)
    const notice = noticeOf(id)
    const res = await api('POST', `/api/messages/${id}/replies/${notice.id}/retry`, anaCookie)
    assert.equal(res.statusCode, 202, res.body)
    await settle(id, 2)
    const after = agentReplies(id).filter((r) => r.id > notice.id).map((r) => r.body)
    assert.equal(after[0], 'Recibido. Empiezo ahora y respondo aquí apenas termine.', 'the retry posts its acknowledgement')
    assert.equal(after.at(-1), 'Claude no pudo responder: se alcanzó el tope de gasto.', 'and its own failure notice')
    const second = jobsOf(id)[1]
    assert.equal(env.db.prepare('SELECT failed_job_id FROM replies WHERE id = ?').get(agentReplies(id).at(-1).id).failed_job_id, second.id, 'the new notice can be retried in turn')
  })

  it('does not enqueue a second job while a delivery of the message is running, and a reply that is no failure is not retried', async () => {
    await worker?.stop()
    fail()
    startWorker()
    const id = await publishedMessage()
    await mention(id, editor, '@Claude hazlo')
    await settle(id)
    await worker.stop()
    const notice = noticeOf(id)
    env.db.prepare("INSERT INTO jobs (kind, message_id, payload_json, status, priority, attempts, max_attempts, run_at, created_at) VALUES ('deliver', ?, '{}', 'running', 0, 0, 1, 0, 0)").run(id)
    const busy = await api('POST', `/api/messages/${id}/replies/${notice.id}/retry`, anaCookie)
    assert.equal(busy.statusCode, 409)
    assert.equal(busy.json().code, 'execute_busy')
    assert.equal(jobsOf(id).length, 1)
    const own = env.db.prepare("SELECT id FROM replies WHERE message_id = ? AND author_id <> ? ORDER BY id LIMIT 1").get(id, agentId).id
    const plain = await api('POST', `/api/messages/${id}/replies/${own}/retry`, anaCookie)
    assert.equal(plain.statusCode, 409)
    assert.equal(plain.json().code, 'not_a_failure')
    assert.equal((await api('POST', `/api/messages/${id}/replies/999999/retry`, anaCookie)).statusCode, 404)
    assert.equal((await api('POST', `/api/messages/${id}/replies/${notice.id}/retry`, '')).statusCode, 401)
  })

  it('with the day\'s spending cap spent, or a failure that another try does not fix, the reply is not retryable and the route refuses', async () => {
    await worker?.stop()
    fail()
    startWorker()
    const id = await publishedMessage()
    await mention(id, editor, '@Claude hazlo')
    await settle(id)
    const notice = noticeOf(id)
    assert.equal((await detail(id, anaCookie)).replies.find((r) => Number(r.id) === notice.id).retryable, true, 'with the cap open it is')
    await worker.stop()
    // the cap spent: the failed job's own cost counts for today
    env.db.prepare("UPDATE jobs SET cost_usd = 1000, runner = 'local' WHERE message_id = ? AND kind = 'execute'").run(id)
    const spent = await api('POST', `/api/messages/${id}/replies/${notice.id}/retry`, anaCookie)
    assert.equal(spent.statusCode, 409)
    assert.equal(spent.json().code, 'budget_spent')
    assert.equal((await detail(id, anaCookie)).replies.find((r) => Number(r.id) === notice.id).retryable, false, 'not shown with the cap spent')
    assert.equal(jobsOf(id).length, 1)
    env.db.prepare("UPDATE jobs SET cost_usd = 0 WHERE message_id = ? AND kind = 'execute'").run(id)
    env.db.prepare("UPDATE replies SET failed_code = 'invalid_output' WHERE id = ?").run(notice.id)
    const format = await api('POST', `/api/messages/${id}/replies/${notice.id}/retry`, anaCookie)
    assert.equal(format.json().code, 'not_retryable')
    assert.equal((await detail(id, anaCookie)).replies.find((r) => Number(r.id) === notice.id).retryable, false, 'not shown for a failure of format')
  })
  it('the retry marks the notice as replaced by the new job without deleting it, and a refused retry marks nothing (UD-290)', async () => {
    await worker?.stop()
    fail()
    startWorker()
    const id = await publishedMessage()
    await mention(id, editor, '@Claude hazlo')
    await settle(id)
    const notice = noticeOf(id)
    const row = () => env.db.prepare('SELECT replaced_by_job_id, deleted_at FROM replies WHERE id = ?').get(notice.id)
    assert.equal(row().replaced_by_job_id, null, 'nobody retried yet')
    await worker.stop()
    env.db.prepare("UPDATE replies SET failed_code = 'invalid_output' WHERE id = ?").run(notice.id)
    const refused = await api('POST', `/api/messages/${id}/replies/${notice.id}/retry`, anaCookie)
    assert.equal(refused.statusCode, 409)
    assert.equal(row().replaced_by_job_id, null, 'a refused retry leaves the notice as it was')
    const untouched = (await detail(id, anaCookie)).replies.find((r) => Number(r.id) === notice.id)
    assert.equal(untouched.replaced_by_job_id, null)
    assert.equal(untouched.retrying, false)
    env.db.prepare("UPDATE replies SET failed_code = 'execute_budget' WHERE id = ?").run(notice.id)
    const res = await api('POST', `/api/messages/${id}/replies/${notice.id}/retry`, anaCookie)
    assert.equal(res.statusCode, 202, res.body)
    const jobId = res.json().job_id
    assert.equal(String(row().replaced_by_job_id), String(jobId), 'the notice names the job that replaced it')
    assert.equal(row().deleted_at, null, 'and is not deleted: the audit keeps it')
    const mid = (await detail(id, anaCookie)).replies.find((r) => Number(r.id) === notice.id)
    assert.equal(String(mid.replaced_by_job_id), String(jobId))
    assert.equal(mid.retrying, true, 'the new job is queued: the thread draws «Reintentando»')
    assert.equal(mid.retryable, false)
    env.db.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").run(jobId)
    assert.equal((await detail(id, anaCookie)).replies.find((r) => Number(r.id) === notice.id).retrying, false, 'when the job ends the thread stops drawing it')
  })

  // Case #125 (2026-10-26): the work was done and pushed; then only steps of the environment fell (a delivery, an `execute` that died before doing anything).
  const seedWorkDone = async (id, { failures, edited = false }) => {
    await worker.stop()
    const job = (kind, status, extra = {}) => Number(env.db.prepare("INSERT INTO jobs (kind, message_id, payload_json, status, priority, attempts, max_attempts, run_at, created_at, finished_at) VALUES (?, ?, ?, ?, 0, 1, 1, 0, 1000, 2000)").run(kind, id, JSON.stringify({ message_id: id, member_id: agentId, ...extra }), status).lastInsertRowid)
    const green = job('execute', 'done')
    env.db.prepare("INSERT INTO execute_runs (job_id, attempt, message_id, started_at, finished_at, outcome) VALUES (?, 1, ?, 1000, 2000, 'done')").run(green, id)
    let last = null
    for (const [kind, code] of failures) {
      const jobId = job(kind, 'failed')
      const r = env.db.prepare("INSERT INTO replies (message_id, author_id, body, kind, created_at, failed_job_id, failed_code) VALUES (?, ?, 'No pude terminar este trabajo.', 'clarification', 3000, ?, ?)").run(id, agentId, jobId, code)
      last = Number(r.lastInsertRowid)
    }
    if (edited) env.db.prepare('UPDATE messages SET edited_at = 5000 WHERE id = ?').run(id)
    return last
  }
  const startForDelivery = async () => { await worker?.stop(); env.config.execute.deliverCommand = 'true'; startWorker({ deliverCommand: 'true' }) } // the API offers a delivery only when the instance declares the command
  const kinds = (id) => env.db.prepare("SELECT kind FROM jobs WHERE message_id = ? AND status = 'queued' ORDER BY id").all(id).map((r) => r.kind)

  it('#125: work done, then a failed delivery and an `execute` that fell by the environment: «Reintentar» enqueues the delivery of the branch, not another session', async () => {
    await startForDelivery()
    const id = await publishedMessage()
    const notice = await seedWorkDone(id, { failures: [['deliver', 'deliver_env'], ['execute', 'system'], ['deliver', 'deliver_failed'], ['execute', 'system']] })
    const view = (await detail(id, anaCookie)).replies.find((r) => Number(r.id) === notice)
    const shown = (await detail(id, anaCookie)).replies.find((r) => Number(r.id) === notice)
    assert.equal(shown.retryable, true)
    assert.equal(shown.retry_action, 'publish', 'the server says what the button does: it publishes the branch')
    const res = await api('POST', `/api/messages/${id}/replies/${notice}/retry`, anaCookie)
    assert.equal(res.statusCode, 202, res.body)
    assert.deepEqual(kinds(id), ['deliver'], 'a delivery and no `execute`: no paid session redoes the work')
    const payload = JSON.parse(env.db.prepare("SELECT payload_json FROM jobs WHERE id = ?").get(res.json().job_id).payload_json)
    assert.equal(payload.branch, `tp/${id}`)
    assert.equal(env.db.prepare("SELECT action FROM audit_log WHERE action = 'message.deliver_retry' AND entity_id = ?").all(String(id)).length, 1)
  })

  it('#125: what Claude did wrong or an edited message goes back to a session: «Reintentar» enqueues an `execute`', async () => {
    await startForDelivery()
    const wrong = await publishedMessage()
    const n1 = await seedWorkDone(wrong, { failures: [['deliver', 'deliver_env'], ['execute', 'execute_max_turns']] })
    assert.equal((await detail(wrong, anaCookie)).replies.find((r) => Number(r.id) === n1).retry_action, 'work', 'a session of Claude runs again')
    assert.equal((await api('POST', `/api/messages/${wrong}/replies/${n1}/retry`, anaCookie)).statusCode, 202)
    assert.deepEqual(kinds(wrong), ['execute'], 'the session that failed on its own work runs again')
    await startForDelivery()
    const edited = await publishedMessage()
    const n2 = await seedWorkDone(edited, { failures: [['deliver', 'deliver_env'], ['execute', 'system']], edited: true })
    assert.equal((await api('POST', `/api/messages/${edited}/replies/${n2}/retry`, anaCookie)).statusCode, 202)
    assert.deepEqual(kinds(edited), ['execute'], 'the text changed after the work: the branch no longer answers it')
  })
})
