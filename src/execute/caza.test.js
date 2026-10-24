// Hunt for the failures of the unattended work (2026-10-23): every case below is a way the `execute` and `deliver` jobs ended with a message that
// nobody holds or nobody answered, reproduced against a listening server, the fake `claude` and a fake delivery command. The rule they share:
// a message is never left without a reply and without a person who sees it; what fails by infrastructure runs once more and then goes to a person (UD-269).
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { buriedHandoffs } from '../domain/escalation.js'
import { updateMember } from '../domain/members.js'
import { createPipeline } from '../domain/pipeline.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { createDeliverHandler } from './deliver.js'
import { enqueueDeliver } from './enqueue.js'
import { createExecuteHandler } from './handler.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
const PORT = 8648 // the range given to this work (8640 to 8649)

describe('failure hunt: execute and deliver', () => {
  let env, state, worker, editor, editorId, author, authorId, englishAuthor, agentId, vault
  const cookieHeaders = (cookie) => ({ cookie, 'x-team-request': 'panel' })

  function startWorker (execute = {}) {
    const config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, {
      execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000, capacityWaitMs: 300, infraRetryWaitMs: 50, ...execute }
    })
    const handlers = {
      ...createPipeline({ db: env.db, config, queue: env.queue, events: env.events, modules: env.modules }),
      execute: createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault }),
      deliver: createDeliverHandler({ db: env.db, config, queue: env.queue, events: env.events })
    }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers })
    worker.start()
    return config
  }
  const calls = () => { try { return readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) } catch { return [] } }
  const jobsOf = (messageId, kind) => env.db.prepare('SELECT * FROM jobs WHERE kind = ? AND message_id = ? ORDER BY id').all(kind, messageId)
  const settle = (messageId) => until(() => {
    const all = env.db.prepare("SELECT status FROM jobs WHERE message_id = ? AND kind IN ('execute', 'deliver')").all(messageId)
    return all.length > 0 && all.every((j) => ['done', 'failed', 'cancelled'].includes(j.status))
  }, { timeoutMs: 40000 })
  const assignees = (messageId) => env.db.prepare('SELECT member_id FROM message_assignees WHERE message_id = ? ORDER BY member_id').all(messageId).map((r) => r.member_id)
  const lastReply = (messageId) => env.db.prepare('SELECT author_id, kind, body FROM replies WHERE message_id = ? ORDER BY id DESC LIMIT 1').get(messageId)
  const status = (messageId) => env.db.prepare('SELECT status FROM messages WHERE id = ?').get(messageId).status

  async function publishedMessage (text, who = author) {
    const res = await postInput(env, who, { text })
    const inputId = res.json().input_id
    await until(() => env.db.prepare('SELECT status FROM inputs WHERE id = ?').get(inputId).status === 'proposed', { timeoutMs: 10000 })
    const pub = await env.app.inject({ method: 'POST', url: `/api/inputs/${inputId}/publish`, headers: { ...cookieHeaders(who), 'content-type': 'application/json' }, payload: '{}' })
    assert.equal(pub.statusCode, 200, pub.body)
    return env.db.prepare('SELECT id FROM messages WHERE input_id = ?').get(inputId).id
  }
  /** What every failure must leave: a person holds the message, it is open, the last reply is the agent's question, nothing is buried. */
  function assertSeen (messageId) {
    assert.deepEqual(assignees(messageId), [editorId], 'a person holds the message and the agent does not')
    assert.equal(status(messageId), 'open')
    const reply = lastReply(messageId)
    assert.deepEqual([reply.author_id, reply.kind], [agentId, 'clarification'])
    assert.deepEqual(buriedHandoffs(env.db), [])
    return reply.body
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
    editor = await login(env, 'ed@x.org')
    const created = await env.app.inject({ method: 'POST', url: '/api/members', headers: cookieHeaders(editor), payload: { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Perfil del agente: arreglo pantallas.' } })
    agentId = Number(created.json().id)
    authorId = await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    updateMember(env.db, authorId, { profile: 'Perfil de Ana: llevo la agenda de la clínica.' })
    author = await login(env, 'ana@x.org')
    const englishId = await addMember(env, { email: 'bob@x.org', name: 'Bob' })
    env.db.prepare("UPDATE members SET language = 'en' WHERE id = ?").run(englishId)
    englishAuthor = await login(env, 'bob@x.org')
    env.config.execute.deliverCommand = 'true'
    await env.app.listen({ host: '127.0.0.1', port: PORT })
  })
  beforeEach(async () => {
    await worker?.stop()
    rmSync(join(state, 'calls.jsonl'), { force: true })
    for (const k of Object.keys(process.env)) if (k.startsWith('FAKE_EXECUTE_') && k !== 'FAKE_EXECUTE_STATE') delete process.env[k]
    process.env.FAKE_EXECUTE_MODE = 'ok'
    process.env.FAKE_EXECUTE_REPLY = '1'
  })
  after(async () => { await worker?.stop(); await env.close() })

  // ---- Case (e): a failure by infrastructure was buried as «answered» and assigned only to Claude
  it('a session that dies with no result runs once more and then goes to a person, not to «answered»', async () => {
    process.env.FAKE_EXECUTE_MODE = 'exit'
    startWorker()
    const messageId = await publishedMessage('Una sesión que no arranca.')
    await settle(messageId)
    const [job] = jobsOf(messageId, 'execute')
    assert.deepEqual([job.status, job.attempts], ['failed', 2], 'one more try for the infrastructure')
    assert.equal(calls().length, 2)
    const body = assertSeen(messageId)
    assert.match(body, /\*\*Resultado\*\*: blocked$/)
    assert.doesNotMatch(body, /execute_no_result|claude -p/, 'plain words')
  })

  it('a failure of the model service (529) runs once more and, if the second try works, nobody hears about it', async () => {
    process.env.FAKE_EXECUTE_FAIL_FIRST = '1'
    process.env.FAKE_EXECUTE_FAIL_MODE = 'api-error'
    startWorker()
    const messageId = await publishedMessage('El servicio del modelo está saturado.')
    await settle(messageId)
    const [job] = jobsOf(messageId, 'execute')
    assert.deepEqual([job.status, job.attempts], ['done', 2])
    assert.match(lastReply(messageId).body, /\*\*Resultado\*\*: done$/)
    assert.equal(status(messageId), 'answered')
  })

  it('a machine that cannot be created runs once more and then goes to a person', async () => {
    startWorker({ runner: 'machine', machineCreate: 'echo vm; exit 1', machineRun: 'bash {workdir}/run.sh', machineDestroy: 'true' })
    const messageId = await publishedMessage('Una máquina que no se crea.')
    await settle(messageId)
    assert.deepEqual(jobsOf(messageId, 'execute').map((j) => [j.status, j.attempts]), [['failed', 2]])
    assertSeen(messageId)
  })

  it('a second 529 goes to a person with the reason in plain words', async () => {
    process.env.FAKE_EXECUTE_MODE = 'api-error'
    startWorker()
    const messageId = await publishedMessage('Siempre saturado.')
    await settle(messageId)
    assert.equal(jobsOf(messageId, 'execute')[0].attempts, 2)
    assert.match(assertSeen(messageId), /problema del sistema/)
  })

  it('a budget that ran out and an output that does not fit the format go to a person at once, with no second try', async () => {
    process.env.FAKE_EXECUTE_MODE = 'error'
    startWorker()
    const budgeted = await publishedMessage('Se acaba el presupuesto a mitad.')
    await settle(budgeted)
    process.env.FAKE_EXECUTE_MODE = 'invalid-output'
    const invalid = await publishedMessage('Salida inválida.')
    await settle(invalid)
    for (const id of [budgeted, invalid]) {
      assert.deepEqual(jobsOf(id, 'execute').map((j) => [j.status, j.attempts]), [['failed', 1]], 'the work was done: another run would spend again')
      assertSeen(id)
    }
    assert.match(lastReply(budgeted).body, /tope de gasto/)
    assert.match(lastReply(invalid).body, /formato/)
  })

  it('a timeout goes to a person and is not run again', async () => {
    process.env.FAKE_EXECUTE_MODE = 'hang'
    startWorker({ timeoutMs: 600 })
    const messageId = await publishedMessage('Una sesión que se cuelga.')
    await settle(messageId)
    assert.deepEqual(jobsOf(messageId, 'execute').map((j) => [j.status, j.attempts]), [['failed', 1]])
    assert.match(assertSeen(messageId), /tiempo máximo/)
  })

  it('a failure reaches the author in the language of the author', async () => {
    process.env.FAKE_EXECUTE_MODE = 'invalid-output'
    startWorker()
    const inEnglish = await publishedMessage('Output that does not fit.', englishAuthor)
    await settle(inEnglish)
    assert.match(lastReply(inEnglish).body, /did not have the format/)
    assert.match(lastReply(inEnglish).body, /\*\*Resultado\*\*: blocked$/)
  })

  // ---- Case (f), the sibling: a session that ends `blocked` is not an answer
  it('a session that ends blocked reaches a person, as needs_decision does', async () => {
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ outcome: 'blocked', summary: 'No tengo acceso a la base de pruebas.' })
    startWorker()
    const messageId = await publishedMessage('Hace falta una base que no existe.')
    await settle(messageId)
    assert.match(assertSeen(messageId), /No tengo acceso a la base de pruebas\./)
  })

  // ---- Case (c): a variable of the environment turned on before the binary that supports it
  it('a binary that rejects the system-prompt flag is run again without it, and the job ends done', async () => {
    process.env.FAKE_EXECUTE_MODE = 'reject-flag'
    startWorker({ stableAsSystem: true })
    const messageId = await publishedMessage('La bandera no existe en esta imagen.')
    await settle(messageId)
    const [job] = jobsOf(messageId, 'execute')
    assert.deepEqual([job.status, job.attempts], ['done', 2], job.last_error)
    const [first, second] = calls()
    assert.ok(first.args.includes('--append-system-prompt-file'))
    assert.ok(!second.args.includes('--append-system-prompt-file'), 'the second try leaves the flag')
    assert.match(second.stdin, /How you work/, 'the stable part travels in the prompt')
    assert.equal(status(messageId), 'answered')
  })

  // ---- Cases (a) and (d): the lease of a job expires
  it('a deliver whose lease expired twice goes to a person with the reason, not to «answered» with Claude', async () => {
    startWorker({ deliverCommand: 'true' })
    const messageId = await publishedMessage('Una entrega que se interrumpe.')
    await settle(messageId)
    await worker.stop()
    env.db.prepare("UPDATE messages SET status = 'answered' WHERE id = ?").run(messageId)
    env.db.prepare('DELETE FROM message_assignees WHERE message_id = ? AND member_id <> ?').run(messageId, agentId)
    env.db.prepare('INSERT OR IGNORE INTO message_assignees (message_id, member_id) VALUES (?, ?)').run(messageId, agentId)
    const id = enqueueDeliver(env.db, { messageId, payload: { member_id: agentId, branch: `tp/${messageId}`, round: 0, output: { outcome: 'done', summary: 'Listo.' }, execute_job_id: null, requested_by: null } })
    env.db.prepare("UPDATE jobs SET status = 'running', attempts = 2, lease_until = 1, worker_id = 'dead' WHERE id = ?").run(id)
    startWorker({ deliverCommand: 'true' })
    await until(() => env.queue.getJob(id).status === 'failed')
    const body = await until(() => { const r = lastReply(messageId); return r.kind === 'clarification' && r.body })
    assert.match(body, /se interrumpió/)
    assert.deepEqual(assignees(messageId), [editorId])
    assert.deepEqual(buriedHandoffs(env.db), [])
  })

  it('a lease that expires while the worker is alive still reaches the handler (the claim recovers it, not the sweep or the start)', async () => {
    startWorker()
    const messageId = await publishedMessage('Un arriendo vencido que recoge la reclamación.')
    await settle(messageId)
    await worker.stop()
    env.db.prepare("UPDATE messages SET status = 'answered' WHERE id = ?").run(messageId)
    env.db.prepare('DELETE FROM message_assignees WHERE message_id = ?').run(messageId)
    env.db.prepare('INSERT INTO message_assignees (message_id, member_id) VALUES (?, ?)').run(messageId, agentId)
    // The worker is alive and has recovered its leases at the start: the sweep of the heartbeat is an hour away.
    const config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, { execute: { bin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, deliverCommand: 'true' } })
    config.worker.heartbeatMs = 3_600_000
    config.worker.leaseMs = 7_200_000
    const handlers = { deliver: createDeliverHandler({ db: env.db, config, queue: env.queue, events: env.events }) }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers })
    worker.start()
    const id = enqueueDeliver(env.db, { messageId, payload: { member_id: agentId, branch: `tp/${messageId}`, round: 0, output: null, execute_job_id: null, requested_by: null } })
    env.db.prepare("UPDATE jobs SET status = 'running', attempts = 2, max_attempts = 2, lease_until = 1, worker_id = 'dead' WHERE id = ?").run(id)
    worker.wake() // a job arrives: the claim recovers the expired lease
    await until(() => env.queue.getJob(id).status === 'failed', { timeoutMs: 5000 })
    await until(() => lastReply(messageId).kind === 'clarification', { timeoutMs: 5000 })
    assert.deepEqual(assignees(messageId), [editorId])
  })

  // ---- The safety net: a failed job that nobody handled is found and given to a person
  it('a failed job whose handler never ran is found by the sweep and its message goes to a person', async () => {
    startWorker()
    const messageId = await publishedMessage('Un trabajo que murió sin que nadie lo viera.')
    await settle(messageId)
    await worker.stop()
    env.db.prepare("UPDATE messages SET status = 'answered' WHERE id = ?").run(messageId)
    env.db.prepare('DELETE FROM message_assignees WHERE message_id = ?').run(messageId)
    env.db.prepare('INSERT INTO message_assignees (message_id, member_id) VALUES (?, ?)').run(messageId, agentId)
    const id = enqueueDeliver(env.db, { messageId, payload: { member_id: agentId, branch: `tp/${messageId}`, round: 0, output: null, execute_job_id: null, requested_by: null } })
    env.db.prepare("UPDATE jobs SET status = 'failed', attempts = 2, finished_at = 1, last_error = 'boom' WHERE id = ?").run(id)
    assert.equal(buriedHandoffs(env.db).filter((b) => b.message_id === messageId).length, 1, 'the invariant sees it')
    startWorker()
    await until(() => assignees(messageId).includes(editorId), { timeoutMs: 5000 })
    assert.deepEqual(assignees(messageId), [editorId])
    assert.deepEqual(buriedHandoffs(env.db), [])
  })

  // ---- The second failed verification
  it('a verification that fails twice goes to a person with the plain notice', async () => {
    startWorker({ deliverCommand: 'echo boom; exit 3' })
    const messageId = await publishedMessage('Una entrega que nunca pasa.')
    await settle(messageId)
    assert.match(assertSeen(messageId), /no pasó la verificación[\s\S]*\*\*Resultado\*\*: blocked$/)
  })

  it('the phase of a job that failed is cleared', async () => {
    process.env.FAKE_EXECUTE_MODE = 'invalid-output'
    startWorker()
    const messageId = await publishedMessage('La fase no debe quedar.')
    await settle(messageId)
    assert.equal(jobsOf(messageId, 'execute')[0].phase, null)
  })
})
