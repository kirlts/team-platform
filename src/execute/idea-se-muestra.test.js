// UD-307: when the analyzer judges that the Guard of the idea applies («nothing changes permanently without the approval of a person when what is asked is to explore an idea»), the
// session builds and shows, the thread gets «Lista para ver», and nothing goes to production until a person answers in the thread and the model reads that they want it delivered. The system obeys the boolean: no threshold,
// no knob, no reading of the words. A decided request is delivered as always.
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
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
import { createDeliverHandler } from './deliver.js'
import { buildExecuteParts } from './prompt.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
let PORT = 0 // ephemeral, set after listen: two suites shared 8645 and collided with EADDRINUSE when run in parallel

describe('an idea is shown, not delivered (UD-307)', () => {
  let env, state, worker, author, editor, vault, estimates
  const panel = (cookie) => ({ cookie, 'x-team-request': 'panel' })
  const start = () => {
    const config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, { execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000, deliverCommand: 'echo abc1234' } })
    const handlers = { ...createPipeline({ db: env.db, config, queue: env.queue, events: env.events, modules: env.modules }), execute: createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault }), deliver: createDeliverHandler({ db: env.db, config, queue: env.queue, events: env.events }) }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers })
    worker.start()
  }
  const jobs = (messageId, kind) => all(env.db, 'SELECT id, status FROM jobs WHERE kind = ? AND message_id = ? ORDER BY id', kind, messageId)
  const settled = (messageId, kind, n) => until(() => { const j = jobs(messageId, kind); return j.length >= n && j.every((x) => ['done', 'failed', 'cancelled'].includes(x.status)) }, { timeoutMs: 30000 })
  const thread = async (messageId) => (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}`, headers: panel(author) })).json()

  async function publish (text) {
    const res = await postInput(env, author, { text })
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
      Object.assign(message, { understand_vs_create: 0.9, irreversibility: 0.1, value_holder: 'model', certainty: 0.9, estimate_reason: 'razón', ...estimates })
      message.assignee_ids = bundle.members.filter((m) => m.name === 'Claude').map((m) => m.id)
      return r
    }
    env = await makeEnv({ telemetry: true, modules: { analyze }, config: { execute: { dailyBudgetUsd: 1000 } } })
    state = join(env.dir, 'fake-state')
    mkdirSync(state)
    process.env.FAKE_EXECUTE_STATE = state
    vault = createVault(loadMasterKey({ dataDir: env.dir }))
    await addMember(env, { email: 'ed@x.org', role: 'editor', name: 'Ed' })
    editor = await login(env, 'ed@x.org')
    await env.app.inject({ method: 'POST', url: '/api/members', headers: panel(editor), payload: { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Arreglo pantallas.' } })
    await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    author = await login(env, 'ana@x.org')
    env.config.execute.deliverCommand = 'true' // the API answers `POST /messages/:id/deliver` only when the instance declares the command
    await env.app.listen({ host: '127.0.0.1', port: 0 }); PORT = env.app.server.address().port
  })
  beforeEach(async () => {
    await worker?.stop()
    rmSync(join(state, 'calls.jsonl'), { force: true })
    process.env.FAKE_EXECUTE_MODE = 'ok'
    process.env.FAKE_EXECUTE_REPLY = '1'
    estimates = {}
    delete process.env.FAKE_IDEA_GUARD
    delete process.env.FAKE_EXECUTE_EXTRA
  })
  after(async () => { await worker?.stop(); await env.close() })

  it('the analyzer decision is stored with its number and its reason', async () => {
    start()
    estimates = { idea: 0.9, idea_guard: true, idea_reason: 'lo dijo como una posibilidad' }
    const id = await publish('una página con la esfera de la IA de venta')
    const stored = JSON.parse(get(env.db, 'SELECT estimates_json FROM messages WHERE id = ?', id).estimates_json)
    assert.deepEqual([stored.idea, stored.idea_guard, stored.idea_reason], [0.9, true, 'lo dijo como una posibilidad'])
    estimates = { idea: 0.1, idea_guard: false, idea_reason: 'describe una falla concreta' }
    const decided = JSON.parse(get(env.db, 'SELECT estimates_json FROM messages WHERE id = ?', await publish('el botón Guardar no hace nada')).estimates_json)
    assert.deepEqual([decided.idea, decided.idea_guard], [0.1, false])
  })

  it('an idea: nothing is delivered and the thread says «Lista para ver»; the reply of a person calls Claude with the thread and what Claude understands from it is done', async () => {
    estimates = { idea: 0.9, idea_guard: true, idea_reason: 'lo dijo como una posibilidad' }
    start()
    const id = await publish('una página de la clínica con la esfera de la IA de venta y videos')
    await settled(id, 'execute', 1)
    await new Promise((resolve) => setTimeout(resolve, 600)) // declared courtesy: a delivery that was wrongly queued would start in less than this
    assert.equal(jobs(id, 'deliver').length, 0, 'no delivery to production')
    const shown = await thread(id)
    assert.match(shown.replies.at(-1).body, /Lista para ver/)
    assert.equal(shown.pending_delivery.state, 'held')
    assert.equal(shown.replies.some((r) => 'publishable' in r), false, 'no «Publicar» button: a person writes what they want')
    // a person writes in the thread, with no mention picked: that reply calls the agent that showed the work
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ review: 'approve', summary: 'Entendido: lo publico.' })
    const wrote = await env.app.inject({ method: 'POST', url: `/api/messages/${id}/replies`, headers: { ...panel(author), 'content-type': 'application/json' }, payload: { body: 'Se ve bien, adelante.' } })
    assert.equal(wrote.statusCode, 201, wrote.body)
    await settled(id, 'execute', 2)
    await settled(id, 'deliver', 1)
    assert.equal(get(env.db, "SELECT status FROM jobs WHERE kind = 'deliver' AND message_id = ?", id).status, 'done')
    const mention = JSON.parse(get(env.db, "SELECT payload_json FROM jobs WHERE kind = 'execute' AND message_id = ? ORDER BY id DESC LIMIT 1", id).payload_json)
    assert.ok(mention.mention, 'the second session runs as a mention, with the whole thread')
  })

  it('a reply that the model reads as «keep exploring» does not deliver', async () => {
    estimates = { idea: 0.9, idea_guard: true, idea_reason: 'lo dijo como una posibilidad' }
    start()
    const id = await publish('otra página con la esfera de la IA y un video de presentación')
    await settled(id, 'execute', 1)
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ review: 'none', summary: 'Sigo explorando.' })
    const wrote = await env.app.inject({ method: 'POST', url: `/api/messages/${id}/replies`, headers: { ...panel(author), 'content-type': 'application/json' }, payload: { body: 'Agrega otra opción con fondo claro.' } })
    assert.equal(wrote.statusCode, 201, wrote.body)
    await settled(id, 'execute', 2)
    await new Promise((resolve) => setTimeout(resolve, 600)) // declared courtesy: same as above
    assert.equal(jobs(id, 'deliver').length, 0)
  })

  it('a decided request is delivered as always, with no «Publicar»', async () => {
    estimates = { idea: 0.1, idea_guard: false, idea_reason: 'describe una falla concreta' }
    start()
    const id = await publish('el botón Guardar de la ficha no hace nada desde ayer')
    await settled(id, 'execute', 1)
    await settled(id, 'deliver', 1)
    assert.equal(jobs(id, 'deliver').length, 1)
  })

  it('a message without the decision (from before it existed) is delivered as always', async () => {
    start()
    const id = await publish('cambia el rótulo')
    await settled(id, 'execute', 1)
    await settled(id, 'deliver', 1)
    assert.equal(jobs(id, 'deliver').length, 1)
  })

  it('a message analyzed before the Guard existed is judged for it when its job starts, the judgement is saved, and only then is it decided', async () => {
    process.env.FAKE_IDEA_GUARD = 'true'
    start()
    const id = await publish('una página de la clínica analizada antes de la Guardia, con videos')
    assert.notEqual(typeof JSON.parse(get(env.db, 'SELECT estimates_json FROM messages WHERE id = ?', id).estimates_json).idea_guard, 'boolean', 'the old assessment was never judged')
    await settled(id, 'execute', 1)
    await new Promise((resolve) => setTimeout(resolve, 600)) // declared courtesy: a delivery wrongly queued would start in less than this
    const stored = JSON.parse(get(env.db, 'SELECT estimates_json FROM messages WHERE id = ?', id).estimates_json)
    assert.deepEqual([stored.idea_guard, stored.idea, stored.idea_reason, stored.certainty], [true, 0.9, 'razón del juicio tardío', 0.9], 'saved next to what was there')
    assert.equal(jobs(id, 'deliver').length, 0, 'no delivery to production')
    assert.equal((await thread(id)).pending_delivery.state, 'held')
  })

  it('an old message the judgement says is a decided request is delivered as always; a judgement that cannot be made is not skipped', async () => {
    process.env.FAKE_IDEA_GUARD = 'false'
    start()
    const id = await publish('cambia el rótulo de la agenda analizado antes de la Guardia')
    await settled(id, 'execute', 1)
    await settled(id, 'deliver', 1)
    assert.equal(JSON.parse(get(env.db, 'SELECT estimates_json FROM messages WHERE id = ?', id).estimates_json).idea_guard, false)
    await worker.stop()
    process.env.FAKE_IDEA_GUARD = 'off'
    start()
    const failing = await publish('otro pedido analizado antes de la Guardia y sin juicio posible')
    await until(() => jobs(failing, 'execute').length > 0 && env.db.prepare("SELECT attempts FROM jobs WHERE kind = 'execute' AND message_id = ?").get(failing).attempts >= 1, { timeoutMs: 15000 })
    await new Promise((resolve) => setTimeout(resolve, 600)) // declared courtesy: same as above
    assert.equal(jobs(failing, 'deliver').length, 0, 'an idea is never delivered without the judgement')
    assert.notEqual(typeof JSON.parse(get(env.db, 'SELECT estimates_json FROM messages WHERE id = ?', failing).estimates_json).idea_guard, 'boolean')
  })

  it('the session receives the exploration as context only when the Guard applies, in the variable part of the prompt', () => {
    const base = { message: { id: 1, title: 't', body: 'b', fields: {}, area: 'A' }, template: { body_markdown: '#' }, author: { name: 'Ana', language: 'es-419' }, agent: { name: 'Claude' }, project: { name: 'P' }, jobId: 1, maxSubagents: 1, branch: 'tp/1', deliver: true }
    const plain = buildExecuteParts(base)
    const exploring = buildExecuteParts({ ...base, exploration: { idea: 0.9, reason: 'lo dijo como una posibilidad' } })
    assert.equal(plain.stable, exploring.stable)
    assert.doesNotMatch(plain.variable, /<exploration>/)
    assert.match(exploring.variable, /<exploration>[\s\S]*mostly an idea to explore \(0\.90 of 1\): lo dijo como una posibilidad[\s\S]*Nothing you build goes to production on its own/)
    assert.doesNotMatch(exploring.variable, /Kratos|Khaos|Filo|Gravitas/)
  })
})
