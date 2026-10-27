// The `deliver` job (UD-263) end to end against a listening server, the fake `claude` of the `execute` tests and a fake delivery command:
// one closing reply «Ya está en producción» in green, exit 76 that holds it for a person, exit 75 that waits without spending the attempt, a failed verification that goes
// back to `execute` once and then ends in the plain notice, the compatibility without EXECUTE_DELIVER_COMMAND, the timeout, and no machine
// alive while the delivery runs.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
import { HOST_TURN_LIFE_MS, clockTime, createDeliverHandler, deferralsInARow, waitPlace, deliveredBody, failedCheck, heldBody, isEnvironmentFailure, outputJson, referenceOf, withProductionNote } from './deliver.js'
import { enqueueDeliver } from './enqueue.js'
import { spawnStreaming } from './runners.js'
import { createExecuteHandler } from './handler.js'
import { buildExecutePrompt } from './prompt.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
const MIGRATIONS = fileURLToPath(new URL('../db/migrations', import.meta.url))
let PORT = 0 // ephemeral, set after listen: a fixed port made a second run of the same file cancel itself with EADDRINUSE (2026-10-26)

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
      execute: createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault, getProviders: env.modules.getProviders }),
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
    await env.app.listen({ host: '127.0.0.1', port: 0 }); PORT = env.app.server.address().port
  })
  beforeEach(async () => {
    await worker?.stop()
    rmSync(join(state, 'calls.jsonl'), { force: true })
    process.env.FAKE_EXECUTE_MODE = 'ok'
    process.env.FAKE_EXECUTE_REPLY = '1'
    delete process.env.FAKE_EXECUTE_EXTRA
    delete process.env.FAKE_EXECUTE_CAPTURE_FILES
    delete process.env.FAKE_EXECUTE_START_CAPTURES
    delete process.env.FAKE_EXECUTE_START_ZONE
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
    assert.equal(running.delivers, true, 'the instance declares a delivery apart: the panel shows the stretch from the start (B7)')

    writeFileSync(gate, '')
    assert.equal((await waitJob(delivery.id)).status, 'done')
    const mine = replies(messageId)
    assert.equal(mine.length, 2, 'the first reply and ONE closing reply')
    assert.match(mine[1], /^Arreglé la pantalla que quedaba en blanco\.\n\nYa carga con tus datos\. En producción desde \d\d:\d\d \S+\.(\n\nCerrado: .+)?$/)
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
    const phases = span.children.map((n) => n.name)
    assert.ok(phases.includes('execute.deliver.verify') && phases.includes('execute.deliver.deploy'), `the delivery has a span for verify and one for deploy, apart: ${phases}`)
    const deploy = span.children.find((n) => n.name === 'execute.deliver.deploy')
    assert.equal(deploy.attributes['team.phase'], 'deliverDeploy')
    assert.deepEqual([span.attributes['team.exit_code'], span.attributes['team.delivery_ref'], span.attributes['team.branch']], [0, 'abc1234', `tp/${messageId}`])
    const timing = (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}/timing`, headers: { cookie: editor } })).json()
    assert.ok(timing.phases.some((p) => p.name === 'deliver'), 'the delivery is one more phase of the message')
  })

  it('without a place of the before, the closing reply carries the after the session took from the branch (UD-268)', async () => {
    const shot = (path, alt) => ({ path, alt, masked: true, place: 'Correos > Bandeja', as: 'Clínica Sur, administrador' })
    process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify({ 'despues.png': 'png' })
    delete process.env.FAKE_EXECUTE_START_CAPTURES
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ captures: [shot('despues.png', 'Bandeja sin el error')] })
    startWorker({ deliverCommand: 'echo abc1234' })
    const messageId = await publishedMessage('La bandeja de correos muestra un error.')
    await settle(messageId)
    const [delivery] = jobsOf(messageId, 'deliver')
    assert.equal(delivery.status, 'done', delivery.last_error)
    const rows = env.db.prepare('SELECT ra.name FROM replies r JOIN reply_attachments ra ON ra.reply_id = r.id WHERE r.message_id = ? AND r.author_id = ? ORDER BY r.id, ra.position').all(messageId, agentId)
    assert.deepEqual(rows.map((x) => x.name), ['Después - Bandeja sin el error.png'])
    const closing = replies(messageId)[1]
    assert.match(closing, /En producción desde \d\d:\d\d \S+\.\n\n\*\*Después\*\*: Bandeja sin el error\. Correos > Bandeja, Clínica Sur, administrador\.(\n\nCerrado: .+)?$/)
  })

  it('the delivery takes the after from production at the place, role and size of the before, and the branch capture is only a fallback (UD-268)', async () => {
    const shot = (path, alt) => ({ path, alt, masked: true, place: 'Correos > Bandeja', as: 'Clínica Sur, administrador' })
    process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify({ 'antes.png': 'png', 'rama.png': 'png' })
    process.env.FAKE_EXECUTE_START_CAPTURES = JSON.stringify([shot('antes.png', 'Bandeja con el error')])
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ captures: [shot('rama.png', 'Bandeja de la rama')] })
    const seen = join(state, 'before.json')
    const png = "'\\211PNG\\r\\n\\032\\n\\000\\000\\000\\000'"
    const place = JSON.stringify({ path: 'prod.png', alt: 'Bandeja en producción', masked: true, place: 'Correos > Bandeja', as: 'Clínica Sur, administrador' })
    startWorker({ deliverCommand: `printf '%s' "$TEAM_BEFORE_CAPTURES" > ${seen}; printf ${png} > "$TEAM_WORKDIR/captures/prod.png"; echo '##team capture ${place}'; echo abc1234` })
    const messageId = await publishedMessage('La bandeja de correos muestra un error en producción.')
    await settle(messageId)
    const [delivery] = jobsOf(messageId, 'deliver')
    assert.equal(delivery.status, 'done', delivery.last_error)
    const before = JSON.parse(readFileSync(seen, 'utf8'))
    assert.equal(before.length, 1)
    assert.deepEqual([before[0].place, before[0].as], ['Correos > Bandeja', 'Clínica Sur, administrador'])
    const names = env.db.prepare('SELECT ra.name FROM replies r JOIN reply_attachments ra ON ra.reply_id = r.id WHERE r.message_id = ? AND r.author_id = ? ORDER BY r.id, ra.position').all(messageId, agentId).map((x) => x.name)
    assert.ok(names.includes('Después - Bandeja en producción.png'), names.join('|'))
    assert.ok(!names.includes('Después - Bandeja de la rama.png'), 'the capture of the branch is not used when the before has a place')
  })

  it('when the delivery cannot take the after, the reply goes out with a line that says so (UD-268)', async () => {
    const shot = (path, alt) => ({ path, alt, masked: true, place: 'Correos > Bandeja', as: 'Clínica Sur, administrador' })
    process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify({ 'antes.png': 'png' })
    process.env.FAKE_EXECUTE_START_CAPTURES = JSON.stringify([shot('antes.png', 'Bandeja con el error')])
    startWorker({ deliverCommand: "echo '##team capture-failed ver no abrió la clínica'; echo abc1234" })
    const messageId = await publishedMessage('La bandeja de correos muestra otro error.')
    await settle(messageId)
    const [delivery] = jobsOf(messageId, 'deliver')
    assert.equal(delivery.status, 'done', delivery.last_error)
    assert.match(replies(messageId)[1], /En producción desde \d\d:\d\d \S+\.[\s\S]*No pude tomar la captura del después: ver no abrió la clínica\.$/)
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
    assert.match(mine[1], /En producción desde \d\d:\d\d \S+\.(\n\nCerrado: .+)?$/)
  })

  it('exit 76 holds the delivery for a person: one reply, no retry, no second pass, the output of the session reaches the command', async () => {
    const log = path('held-log')
    startWorker({ deliverCommand: 'true', autoClose: false }) // UD-310: the first delivery would close the message and the held one needs it open
    const messageId = await publishedMessage('Un cobro que sale doble.')
    await settle(messageId)
    await worker.stop()
    const [exec] = jobsOf(messageId, 'execute')
    const before = replies(messageId).length
    const output = { outcome: 'done', summary: 'Arreglé el cobro doble.\n\nYa se cobra una vez.', zone: 'pagos' }
    const jobId = enqueueDeliver(env.db, { messageId, payload: { member_id: agentId, branch: `tp/${messageId}`, round: 0, output, execute_job_id: exec.id, execute_attempt: 1, requested_by: null } })
    startWorker({ deliverCommand: `echo "$TEAM_OUTPUT_JSON" >> ${log}; echo 'revisando'; echo 'el cambio toca pagos'; exit 76` })
    assert.equal((await waitJob(jobId)).status, 'done', env.queue.getJob(jobId).last_error)
    const delivery = env.queue.getJob(jobId)
    assert.equal(delivery.attempts, 1, 'a held delivery is not a failure: one run, no retry')
    assert.equal(jobsOf(messageId, 'deliver').length, 2, 'no new delivery')
    assert.equal(jobsOf(messageId, 'execute').length, 1, 'nothing goes back to Claude')
    const lines = readFileSync(log, 'utf8').trim().split('\n')
    assert.equal(lines.length, 1, 'the command ran once')
    assert.deepEqual(JSON.parse(lines[0]), { outcome: 'done', zone: 'pagos' }, 'compact JSON of the output, without the summary')
    assert.doesNotMatch(lines[0], /\s/, 'compact')
    const mine = replies(messageId).slice(before)
    assert.equal(mine.length, 1, 'ONE reply for the held delivery')
    assert.equal(mine[0], 'Arreglé el cobro doble.\n\nYa se cobra una vez.\n\nCambio listo para revisar: el cambio toca pagos. Todavía no llega a producción.')
    assert.doesNotMatch(mine[0], /Propuesta/, 'UD-289: without screenshots the reply does not point at them')
    assert.doesNotMatch(mine[0], /76|deliver|En producción desde/)
    const done = eventsOf(jobId).at(-1)
    assert.equal(done.kind, 'done')
    assert.equal(JSON.parse(done.data_json).delivery_held, true)
    const run = env.db.prepare('SELECT * FROM execute_runs WHERE job_id = ?').get(exec.id)
    assert.deepEqual([run.deliver_job_id, run.delivered, run.delivery_held, run.delivery_ref], [jobId, 0, 1, null])
    // UD-269: a held delivery is a question in the tray of the person who decides (the first Editor), `open`, without the agent.
    const editorId = env.db.prepare("SELECT id FROM members WHERE email = 'ed@x.org'").get().id
    assert.deepEqual(env.db.prepare('SELECT member_id FROM message_assignees WHERE message_id = ?').all(messageId).map((r) => r.member_id), [editorId])
    assert.equal(env.db.prepare('SELECT status FROM messages WHERE id = ?').get(messageId).status, 'open')
    assert.equal(env.db.prepare('SELECT kind FROM replies WHERE message_id = ? ORDER BY id DESC LIMIT 1').get(messageId).kind, 'clarification')
    assert.equal(JSON.parse(env.db.prepare("SELECT detail_json FROM audit_log WHERE action = 'message.escalate' AND entity_id = ?").get(messageId).detail_json).source, 'deliver')
    const view = (await env.app.inject({ method: 'GET', url: '/api/ops/execute-runs/summary', headers: { cookie: editor } })).json()
    assert.ok(view.delivery.held >= 1, 'the summary counts «en espera de revisión» apart')
  })

  it('exit 76 after a person approved in advance counts as a failure: the approval is not asked again (UD-269, UD-286)', async () => {
    startWorker({ deliverCommand: 'true', autoClose: false })
    const messageId = await publishedMessage('Un cobro aprobado de antemano.')
    await settle(messageId)
    await worker.stop()
    const [exec] = jobsOf(messageId, 'execute')
    const editorId = env.db.prepare("SELECT id FROM members WHERE email = 'ed@x.org'").get().id
    const output = { outcome: 'done', summary: 'Arreglé el cobro.', zone: 'pagos' }
    const jobId = enqueueDeliver(env.db, { messageId, payload: { member_id: agentId, branch: `tp/${messageId}`, round: 0, output, execute_job_id: exec.id, execute_attempt: 1, requested_by: null, approved_by: editorId } })
    startWorker({ deliverCommand: 'echo "reviewed=$TEAM_REVIEWED_BY" >&2; echo \'el cambio toca pagos\'; exit 76', deliverRetries: 0 })
    const job = await waitJob(jobId)
    assert.equal(job.status, 'failed', 'a host that holds again after an approval broke the contract')
    assert.match(job.last_error, /código 76/)
    assert.match(job.last_error, new RegExp(`reviewed=${editorId}`), 'the command saw who approved')
    const run = env.db.prepare('SELECT delivery_held FROM execute_runs WHERE job_id = ?').get(exec.id)
    assert.notEqual(run.delivery_held, 1, 'not held')
    assert.doesNotMatch(replies(messageId).at(-1), /Cambio listo para revisar/, 'the approval is not asked again')
    assert.match(replies(messageId).at(-1), /^No quedó en producción/, 'the person who approved learns it failed (UD-289)')
  })

  describe('the review of a held delivery (UD-275)', () => {
    const shot = (path, alt) => ({ path, alt, masked: true, place: 'Fichas > Paciente', as: 'Clínica Sur, recepción' })
    const holdUnlessReviewed = (log) => `echo "reviewed=$TEAM_REVIEWED_BY" >> ${log}; if [ -n "$TEAM_REVIEWED_BY" ]; then echo ref-reviewed; exit 0; fi; echo 'toca datos de personas'; exit 76`
    const pendingOf = async (messageId, cookie = editor) => (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}`, headers: { cookie } })).json().pending_delivery
    const post = (url, cookie, payload) => env.app.inject({ method: 'POST', url, headers: { ...cookieHeaders(cookie), 'content-type': 'application/json' }, payload: JSON.stringify(payload ?? {}) })
    async function held (text, log) {
      process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify({ 'paso1.png': 'png', 'recorrido.webm': 'webm' })
      process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ captures: [shot('paso1.png', '0:02 · Paso 1 · Abrir la ficha'), shot('recorrido.webm', 'Recorrido · 0:12')] })
      startWorker({ deliverCommand: holdUnlessReviewed(log) })
      const messageId = await publishedMessage(text)
      await settle(messageId)
      return messageId
    }

    it('the message view exposes the review, the held reply attaches the «Propuesta» screenshots and the video, and any person delivers', async () => {
      const log = path('review-log')
      const messageId = await held('Subir fotos a la ficha del paciente.', log)
      const rows = env.db.prepare('SELECT ra.name, ra.kind, ra.mime FROM replies r JOIN reply_attachments ra ON ra.reply_id = r.id WHERE r.message_id = ? AND r.author_id = ? ORDER BY r.id, ra.position').all(messageId, agentId)
      assert.deepEqual(rows.map((x) => [x.name, x.kind, x.mime]), [['Propuesta - 0:02 · Paso 1 · Abrir la ficha.png', 'image', 'image/png'], ['Propuesta - Recorrido · 0:12.webm', 'video', 'video/webm']])
      assert.match(replies(messageId).at(-1), /\*\*Propuesta\*\*: 0:02 · Paso 1 · Abrir la ficha\. Fichas > Paciente, Clínica Sur, recepción\.\n\n\*\*Propuesta\*\*: Recorrido · 0:12\./)
      assert.doesNotMatch(replies(messageId).at(-1), /Después/)
      assert.match(replies(messageId).at(-1), /Cómo queda, en «Propuesta»\./, 'with screenshots the reply points at them')
      const [exec] = jobsOf(messageId, 'execute')
      assert.deepEqual(await pendingOf(messageId), { branch: `tp/${messageId}`, held_reason: 'toca datos de personas', job_id: String(exec.id), agent_id: String(agentId), delivering_job_id: null, state: 'held' })
      assert.deepEqual(await pendingOf(messageId, author), await pendingOf(messageId), 'any member sees the review')
      const delivered = await post(`/api/messages/${messageId}/deliver`, editor)
      assert.equal(delivered.statusCode, 202, delivered.body)
      await worker.stop()
      startWorker({ deliverCommand: holdUnlessReviewed(log) })
      await settle(messageId)
      assert.match(replies(messageId).at(-1), /En producción desde \d\d:\d\d \S+\.(\n\nCerrado: .+)?$/)
      assert.equal(await pendingOf(messageId), null, 'delivered: no review left')
      assert.match(readFileSync(log, 'utf8'), /reviewed=\n[\s\S]*reviewed=\d+\n$/, 'the first delivery was held; the approved one carried the reviewer')
    })

    it('UD-289: the approved delivery fails, the header says so and the notice offers «Reintentar» that launches it again once', async () => {
      const messageId = await held('Subir fotos a la ficha 3.', path('fail-log'))
      assert.equal((await pendingOf(messageId)).state, 'held')
      await worker.stop()
      startWorker({ deliverCommand: 'echo boom; exit 3', deliverRetries: 0 })
      assert.equal((await post(`/api/messages/${messageId}/deliver`, author)).statusCode, 202)
      await settle(messageId)
      assert.equal((await pendingOf(messageId)).state, 'failed', 'the header comes from the real state: the delivery failed')
      const view = async (cookie = author) => (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}`, headers: { cookie } })).json()
      const notice = (await view()).replies.at(-1)
      assert.match(notice.body, /^No quedó en producción: no pasó la verificación/)
      assert.doesNotMatch(notice.body, /Editor/)
      assert.equal(notice.retryable, true, 'decided by the server, for any member')
      assert.equal((await view(editor)).replies.at(-1).retryable, true)
      assert.equal((await view()).replies.filter((r) => r.retryable).length, 1)
      const retry = (cookie = author) => post(`/api/messages/${messageId}/replies/${notice.id}/retry`, cookie)
      await worker.stop()
      const first = await retry()
      assert.equal(first.statusCode, 202, first.body)
      assert.equal((await retry(editor)).statusCode, 409, 'a second click enqueues nothing')
      assert.equal((await view()).replies.at(-1).retryable, false, 'the button goes away while the delivery runs')
      assert.equal((await pendingOf(messageId)).state, 'delivering')
      assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'message.deliver_retry' AND entity_id = ?").get(String(messageId)).n, 1)
      startWorker({ deliverCommand: 'echo ref-retry' })
      await settle(messageId)
      assert.match(replies(messageId).at(-1), /En producción desde \d\d:\d\d \S+\.(\n\nCerrado: .+)?$/)
      assert.equal(await pendingOf(messageId), null)
      assert.equal((await view()).replies.some((r) => r.retryable), false)
    })

    it('discarding needs a reason, leaves the notice in the thread, keeps the message open and never delivers', async () => {
      const messageId = await held('Subir fotos a otra ficha.', path('discard-log'))
      assert.equal((await post(`/api/messages/${messageId}/discard-delivery`, editor, { reason: '   ' })).statusCode, 400)
      assert.equal((await post(`/api/messages/${messageId}/discard-delivery`, editor, {})).statusCode, 400)
      const done = await post(`/api/messages/${messageId}/discard-delivery`, editor, { reason: 'Las fotos no pueden ir a la ficha.' })
      assert.equal(done.statusCode, 200, done.body)
      const detail = (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}`, headers: { cookie: editor } })).json()
      assert.equal(detail.pending_delivery, null)
      assert.equal(detail.status, 'open')
      assert.equal(detail.replies.at(-1).body, 'Descartado por ed@x.org: Las fotos no pueden ir a la ficha.'.replace('ed@x.org', env.db.prepare("SELECT name FROM members WHERE email = 'ed@x.org'").get().name))
      assert.equal(JSON.parse(env.db.prepare("SELECT detail_json FROM audit_log WHERE action = 'message.delivery_discard' AND entity_id = ?").get(messageId).detail_json).reason, 'Las fotos no pueden ir a la ficha.')
      assert.equal((await post(`/api/messages/${messageId}/deliver`, editor)).statusCode, 409, 'a discarded branch is never delivered')
      assert.equal((await post(`/api/messages/${messageId}/discard-delivery`, editor, { reason: 'Otra vez' })).statusCode, 409, 'nothing left to discard')
    })

    it('asking for changes: a new run of Claude on the same branch leaves the review again with new material', async () => {
      const messageId = await held('Subir fotos a una tercera ficha.', path('changes-log'))
      assert.ok(await pendingOf(messageId))
      await worker.stop()
      // The mention of the thread (another work) gives the message back to Claude; here the same effect, by the assignees.
      env.db.prepare('INSERT OR IGNORE INTO message_assignees (message_id, member_id) VALUES (?, ?)').run(messageId, agentId)
      const again = await post(`/api/messages/${messageId}/execute`, editor, { member_id: String(agentId) })
      assert.equal(again.statusCode, 202, again.body)
      assert.equal(await pendingOf(messageId), null, 'while Claude works the change the review is not offered')
      process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ captures: [shot('paso1.png', '0:03 · Paso 1 · Abrir la ficha con los cambios')] })
      await worker.stop()
      startWorker({ deliverCommand: holdUnlessReviewed(path('changes-log-2')) })
      await settle(messageId)
      const pending = await pendingOf(messageId)
      assert.equal(pending?.branch, `tp/${messageId}`)
      assert.equal(pending?.job_id, String(jobsOf(messageId, 'execute').at(-1).id), 'the review points at the new run')
      const last = env.db.prepare('SELECT ra.name FROM replies r JOIN reply_attachments ra ON ra.reply_id = r.id WHERE r.message_id = ? AND r.author_id = ? ORDER BY r.id DESC, ra.position').all(messageId, agentId)
      assert.ok(last.some((x) => x.name === 'Propuesta - 0:03 · Paso 1 · Abrir la ficha con los cambios.png'))
    })
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
    assert.equal(mine.length, 3, 'the first reply, the notice that the delivery went back to Claude (UD-296) and ONE closing reply')
    assert.match(mine[0], /^Recibido/)
    assert.equal(mine[1], 'No pasó la verificación. Claude lo corrige y vuelve a entregar.', 'no test name in this output: the sentence stands without one')
    assert.match(mine[2], /En producción desde \d\d:\d\d \S+\.(\n\nCerrado: .+)?$/)
    assert.equal(env.db.prepare('SELECT delivered FROM execute_runs WHERE job_id = ?').get(executes[0].id).delivered, 0)
    assert.equal(env.db.prepare('SELECT delivered FROM execute_runs WHERE job_id = ?').get(executes[1].id).delivered, 1)
  })

  it('a second failure ends in the plain notice with the failed check, and the delivery that went back to Claude said so (UD-296)', async () => {
    startWorker({ deliverCommand: "echo 'FALLA prueba: src/agenda.test.js › la agenda abre en blanco'; echo 'FALLA prueba: src/otra.test.js › otra cosa'; echo boom; exit 3", deliverRetries: 1 })
    const messageId = await publishedMessage('Una entrega que nunca pasa.')
    await settle(messageId)
    assert.deepEqual([jobsOf(messageId, 'execute').length, jobsOf(messageId, 'deliver').length], [2, 2])
    assert.deepEqual(jobsOf(messageId, 'deliver').map((j) => j.status), ['failed', 'failed'])
    const mine = replies(messageId)
    assert.equal(mine.length, 3, 'the first reply, the notice of the second pass and the final notice')
    assert.equal(mine[1], 'No pasó la verificación: la agenda abre en blanco (y 1 más). Claude lo corrige y vuelve a entregar.')
    assert.match(mine[2], /^No quedó en producción: no pasó la verificación \(la agenda abre en blanco \(y 1 más\)\)\. Lo que se hizo queda guardado en la rama tp\/\d+\.\n\nCualquier persona del equipo puede volver a lanzar la entrega\.$/)
    assert.doesNotMatch(mine[2], /En producción desde/)
    assert.doesNotMatch(mine[2], /boom/, 'the output is for Claude and the Editor, not for the author')
    assert.equal(eventsOf(jobsOf(messageId, 'deliver')[1].id).at(-1).kind, 'done')
  })

  it('EXECUTE_DELIVER_RETRIES=0 reports the first failure without a second pass', async () => {
    startWorker({ deliverCommand: 'exit 4', deliverRetries: 0 })
    const messageId = await publishedMessage('Sin segunda pasada.')
    await settle(messageId)
    assert.deepEqual([jobsOf(messageId, 'execute').length, jobsOf(messageId, 'deliver').length], [1, 1])
    assert.match(replies(messageId).at(-1), /^No quedó en producción: no pasó la verificación[\s\S]*lanzar la entrega\.$/)
  })

  it('every failed delivery leaves its own notice in the thread, also the same failure twice (UD-296, message 117)', async () => {
    startWorker({ deliverCommand: "echo 'FALLA prueba: src/agenda.test.js › la agenda abre en blanco'; exit 4", deliverRetries: 0 })
    const messageId = await publishedMessage('Dos entregas fallidas iguales.')
    await settle(messageId)
    const before = replies(messageId).length
    await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/deliver`, headers: cookieHeaders(editor) })
    await settle(messageId)
    assert.equal(jobsOf(messageId, 'deliver').length, 2, 'the Editor launched a second delivery')
    const mine = replies(messageId)
    assert.equal(mine.length, before + 1, 'the second failure says so as well')
    assert.equal(mine.at(-1), mine.at(-2), 'the same words, each for its own job')
    const rows = env.db.prepare('SELECT failed_job_id, failed_code FROM replies WHERE message_id = ? AND failed_job_id IS NOT NULL ORDER BY id').all(messageId)
    assert.deepEqual(rows.map((r) => r.failed_job_id), jobsOf(messageId, 'deliver').map((j) => j.id), 'each notice stands for the job that failed')
    const view = (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}`, headers: { cookie: editor } })).json()
    const notices = view.replies.filter((r) => /^No quedó en producción: no pasó la verificación/.test(r.body))
    assert.deepEqual(notices.map((r) => r.retryable), [false, true], 'the state with «Reintentar» is the last one')
  })

  describe('a branch already in production counts as delivered (UD-296, message 117)', () => {
    const git = (dir, ...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@x.org', '-c', 'user.name=t', ...a], { encoding: 'utf8' }).trim()
    /** A fake origin with `desarrollo` and the branch; `merged` decides whether `desarrollo` already holds it (what the night batch of the host did). Returns the check command the host would declare. */
    function host (name, merged) {
      const origin = path(`${name}-origin`)
      mkdirSync(origin)
      execFileSync('git', ['init', '-q', '--bare', '-b', 'desarrollo', origin])
      const repo = path(`${name}-repo`)
      execFileSync('git', ['clone', '-q', origin, repo])
      git(repo, 'checkout', '-q', '-b', 'desarrollo')
      git(repo, 'commit', '-q', '--allow-empty', '-m', 'init')
      git(repo, 'push', '-q', 'origin', 'desarrollo')
      git(repo, 'checkout', '-q', '-b', 'rama')
      writeFileSync(join(repo, 'cambio.txt'), 'x')
      git(repo, 'add', '.')
      git(repo, 'commit', '-q', '-m', 'el cambio')
      git(repo, 'push', '-q', 'origin', 'rama:refs/heads/tp/all')
      if (merged) git(repo, 'push', '-q', 'origin', 'rama:desarrollo')
      // The host's own question: is the branch an ancestor of desarrollo on the remote? It asks the remote, not its local copy.
      return `git -C ${repo} fetch -q origin +refs/heads/{branch}:refs/team/tip +refs/heads/desarrollo:refs/team/base && git -C ${repo} merge-base --is-ancestor refs/team/tip refs/team/base && git -C ${repo} rev-parse --short refs/team/tip`
    }
    const published = async (text) => {
      startWorker({ deliverCommand: '' })
      const messageId = await publishedMessage(text)
      await settle(messageId)
      await worker.stop()
      return messageId
    }
    const hand = async (messageId) => {
      const res = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/deliver`, headers: cookieHeaders(editor) })
      assert.equal(res.statusCode, 202, res.body)
      return Number(res.json().job_id)
    }
    const withBranch = (check) => check.replaceAll('{branch}', 'tp/all')

    it('the delivery command does not run: the delivery is marked as achieved, the final reply is posted and the message stays answered', async () => {
      const messageId = await published('Una rama que ya salió por otro camino.')
      const log = path('ran')
      startWorker({ deliverCheckCommand: withBranch(host('merged', true)), deliverCommand: `echo ran >> ${log}; exit 3` })
      const jobId = await hand(messageId)
      assert.equal((await waitJob(jobId)).status, 'done')
      assert.equal(existsSync(log), false, 'nothing was verified or deployed again')
      const last = replies(messageId).at(-1)
      assert.match(last, /En producción desde \d\d:\d\d \S+\./)
      assert.match(last, /ya estaba en producción: llegó por otro camino/)
      assert.equal(env.db.prepare('SELECT status FROM messages WHERE id = ?').get(messageId).status, 'answered')
      assert.deepEqual(JSON.parse(env.queue.getJob(jobId).marks_json), { delivery_ms: 0, delivered: 1 })
      assert.match(JSON.parse(eventsOf(jobId).at(-1).data_json).delivery_ref, /^[0-9a-f]{7,}$/)
      assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE message_id = ? AND kind = 'deliver'").get(messageId).n, 1)
    })

    it('a branch that is not in production is delivered as always', async () => {
      const messageId = await published('Una rama que todavía no salió.')
      const log = path('ran')
      startWorker({ deliverCheckCommand: withBranch(host('pending', false)), deliverCommand: `echo ran >> ${log}; echo ref-real` })
      assert.equal((await waitJob(await hand(messageId))).status, 'done')
      assert.equal(readFileSync(log, 'utf8').trim(), 'ran', 'the command ran')
      assert.match(replies(messageId).at(-1), /^En producción desde \d\d:\d\d \S+\.(\n\nCerrado: .+)?$/)
    })

    it('a check that does not answer yes leaves the delivery as it was', async () => {
      const messageId = await published('Sin respuesta del anfitrión.')
      const log = path('ran')
      startWorker({ deliverCheckCommand: 'exit 9', deliverCommand: `echo ran >> ${log}; echo ref-real` })
      assert.equal((await waitJob(await hand(messageId))).status, 'done')
      assert.equal(readFileSync(log, 'utf8').trim(), 'ran')
    })
  })

  describe('a failed check is the next task, not the end (UD-298)', () => {
    const notes = (messageId) => env.db.prepare("SELECT body FROM progress_notes WHERE message_id = ? AND json_extract(data_json, '$.event') IS NULL ORDER BY id").all(messageId).map((n) => n.body) // the rows of the start and the wait (UD-303) are not delivery notices

    it('a delivery that fails twice and passes the third time: three rounds, a notice for each failure, one final reply', async () => {
      const count = path('count')
      writeFileSync(count, '')
      startWorker({ deliverCommand: `echo x >> ${count}; if [ "$(wc -l < ${count})" -ge 3 ]; then echo ref-3; else echo 'FALLA prueba: src/agenda.test.js › la agenda abre en blanco'; exit 3; fi` })
      const messageId = await publishedMessage('Una prueba que cae dos veces.')
      await settle(messageId)
      assert.deepEqual(jobsOf(messageId, 'deliver').map((j) => j.status), ['failed', 'failed', 'done'])
      assert.equal(jobsOf(messageId, 'execute').length, 3, 'one session per round')
      assert.deepEqual(jobsOf(messageId, 'deliver').map((j) => JSON.parse(j.payload_json).round), [0, 1, 2])
      const mine = replies(messageId)
      assert.equal(mine.length, 4, 'the first reply, one notice per failure and ONE final reply')
      assert.equal(mine[1], 'No pasó la verificación: la agenda abre en blanco. Claude lo corrige y vuelve a entregar.')
      assert.equal(mine[2], mine[1])
      assert.match(mine[3], /En producción desde \d\d:\d\d \S+\.(\n\nCerrado: .+)?$/)
      assert.deepEqual(notes(messageId), ['Construido; entregando a producción.', 'Construido; entregando a producción.', 'Construido; entregando a producción.'], 'a notice of delivery each time, never a promise')
      const prompt = calls().at(-1).stdin
      assert.match(prompt, /A failed check is not an end[\s\S]*never skip the test, never hide it behind a retry or a wait/)
    })

    it('the final text of the session is not in the thread until the delivery is confirmed, and says the real time', async () => {
      const gate = path('gate')
      startWorker({ deliverCommand: `while [ ! -e ${gate} ]; do sleep 0.05; done; echo ref-ok` })
      const messageId = await publishedMessage('Una entrega que espera su confirmación en producción.')
      const delivery = await until(() => jobsOf(messageId, 'deliver')[0])
      await until(() => env.db.prepare('SELECT phase FROM jobs WHERE id = ?').get(delivery.id).phase !== null)
      assert.equal(replies(messageId).length, 1, 'only the first reply exists while the delivery runs')
      assert.ok(replies(messageId).every((b) => !/Arreglé la pantalla|producción/.test(b)), 'neither the summary nor a promise is in the thread yet')
      assert.deepEqual(notes(messageId), ['Construido; entregando a producción.'])
      writeFileSync(gate, '')
      assert.equal((await waitJob(delivery.id)).status, 'done')
      const final = replies(messageId).at(-1)
      assert.match(final, /^Arreglé la pantalla que quedaba en blanco\.[\s\S]*En producción desde \d\d:\d\d \S+\.(\n\nCerrado: .+)?$/)
      const stamp = env.db.prepare("SELECT created_at FROM replies WHERE message_id = ? ORDER BY id DESC LIMIT 1").get(messageId).created_at
      assert.ok(final.includes(clockTime(stamp)) || final.includes(clockTime(stamp - 60000)), 'the time is the one of the confirmation')
    })

    it('with the day\'s budget spent the answer is «No quedó en producción» with the reason and no more rounds', async () => {
      const spent = env.db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM jobs WHERE kind = 'execute'").get().c // the day is shared by every test of the file
      startWorker({ deliverCommand: "echo 'FALLA prueba: src/agenda.test.js › la agenda abre en blanco'; exit 3", dailyBudgetUsd: spent + 1.5 })
      const messageId = await publishedMessage('Una prueba que nunca pasa y un presupuesto corto.')
      await settle(messageId)
      const last = replies(messageId).at(-1)
      assert.match(last, /^No quedó en producción: no pasó la verificación \(la agenda abre en blanco\)\. Se alcanzó el tope de gasto de hoy y Claude no sigue\./)
      assert.ok(jobsOf(messageId, 'deliver').length >= 2 && jobsOf(messageId, 'deliver').at(-1).status === 'failed')
      assert.doesNotMatch(last, /lo verás|pronto|apenas/i)
    })

    it('a change to a screen with no capture says so in the final reply and does not close the message', async () => {
      process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ touches_screen: true, no_capture_reason: 'el navegador no abrió', close: true, close_reason: 'Ya está hecho y revisado.' })
      startWorker({ deliverCommand: 'echo ref-screen' })
      const messageId = await publishedMessage('Un texto de una pantalla.')
      await settle(messageId)
      const last = replies(messageId).at(-1)
      assert.match(last, /No incluye captura ni video: el navegador no abrió\./)
      assert.match(last, /En producción desde/)
      assert.notEqual(env.db.prepare('SELECT status FROM messages WHERE id = ?').get(messageId).status, 'closed', 'a screen without a capture is read by a person before it closes')
    })
  })

  it('without EXECUTE_DELIVER_COMMAND execute posts its final reply and there is no delivery', async () => {
    startWorker({ deliverCommand: '' })
    const messageId = await publishedMessage('Todo como antes.')
    await settle(messageId)
    assert.equal(jobsOf(messageId, 'deliver').length, 0)
    const mine = replies(messageId)
    assert.equal(mine.length, 2)
    assert.equal(mine[1], 'Arreglé la pantalla que quedaba en blanco.\n\nYa carga con tus datos.')
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
    assert.doesNotMatch(replies(messageId).at(-1), /\*\*Resultado\*\*|bloc?ked/)
    assert.match(replies(messageId).at(-1), /Ya carga con tus datos\.$/)
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
    assert.doesNotMatch(replies(messageId).at(-1), /\*\*Resultado\*\*/)
    assert.match(replies(messageId).at(-1), /Ya carga con tus datos\.$/)
    assert.doesNotMatch(replies(messageId).at(-1), /En producción desde/)
  })

  it('a timeout kills the command, runs once more by itself, and the second one goes to a person without going back to Claude', async () => {
    const pidFile = path('pid')
    const tries = path('tries')
    startWorker({ deliverCommand: `echo $$ >> ${tries}; echo $$ > ${pidFile}; sleep 30`, deliverTimeoutMs: 700 })
    const messageId = await publishedMessage('Una entrega que no termina.')
    await settle(messageId)
    const [delivery] = jobsOf(messageId, 'deliver')
    assert.equal(delivery.status, 'failed')
    assert.equal(delivery.attempts, 2, 'the timeout ran once more before giving up')
    assert.equal(readFileSync(tries, 'utf8').trim().split('\n').length, 2)
    assert.match(delivery.last_error, /superó el tiempo máximo/)
    assert.equal(jobsOf(messageId, 'execute').length, 1, 'it does not go back to Claude: a timeout is not a failure of the change')
    assert.match(replies(messageId).at(-1), /^La entrega falló dos veces por la máquina de entrega o por el plazo \(1 min\), no por el cambio/)
    const editorId = env.db.prepare("SELECT id FROM members WHERE email = 'ed@x.org'").get().id
    assert.deepEqual(env.db.prepare('SELECT member_id FROM message_assignees WHERE message_id = ?').all(messageId).map((r) => r.member_id), [editorId], 'a person has it')
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'the process the job started is gone')
    assert.equal(env.db.prepare('SELECT delivered FROM execute_runs WHERE job_id = ?').get(jobsOf(messageId, 'execute')[0].id).delivered, 0)
  })

  it('a failure of the delivery machine is retried once by itself and, if the second try works, nobody hears about it', async () => {
    const flag = path('flag')
    startWorker({ deliverCommand: `if [ -e ${flag} ]; then echo ref-second; else touch ${flag}; echo 'el entorno de la entrega no está listo' >&2; exit 1; fi` })
    const messageId = await publishedMessage('Una máquina que falla una vez.')
    await settle(messageId)
    const [delivery] = jobsOf(messageId, 'deliver')
    assert.deepEqual([delivery.status, delivery.attempts], ['done', 2])
    assert.equal(jobsOf(messageId, 'execute').length, 1)
    assert.match(replies(messageId).at(-1), /En producción desde \d\d:\d\d \S+\./)
    assert.equal(replies(messageId).filter((b) => /falló dos veces/.test(b)).length, 0)
  })

  it('the rehearsal gate answering 1 is the infrastructure: it is retried and nothing goes back to Claude (jobs 219 and 220, 2026-10-26)', async () => {
    const flag = path('gate')
    startWorker({ deliverCommand: `if [ -e ${flag} ]; then echo ref-gate; else touch ${flag}; echo 'sin ensayo verde de esta combinación (ab12): ninguna pasada sale sin ensayar antes la misma combinación' >&2; exit 1; fi` })
    const messageId = await publishedMessage('Una compuerta de ensayo.')
    await settle(messageId)
    const [delivery] = jobsOf(messageId, 'deliver')
    assert.deepEqual([delivery.status, delivery.attempts], ['done', 2])
    assert.equal(jobsOf(messageId, 'execute').length, 1, 'a good change was not sent back to Claude')
    assert.equal(replies(messageId).filter((b) => /No pasó la verificación/.test(b)).length, 0)
  })

  it('the number of «not now» answers in a row comes from the turn of the host, not from a chosen figure', () => {
    assert.equal(HOST_TURN_LIFE_MS, 64 * 60_000, 'a turn of the host lives 64 min (measured 2026-10-26)')
    assert.equal(deferralsInARow(30_000), 128)
    assert.equal(deferralsInARow(HOST_TURN_LIFE_MS), 1)
  })

  it('a «not now» says where it happened: inside the machine counts, before it (or unsaid, from an older host) is a wait', () => {
    assert.equal(waitPlace('##team phase verify\n##team wait in-machine\n'), 'in-machine')
    assert.equal(waitPlace('##team wait before-machine\n'), 'before-machine')
    assert.equal(waitPlace('##team wait before-machine\n##team wait in-machine'), 'in-machine', 'any line from inside the machine wins')
    assert.equal(waitPlace(''), 'before-machine')
    assert.equal(waitPlace(null), 'before-machine')
  })

  it('a «not now» from inside the machine fails at once as infrastructure: it runs once, spends no machine twice and the next deploy launches it again', async () => {
    const counter = path('inside')
    startWorker({ deliverCommand: `echo x >> ${counter}; echo 'falta el binario «python3»' >&2; echo '##team wait in-machine'; exit 75` })
    const messageId = await publishedMessage('Un ahora no desde dentro de la máquina.')
    await settle(messageId)
    const [delivery] = jobsOf(messageId, 'deliver')
    assert.equal(delivery.status, 'failed')
    assert.equal(readFileSync(counter, 'utf8').trim().split('\n').length, 1, 'it was not tried again: every try would spend a machine')
    assert.equal(jobsOf(messageId, 'execute').length, 1, 'nothing goes back to Claude')
    const last = env.db.prepare('SELECT failed_code, body FROM replies WHERE message_id = ? AND failed_job_id IS NOT NULL ORDER BY id DESC').get(messageId)
    assert.equal(last.failed_code, 'deliver_env')
    assert.match(last.body, /espera un arreglo del sistema/)
  })

  // The waits are made quick by moving `run_at` of the queued job to the past: the count is by events, so the clock does not matter.
  const hurry = async (messageId, stop) => {
    await until(() => {
      const j = jobsOf(messageId, 'deliver')[0]
      if (j && j.status === 'queued') env.db.prepare('UPDATE jobs SET run_at = 1 WHERE id = ?').run(j.id)
      return stop(j)
    }, { timeoutMs: 90000 })
  }

  it('the same «not now» without end stops being a wait: the job fails as infrastructure, says it waits for a fix and the next deploy launches it again', async () => {
    const counter = path('forever')
    startWorker({ capacityWaitMs: HOST_TURN_LIFE_MS / 2, deliverCommand: `echo x >> ${counter}; echo 'esperando el turno' >&2; echo '##team wait before-machine'; exit 75` })
    const messageId = await publishedMessage('Un ahora no que no termina.')
    await hurry(messageId, (j) => j?.status === 'failed')
    const [delivery] = jobsOf(messageId, 'deliver')
    assert.equal(readFileSync(counter, 'utf8').trim().split('\n').length, 2, 'it ran exactly the declared number of times and no more')
    assert.equal(delivery.attempts, 1, 'the waits did not spend attempts: only the last run, the one that failed, counts')
    assert.equal(jobsOf(messageId, 'execute').length, 1, 'nothing goes back to Claude')
    const last = env.db.prepare('SELECT failed_code, body FROM replies WHERE message_id = ? AND failed_job_id IS NOT NULL ORDER BY id DESC').get(messageId)
    assert.equal(last.failed_code, 'deliver_env', 'infrastructure: the resume by worker version launches it again')
    assert.match(last.body, /espera un arreglo del sistema/)
  })

  it('a «not now» that changes its reason does not add up: it is a wait, not a stuck fault', async () => {
    const counter = path('changes')
    startWorker({ capacityWaitMs: HOST_TURN_LIFE_MS / 2, deliverCommand: `echo x >> ${counter}; n=$(wc -l < ${counter}); if [ "$n" -ge 4 ]; then echo ref-ok; exit 0; fi; echo "motivo $n" >&2; exit 75` })
    const messageId = await publishedMessage('Un ahora no que cambia.')
    await hurry(messageId, (j) => j?.status === 'done')
    assert.equal(jobsOf(messageId, 'deliver')[0].status, 'done')
    assert.equal(readFileSync(counter, 'utf8').trim().split('\n').length, 4)
  })

  it('a second failure of the machine goes to a person with the reason; a failed verification still goes back to Claude, not to the retry', async () => {
    startWorker({ deliverCommand: "echo 'no se puede entrar por SSH a la máquina de producción' >&2; exit 1" })
    const messageId = await publishedMessage('Una máquina que no entra.')
    await settle(messageId)
    const [delivery] = jobsOf(messageId, 'deliver')
    assert.deepEqual([delivery.status, delivery.attempts], ['failed', 2])
    assert.equal(jobsOf(messageId, 'execute').length, 1)
    assert.match(replies(messageId).at(-1), /falló dos veces por la máquina de entrega.*no se puede entrar por SSH/s)
    const editorId = env.db.prepare("SELECT id FROM members WHERE email = 'ed@x.org'").get().id
    assert.deepEqual(env.db.prepare('SELECT member_id FROM message_assignees WHERE message_id = ?').all(messageId).map((r) => r.member_id), [editorId])
  })

  it('a command that prints more than 20000 characters of stderr keeps the line that ends it', async () => {
    const r = await spawnStreaming('/bin/sh', ['-c', "echo EMPIEZA >&2; i=0; while [ $i -lt 600 ]; do echo 'relleno relleno relleno relleno relleno relleno relleno relleno' >&2; i=$((i+1)); done; echo 'No se instala: lo servido (abc1234) no es un antecesor de este árbol' >&2; exit 5"], { timeoutMs: 10000, graceMs: 100 })
    assert.equal(r.code, 5)
    assert.match(r.stderr, /^EMPIEZA/)
    assert.match(r.stderr, /no es un antecesor de este árbol\n$/)
    assert.ok(r.stderr.length < 21000)
    assert.equal(isEnvironmentFailure(r, r.stderr), true)
  })

  it('isEnvironmentFailure tells the machine from the change', () => {
    assert.equal(isEnvironmentFailure({ code: null, timedOut: true }), true)
    assert.equal(isEnvironmentFailure({ code: 255 }), true)
    assert.equal(isEnvironmentFailure({ code: 1 }, '==== el entorno de la entrega no está listo ====\nsin token de la cuenta de entrega'), true)
    assert.equal(isEnvironmentFailure({ code: 1 }, 'Falta la marca de un juez distinto del autor: no entra.'), false, 'a missing judge mark is the change')
    assert.equal(isEnvironmentFailure({ code: 1 }, '→ fallaron 2 archivos'), false, 'a failed test is the change')
    assert.equal(isEnvironmentFailure({ code: 5 }, 'No se instala: lo servido (cede6f154109cd99185ce1ec731a42a231155ca6) no es un antecesor de este árbol (69c17123af5b).'), true, 'production moved during the verification')
    assert.equal(isEnvironmentFailure({ code: 75 }, 'Connection reset'), false)
    // An older delivery host that still answers 1 for what is not the change's (2026-10-26, jobs 219 and 220: the rehearsal gate sent a good change back to Claude).
    assert.equal(isEnvironmentFailure({ code: 1 }, 'sin ensayo verde de esta combinación (ab12): ninguna pasada sale sin ensayar antes la misma combinación'), true, 'the rehearsal gate is the infrastructure')
    assert.equal(isEnvironmentFailure({ code: 1 }, 'la máquina no se pudo crear: es de la infraestructura y no del cambio, se reintenta'), true)
    assert.equal(isEnvironmentFailure({ code: 1 }, 'no se pudo anotar la aprobación de wt-a: es del depósito y no del cambio'), true)
    assert.equal(isEnvironmentFailure({ code: 1 }, 'una rama no pasó su prueba: no entra a la cola'), false, 'a rejected change stays the change')
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

    it('needs the command and refuses while the message is being worked', async () => {
      startWorker({ deliverCommand: '' })
      const messageId = await publishedMessage('Una entrega a mano.')
      await settle(messageId)
      await worker.stop() // from here the queue only holds what the test puts in it
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
      assert.match(mine[2], /^En producción desde \d\d:\d\d \S+\.(\n\nCerrado: .+)?$/)
    })

    it('a delivery launched again keeps the summary of the session', async () => {
      startWorker({ deliverCommand: 'exit 9', deliverRetries: 0 })
      const messageId = await publishedMessage('Entrega que se relanza.')
      await settle(messageId)
      assert.match(replies(messageId).at(-1), /^No quedó en producción: no pasó la verificación/)
      await worker.stop()
      startWorker({ deliverCommand: 'echo ref-again' })
      const res = await post(messageId)
      assert.equal(res.statusCode, 202, res.body)
      await waitJob(Number(res.json().job_id))
      assert.match(replies(messageId).at(-1), /^Arreglé la pantalla que quedaba en blanco\.\n\nYa carga con tus datos\. En producción desde \d\d:\d\d \S+\.(\n\nCerrado: .+)?$/)
    })
  })
})

describe('pieces of the delivery', () => {
  it('failedCheck names the first failed test, once, and counts the rest (UD-296)', () => {
    assert.equal(failedCheck(''), '')
    assert.equal(failedCheck('boom'), '')
    assert.equal(failedCheck('FALLA prueba: src/a.test.js › la agenda\nFALLA prueba: src/a.test.js › la agenda'), 'la agenda')
    assert.equal(failedCheck('x\nFALLA prueba: panel-clinica/src/estilos/panel-de-fotos.css\nFALLA prueba: src/b.test.js › otra'), 'panel-clinica/src/estilos/panel-de-fotos.css (y 1 más)')
    assert.equal(failedCheck('FALLA prueba: s.js › a\nFALLA prueba: s.js › b\nFALLA prueba: s.js › c', 'en'), 'a (and 2 more)')
    assert.ok(failedCheck(`FALLA prueba: s.js › ${'x'.repeat(400)}`).length <= 160)
  })

  it('the production note ends the last paragraph and the reference goes in the structured part', () => {
    assert.equal(withProductionNote('Uno.\n\nDos.', 'Ya está en producción.'), 'Uno.\n\nDos. Ya está en producción.')
    assert.equal(withProductionNote('Listo', 'Ya está en producción.'), 'Listo. Ya está en producción.')
    assert.equal(withProductionNote('', 'Ya está en producción.'), 'Ya está en producción.')
    const at = Date.UTC(2026, 9, 25, 14, 28)
    assert.match(clockTime(at), /^\d\d:\d\d \S+$/)
    assert.equal(clockTime(at), process.env.TZ ? clockTime(at) : '14:28 UTC')
    assert.equal(deliveredBody({ output: { outcome: 'done', summary: 'Listo.' }, ref: 'https://x.org/c/1', language: 'es-419', at }), `Listo. En producción desde ${clockTime(at)}.`)
    assert.equal(deliveredBody({ output: { outcome: 'done', summary: 'Done.' }, language: 'en', at }), `Done. In production since ${clockTime(at)}.`)
    assert.match(deliveredBody({ output: { outcome: 'done', summary: 'Done.' }, ref: 'abc', language: 'en' }), /^Done\. In production since \d\d:\d\d \S+\.(\n\nCerrado: .+)?$/)
    assert.equal(deliveredBody({ output: null, ref: null, language: 'es-419', at }), `En producción desde ${clockTime(at)}.`)
  })

  it('the held reply keeps the summary, names the reason in plain words and has no jargon', () => {
    assert.equal(heldBody({ output: { outcome: 'done', summary: 'Listo.' }, reason: 'el cambio toca pagos.', language: 'es-419' }),
      'Listo.\n\nCambio listo para revisar: el cambio toca pagos. Todavía no llega a producción.')
    assert.equal(heldBody({ output: { outcome: 'done', summary: 'Listo.' }, reason: 'el cambio toca pagos.', language: 'es-419', captures: true }),
      'Listo.\n\nCambio listo para revisar: el cambio toca pagos. Todavía no llega a producción. Cómo queda, en «Propuesta».')
    assert.doesNotMatch(heldBody({ output: { outcome: 'done', summary: 'Done.' }, reason: 'x', language: 'en' }), /Proposal/)
    assert.match(heldBody({ output: { outcome: 'done', summary: 'Done.' }, reason: 'x', language: 'en', captures: true }), /How it looks, in «Proposal»\./)
    assert.match(heldBody({ output: { outcome: 'done', summary: 'Listo.' }, reason: '', language: 'es-419' }), /Cambio listo para revisar: el cambio necesita esa revisión\. Todavía/)
    assert.match(heldBody({ output: { outcome: 'done', summary: 'Done.' }, reason: 'it touches payments', language: 'en' }), /Change ready for review: it touches payments\. It is not in production yet\./)
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
    assert.deepEqual([d.deliverCommand, d.deliverTimeoutMs, d.deliverRetries, d.deliverMaxAttempts], ['', 900000, null, 2])
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
