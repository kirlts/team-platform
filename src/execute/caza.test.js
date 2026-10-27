// Hunt for the failures of the unattended work (2026-10-23): every case below is a way the `execute` and `deliver` jobs ended with a message that
// nobody holds or nobody answered, reproduced against a listening server, the fake `claude` and a fake delivery command. The rule they share:
// a message is never left without a reply and without a person who sees it; what fails by infrastructure runs once more and then goes to a person (UD-269).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { buriedHandoffs } from '../domain/escalation.js'
import { closeMessage, getMessage, updateMessage } from '../domain/messages.js'
import { updateMember } from '../domain/members.js'
import { createPipeline } from '../domain/pipeline.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { createDeliverHandler, isEnvironmentFailure } from './deliver.js'
import { enqueueDeliver } from './enqueue.js'
import { createExecuteHandler } from './handler.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
const HOUR_MS = 3_600_000 // a test bound: longer than any case here, so the sweep of the leases never runs inside one
let PORT = 0 // ephemeral, set after listen: a fixed port made a second run of the same file cancel itself with EADDRINUSE (2026-10-26)

describe('failure hunt: execute and deliver', () => {
  let env, state, worker, editor, editorId, author, authorId, englishAuthor, agentId, vault
  const cookieHeaders = (cookie) => ({ cookie, 'x-team-request': 'panel' })

  function startWorker (execute = {}, queueEnv = {}) {
    const config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT), ...queueEnv }, {
      execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000, capacityWaitMs: 300, infraRetryWaitMs: 50, ...execute }
    })
    const handlers = {
      ...createPipeline({ db: env.db, config, queue: env.queue, events: env.events, modules: env.modules }),
      execute: createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault, getProviders: env.modules.getProviders }),
      deliver: createDeliverHandler({ db: env.db, config, queue: env.queue, events: env.events })
    }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers })
    worker.start()
    return config
  }
  const ends = () => { try { return readFileSync(join(state, 'ends.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) } catch { return [] } }
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
    await env.app.listen({ host: '127.0.0.1', port: 0 }); PORT = env.app.server.address().port
  })
  beforeEach(async () => {
    await worker?.stop()
    rmSync(join(state, 'calls.jsonl'), { force: true })
    rmSync(join(state, 'ends.jsonl'), { force: true })
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
    assert.doesNotMatch(body, /\*\*Resultado\*\*/)
    assert.match(body, /Todavía no está en producción/)
    assert.doesNotMatch(body, /execute_no_result|claude -p/, 'plain words')
  })

  it('a failure of the model service (529) runs once more at its own time (not at the sweep of the leases) and, if the second try works, nobody hears about it', async () => {
    process.env.FAKE_EXECUTE_FAIL_FIRST = '1'
    process.env.FAKE_EXECUTE_FAIL_MODE = 'api-error'
    // No wall clock: the sweep of the leases (and the heartbeat) is set an hour apart, so it cannot happen while the case runs. The second try then ends only if the queue
    // wakes for its `run_at` by itself (the timer of `armNextWake`); if it waited for the sweep, `settle` would run out of time and the case would fail.
    startWorker({}, { QUEUE_HEARTBEAT_MS: String(HOUR_MS), QUEUE_LEASE_MS: String(2 * HOUR_MS) })
    const messageId = await publishedMessage('El servicio del modelo está saturado.')
    await settle(messageId)
    const [job] = jobsOf(messageId, 'execute')
    assert.deepEqual([job.status, job.attempts], ['done', 2])
    assert.doesNotMatch(lastReply(messageId).body, /\*\*Resultado\*\*/)
    assert.match(lastReply(messageId).body, /Ya carga con tus datos\.$/)
    assert.equal(status(messageId), 'answered')
    assert.ok(Math.abs(job.cost_usd - 2 * 1.2345) < 1e-9, `the day's cost keeps what both tries spent, not only the last: ${job.cost_usd}`)
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
    assert.doesNotMatch(lastReply(inEnglish).body, /\*\*Resultado\*\*/)
    assert.match(lastReply(inEnglish).body, /launch it again from its page\.$/)
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
    startWorker({ deliverCommand: 'echo boom; exit 3', deliverRetries: 1 })
    const messageId = await publishedMessage('Una entrega que nunca pasa.')
    await settle(messageId)
    assert.match(assertSeen(messageId), /^No quedó en producción: no pasó la verificación[\s\S]*lanzar la entrega\.$/)
  })

  it('the phase of a job that failed is cleared', async () => {
    process.env.FAKE_EXECUTE_MODE = 'invalid-output'
    startWorker()
    const messageId = await publishedMessage('La fase no debe quedar.')
    await settle(messageId)
    assert.equal(jobsOf(messageId, 'execute')[0].phase, null)
  })
  // ---- The day's cap and a burst of messages
  it('eight sessions that start together do not each get the whole remainder of the day: the cap holds', async () => {
    process.env.FAKE_EXECUTE_SLEEP_MS = '400'
    env.db.prepare("UPDATE jobs SET cost_usd = NULL WHERE kind = 'execute'").run()
    startWorker({ dailyBudgetUsd: 10, maxBudgetUsd: 10, sessionReserveUsd: 10, capacityWaitMs: 100 }) // UD-305: the knob holds the whole cap per session, so the caps never add up to more than the day
    const ids = []
    for (let i = 0; i < 3; i++) ids.push(await publishedMessage(`Mensaje de una ráfaga ${i}.`))
    await Promise.all(ids.map(settle))
    const budgetOf = (c) => Number(c.args[c.args.indexOf('--max-budget-usd') + 1])
    const done = ends()
    const runs = calls().map((c) => ({ budget: budgetOf(c), t0: c.t0, t1: done.find((e) => e.pid === c.pid).t1 }))
    assert.equal(runs.length, 3, 'every message was worked')
    for (const a of runs) {
      const alive = runs.filter((b) => b.t0 < a.t1 && a.t0 < b.t1).reduce((sum, b) => sum + b.budget, 0)
      assert.ok(alive <= 10 + 1e-9, `sessions alive at the same time may spend ${alive} USD against a cap of 10`)
    }
  })

  it('the reserve of a session is what its model cost, so three sessions run together under a day of 3 USD that a reserve of 10 would serialize (UD-305)', async () => {
    process.env.FAKE_EXECUTE_SLEEP_MS = '400'
    env.db.prepare("UPDATE jobs SET cost_usd = NULL WHERE kind = 'execute'").run()
    const longAgo = Date.now() - 2 * 24 * 3600 * 1000 // finished two days ago: it measures the cost and is not today's spend
    for (let i = 0; i < 4; i++) env.db.prepare("INSERT INTO jobs (kind, payload_json, status, run_at, created_at, finished_at, cost_usd, model) VALUES ('execute', '{}', 'done', ?, ?, ?, 0.1, 'claude-sonnet-5-5')").run(longAgo, longAgo, longAgo)
    startWorker({ dailyBudgetUsd: 3, maxBudgetUsd: 1, capacityWaitMs: 100, model: 'claude-sonnet-5-5' })
    const ids = []
    for (let i = 0; i < 3; i++) ids.push(await publishedMessage(`Mensaje medido ${i}.`))
    await Promise.all(ids.map(settle))
    const done = ends()
    const runs = calls().map((c) => ({ t0: c.t0, t1: done.find((e) => e.pid === c.pid).t1 }))
    assert.equal(runs.length, 3, 'every message was worked')
    assert.ok(Math.max(...runs.map((r) => r.t0)) < Math.min(...runs.map((r) => r.t1)), 'the three sessions were alive at the same time')
  })

  // ---- The message changes while Claude works
  it('a message that loses the agent while it works stops the session and the message goes on without Claude', async () => {
    process.env.FAKE_EXECUTE_SLEEP_MS = '3000'
    startWorker()
    const messageId = await publishedMessage('Se le quita el mensaje a Claude a mitad de trabajo.')
    await until(() => calls().length === 1)
    const version = getMessage(env.db, messageId).version
    updateMessage({ db: env.db, events: env.events }, { messageId, actor: { id: authorId }, patch: { version, assignee_ids: [editorId] } })
    const [job] = jobsOf(messageId, 'execute')
    await until(() => env.queue.getJob(job.id).status !== 'running', { timeoutMs: 5000 })
    assert.equal(env.queue.getJob(job.id).status, 'cancelled')
    await new Promise((resolve) => setTimeout(resolve, 600))
    assert.equal(jobsOf(messageId, 'deliver').length, 0, 'nothing is delivered for a message that is no longer Claude\'s')
    assert.deepEqual(assignees(messageId), [editorId])
    assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM replies WHERE message_id = ? AND body LIKE '%Resultado%'").get(messageId).n, 0, 'no closing reply after it was taken away')
  })

  it('a message edited while Claude works is answered, not delivered to production, and goes to a person with the reason', async () => {
    process.env.FAKE_EXECUTE_SLEEP_MS = '700'
    startWorker({ deliverCommand: 'true' })
    const messageId = await publishedMessage('Texto original del pedido.')
    await until(() => calls().length === 1)
    const version = getMessage(env.db, messageId).version
    updateMessage({ db: env.db, events: env.events }, { messageId, actor: { id: authorId }, patch: { version, body: 'Texto corregido: era otra pantalla.' } })
    await settle(messageId)
    assert.equal(jobsOf(messageId, 'deliver').length, 0, 'the change for the old text does not reach production by itself')
    const body = assertSeen(messageId)
    assert.match(body, /se editó mientras trabajaba/)
  })

  it('a message closed while Claude works ends the job in done, with no failure and no reply', async () => {
    process.env.FAKE_EXECUTE_SLEEP_MS = '700'
    process.env.FAKE_EXECUTE_REPLY = '0'
    startWorker({ deliverCommand: 'true' })
    const messageId = await publishedMessage('Se cierra mientras Claude trabaja.')
    await until(() => calls().length === 1)
    const before = env.db.prepare('SELECT COUNT(*) AS n FROM replies WHERE message_id = ?').get(messageId).n
    closeMessage({ db: env.db, events: env.events }, messageId, editorId)
    await settle(messageId)
    const [job] = jobsOf(messageId, 'execute')
    assert.deepEqual([job.status, job.attempts], ['done', 1], job.last_error)
    assert.equal(jobsOf(messageId, 'deliver').length, 0)
    assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM replies WHERE message_id = ?').get(messageId).n, before)
  })

  // ---- The worker
  it('a progress line that cannot be recorded does not take the worker down', async () => {
    const config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, { execute: { bin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, dailyBudgetUsd: 1000, killGraceMs: 200 } })
    const queue = { ...env.queue, progress: (job, percent, phrase) => { if (phrase === 'Sesión iniciada') throw new Error('database is locked'); return env.queue.progress(job, percent, phrase) } }
    const handlers = { ...createPipeline({ db: env.db, config, queue: env.queue, events: env.events, modules: env.modules }), execute: createExecuteHandler({ db: env.db, config, queue, events: env.events, vault, getProviders: env.modules.getProviders }) }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers })
    worker.start()
    const messageId = await publishedMessage('Una línea de avance que no se puede guardar.')
    await settle(messageId)
    assert.equal(jobsOf(messageId, 'execute')[0].status, 'done', jobsOf(messageId, 'execute')[0].last_error)
  })

  it('a worktree left by an attempt that died with its worker does not stop the next attempt on the same branch', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'caza-repo-'))
    const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' })
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 'x'); writeFileSync(join(repo, 'a.txt'), 'a'); git('add', '.'); git('commit', '-qm', 'a')
    try {
      startWorker({ repoDir: repo, workRoot: join(env.dir, 'work') })
      process.env.FAKE_EXECUTE_SLEEP_MS = '300'
      const first = await publishedMessage('Un trabajo cuyo intento anterior murió con el trabajador.')
      await settle(first)
      // The previous attempt: a worktree of this very branch in the work root, left behind by a process that died.
      const dead = join(env.dir, 'work', 'execute-999-dead')
      mkdirSync(dead, { recursive: true })
      const messageId = first
      git('worktree', 'add', '-B', `tp/${messageId}`, join(dead, 'repo'))
      const id = Number((await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })).json().job_ids[0])
      await until(() => ['done', 'failed'].includes(env.queue.getJob(id).status), { timeoutMs: 20000 })
      assert.equal(env.queue.getJob(id).status, 'done', env.queue.getJob(id).last_error)
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })
  it('a session cannot start on the branch of a message while its delivery is queued or running', async () => {
    startWorker()
    const messageId = await publishedMessage('Una entrega en curso.')
    await settle(messageId)
    await worker.stop()
    const id = enqueueDeliver(env.db, { messageId, payload: { member_id: agentId, branch: `tp/${messageId}`, round: 0, output: null, execute_job_id: null, requested_by: null } })
    const res = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })
    assert.equal(res.statusCode, 409, res.body)
    assert.equal(res.json().code, 'execute_busy')
    env.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE id = ?").run(id)
  })

  it('a delivery command that did not run or was killed by a signal is the machine and not the change', () => {
    for (const code of [124, 126, 127, 129, 130, 139, 141]) assert.equal(isEnvironmentFailure({ code }, ''), true, `exit ${code}`)
    for (const code of [1, 2, 3, 4, 5, 64, 100]) assert.equal(isEnvironmentFailure({ code }, 'FAIL: la prueba'), false, `exit ${code}`)
  })
  it('the retry of a session that already sent its first reply is told not to send it again', async () => {
    process.env.FAKE_EXECUTE_FAIL_FIRST = '1'
    process.env.FAKE_EXECUTE_FAIL_MODE = 'exit-late'
    startWorker()
    const messageId = await publishedMessage('Una sesión que responde y muere.')
    await settle(messageId)
    assert.deepEqual(jobsOf(messageId, 'execute').map((j) => [j.status, j.attempts]), [['done', 2]])
    assert.match(calls()[1].stdin, /pass: retry after a failure of the system; your first reply was already sent/)
    assert.doesNotMatch(calls()[0].stdin, /pass: retry/)
    assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM replies WHERE message_id = ? AND body LIKE 'Recibido%'").get(messageId).n, 1, 'one «Recibido» in the thread')
  })
  it('a job that waits for the next day because the cap is spent says so once in the thread, and not at each retry', async () => {
    const spend = env.db.prepare("INSERT INTO jobs (kind, payload_json, status, run_at, created_at, finished_at, cost_usd, runner) VALUES ('execute', '{}', 'done', ?, ?, ?, 10, 'local')").run(Date.now(), Date.now(), Date.now())
    try {
      startWorker({ dailyBudgetUsd: 10 })
      const messageId = await publishedMessage('Se acabó el tope de hoy.')
      const [job] = await until(() => { const j = jobsOf(messageId, 'execute'); return j.length && j[0].status === 'queued' && j[0].run_at > Date.now() + 1000 && j })
      const notices = () => env.db.prepare("SELECT body, author_id FROM replies WHERE message_id = ? AND body LIKE 'En espera:%'").all(messageId)
      assert.equal(notices().length, 1)
      assert.match(notices()[0].body, /^En espera: se alcanzó el tope de gasto de hoy\. Sigue mañana a las 00:00\.$/)
      assert.equal(notices()[0].author_id, agentId)
      assert.equal(calls().length, 0, 'claude was not called')
      env.db.prepare('UPDATE jobs SET run_at = ? WHERE id = ?').run(Date.now(), job.id) // the next day arrives and the cap is still spent
      worker.wake()
      await until(() => jobsOf(messageId, 'execute')[0].run_at > Date.now() + 1000)
      assert.equal(notices().length, 1, 'the second wait does not repeat it')
    } finally { env.db.prepare('DELETE FROM jobs WHERE id = ?').run(Number(spend.lastInsertRowid)) }
  })
})
