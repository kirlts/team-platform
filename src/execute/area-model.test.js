// UD-292: the model of the unattended session comes from the area of the message and the level of the message. The area's model reaches
// `claude -p --model`, a direct fix runs with the area's «direct» model, a level set by hand is respected, a level that only a person can take
// never reaches an agent by the automatic routing (and a person's own choice of recipient prevails), and the job records its model.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { createPipeline } from '../domain/pipeline.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { all, get } from '../db/index.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { createExecuteHandler } from './handler.js'
import { EXECUTE_MODEL_IDS, resolveExecuteModel } from '../domain/execute-models.js'
import { tierOf } from '../domain/bloom.js'
import { closeReason } from './auto-close.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
const PORT = 8644 // the range given to this work (8640 to 8649)

describe('model by area and level', () => {
  let env, state, worker, editor, author, agentId, vault, areaId
  const panel = (cookie) => ({ cookie, 'x-team-request': 'panel' })
  let nextLevel = 'apply'
  let routing = 'agent' // who the fake analyzer assigns: the agent (as the routing reads a profile) or nobody (the first member)

  const startWorker = () => {
    const config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, { execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000 } })
    const handlers = { ...createPipeline({ db: env.db, config, queue: env.queue, events: env.events, modules: env.modules }), execute: createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault }) }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers })
    worker.start()
  }
  const calls = () => { try { return readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) } catch { return [] } }
  const modelOf = (call) => call.args[call.args.indexOf('--model') + 1]
  const waitJob = (id) => until(() => { const j = env.queue.getJob(id); return ['done', 'failed', 'cancelled'].includes(j.status) && j }, { timeoutMs: 20000 })
  const patchArea = (payload, cookie = editor) => env.app.inject({ method: 'PATCH', url: `/api/areas/${areaId}`, headers: { ...panel(cookie), 'content-type': 'application/json' }, payload })

  async function publish (text, extra = {}) {
    const res = await postInput(env, author, { text, ...extra })
    assert.equal(res.statusCode, 202, res.body)
    const inputId = res.json().input_id
    await until(() => get(env.db, 'SELECT status FROM inputs WHERE id = ?', inputId).status === 'proposed', { timeoutMs: 10000 })
    const pub = await env.app.inject({ method: 'POST', url: `/api/inputs/${inputId}/publish`, headers: { ...panel(author), 'content-type': 'application/json' }, payload: '{}' })
    assert.equal(pub.statusCode, 200, pub.body)
    return get(env.db, 'SELECT id FROM messages WHERE input_id = ?', inputId).id
  }

  before(async () => {
    const analyze = async (bundle, opts) => {
      const r = await fakeAnalyze(bundle, opts)
      const message = r.proposal.messages[0]
      message.bloom_level = nextLevel
      if (routing === 'agent') message.assignee_ids = bundle.members.filter((m) => m.name === 'Claude').map((m) => m.id)
      return r
    }
    env = await makeEnv({ telemetry: true, modules: { analyze } })
    state = join(env.dir, 'fake-state')
    mkdirSync(state)
    process.env.FAKE_EXECUTE_STATE = state
    vault = createVault(loadMasterKey({ dataDir: env.dir }))
    await addMember(env, { email: 'ed@x.org', role: 'editor', name: 'Ed' })
    editor = await login(env, 'ed@x.org')
    const created = await env.app.inject({ method: 'POST', url: '/api/members', headers: panel(editor), payload: { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Arreglo pantallas.' } })
    agentId = Number(created.json().id)
    await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    await addMember(env, { email: 'beto@x.org', name: 'Beto' })
    author = await login(env, 'ana@x.org')
    areaId = get(env.db, 'SELECT id FROM areas WHERE deleted_at IS NULL ORDER BY position, id LIMIT 1').id
    await env.app.listen({ host: '127.0.0.1', port: PORT })
  })
  beforeEach(async () => {
    await worker?.stop()
    rmSync(join(state, 'calls.jsonl'), { force: true })
    process.env.FAKE_EXECUTE_MODE = 'ok'
    process.env.FAKE_EXECUTE_REPLY = '1'
    nextLevel = 'apply'
    routing = 'agent'
  })
  after(async () => { await worker?.stop(); await env.close() })

  it('the closed list has the four current models with their documented ids', () => {
    assert.deepEqual(EXECUTE_MODEL_IDS, ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'])
  })

  it('an area runs with the installation default until it names a model, and the area view says which', async () => {
    const areas = (await env.app.inject({ method: 'GET', url: '/api/areas', headers: panel(author) })).json()
    assert.equal(areas[0].execute_model, 'claude-sonnet-5-5')
    assert.equal(areas[0].execute_model_direct, null)
  })

  it('only the Editor changes an area model, and only to a model of the list', async () => {
    assert.equal((await patchArea({ execute_model: 'claude-opus-5-5' }, author)).statusCode, 403)
    const bad = await patchArea({ execute_model: 'claude-opus-3' })
    assert.equal(bad.statusCode, 400)
    const ok = await patchArea({ execute_model: 'claude-opus-5-5', execute_model_direct: 'claude-haiku-5-5' })
    assert.equal(ok.statusCode, 200, ok.body)
    assert.deepEqual([ok.json().execute_model, ok.json().execute_model_direct], ['claude-opus-5-5', 'claude-haiku-5-5'])
    const back = await patchArea({ execute_model: null, execute_model_direct: null })
    assert.deepEqual([back.json().execute_model, back.json().execute_model_direct], ['claude-sonnet-5-5', null])
    const audit = get(env.db, "SELECT detail_json FROM audit_log WHERE action = 'area.update' ORDER BY id DESC LIMIT 1")
    assert.match(audit.detail_json, /execute_model/)
  })

  it('the area model is the one in `claude -p --model`, and the job and its timing record it', async () => {
    await patchArea({ execute_model: 'claude-opus-5-5', execute_model_direct: null })
    nextLevel = 'analyze'
    startWorker()
    const messageId = await publish('La agenda tarda en abrir y no sé por qué.')
    const job = get(env.db, "SELECT id FROM jobs WHERE kind = 'execute' AND message_id = ?", messageId)
    assert.equal((await waitJob(job.id)).status, 'done')
    assert.equal(modelOf(calls()[0]), 'claude-opus-5-5')
    assert.equal(get(env.db, 'SELECT model FROM jobs WHERE id = ?', job.id).model, 'claude-opus-5-5')
    const timing = (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}/timing`, headers: panel(editor) })).json()
    assert.equal(timing.model, 'claude-opus-5-5')
    assert.equal(typeof timing.cost_usd, 'number')
    assert.equal(get(env.db, 'SELECT bloom_level FROM messages WHERE id = ?', messageId).bloom_level, 'analyze')
  })

  it('a direct fix runs with the area direct model and a complex one with the area model', async () => {
    await patchArea({ execute_model: 'claude-sonnet-5-5', execute_model_direct: 'claude-haiku-5-5' })
    startWorker()
    nextLevel = 'apply'
    const direct = await publish('Cambiar el texto del botón Guardar por Aceptar.')
    await waitJob(get(env.db, "SELECT id FROM jobs WHERE kind = 'execute' AND message_id = ?", direct).id)
    assert.equal(modelOf(calls().at(-1)), 'claude-haiku-5-5')
    assert.match(calls().at(-1).stdin, /level: direct fix/)
    nextLevel = 'evaluate'
    const complex = await publish('Evaluar si conviene mover la agenda a otra pantalla.')
    await waitJob(get(env.db, "SELECT id FROM jobs WHERE kind = 'execute' AND message_id = ?", complex).id)
    assert.equal(modelOf(calls().at(-1)), 'claude-sonnet-5-5')
    assert.match(calls().at(-1).stdin, /level: complex/)
    await patchArea({ execute_model_direct: null })
  })

  it('a level set by hand decides the model of the next session', async () => {
    await patchArea({ execute_model: 'claude-sonnet-5-5', execute_model_direct: 'claude-haiku-5-5' })
    routing = 'first' // no agent: the model is only resolved here, no session runs
    startWorker()
    nextLevel = 'apply'
    const messageId = await publish('Ajustar el color del encabezado.')
    assert.equal(resolveExecuteModel(env.db, { messageId, fallback: 'x' }).model, 'claude-haiku-5-5')
    const set = await env.app.inject({ method: 'PUT', url: `/api/messages/${messageId}/level`, headers: { ...panel(author), 'content-type': 'application/json' }, payload: { bloom_level: 'analyze' } })
    assert.equal(set.statusCode, 200, set.body)
    assert.deepEqual([set.json().bloom_level, set.json().bloom_by], ['analyze', String(get(env.db, "SELECT id FROM members WHERE email = 'ana@x.org'").id)])
    assert.equal(resolveExecuteModel(env.db, { messageId, fallback: 'x' }).model, 'claude-sonnet-5-5')
    assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'message.level.update' AND entity_id = ?", messageId).n, 1)
    // The same level again changes nothing; an unknown one is refused.
    await env.app.inject({ method: 'PUT', url: `/api/messages/${messageId}/level`, headers: { ...panel(author), 'content-type': 'application/json' }, payload: { bloom_level: 'analyze' } })
    assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'message.level.update' AND entity_id = ?", messageId).n, 1)
    assert.equal((await env.app.inject({ method: 'PUT', url: `/api/messages/${messageId}/level`, headers: { ...panel(author), 'content-type': 'application/json' }, payload: { bloom_level: 'whatever' } })).statusCode, 400)
    await patchArea({ execute_model_direct: null })
  })

  it('a retry of a failed session on the direct model runs with the area model', async () => {
    await patchArea({ execute_model: 'claude-sonnet-5-5', execute_model_direct: 'claude-haiku-5-5' })
    process.env.FAKE_EXECUTE_MODE = 'error'
    process.env.FAKE_EXECUTE_REPLY = '0'
    startWorker()
    nextLevel = 'apply'
    const messageId = await publish('Corregir la tilde del título.')
    const first = get(env.db, "SELECT id FROM jobs WHERE kind = 'execute' AND message_id = ?", messageId)
    await waitJob(first.id)
    assert.equal(modelOf(calls().at(-1)), 'claude-haiku-5-5')
    process.env.FAKE_EXECUTE_MODE = 'ok'
    process.env.FAKE_EXECUTE_REPLY = '1'
    const reply = get(env.db, 'SELECT id FROM replies WHERE message_id = ? AND failed_job_id IS NOT NULL ORDER BY id DESC LIMIT 1', messageId)
    const retry = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/replies/${reply.id}/retry`, headers: panel(author) })
    assert.equal(retry.statusCode, 202, retry.body)
    await waitJob(Number(retry.json().job_id))
    assert.equal(modelOf(calls().at(-1)), 'claude-sonnet-5-5')
    await patchArea({ execute_model_direct: null })
  })

  it('a level only a person can take is never given to an agent by the automatic routing: the person who decides takes it', async () => {
    nextLevel = 'decide'
    startWorker()
    const messageId = await publish('Definir cuánto cobramos por el plan nuevo.')
    assert.equal(get(env.db, 'SELECT bloom_level FROM messages WHERE id = ?', messageId).bloom_level, 'decide')
    const assignees = all(env.db, 'SELECT m.id, m.kind FROM message_assignees a JOIN members m ON m.id = a.member_id WHERE a.message_id = ?', messageId)
    assert.ok(assignees.length > 0 && assignees.every((m) => m.kind === 'person'), JSON.stringify(assignees))
    assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'execute' AND message_id = ?", messageId).n, 0)
    assert.ok(assignees.some((m) => m.id === get(env.db, "SELECT id FROM members WHERE email = 'ed@x.org'").id), 'the Editor decides in the area by default')
    assert.equal(calls().length, 0)
  })

  it('the person who picks Claude in «Para» prevails over the level: it is assigned and works, and the level is still shown', async () => {
    nextLevel = 'decide'
    routing = 'first'
    startWorker()
    const messageId = await publish('Decidir el precio del plan nuevo.', { recipient_ids: [String(agentId)] })
    assert.equal(get(env.db, 'SELECT bloom_level FROM messages WHERE id = ?', messageId).bloom_level, 'decide')
    const job = get(env.db, "SELECT id FROM jobs WHERE kind = 'execute' AND message_id = ?", messageId)
    assert.ok(job, 'the agent got its job')
    assert.deepEqual(all(env.db, 'SELECT member_id FROM message_assignees WHERE message_id = ?', messageId).map((r) => r.member_id), [agentId])
    await waitJob(job.id)
  })

  it('only a direct fix closes alone: what the larger model did is validated by a person, and a decision is theirs', async () => {
    routing = 'first'
    startWorker()
    const args = (messageId) => ({ output: { outcome: 'done' }, request: { reason: 'nada pendiente' }, delivered: true, messageId, agentId, after: 1, since: Date.now() })
    const config = loadConfig({ DATA_DIR: env.dir })
    nextLevel = 'apply'
    const direct = await publish('Cambiar un rótulo.')
    assert.equal(closeReason(env.db, config, args(direct)), 'nada pendiente')
    nextLevel = 'evaluate'
    const complex = await publish('Evaluar la pantalla nueva.')
    assert.equal(closeReason(env.db, config, args(complex)), null)
    nextLevel = 'decide'
    const person = await publish('Fijar el precio del plan.')
    assert.equal(closeReason(env.db, config, args(person)), null)
  })

  it('the tier is a fixed table over the enum, and a message without a level has none', () => {
    assert.deepEqual(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create', 'decide'].map(tierOf), ['direct', 'direct', 'direct', 'complex', 'complex', 'complex', 'person'])
    assert.equal(tierOf(null), null)
    assert.equal(tierOf('Aplicar'), null)
  })
})
