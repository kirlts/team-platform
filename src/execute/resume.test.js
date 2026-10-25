// A failure of the environment is not left dead (Martín, 2026-10-25: «¿por qué no los habías relanzado tú?»). Without `resume.js` and its call at the start of the
// worker, the failed message waits for a person to press «Reintentar»: these cases fail.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { addReply } from '../domain/messages.js'
import { addMember, login, makeEnv, multipart, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { resumeInfraFailures } from './resume.js'

describe('failures of the environment are relaunched by event', () => {
  let env, config, agentId, editor, anaCookie
  let cases = 0
  const api = (method, url, cookie, payload) => env.app.inject({ method, url, headers: { cookie, 'x-team-request': 'panel', ...(payload === undefined ? {} : { 'content-type': 'application/json' }) }, payload: payload === undefined ? undefined : JSON.stringify(payload) })

  async function publishedMessage () {
    const { payload, headers } = await multipart({ text: `La agenda queda en blanco (caso ${++cases}).` })
    const res = await env.app.inject({ method: 'POST', url: '/api/inputs', payload, headers: { ...headers, cookie: anaCookie, 'x-team-request': 'panel' } })
    const inputId = res.json().input_id
    await until(() => env.db.prepare('SELECT status FROM inputs WHERE id = ?').get(inputId).status === 'proposed', { timeoutMs: 10000 })
    assert.equal((await api('POST', `/api/inputs/${inputId}/publish`, anaCookie, {})).statusCode, 200)
    return env.db.prepare('SELECT id FROM messages WHERE input_id = ?').get(inputId).id
  }
  const seedJob = (messageId, kind, status) => Number(env.db.prepare(`INSERT INTO jobs (kind, message_id, payload_json, status, priority, attempts, max_attempts, run_at, created_at, finished_at)
    VALUES (?, ?, ?, ?, 0, 1, 1, 1, 1, ?)`).run(kind, messageId, JSON.stringify({ message_id: messageId, member_id: agentId, requested_by: null }), status, status === 'failed' ? Date.now() - 60_000 : null).lastInsertRowid)
  // The thread as a failure leaves it: the failed job, the notice that carries it and a person holding the message.
  function failedMessage (messageId, kind, code) {
    const jobId = seedJob(messageId, kind, 'failed')
    const { replyId } = addReply({ db: env.db, events: env.events }, { messageId, authorId: agentId, kind: 'answer', body: 'Claude no pudo responder.' })
    env.db.prepare('UPDATE replies SET failed_job_id = ?, failed_code = ? WHERE id = ?').run(jobId, code, replyId)
    return { jobId, replyId }
  }
  const resume = (trigger = 'start') => resumeInfraFailures({ db: env.db, config, events: env.events }, { trigger })
  const jobsOf = (id, kind) => env.db.prepare('SELECT id, status, payload_json FROM jobs WHERE message_id = ? AND kind = ? ORDER BY id').all(id, kind)

  before(async () => {
    env = await makeEnv({ telemetry: true, worker: true })
    config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent' }, { execute: { deliverCommand: 'entregar.sh', dailyBudgetUsd: 1000 } })
    await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
    await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    editor = await login(env, 'ed@x.org')
    anaCookie = await login(env, 'ana@x.org')
    const created = await api('POST', '/api/members', editor, { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Perfil del agente.' })
    agentId = Number(created.json().id)
  })
  beforeEach(() => { env.db.prepare("DELETE FROM jobs WHERE status = 'queued'").run(); env.db.prepare("UPDATE messages SET status = 'closed'").run() }) // each case starts with the earlier ones out of the way
  after(async () => { await env.close() })

  it('an execute that failed for the machine is launched again, says so in the thread, and is not launched twice', async () => {
    const id = await publishedMessage()
    const { jobId, replyId } = failedMessage(id, 'execute', 'machine_create_failed')
    const launched = resume()
    assert.equal(launched.length, 1)
    const [, again] = jobsOf(id, 'execute')
    assert.equal(again.status, 'queued')
    assert.equal(JSON.parse(again.payload_json).auto_resumed, true)
    assert.equal(env.db.prepare('SELECT replaced_by_job_id FROM replies WHERE id = ?').get(replyId).replaced_by_job_id, launched[0])
    assert.ok(jobId < launched[0])
    assert.ok(env.db.prepare("SELECT 1 AS ok FROM progress_notes WHERE message_id = ? AND json_extract(data_json, '$.event') = 'resumed'").get(id), 'the thread says it was picked up again on its own')
    assert.ok(env.db.prepare("SELECT 1 AS ok FROM message_assignees WHERE message_id = ? AND member_id = ?").get(id, agentId), 'Claude is again among the assignees')
    assert.deepEqual(resume(), [], 'a second start enqueues nothing while one is queued (retry_stale)')
    assert.equal(jobsOf(id, 'execute').length, 2)
  })

  it('a delivery that failed with exit 127 (deliver_env) is launched again', () => {
    return publishedMessage().then((id) => {
      failedMessage(id, 'deliver', 'deliver_env')
      assert.equal(resume().length, 1)
      assert.equal(jobsOf(id, 'deliver').at(-1).status, 'queued')
    })
  })

  it('a failure that another try does not fix is not launched: invalid_output and a failed verification', async () => {
    const a = await publishedMessage()
    failedMessage(a, 'execute', 'invalid_output')
    const b = await publishedMessage()
    failedMessage(b, 'deliver', 'deliver_failed')
    assert.deepEqual(resume(), [])
    assert.equal(jobsOf(a, 'execute').length, 1)
    assert.equal(jobsOf(b, 'deliver').length, 1)
  })

  it('a closed message is not launched', async () => {
    const id = await publishedMessage()
    failedMessage(id, 'execute', 'execute_timeout')
    env.db.prepare("UPDATE messages SET status = 'closed' WHERE id = ?").run(id)
    assert.deepEqual(resume(), [])
  })

  it('a work waiting for a person (its last job ended well, an older one failed) is not launched', async () => {
    const id = await publishedMessage()
    failedMessage(id, 'execute', 'machine_create_failed')
    seedJob(id, 'execute', 'done')
    assert.deepEqual(resume(), [])
    assert.equal(jobsOf(id, 'execute').length, 2)
  })

  it('a message that already has a job queued is not duplicated', async () => {
    const id = await publishedMessage()
    failedMessage(id, 'execute', 'execute_no_result')
    seedJob(id, 'execute', 'queued')
    assert.deepEqual(resume(), [])
    assert.equal(jobsOf(id, 'execute').length, 2)
  })

  it('capacity coming back relaunches only the machine failures, and only once', async () => {
    const a = await publishedMessage()
    failedMessage(a, 'execute', 'machine_create_failed')
    const b = await publishedMessage()
    failedMessage(b, 'deliver', 'deliver_env')
    const c = await publishedMessage()
    failedMessage(c, 'execute', 'execute_timeout')
    assert.equal(resume('capacity').length, 1, 'only the one that failed for the machine')
    assert.equal(jobsOf(b, 'deliver').length, 1)
    assert.equal(jobsOf(c, 'execute').length, 1)
    env.db.prepare("UPDATE jobs SET status = 'failed', finished_at = 1 WHERE message_id = ? AND kind = 'execute' AND status = 'queued'").run(a)
    const last = env.db.prepare('SELECT MAX(id) AS id FROM jobs WHERE message_id = ?').get(a).id
    const { replyId } = (() => { const r = addReply({ db: env.db, events: env.events }, { messageId: a, authorId: agentId, kind: 'answer', body: 'Otra vez no pudo.' }); return r })()
    env.db.prepare("UPDATE replies SET failed_job_id = ?, failed_code = 'machine_create_failed' WHERE id = ?").run(last, replyId)
    assert.deepEqual(resume('capacity'), [], 'the system does not relaunch its own relaunch on every event: a person or the next start does')
  })

  it('the worker relaunches it when it starts', async () => {
    const id = await publishedMessage()
    failedMessage(id, 'execute', 'execute_no_result')
    const handlers = { execute: { run: async () => () => {}, onFailure () {} } }
    const worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers, resume: (trigger) => resumeInfraFailures({ db: env.db, config, events: env.events }, { trigger }) })
    worker.start()
    try {
      await until(() => jobsOf(id, 'execute').length === 2 && jobsOf(id, 'execute').at(-1).status === 'done', { timeoutMs: 10000 })
      assert.equal(jobsOf(id, 'execute').length, 2)
    } finally { await worker.stop() }
  })
})
