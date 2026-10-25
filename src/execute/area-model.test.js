// UD-295: the model of the unattended session comes from the area and from what the analyzer estimates about the message, never from a box a level puts it in. The light model takes
// what stays within its limits, the area's larger one the rest; a person's Guard puts a person on the message next to Claude; a session of the light model that cannot close goes on
// in the larger one, on the same branch, and the thread says so; every finished job is judged with the IMK.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig, limitPairs } from '../config.js'
import { createPipeline } from '../domain/pipeline.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { all, get } from '../db/index.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { createExecuteHandler } from './handler.js'
import { EXECUTE_MODEL_IDS, resolveExecuteModel } from '../domain/execute-models.js'
import { modelFor } from '../domain/assessment.js'
import { closeReason } from './auto-close.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
const PORT = 8644 // the range given to this work (8640 to 8649)
const LIMITS = { create: 0.6, irreversibility: 0.5, certainty: 0.4 }

describe('model by area and by estimates', () => {
  let env, state, worker, editor, author, agentId, vault, areaId
  const panel = (cookie) => ({ cookie, 'x-team-request': 'panel' })
  let estimates = { understand_vs_create: 0.2, irreversibility: 0.1, value_holder: 'model', certainty: 0.9 }
  let extra = {}
  let routing = 'agent'

  const startWorker = () => {
    const config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, { execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000, lightLimits: LIMITS } })
    const handlers = { ...createPipeline({ db: env.db, config, queue: env.queue, events: env.events, modules: env.modules }), execute: createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault }) }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers })
    worker.start()
  }
  const calls = () => { try { return readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) } catch { return [] } }
  const modelOf = (call) => call.args[call.args.indexOf('--model') + 1]
  const waitJob = (id) => until(() => { const j = env.queue.getJob(id); return ['done', 'failed', 'cancelled'].includes(j.status) && j }, { timeoutMs: 20000 })
  const jobsOf = (messageId) => all(env.db, "SELECT id, status, model, payload_json FROM jobs WHERE kind = 'execute' AND message_id = ? ORDER BY id", messageId)
  const settle = (messageId, n = 1) => until(() => { const j = jobsOf(messageId); return j.length >= n && j.every((x) => ['done', 'failed', 'cancelled'].includes(x.status)) }, { timeoutMs: 25000 })
  const patchArea = (payload, cookie = editor) => env.app.inject({ method: 'PATCH', url: `/api/areas/${areaId}`, headers: { ...panel(cookie), 'content-type': 'application/json' }, payload })

  async function publish (text, fields = {}) {
    const res = await postInput(env, author, { text, ...fields })
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
      Object.assign(message, estimates === null ? {} : { understand_vs_create: estimates.understand_vs_create, irreversibility: estimates.irreversibility, value_holder: estimates.value_holder, certainty: estimates.certainty, estimate_reason: 'razón' }, extra)
      if (routing === 'agent') message.assignee_ids = bundle.members.filter((m) => m.name === 'Claude').map((m) => m.id)
      return r
    }
    env = await makeEnv({ telemetry: true, modules: { analyze }, config: { execute: { dailyBudgetUsd: 1000 } } })
    state = join(env.dir, 'fake-state')
    mkdirSync(state)
    process.env.FAKE_EXECUTE_STATE = state
    vault = createVault(loadMasterKey({ dataDir: env.dir }))
    await addMember(env, { email: 'ed@x.org', role: 'editor', name: 'Ed' })
    editor = await login(env, 'ed@x.org')
    const created = await env.app.inject({ method: 'POST', url: '/api/members', headers: panel(editor), payload: { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Arreglo pantallas.' } })
    agentId = Number(created.json().id)
    await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    author = await login(env, 'ana@x.org')
    areaId = get(env.db, 'SELECT id FROM areas WHERE deleted_at IS NULL ORDER BY position, id LIMIT 1').id
    await env.app.listen({ host: '127.0.0.1', port: PORT })
  })
  beforeEach(async () => {
    await worker?.stop()
    rmSync(join(state, 'calls.jsonl'), { force: true })
    process.env.FAKE_EXECUTE_MODE = 'ok'
    process.env.FAKE_EXECUTE_REPLY = '1'
    delete process.env.FAKE_CANNOT_CLOSE_ON
    delete process.env.FAKE_JUDGE
    estimates = { understand_vs_create: 0.2, irreversibility: 0.1, value_holder: 'model', certainty: 0.9 }
    extra = {}
    routing = 'agent'
    await patchArea({ execute_model: null, execute_model_light: null, guards: [] })
  })
  after(async () => { await worker?.stop(); await env.close() })

  it('the closed list has the four current models with their documented ids', () => {
    assert.deepEqual(EXECUTE_MODEL_IDS, ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'])
  })

  it('an area runs the light model and the larger one of the installation until it names its own, and says so', async () => {
    const [area] = (await env.app.inject({ method: 'GET', url: '/api/areas', headers: panel(author) })).json()
    assert.deepEqual([area.execute_model, area.execute_model_light, area.guards], ['claude-sonnet-5-5', 'claude-haiku-5-5', []])
  })

  it('only the Editor changes models and Guards; the list of models is closed and a Guard keeps its id when the list is rewritten', async () => {
    assert.equal((await patchArea({ execute_model: 'claude-opus-5-5' }, author)).statusCode, 403)
    assert.equal((await patchArea({ execute_model: 'claude-opus-3' })).statusCode, 400)
    const ok = await patchArea({ execute_model: 'claude-opus-5-5', execute_model_light: 'claude-sonnet-5-5', guards: [{ text: 'Nada toca pagos', mechanism: 'credencial de solo lectura', person: true }, { text: 'Sin credenciales en archivos', mechanism: 'gancho de commit' }] })
    assert.equal(ok.statusCode, 200, ok.body)
    assert.deepEqual([ok.json().execute_model, ok.json().execute_model_light], ['claude-opus-5-5', 'claude-sonnet-5-5'])
    assert.deepEqual(ok.json().guards.map((g) => [g.id, g.person ?? false]), [[1, true], [2, false]])
    const again = await patchArea({ guards: [{ id: 2, text: 'Sin credenciales en archivos', mechanism: 'gancho de commit' }, { text: 'Nueva', mechanism: 'x' }] })
    assert.deepEqual(again.json().guards.map((g) => g.id), [2, 3], 'the Guard that stays keeps its id; the new one takes the next')
    assert.equal((await patchArea({ guards: [{ text: ' ' }] })).statusCode, 422)
    assert.match(get(env.db, "SELECT detail_json FROM audit_log WHERE action = 'area.update' ORDER BY id DESC LIMIT 1").detail_json, /fieldValues|guards_json/)
  })

  it('modelFor is a function of the estimates and the limits: above create or irreversibility, or below certainty, the larger one; no estimates, the larger one', () => {
    const low = { understand_vs_create: 0.2, irreversibility: 0.1, value_holder: 'model', certainty: 0.9 }
    assert.equal(modelFor(low, LIMITS), 'light')
    assert.equal(modelFor({ ...low, understand_vs_create: 0.8 }, LIMITS), 'major')
    assert.equal(modelFor({ ...low, irreversibility: 0.9 }, LIMITS), 'major')
    assert.equal(modelFor({ ...low, certainty: 0.1 }, LIMITS), 'major')
    assert.equal(modelFor(null, LIMITS), 'major')
    assert.deepEqual(limitPairs('create=0.6 irreversibility=0.5 certainty=0.4'), LIMITS)
    assert.throws(() => limitPairs('create=2 irreversibility=0.5 certainty=0.4'))
    assert.throws(() => limitPairs('create=0.6'))
  })

  it('what stays within the limits runs the light model; what passes one runs the area larger model; a message with no estimates keeps running the larger one', async () => {
    await patchArea({ execute_model: 'claude-opus-5-5' })
    startWorker()
    const light = await publish('Cambiar el rótulo del botón.')
    await settle(light)
    assert.equal(modelOf(calls().at(-1)), 'claude-haiku-5-5')
    assert.equal(get(env.db, 'SELECT model FROM jobs WHERE message_id = ?', light).model, 'claude-haiku-5-5')
    estimates = { ...estimates, understand_vs_create: 0.9 }
    const heavy = await publish('Diseñar cómo se unifica la subida de archivos.')
    await settle(heavy)
    assert.equal(modelOf(calls().at(-1)), 'claude-opus-5-5')
    estimates = null
    const legacy = await publish('Un mensaje sin estimaciones.')
    await settle(legacy)
    assert.equal(modelOf(calls().at(-1)), 'claude-opus-5-5')
    assert.equal(resolveExecuteModel(env.db, { messageId: legacy, fallback: 'x', light: 'y', limits: LIMITS }).source, 'legacy')
  })

  it('the expectation reaches the session in its own words, with the Guards the message touches and the mechanism that holds each', async () => {
    await patchArea({ guards: [{ text: 'Nada toca pagos', mechanism: 'credencial de solo lectura', person: true }] })
    extra = { expectation: 'Investigar por qué tarda la agenda y proponer un arreglo, sin tocar código todavía.', guards_touched: [1, 99] }
    startWorker()
    const id = await publish('La agenda tarda y no sé por qué.')
    await settle(id)
    const stdin = calls().at(-1).stdin
    assert.match(stdin, /<expectation>\nInvestigar por qué tarda la agenda y proponer un arreglo, sin tocar código todavía\./)
    assert.match(stdin, /G1: Nada toca pagos \(held by: credencial de solo lectura\)/)
    assert.ok(!stdin.includes('G99'), 'an id that is not a Guard of the area is dropped')
    assert.equal(get(env.db, 'SELECT guards_json FROM messages WHERE id = ?', id).guards_json, '[1]')
  })

  it('a Guard about a person puts a person on the message next to Claude, and Claude does not close alone', async () => {
    await patchArea({ guards: [{ text: 'Nada toca pagos', mechanism: 'credencial de solo lectura', person: true }] })
    extra = { guards_touched: [1], expectation: 'Preparar el cambio del cobro.' }
    startWorker()
    const id = await publish('Cambiar el cobro del plan.')
    const people = all(env.db, "SELECT m.id FROM message_assignees a JOIN members m ON m.id = a.member_id WHERE a.message_id = ? AND m.kind = 'person'", id)
    assert.ok(people.length > 0, 'a person is assigned')
    assert.ok(get(env.db, "SELECT 1 AS ok FROM message_assignees WHERE message_id = ? AND member_id = ?", id, agentId), 'and Claude too')
    await settle(id)
    assert.equal(closeReason(env.db, loadConfig({ DATA_DIR: env.dir }), { output: { outcome: 'done' }, request: { reason: 'nada pendiente' }, delivered: true, messageId: id, agentId, after: 1, since: Date.now() }), null)
    assert.equal(get(env.db, 'SELECT status FROM messages WHERE id = ?', id).status, 'answered')
  })

  it('the missing value being a person\'s does the same without a Guard', async () => {
    estimates = { ...estimates, value_holder: 'person' }
    startWorker()
    const id = await publish('Elegir el precio del plan.')
    assert.ok(all(env.db, "SELECT m.id FROM message_assignees a JOIN members m ON m.id = a.member_id WHERE a.message_id = ? AND m.kind = 'person'", id).length > 0)
    await settle(id)
  })

  it('a person who picks Claude in «Para» prevails: only Claude is assigned, and the estimates still apply to its model and to its closing', async () => {
    await patchArea({ guards: [{ text: 'Nada toca pagos', mechanism: 'm', person: true }] })
    extra = { guards_touched: [1] }
    routing = 'first'
    startWorker()
    const id = await publish('Decidir el precio.', { recipient_ids: [String(agentId)] })
    assert.deepEqual(all(env.db, 'SELECT member_id FROM message_assignees WHERE message_id = ?', id).map((r) => r.member_id), [agentId])
    await settle(id)
    assert.equal(closeReason(env.db, loadConfig({ DATA_DIR: env.dir }), { output: { outcome: 'done' }, request: { reason: 'x' }, delivered: true, messageId: id, agentId, after: 1, since: Date.now() }), null)
  })

  it('a person changes the assessment by hand: the expectation, the Guards it touches and who holds the value; an agent cannot, and a Guard of another area is refused', async () => {
    await patchArea({ guards: [{ text: 'Nada toca pagos', mechanism: 'm', person: true }] })
    routing = 'first'
    startWorker()
    const id = await publish('Ajustar el color del encabezado.')
    const put = (payload, cookie = author) => env.app.inject({ method: 'PUT', url: `/api/messages/${id}/assessment`, headers: { ...panel(cookie), 'content-type': 'application/json' }, payload })
    const ok = await put({ expectation: 'Cambiar el color y mostrarme el antes y el después.', guards: [1], value_holder: 'person' })
    assert.equal(ok.statusCode, 200, ok.body)
    const a = ok.json().assessment
    assert.deepEqual([a.expectation, a.guards, a.estimates.value_holder, a.by], ['Cambiar el color y mostrarme el antes y el después.', [1], 'person', String(get(env.db, "SELECT id FROM members WHERE email = 'ana@x.org'").id)])
    assert.equal((await put({ guards: [9] })).statusCode, 400)
    assert.equal((await put({})).statusCode, 400)
    assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'message.assessment.update' AND entity_id = ?", id).n, 1)
    await put({ guards: [1] })
    assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'message.assessment.update' AND entity_id = ?", id).n, 1, 'the same value changes nothing')
  })

  it('a session of the light model that says it cannot close goes on in the larger model on the same branch, and the thread says so; never twice', async () => {
    process.env.FAKE_CANNOT_CLOSE_ON = 'claude-haiku-5-5'
    startWorker()
    const id = await publish('Corregir la tilde del título.')
    await settle(id, 2)
    const [first, second] = jobsOf(id)
    assert.deepEqual([first.model, second.model], ['claude-haiku-5-5', 'claude-sonnet-5-5'])
    const payload = JSON.parse(second.payload_json)
    assert.deepEqual([payload.escalated, payload.escalated_from, payload.escalated_from_model], [true, first.id, 'claude-haiku-5-5'])
    assert.match(calls().at(-1).stdin, /pass: continues the work of Haiku 5\.5/)
    const thread = (await env.app.inject({ method: 'GET', url: `/api/messages/${id}`, headers: { cookie: author } })).json()
    assert.ok(thread.replies.some((r) => r.body === 'Haiku 5.5 no cerró: siguió Sonnet 5.5.'), thread.replies.map((r) => r.body).join(' | '))
    assert.equal(jobsOf(id).length, 2, 'the larger model does not escalate again')
    assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'message.execute_escalate' AND entity_id = ?", id).n, 1)
    const timing = (await env.app.inject({ method: 'GET', url: `/api/messages/${id}/timing`, headers: panel(editor) })).json()
    assert.ok(timing.cost_usd >= 2 * 1.2, `the cost is the whole of the message: ${timing.cost_usd}`)
  })

  it('a retry of a failed session on the light model runs with the area larger model', async () => {
    process.env.FAKE_EXECUTE_MODE = 'error'
    process.env.FAKE_EXECUTE_REPLY = '0'
    startWorker()
    const id = await publish('Corregir la tilde del subtítulo.')
    await settle(id)
    assert.equal(modelOf(calls().at(-1)), 'claude-haiku-5-5')
    process.env.FAKE_EXECUTE_MODE = 'ok'
    process.env.FAKE_EXECUTE_REPLY = '1'
    const reply = get(env.db, 'SELECT id FROM replies WHERE message_id = ? AND failed_job_id IS NOT NULL ORDER BY id DESC LIMIT 1', id)
    const retry = await env.app.inject({ method: 'POST', url: `/api/messages/${id}/replies/${reply.id}/retry`, headers: panel(author) })
    assert.equal(retry.statusCode, 202, retry.body)
    await waitJob(Number(retry.json().job_id))
    assert.equal(modelOf(calls().at(-1)), 'claude-sonnet-5-5')
  })

  it('every finished job is judged with the IMK: 12 KPI, 4 axes against the target of the quadrant, saved with the job and shown in its detail; a judge that cannot run leaves the job unjudged', async () => {
    startWorker()
    const id = await publish('Cambiar un rótulo.')
    await settle(id)
    const timing = (await env.app.inject({ method: 'GET', url: `/api/messages/${id}/timing`, headers: panel(editor) })).json()
    const j = timing.judgment
    assert.equal(j.quadrant, 'execute')
    assert.equal(j.kpis.length, 12)
    assert.deepEqual(j.axes.map((a) => [a.axis, a.score, a.target, a.meets]), [[1, 0, 0, true], [2, 1, 2, false], [3, null, 1, null], [4, null, 0, null]])
    assert.equal(j.judge_model, 'claude-haiku-5-5')
    assert.equal(j.worked_with, 'claude-haiku-5-5')
    process.env.FAKE_JUDGE = 'off'
    const other = await publish('Otro rótulo.')
    await settle(other)
    assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM execute_judgments WHERE message_id = ?', other).n, 0)
    assert.equal(get(env.db, 'SELECT status FROM jobs WHERE message_id = ?', other).status, 'done', 'the job does not depend on its judge')
  })
})
