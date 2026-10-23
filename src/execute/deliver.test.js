// The `deliver` job (UD-263) end to end against a listening server, the fake `claude` of the `execute` tests and a fake delivery command:
// one closing reply «Ya está en producción» in green, exit 76 that holds it for a person, exit 75 that waits without spending the attempt, a failed verification that goes
// back to `execute` once and then ends in the plain notice, the compatibility without EXECUTE_DELIVER_COMMAND, the timeout, and no machine
// alive while the delivery runs.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { listMigrations, migrate, openDatabase } from '../db/index.js'
import { updateMember } from '../domain/members.js'
import { createPipeline } from '../domain/pipeline.js'
import { PROGRESS_CODES } from '../domain/progress-phrases.js'
import { setProjectDescription } from '../domain/settings.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, tempDir, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { createDeliverHandler, deliveredBody, heldBody, outputJson, referenceOf, withProductionNote } from './deliver.js'
import { createExecuteHandler } from './handler.js'
import { buildExecutePrompt } from './prompt.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
const MIGRATIONS = fileURLToPath(new URL('../db/migrations', import.meta.url))
const PORT = 8643 // the range given to this work (8640 to 8649)

describe('deliver job', () => {
  let env, state, worker, editor, author, agentId, vault, counter
  const cookieHeaders = (cookie) => ({ cookie, 'x-team-request': 'panel' })
  const path = (name) => join(env.dir, `${name}-${++counter}`)

  function startWorker (execute = {}) {
    const config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, {
      execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000, capacityWaitMs: 300, ...execute }
    })
    const handlers = {
      ...createPipeline({ db: env.db, config, queue: env.queue, events: env.events, modules: env.modules }),
      execute: createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault }),
      deliver: createDeliverHandler({ db: env.db, config, queue: env.queue, events: env.events })
    }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers })
    worker.start()
  }
  const calls = () => { try { return readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) } catch { return [] } }
  const jobsOf = (messageId, kind) => env.db.prepare('SELECT * FROM jobs WHERE kind = ? AND message_id = ? ORDER BY id').all(kind, messageId)
  const finished = (id) => { const j = env.queue.getJob(id); return ['done', 'failed', 'cancelled'].includes(j.status) && j }
  const waitJob = (id) => until(() => finished(id), { timeoutMs: 30000 })
  const replies = (messageId) => env.db.prepare('SELECT body FROM replies WHERE message_id = ? AND author_id = ? ORDER BY id').all(messageId, agentId).map((r) => r.body)
  const eventsOf = (jobId) => env.db.prepare('SELECT kind, percent, phrase, data_json FROM job_events WHERE job_id = ? ORDER BY seq').all(jobId)
  const phrasesOf = (jobId) => eventsOf(jobId).filter((e) => e.kind === 'progress').map((e) => e.phrase)
  /** Waits until every `execute` and `deliver` job of the message has ended and nothing is queued. */
  const settle = (messageId) => until(() => {
    const all = env.db.prepare("SELECT status FROM jobs WHERE message_id = ? AND kind IN ('execute', 'deliver')").all(messageId)
    return all.length > 0 && all.every((j) => ['done', 'failed', 'cancelled'].includes(j.status))
  }, { timeoutMs: 40000 })

  async function publishedMessage (text) {
    const res = await postInput(env, author, { text })
    const inputId = res.json().input_id
    await until(() => env.db.prepare('SELECT status FROM inputs WHERE id = ?').get(inputId).status === 'proposed', { timeoutMs: 10000 })
    const pub = await env.app.inject({ method: 'POST', url: `/api/inputs/${inputId}/publish`, headers: { ...cookieHeaders(author), 'content-type': 'application/json' }, payload: '{}' })
    assert.equal(pub.statusCode, 200, pub.body)
    return env.db.prepare('SELECT id FROM messages WHERE input_id = ?').get(inputId).id
  }

  before(async () => {
    const analyze = async (bundle, opts) => {
      const r = await fakeAnalyze(bundle, opts)
      r.proposal.messages[0].assignee_ids = bundle.members.filter((m) => m.name === 'Claude').map((m) => m.id)
      return r
    }
    env = await makeEnv({ telemetry: true, modules: { analyze } })
    counter = 0
    state = join(env.dir, 'fake-state')
    mkdirSync(state)
    process.env.FAKE_EXECUTE_STATE = state
    vault = createVault(loadMasterKey({ dataDir: env.dir }))
    await addMember(env, { email: 'ed@x.org', role: 'editor' })
    editor = await login(env, 'ed@x.org')
    const created = await env.app.inject({ method: 'POST', url: '/api/members', headers: cookieHeaders(editor), payload: { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Perfil del agente: arreglo pantallas.' } })
    agentId = Number(created.json().id)
    const authorId = await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    updateMember(env.db, authorId, { profile: 'Perfil de Ana: llevo la agenda de la clínica.' })
    author = await login(env, 'ana@x.org')
    setProjectDescription(env.db, 'Descripción del proyecto: agenda de clínicas.')
    env.config.execute.deliverCommand = 'true' // the API answers `POST /messages/:id/deliver` only when the instance declares the command
    await env.app.listen({ host: '127.0.0.1', port: PORT })
  })
  beforeEach(async () => {
    await worker?.stop()
    rmSync(join(state, 'calls.jsonl'), { force: true })
    process.env.FAKE_EXECUTE_MODE = 'ok'
    process.env.FAKE_EXECUTE_REPLY = '1'
    delete process.env.FAKE_EXECUTE_EXTRA
    delete process.env.FAKE_EXECUTE_MULTI
    delete process.env.FAKE_EXECUTE_MARKS
  })
  after(async () => { await worker?.stop(); await env.close() })

  it('execute hands over and posts nothing; the delivery posts the one closing reply with the production note and the reference', async () => {
    const gate = path('gate')
    const log = path('log')
    startWorker({ deliverCommand: `echo "$TEAM_MESSAGE_ID {message_id} {branch} {job_id} $TEAM_BRANCH" >> ${log}; echo '##team phase verify'; echo verifying; echo '##team phase deploy'; while [ ! -e ${gate} ]; do sleep 0.05; done; echo built; echo abc1234` })
    const messageId = await publishedMessage('La pantalla de agenda queda en blanco al abrirla.')
    const [exec] = jobsOf(messageId, 'execute')
    assert.equal((await waitJob(exec.id)).status, 'done')
    const delivery = await until(() => jobsOf(messageId, 'deliver')[0])
    assert.equal(delivery.max_attempts, 2)
    await until(() => env.db.prepare('SELECT phase FROM jobs WHERE id = ?').get(delivery.id).phase === 'deliverDeploy')
    assert.deepEqual(replies(messageId).length, 1, 'only the first reply exists while the delivery runs')
    const running = (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}/timing`, headers: { cookie: editor } })).json()
    assert.deepEqual([running.job_status, running.phase, running.deliver.job_id], ['running', 'deliverDeploy', String(delivery.id)])

    writeFileSync(gate, '')
    assert.equal((await waitJob(delivery.id)).status, 'done')
    const mine = replies(messageId)
    assert.equal(mine.length, 2, 'the first reply and ONE closing reply')
    assert.equal(mine[1], 'Arreglé la pantalla que quedaba en blanco.\n\nYa carga con tus datos. Ya está en producción.\n\n**Resultado**: done\n\n**Entrega**: abc1234')
    assert.equal(readFileSync(log, 'utf8').trim(), `${messageId} '${messageId}' 'tp/${messageId}' '${delivery.id}' tp/${messageId}`)

    assert.deepEqual(phrasesOf(delivery.id).filter((p) => p.startsWith('Entrega')), ['Entrega: verificación', 'Entrega: verificación', 'Entrega: despliegue'])
    assert.equal(eventsOf(delivery.id).at(-1).kind, 'done')
    assert.equal(JSON.parse(eventsOf(delivery.id).at(-1).data_json).delivery_ref, 'abc1234')
    const run = env.db.prepare('SELECT * FROM execute_runs WHERE job_id = ?').get(exec.id)
    assert.deepEqual([run.deliver_job_id, run.delivered, run.delivery_ref], [delivery.id, 1, 'abc1234'])
    assert.equal(typeof run.delivery_ms, 'number')
    assert.ok(run.final_reply_ms >= run.delivery_ms, 'the final reply came after the delivery')

    await env.telemetry.flush()
    const trace = (await env.app.inject({ method: 'GET', url: `/api/jobs/${delivery.id}/trace`, headers: { cookie: editor } })).json()
    const find = (nodes) => nodes.flatMap((n) => [n, ...find(n.children)])
    const span = find(trace.roots).find((n) => n.name === 'execute.deliver')
    assert.ok(span, 'the span execute.deliver is in the trace')
    assert.deepEqual([span.attributes['team.exit_code'], span.attributes['team.delivery_ref'], span.attributes['team.branch']], [0, 'abc1234', `tp/${messageId}`])
    const timing = (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}/timing`, headers: { cookie: editor } })).json()
    assert.ok(timing.phases.some((p) => p.name === 'deliver'), 'the delivery is one more phase of the message')
  })

  it('the prompt tells the session that the system delivers and that it stops at the push', async () => {
    startWorker({ deliverCommand: 'echo ref' })
    const messageId = await publishedMessage('Otro arreglo para el prompt.')
    await settle(messageId)
    const { stdin } = calls().at(-1)
    assert.match(stdin, /push the branch: the system delivers it to production after you finish/)
    assert.match(stdin, /## Delivery \(takes precedence over any delivery step in the rules above\)/)
    assert.doesNotMatch(stdin, /a person delivers it/)
    assert.doesNotMatch(stdin, /<delivery_failure>/)
  })

  it('exit 75 waits and tries again without spending the attempt; the reply comes once', async () => {
    const flag = path('later')
    startWorker({ deliverCommand: `if [ -e ${flag} ]; then echo ref-75; else touch ${flag}; exit 75; fi` })
    const messageId = await publishedMessage('Una entrega que espera.')
    await settle(messageId)
    const [delivery] = jobsOf(messageId, 'deliver')
    assert.equal(delivery.status, 'done', delivery.last_error)
    assert.equal(delivery.attempts, 1, 'the wait does not spend the attempt')
    assert.ok(phrasesOf(delivery.id).includes('En espera: entrega a producción'), `${phrasesOf(delivery.id)}`)
    assert.equal(jobsOf(messageId, 'execute').length, 1, 'nothing goes back to Claude')
    const mine = replies(messageId)
    assert.equal(mine.length, 2)
    assert.match(mine[1], /Ya está en producción\.\n\n\*\*Resultado\*\*: done\n\n\*\*Entrega\*\*: ref-75$/)
  })

  it('exit 76 holds the delivery for a person: one reply, no retry, no second pass, the output of the session reaches the command', async () => {
    const log = path('held-log')
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ zone: 'pagos' })
    startWorker({ deliverCommand: `echo "$TEAM_OUTPUT_JSON" >> ${log}; echo 'revisando'; echo 'el cambio toca pagos'; exit 76` })
    const messageId = await publishedMessage('Un cobro que sale doble.')
    await settle(messageId)
    const [delivery] = jobsOf(messageId, 'deliver')
    assert.equal(delivery.status, 'done', delivery.last_error)
    assert.equal(delivery.attempts, 1, 'a held delivery is not a failure: one run, no retry')
    assert.deepEqual([jobsOf(messageId, 'deliver').length, jobsOf(messageId, 'execute').length], [1, 1], 'nothing goes back to Claude')
    const lines = readFileSync(log, 'utf8').trim().split('\n')
    assert.equal(lines.length, 1, 'the command ran once')
    assert.deepEqual(JSON.parse(lines[0]), { outcome: 'done', zone: 'pagos' }, 'compact JSON of the output, without the summary')
    assert.doesNotMatch(lines[0], /\s/, 'compact')
    const mine = replies(messageId)
    assert.equal(mine.length, 2, 'the first reply and ONE closing reply')
    assert.equal(mine[1], 'Arreglé la pantalla que quedaba en blanco.\n\nYa carga con tus datos.\n\nEl cambio está listo y espera la revisión de una persona antes de entrar a producción: el cambio toca pagos. Queda guardado en la rama.\n\n**Resultado**: needs_decision\n\n**zone**: pagos')
    assert.doesNotMatch(mine[1], /76|deliver|Ya está en producción/)
    const done = eventsOf(delivery.id).at(-1)
    assert.equal(done.kind, 'done')
    assert.equal(JSON.parse(done.data_json).delivery_held, true)
    const run = env.db.prepare('SELECT * FROM execute_runs WHERE job_id = ?').get(jobsOf(messageId, 'execute')[0].id)
    assert.deepEqual([run.deliver_job_id, run.delivered, run.delivery_held, run.delivery_ref], [delivery.id, 0, 1, null])
    const view = (await env.app.inject({ method: 'GET', url: '/api/ops/execute-runs/summary', headers: { cookie: editor } })).json()
    assert.ok(view.delivery.held >= 1, 'the summary counts «en espera de revisión» apart')
  })

  it('a failed verification goes back to execute once with its output; the second delivery answers once', async () => {
    const ok = path('second-time')
    startWorker({ deliverCommand: `if [ -e ${ok} ]; then echo ref-2; else touch ${ok}; echo 'FAIL: la prueba de agenda'; echo 'detalle en stderr' >&2; exit 3; fi` })
    const messageId = await publishedMessage('Una entrega que falla la primera vez.')
    await settle(messageId)
    const executes = jobsOf(messageId, 'execute')
    const deliveries = jobsOf(messageId, 'deliver')
    assert.deepEqual([executes.length, deliveries.length], [2, 2])
    assert.deepEqual(deliveries.map((j) => j.status), ['failed', 'done'])
    assert.match(deliveries[0].last_error, /código 3/)
    assert.match(deliveries[0].last_error, /FAIL: la prueba de agenda/)
    const second = JSON.parse(executes[1].payload_json)
    assert.deepEqual([second.deliver_round, second.deliver_failure.output.includes('detalle en stderr')], [1, true])
    assert.equal(JSON.parse(deliveries[1].payload_json).round, 1)
    const prompt = calls().at(-1).stdin
    assert.match(prompt, /<delivery_failure>[\s\S]*FAIL: la prueba de agenda[\s\S]*detalle en stderr[\s\S]*<\/delivery_failure>/)
    assert.match(prompt, /do not send another one/)
    const mine = replies(messageId)
    assert.equal(mine.length, 2, 'one first reply and ONE closing reply, none for the failed delivery')
    assert.match(mine[0], /^Recibido/)
    assert.match(mine[1], /Ya está en producción\.\n\n\*\*Resultado\*\*: done\n\n\*\*Entrega\*\*: ref-2$/)
    assert.equal(env.db.prepare('SELECT delivered FROM execute_runs WHERE job_id = ?').get(executes[0].id).delivered, 0)
    assert.equal(env.db.prepare('SELECT delivered FROM execute_runs WHERE job_id = ?').get(executes[1].id).delivered, 1)
  })

  it('a second failure ends in the plain notice with outcome blocked and nothing in production', async () => {
    startWorker({ deliverCommand: 'echo boom; exit 3' })
    const messageId = await publishedMessage('Una entrega que nunca pasa.')
    await settle(messageId)
    assert.deepEqual([jobsOf(messageId, 'execute').length, jobsOf(messageId, 'deliver').length], [2, 2])
    assert.deepEqual(jobsOf(messageId, 'deliver').map((j) => j.status), ['failed', 'failed'])
    const mine = replies(messageId)
    assert.equal(mine.length, 2, 'the first reply and the notice')
    assert.match(mine[1], /^El cambio no pasó la verificación y todavía no está en producción\. Lo que se hizo queda guardado en la rama tp\/\d+\.\n\nUn Editor puede volver a lanzar la entrega\.\n\n\*\*Resultado\*\*: blocked$/)
    assert.doesNotMatch(mine[1], /Ya está en producción/)
    assert.doesNotMatch(mine[1], /boom/, 'the output is for Claude and the Editor, not for the author')
    assert.equal(eventsOf(jobsOf(messageId, 'deliver')[1].id).at(-1).kind, 'done')
  })

  it('EXECUTE_DELIVER_RETRIES=0 reports the first failure without a second pass', async () => {
    startWorker({ deliverCommand: 'exit 4', deliverRetries: 0 })
    const messageId = await publishedMessage('Sin segunda pasada.')
    await settle(messageId)
    assert.deepEqual([jobsOf(messageId, 'execute').length, jobsOf(messageId, 'deliver').length], [1, 1])
    assert.match(replies(messageId).at(-1), /no pasó la verificación[\s\S]*\*\*Resultado\*\*: blocked$/)
  })

  it('without EXECUTE_DELIVER_COMMAND execute posts its final reply and there is no delivery', async () => {
    startWorker({ deliverCommand: '' })
    const messageId = await publishedMessage('Todo como antes.')
    await settle(messageId)
    assert.equal(jobsOf(messageId, 'deliver').length, 0)
    const mine = replies(messageId)
    assert.equal(mine.length, 2)
    assert.equal(mine[1], 'Arreglé la pantalla que quedaba en blanco.\n\nYa carga con tus datos.\n\n**Resultado**: done')
    const { stdin } = calls().at(-1)
    assert.match(stdin, /Never push to `main`: leave the branch; a person delivers it\./)
    assert.doesNotMatch(stdin, /## Delivery/)
    assert.equal(env.db.prepare('SELECT deliver_job_id FROM execute_runs WHERE message_id = ?').get(messageId).deliver_job_id, null)
  })

  it('an outcome other than done is answered by execute, with no delivery', async () => {
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ outcome: 'blocked' })
    startWorker({ deliverCommand: 'echo should-not-run' })
    const messageId = await publishedMessage('Algo que no se pudo arreglar.')
    await settle(messageId)
    assert.equal(jobsOf(messageId, 'deliver').length, 0)
    assert.match(replies(messageId).at(-1), /\*\*Resultado\*\*: blocked$/)
  })

  it('with EXECUTE_REPO_DIR the branch of the worktree is what gets delivered, and the second pass continues from it', async () => {
    const repo = path('repo')
    mkdirSync(repo)
    const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim()
    git('init', '-q', '-b', 'main')
    git('-c', 'user.email=t@x.org', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
    const ok = path('second-time')
    // The first delivery leaves a commit on the branch (what a fix of the host would be) and fails; the second pass must start from that commit.
    startWorker({
      repoDir: repo,
      deliverCommand: `if [ -e ${ok} ]; then echo ref-repo; else touch ${ok}; git -C ${repo} update-ref refs/heads/{branch} $(git -C ${repo} commit-tree -m ahead -p main main^{tree}); echo FAIL; exit 3; fi`
    })
    const messageId = await publishedMessage('Con repositorio.')
    await settle(messageId)
    assert.deepEqual(jobsOf(messageId, 'deliver').map((j) => j.status), ['failed', 'done'])
    assert.notEqual(git('rev-parse', `tp/${messageId}`), git('rev-parse', 'main'), 'the second pass did not reset the branch')
    assert.match(calls().at(-1).cwd, /\/repo$/)
    assert.equal(git('worktree', 'list').split('\n').length, 1, 'the worktrees are removed')
  })

  it('a branch that does not exist in EXECUTE_REPO_DIR leaves nothing to deliver: execute answers', async () => {
    const repo = path('repo-without-branch')
    mkdirSync(repo)
    const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    git('-c', 'user.email=t@x.org', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
    // The machine runner works elsewhere and creates no local branch; with no `origin` either, the branch is not found.
    startWorker({
      runner: 'machine', repoDir: repo, machineCreate: 'echo vm-{job_id}', machineRun: 'bash {workdir}/run.sh', machineDestroy: 'true', deliverCommand: 'echo should-not-run'
    })
    const messageId = await publishedMessage('Sin rama.')
    await settle(messageId)
    assert.equal(jobsOf(messageId, 'deliver').length, 0)
    assert.match(replies(messageId).at(-1), /\*\*Resultado\*\*: done$/)
    assert.doesNotMatch(replies(messageId).at(-1), /Ya está en producción/)
  })

  it('a timeout kills the command, reports it plainly and does not go back to Claude', async () => {
    const pidFile = path('pid')
    startWorker({ deliverCommand: `echo $$ > ${pidFile}; sleep 30`, deliverTimeoutMs: 700 })
    const messageId = await publishedMessage('Una entrega que no termina.')
    await settle(messageId)
    const [delivery] = jobsOf(messageId, 'deliver')
    assert.equal(delivery.status, 'failed')
    assert.match(delivery.last_error, /superó el tiempo máximo/)
    assert.equal(jobsOf(messageId, 'execute').length, 1)
    assert.match(replies(messageId).at(-1), /^La entrega no terminó dentro del tiempo máximo \(1 min\) y todavía no está en producción\./)
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'the process the job started is gone')
    assert.equal(env.db.prepare('SELECT delivered FROM execute_runs WHERE job_id = ?').get(jobsOf(messageId, 'execute')[0].id).delivered, 0)
  })

  it('no machine is alive while the delivery runs', async () => {
    const live = path('live')
    const seen = path('seen')
    const during = path('during')
    mkdirSync(live)
    startWorker({
      runner: 'machine',
      machineCreate: `touch ${live}/{job_id}; echo vm-{job_id}`,
      machineRun: `ls ${live} | wc -l > ${during}; bash {workdir}/run.sh`,
      machineDestroy: `rm -f ${live}/{job_id}`,
      deliverCommand: `ls ${live} | wc -l > ${seen}; echo ref-machine`
    })
    const messageId = await publishedMessage('Con máquina.')
    await settle(messageId)
    assert.equal(jobsOf(messageId, 'deliver')[0].status, 'done')
    assert.equal(readFileSync(during, 'utf8').trim(), '1', 'the machine existed while the session ran')
    assert.equal(readFileSync(seen, 'utf8').trim(), '0', 'and none exists while the delivery runs')
    assert.deepEqual(readdirSync(live), [])
  })

  describe('POST /messages/:id/deliver', () => {
    const post = (messageId, cookie = editor) => env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/deliver`, headers: cookieHeaders(cookie) })

    it('is for the Editor, needs the command and refuses while the message is being worked', async () => {
      startWorker({ deliverCommand: '' })
      const messageId = await publishedMessage('Una entrega a mano.')
      await settle(messageId)
      await worker.stop() // from here the queue only holds what the test puts in it
      assert.equal((await post(messageId, author)).statusCode, 403)
      const queued = (await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })).json().job_ids[0]
      assert.equal((await post(messageId)).json().code, 'execute_busy')
      env.queue.cancel(Number(queued))
      env.config.execute.deliverCommand = ''
      assert.equal((await post(messageId)).json().code, 'deliver_not_configured')
      env.config.execute.deliverCommand = 'true'
      assert.equal((await post(9999)).statusCode, 404)
    })

    it('the Editor delivers by hand: the agent answers once with the note and the reference', async () => {
      startWorker({ deliverCommand: '' })
      const messageId = await publishedMessage('Otra entrega a mano.')
      await settle(messageId)
      await worker.stop()
      const res = await post(messageId)
      assert.equal(res.statusCode, 202, res.body)
      assert.equal((await post(messageId)).json().code, 'deliver_busy')
      const jobId = Number(res.json().job_id)
      assert.deepEqual(JSON.parse(env.queue.getJob(jobId).payload_json).branch, `tp/${messageId}`)
      assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'message.deliver' AND entity_id = ?").get(String(messageId)).n, 1)
      startWorker({ deliverCommand: 'echo ref-manual' })
      assert.equal((await waitJob(jobId)).status, 'done')
      const mine = replies(messageId)
      assert.equal(mine.length, 3, 'the first reply, the answer of execute (no separate delivery then) and the note')
      assert.equal(mine[2], 'Ya está en producción.\n\n**Entrega**: ref-manual')
    })

    it('a delivery launched again keeps the summary of the session', async () => {
      startWorker({ deliverCommand: 'exit 9', deliverRetries: 0 })
      const messageId = await publishedMessage('Entrega que se relanza.')
      await settle(messageId)
      assert.match(replies(messageId).at(-1), /no pasó la verificación/)
      await worker.stop()
      startWorker({ deliverCommand: 'echo ref-again' })
      const res = await post(messageId)
      assert.equal(res.statusCode, 202, res.body)
      await waitJob(Number(res.json().job_id))
      assert.equal(replies(messageId).at(-1), 'Arreglé la pantalla que quedaba en blanco.\n\nYa carga con tus datos. Ya está en producción.\n\n**Resultado**: done\n\n**Entrega**: ref-again')
    })
  })
})

describe('pieces of the delivery', () => {
  it('the production note ends the last paragraph and the reference goes in the structured part', () => {
    assert.equal(withProductionNote('Uno.\n\nDos.', 'Ya está en producción.'), 'Uno.\n\nDos. Ya está en producción.')
    assert.equal(withProductionNote('Listo', 'Ya está en producción.'), 'Listo. Ya está en producción.')
    assert.equal(withProductionNote('', 'Ya está en producción.'), 'Ya está en producción.')
    assert.equal(deliveredBody({ output: { outcome: 'done', summary: 'Listo.' }, ref: 'https://x.org/c/1', language: 'es-419' }), 'Listo. Ya está en producción.\n\n**Resultado**: done\n\n**Entrega**: https://x.org/c/1')
    assert.equal(deliveredBody({ output: { outcome: 'done', summary: 'Done.' }, ref: 'abc', language: 'en' }), 'Done. It is in production now.\n\n**Resultado**: done\n\n**Delivery**: abc')
    assert.equal(deliveredBody({ output: null, ref: null, language: 'es-419' }), 'Ya está en producción.')
  })

  it('the held reply keeps the summary, names the reason in plain words and has no jargon', () => {
    assert.equal(heldBody({ output: { outcome: 'done', summary: 'Listo.' }, reason: 'el cambio toca pagos.', language: 'es-419' }),
      'Listo.\n\nEl cambio está listo y espera la revisión de una persona antes de entrar a producción: el cambio toca pagos. Queda guardado en la rama.\n\n**Resultado**: needs_decision')
    assert.match(heldBody({ output: { outcome: 'done', summary: 'Listo.' }, reason: '', language: 'es-419' }), /producción: el cambio necesita esa revisión\. Queda/)
    assert.match(heldBody({ output: { outcome: 'done', summary: 'Done.' }, reason: 'it touches payments', language: 'en' }), /waits for a person to review it before it goes to production: it touches payments\./)
    assert.equal(outputJson({ summary: 'x', outcome: 'done', zone: 'pagos' }), '{"outcome":"done","zone":"pagos"}')
    assert.equal(outputJson(null), '{}')
  })

  it('the reference is the last line of stdout that is not a phase marker', () => {
    assert.equal(referenceOf('building\n##team phase deploy\nabc1234\n\n'), 'abc1234')
    assert.equal(referenceOf('##team phase verify\n'), null)
    assert.equal(referenceOf(''), null)
  })

  it('the catalogue has the delivery phases', () => {
    for (const code of ['deliverVerify', 'deliverDeploy', 'deliverWait']) assert.ok(PROGRESS_CODES.includes(code), code)
  })

  it('the configuration declares the command, its timeout, its retries and its attempts', () => {
    const d = loadConfig({ DATA_DIR: '/tmp/x' }).execute
    assert.deepEqual([d.deliverCommand, d.deliverTimeoutMs, d.deliverRetries, d.deliverMaxAttempts], ['', 900000, 1, 2])
    const c = loadConfig({ DATA_DIR: '/tmp/x', EXECUTE_DELIVER_COMMAND: 'deliver {branch}', EXECUTE_DELIVER_TIMEOUT_MS: '5000', EXECUTE_DELIVER_RETRIES: '0' }).execute
    assert.deepEqual([c.deliverCommand, c.deliverTimeoutMs, c.deliverRetries], ['deliver {branch}', 5000, 0])
  })

  it('the prompt changes only when the delivery is separate', () => {
    const input = {
      message: { id: 5, title: 't', body: 'b', fields: {}, area: 'a', status: 'open' }, template: null, author: { name: 'Ana', profile: '', language: 'es-419' },
      agent: { name: 'Claude' }, project: { name: 'P', description: 'd' }, jobId: 9, maxSubagents: 3, branch: 'tp/5', hostInstructions: 'Entregar con `deploy.sh`.'
    }
    const plain = buildExecutePrompt(input)
    const separate = buildExecutePrompt({ ...input, deliver: true })
    assert.match(plain, /a person delivers it/)
    assert.doesNotMatch(plain, /## Delivery/)
    assert.ok(separate.indexOf('## Delivery') > separate.indexOf('Entregar con `deploy.sh`.'), 'the contract line comes after the rules of the host and prevails')
    assert.ok(separate.includes('Entregar con `deploy.sh`.'), 'the text of the host stays the host\'s')
    const second = buildExecutePrompt({ ...input, deliver: true, deliverFailure: { output: 'FAIL x' } })
    assert.match(second, /<delivery_failure>[\s\S]*FAIL x[\s\S]*<\/delivery_failure>/)
    assert.match(second, /do not send another one/)
  })
})

describe('migration 0020', () => {
  it('adds delivery_held to execute_runs with 0, 1 or NULL', () => {
    const dir = tempDir()
    const db = openDatabase(join(dir, 'team.db'))
    migrate(db, { dir: MIGRATIONS })
    db.exec('INSERT INTO execute_runs (job_id, attempt, started_at, finished_at, delivery_held) VALUES (1, 1, 1, 2, 1), (2, 1, 1, 2, NULL)')
    assert.deepEqual(db.prepare('SELECT delivery_held AS h FROM execute_runs ORDER BY job_id').all().map((r) => r.h), [1, null])
    assert.throws(() => db.exec('UPDATE execute_runs SET delivery_held = 2 WHERE job_id = 1'), /CHECK/)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('migration 0019', () => {
  it('rebuilds jobs with the new kind and keeps every row, event and column', () => {
    const dir = tempDir()
    const old = join(dir, 'old')
    mkdirSync(old)
    const files = listMigrations(MIGRATIONS)
    for (const m of files.slice(0, 18)) copyFileSync(join(MIGRATIONS, m.filePath), join(old, m.filePath))
    const db = openDatabase(join(dir, 'team.db'))
    migrate(db, { dir: old })
    db.exec("INSERT INTO jobs (kind, payload_json, status, run_at, created_at, cost_usd, runner, phase, marks_json, trace_id) VALUES ('execute', '{\"a\":1}', 'done', 1, 1, 2.5, 'machine', 'run', '{\"judge_ms\":5}', 'abc')")
    db.exec("INSERT INTO job_events (job_id, kind, percent, at) VALUES (1, 'progress', 10, 1)")
    db.exec("INSERT INTO execute_runs (job_id, attempt, started_at, finished_at) VALUES (1, 1, 1, 2)")
    assert.throws(() => db.exec("INSERT INTO jobs (kind, run_at, created_at) VALUES ('deliver', 1, 1)"), /CHECK/)
    migrate(db, { dir: MIGRATIONS })
    const job = db.prepare('SELECT * FROM jobs WHERE id = 1').get()
    assert.deepEqual([job.kind, job.cost_usd, job.runner, job.phase, job.marks_json, job.trace_id], ['execute', 2.5, 'machine', 'run', '{"judge_ms":5}', 'abc'])
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM job_events WHERE job_id = 1').get().n, 1)
    db.exec("INSERT INTO jobs (kind, run_at, created_at) VALUES ('deliver', 1, 1)")
    assert.throws(() => db.exec("INSERT INTO jobs (kind, run_at, created_at) VALUES ('other', 1, 1)"), /CHECK/)
    const columns = Object.keys(db.prepare('SELECT * FROM execute_runs').get())
    assert.ok(columns.includes('deliver_job_id') && columns.includes('delivery_ref'))
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
