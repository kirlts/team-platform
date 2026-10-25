// The review of a held change by reply (UD-280): a mention of Claude on a message whose change waits for review. The model says in `review` what the
// person asked (approve, discard, iterate, none) and the system carries it out: only an Editor delivers or discards, and nothing reads the words.
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
import { createDeliverHandler, deliveredBody, heldBody, isEnvironmentFailure, outputJson, referenceOf, withProductionNote } from './deliver.js'
import { enqueueDeliver } from './enqueue.js'
import { spawnStreaming } from './runners.js'
import { createExecuteHandler } from './handler.js'
import { buildExecutePrompt } from './prompt.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
const MIGRATIONS = fileURLToPath(new URL('../db/migrations', import.meta.url))
let PORT = 0 // ephemeral, set after listen: three suites shared 8647 and collided with EADDRINUSE when run in parallel

describe('the review by reply (UD-280)', () => {
  let env, state, worker, editor, editorId, author, agentId, vault, counter
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
    editorId = await addMember(env, { email: 'ed@x.org', role: 'editor' })
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

  const shot = (path, alt) => ({ path, alt, masked: true, place: 'Fichas > Paciente', as: 'Clínica Sur, recepción' })
  const holdUnlessReviewed = (log) => `echo "reviewed=$TEAM_REVIEWED_BY" >> ${log}; if [ -n "$TEAM_REVIEWED_BY" ]; then echo ref-reviewed; exit 0; fi; echo 'toca datos de personas'; exit 76`
  const pendingOf = async (messageId) => (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}`, headers: { cookie: editor } })).json().pending_delivery
  const detailOf = async (messageId) => (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}`, headers: { cookie: editor } })).json()
  const reply = (messageId, cookie, body) => env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/replies`, headers: { ...cookieHeaders(cookie), 'content-type': 'application/json' }, payload: JSON.stringify({ body, mention_ids: [String(agentId)] }) })

  /** A message whose change is held for review, with the worker running and the review pending. */
  async function held (text, log) {
    process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify({ 'paso1.png': 'png' })
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ captures: [shot('paso1.png', '0:02 · Paso 1 · Abrir la ficha')] })
    startWorker({ deliverCommand: holdUnlessReviewed(log) })
    const messageId = await publishedMessage(text)
    await settle(messageId)
    assert.ok(await pendingOf(messageId), 'the change waits for review')
    return messageId
  }
  const mentionRuns = (messageId) => jobsOf(messageId, 'execute').slice(1)
  const lastPrompt = () => calls().at(-1).stdin
  const answer = (review, extra = {}) => { process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ review, summary: 'Entendido.', ...extra }) }

  it('the session of the mention receives the review state; an Editor with review `approve` enqueues the delivery with reviewed_by and the final reply follows', async () => {
    const log = path('approve-log')
    const messageId = await held('Subir fotos a la ficha del paciente (aprobar).', log)
    answer('approve')
    const r = await reply(messageId, editor, 'Se ve bien, mándalo.')
    assert.equal(r.statusCode, 201, r.body)
    await settle(messageId)
    assert.match(lastPrompt(), /REVIEW PENDING/)
    assert.match(lastPrompt(), /toca datos de personas/)
    assert.match(lastPrompt(), /can approve and discard/)
    const deliveries = jobsOf(messageId, 'deliver')
    assert.equal(deliveries.length, 2)
    assert.equal(JSON.parse(deliveries[1].payload_json).requested_by, editorId, 'the delivery carries who asked for it')
    assert.match(readFileSync(log, 'utf8'), /reviewed=\n[\s\S]*reviewed=\d+\n$/)
    assert.match(replies(messageId).at(-1), /En producción desde \d\d:\d\d \S+\.$/)
    assert.equal(await pendingOf(messageId), null)
  })

  it('a member who is not an Editor approves by writing it, as any person of the team (UD-284)', async () => {
    const messageId = await held('Subir fotos a la ficha del paciente (miembro).', path('member-log'))
    answer('approve')
    const r = await reply(messageId, author, 'Entrégalo.')
    assert.equal(r.statusCode, 201, r.body)
    await settle(messageId)
    assert.match(lastPrompt(), /can approve and discard/)
    assert.doesNotMatch(replies(messageId).at(-1), /Sólo/)
    assert.equal(jobsOf(messageId, 'deliver').length, 2, 'the approval enqueues the delivery')
  })

  it('`discard` from an Editor drops the change with the reason the model summarized, keeps the message open and never delivers', async () => {
    const messageId = await held('Subir fotos a la ficha del paciente (descartar).', path('discard-log'))
    answer('discard', { review_reason: 'Las fotos no deben ir a la ficha.' })
    await reply(messageId, editor, 'Mejor no, déjalo.')
    await settle(messageId)
    const detail = await detailOf(messageId)
    assert.equal(detail.pending_delivery, null)
    assert.equal(detail.status, 'open')
    assert.ok(detail.replies.some((x) => /^Descartado por .*: Las fotos no deben ir a la ficha\.$/.test(x.body)))
    assert.equal(jobsOf(messageId, 'deliver').length, 1)
  })

  it('`none` answers a question and leaves the review as it was, pointing at the run that held the branch', async () => {
    const messageId = await held('Subir fotos a la ficha del paciente (pregunta).', path('none-log'))
    const [first] = jobsOf(messageId, 'execute')
    answer('none', { summary: 'Toca la ficha del paciente y nada más.' })
    await reply(messageId, author, '¿Qué pantallas toca?')
    await settle(messageId)
    assert.equal(mentionRuns(messageId).length, 1)
    assert.match(replies(messageId).at(-1), /Toca la ficha del paciente/)
    const pending = await pendingOf(messageId)
    assert.equal(pending?.job_id, String(first.id))
    assert.equal(jobsOf(messageId, 'deliver').length, 1)
  })

  it('`iterate` works the same branch again and leaves the review with new material', async () => {
    const log = path('iterate-log')
    const messageId = await held('Subir fotos a la ficha del paciente (iterar).', log)
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ review: 'iterate', captures: [shot('paso1.png', '0:03 · Paso 1 · Abrir la ficha con el cambio')] })
    await reply(messageId, editor, 'Cambia el color del botón y vuelve a mostrármelo.')
    await settle(messageId)
    assert.equal(mentionRuns(messageId).length, 1)
    assert.equal(jobsOf(messageId, 'deliver').length, 2, 'the change is delivered again to the same check, which holds it again')
    const pending = await pendingOf(messageId)
    assert.equal(pending?.branch, `tp/${messageId}`)
    assert.equal(pending?.job_id, String(mentionRuns(messageId).at(-1).id), 'the review points at the new run')
    assert.match(readFileSync(log, 'utf8'), /^(reviewed=\n){2}$/, 'nothing was approved')
  })
})
