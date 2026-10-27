// Second audit of the method, B1: a limit that a person lifts (UD-313) and the wait of an idea (UD-307) have to hold in the two ways an instance delivers. With EXECUTE_DELIVER_COMMAND the
// platform holds the delivery job (deliver.test.js). Without it the session delivers by the rules of the host, and what holds is the list of delivery orders the host declares in its guards file
// (`commands.deliveries`), refused to the session while the limit is open or the idea is not released; what the session leaves goes to a person, and the person's approval relaunches the session as the
// one that may deliver. Without the list nothing can hold, and the instance says so.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { createPipeline } from '../domain/pipeline.js'
import { enqueueExecute } from './enqueue.js'
import { unseenGuards } from './guards-judge.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { all, get } from '../db/index.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { createExecuteHandler } from './handler.js'
import { holdMode, limitsHoldState, personLimitsDeclared, withDeliveriesDenied } from './limits-hold.js'
import { parseGuards } from './hooks/guards.js'
import { refusalOf } from './hooks/commands.mjs'
import { buildExecuteParts } from './prompt.js'
import { declaredGuards, liftPersonGuards, openPersonGuards } from '../domain/assessment.js'
import { audit } from '../domain/audit.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
let PORT = 0
const HOST = { commands: { deliveries: [{ id: 'ship', match: 'ship-it\\.sh', message: 'Shipping is done by ship-it.sh in the delivery machine, not by this session.' }] } }

describe('what holds a limit and the wait of an idea, by mode (units)', () => {
  it('the mode is the delivery job, the delivery orders of the guards file, or nothing', () => {
    assert.equal(holdMode({ deliverCommand: 'deploy {branch}' }), 'deliver')
    assert.equal(holdMode({ deliverCommand: 'deploy {branch}', guards: HOST }), 'deliver', 'the delivery job wins: the platform holds it, whatever the host lists')
    assert.equal(holdMode({ guards: HOST }), 'hook')
    assert.equal(holdMode({ guards: { commands: { rules: [{ match: 'x', message: 'm' }] } } }), 'none', 'a guards file without delivery orders holds nothing')
    assert.equal(holdMode({}), 'none')
  })

  it('the guards file accepts the list with the shape of a rule and refuses a typo with its name', () => {
    assert.deepEqual(parseGuards(JSON.stringify(HOST)), HOST)
    assert.throws(() => parseGuards(JSON.stringify({ commands: { deliveries: [{ match: 'x' }] } })), /commands\.deliveries\[0\]\.message is required/)
    assert.throws(() => parseGuards(JSON.stringify({ commands: { deliveries: [{ match: '(', message: 'm' }] } })), /commands\.deliveries\[0\]\.match is not a regular expression/)
    assert.throws(() => parseGuards(JSON.stringify({ commands: { deliveries: 'ship' } })), /commands\.deliveries must be a list/)
  })

  it('the orders of the list join the refused commands with the reason of the system after the host\'s, and the original is not changed', () => {
    const denied = withDeliveriesDenied(HOST, 'A person lifts the limit.')
    assert.equal(refusalOf(denied.commands, 'bash tools/ship-it.sh --now'), 'Shipping is done by ship-it.sh in the delivery machine, not by this session. A person lifts the limit.')
    assert.equal(refusalOf(denied.commands, 'git push -u origin HEAD'), null)
    assert.equal(refusalOf(HOST.commands, 'bash tools/ship-it.sh --now'), null, 'without the hold the list refuses nothing')
    assert.equal(HOST.commands.rules, undefined)
  })

  it('the touches_<name> booleans of the output name Guards of the area, by key or by id, and nothing else', () => {
    const guards = [{ id: 1, key: 'money', text: 'a' }, { id: 2, text: 'b' }, { id: 3, key: 'data', text: 'c' }]
    assert.deepEqual(declaredGuards(guards, { touches_money: true, touches_2: true, touches_data: false, touches_9: true, touches_other: true }), [1, 2])
    assert.deepEqual(declaredGuards(guards, {}), [])
    assert.deepEqual(declaredGuards(guards, undefined), [])
  })

  it('the prompt carries the hold and the release only when they apply, in the part that varies', () => {
    const base = { message: { id: 1, title: 't', body: 'b', fields: {}, area: 'A', areaDescription: 'Para qué existe el área.' }, template: { body_markdown: '#' }, author: { name: 'Ana', language: 'es-419' }, agent: { name: 'Claude' }, project: { name: 'P' }, jobId: 1, maxSubagents: 1, branch: 'tp/1' }
    const plain = buildExecuteParts(base)
    const held = buildExecuteParts({ ...base, hold: { guards: ['G1: Nada toca pagos'], idea: false } })
    const released = buildExecuteParts({ ...base, release: true })
    assert.equal(plain.stable, held.stable)
    assert.doesNotMatch(plain.variable, /<hold>|released the hold/)
    assert.match(held.variable, /<hold>[\s\S]*touches a limit that only a person lifts \(G1: Nada toca pagos\)[\s\S]*orders that deliver are refused/)
    assert.match(released.variable, /pass: a person released the hold/)
    assert.match(plain.variable, /<area_description>\nPara qué existe el área\.\n<\/area_description>/, 'B4: the session reads the description of the area')
    assert.doesNotMatch(buildExecuteParts({ ...base, message: { ...base.message, areaDescription: '  ' } }).variable, /<area_description>/)
  })
})

describe('a limit about a person and an idea, in an instance with no delivery command', () => {
  let env, state, worker, author, editor, vault, areaId, estimates, extra, guardsFile
  const panel = (cookie) => ({ cookie, 'x-team-request': 'panel' })
  const FIRE = [{ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'bash tools/ship-it.sh --now' } }, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push -u origin HEAD' } }]
  // The text provider judges the Guards a message was never judged against (guards-judge.js); `touching` is what it answers, `asked` collects the prompts it received.
  let touching = []
  const asked = []
  const text = { name: 'fake', model: 'claude-haiku-5-5', complete: async (req) => {
    if (!req.messages[0].content.includes('<guardias>')) throw new Error('only the judgement of the Guards is answered here') // the job judge fails the way a missing key does: the job is not judged
    asked.push(req.messages[0].content)
    return { json: { guards_touched: touching }, usage: { input_tokens: 1, output_tokens: 1 }, provider: 'fake', model: 'claude-haiku-5-5' }
  } }
  const start = ({ withList = true } = {}) => {
    const config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, { execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000, deliverCommand: '', ...(withList ? { guardsFile } : {}) } })
    const handlers = { ...createPipeline({ db: env.db, config, queue: env.queue, events: env.events, modules: env.modules }), execute: createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault, getProviders: () => ({ describe: () => [], text }) }) }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers })
    worker.start()
  }
  const jobs = (messageId) => all(env.db, "SELECT id, status, payload_json FROM jobs WHERE kind = 'execute' AND message_id = ? ORDER BY id", messageId)
  const settled = (messageId, n) => until(() => { const j = jobs(messageId); return j.length >= n && j.every((x) => ['done', 'failed', 'cancelled'].includes(x.status)) }, { timeoutMs: 30000 })
  const thread = async (messageId) => (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}`, headers: panel(author) })).json()
  const calls = () => { try { return readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) } catch { return [] } }
  const answers = () => { try { return readFileSync(join(state, 'guards.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) } catch { return [] } }
  const refused = (record) => record.answers.filter((a) => a.command === 'team hook commands').map((a) => (a.stdout.includes('"deny"') ? 'deny' : 'allow')) // only the hook of the host's list: a light session has its own `team guard` too
  const audited = (action, id) => all(env.db, 'SELECT member_id, detail_json FROM audit_log WHERE action = ? AND entity = ? AND entity_id = ? ORDER BY id', action, 'message', id)
  const reply = (id, body) => env.app.inject({ method: 'POST', url: `/api/messages/${id}/replies`, headers: { ...panel(author), 'content-type': 'application/json' }, payload: { body } })
  const patchArea = (payload) => env.app.inject({ method: 'PATCH', url: `/api/areas/${areaId}`, headers: { ...panel(editor), 'content-type': 'application/json' }, payload })

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
      Object.assign(message, { understand_vs_create: 0.9, irreversibility: 0.1, value_holder: 'model', certainty: 0.9, estimate_reason: 'razón', ...estimates, ...extra })
      message.assignee_ids = bundle.members.filter((m) => m.name === 'Claude').map((m) => m.id)
      return r
    }
    env = await makeEnv({ telemetry: true, modules: { analyze }, config: { execute: { dailyBudgetUsd: 1000 } } })
    state = join(env.dir, 'fake-state')
    mkdirSync(state)
    guardsFile = join(env.dir, 'guards.json')
    writeFileSync(guardsFile, JSON.stringify(HOST))
    process.env.FAKE_EXECUTE_STATE = state
    vault = createVault(loadMasterKey({ dataDir: env.dir }))
    await addMember(env, { email: 'ed@x.org', role: 'editor', name: 'Ed' })
    editor = await login(env, 'ed@x.org')
    await env.app.inject({ method: 'POST', url: '/api/members', headers: panel(editor), payload: { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Arreglo pantallas.' } })
    await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    author = await login(env, 'ana@x.org')
    areaId = get(env.db, 'SELECT id FROM areas WHERE deleted_at IS NULL ORDER BY position, id LIMIT 1').id
    env.config.execute.deliverCommand = ''
    env.config.execute.guardsFile = guardsFile
    await env.app.listen({ host: '127.0.0.1', port: 0 }); PORT = env.app.server.address().port
  })
  beforeEach(async () => {
    await worker?.stop()
    for (const f of ['calls.jsonl', 'guards.jsonl']) rmSync(join(state, f), { force: true })
    process.env.FAKE_EXECUTE_MODE = 'ok'
    process.env.FAKE_EXECUTE_REPLY = '1'
    process.env.FAKE_EXECUTE_GUARDS = '1'
    process.env.FAKE_EXECUTE_GUARD_EVENTS = JSON.stringify(FIRE)
    delete process.env.FAKE_EXECUTE_EXTRA
    estimates = { idea: 0.1, idea_guard: false, idea_reason: 'describe un cambio concreto' }
    touching = []
    asked.length = 0
    extra = {}
    writeFileSync(guardsFile, JSON.stringify(HOST))
    await patchArea({ guards: [] }) // the ids start again at 1 in every test
    await patchArea({ guards: [{ text: 'Nada toca pagos', mechanism: 'credencial de solo lectura', person: true }] })
  })
  after(async () => { await worker?.stop(); delete process.env.FAKE_EXECUTE_GUARDS; delete process.env.FAKE_EXECUTE_GUARD_EVENTS; await env.close() })

  it('the session cannot run the delivery orders of the host, what it leaves goes to a person, and the approval of a person relaunches the one that may deliver', async () => {
    extra = { guards_touched: [1], expectation: 'Preparar el cambio del cobro.' }
    start()
    const id = await publish('Cambiar el cobro del plan.')
    await settled(id, 1)
    // 1. The orders of the host that deliver are refused to this session; the rest of its work is not.
    assert.deepEqual(refused(answers()[0]), ['deny', 'allow'])
    assert.match(answers()[0].answers.find((a) => a.command === 'team hook commands').stdout, /Shipping is done by ship-it\.sh[\s\S]*touches a limit that only a person lifts \(G1: Nada toca pagos\)/)
    assert.match(calls()[0].stdin, /<hold>[\s\S]*G1: Nada toca pagos/)
    assert.match(calls()[0].stdin, /the orders that deliver are refused in this session until a person releases it/)
    // 2. The work is not closed or delivered: it is a question to the person, held, and the run says why.
    const shown = await thread(id)
    assert.match(shown.replies.at(-1).body, /Lista para revisar\. Toca un límite que solo una persona levanta \(G1: Nada toca pagos\)/)
    assert.equal(shown.pending_delivery.state, 'held')
    assert.notEqual(get(env.db, 'SELECT status FROM messages WHERE id = ?', id).status, 'closed')
    assert.equal(audited('message.limit_held', id).length, 1)
    // The warning (consequence and alternative) is in the reply and was recorded as shown (third audit, H-1).
    assert.match(shown.replies.at(-1).body, /Riesgo si se cruza: Se cobra un monto equivocado a un cliente\./)
    assert.match(shown.replies.at(-1).body, /Alternativa que no lo cruza: Dejar el cambio en la rama y pedir el monto a una persona\./)
    assert.match(shown.replies.at(-1).body, /Quien apruebe levanta el límite y queda registrado\./)
    assert.deepEqual(JSON.parse(audited('message.limit_notice', id)[0].detail_json).guards, [1])
    assert.match(get(env.db, 'SELECT delivery_hold_reason FROM execute_runs WHERE message_id = ?', id).delivery_hold_reason, /G1: Nada toca pagos/)
    assert.equal(audited('message.guard_lifted', id).length, 0)
    // 3. An answer that settles nothing leaves the limit open and starts nothing.
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ review: 'none', summary: 'Sigo esperando tu decisión.' })
    assert.equal((await reply(id, '¿Qué riesgo tiene?')).statusCode, 201)
    await settled(id, 2)
    assert.equal(jobs(id).length, 2)
    assert.equal(audited('message.guard_lifted', id).length, 0)
    assert.deepEqual(refused(answers().at(-1)), ['deny', 'allow'], 'the pass that answered the question is still held')
    // 4. A person approves in the thread: the limit is lifted and audited with who, and a new pass is the one that may deliver.
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ review: 'approve', summary: 'Entendido: sigo con la entrega.' })
    assert.equal((await reply(id, 'Apruebo, entrega.')).statusCode, 201)
    await settled(id, 4)
    const lifted = audited('message.guard_lifted', id)
    assert.equal(lifted.length, 1)
    assert.deepEqual(JSON.parse(lifted[0].detail_json).guards, [1])
    assert.equal(lifted[0].member_id, get(env.db, "SELECT id FROM members WHERE email = 'ana@x.org'").id, 'who lifted it is a person')
    assert.equal(audited('message.hold_released', id).length, 1)
    const released = jobs(id).at(-1)
    assert.equal(JSON.parse(released.payload_json).released_by, get(env.db, "SELECT id FROM members WHERE email = 'ana@x.org'").id)
    assert.deepEqual(refused(answers().at(-1)), [], 'the pass that was released declares no refusal: it may run the orders of the host')
    assert.match(calls().at(-1).stdin, /pass: a person released the hold/)
    assert.doesNotMatch(calls().at(-1).stdin, /<hold>/)
  })

  it('a session that ends done with a limit of a person open and no warning fails: the notice is checked by form, and a limit is lifted only after its warning was shown', async () => {
    extra = { guards_touched: [1], expectation: 'Preparar el cambio del cobro.' }
    process.env.FAKE_EXECUTE_NO_NOTICE = '1'
    start()
    const id = await publish('Cambiar el cobro del plan, sin aviso.')
    await settled(id, 1)
    delete process.env.FAKE_EXECUTE_NO_NOTICE
    assert.equal(jobs(id)[0].status, 'failed', 'the output without limit_notice is not valid')
    assert.match(get(env.db, 'SELECT last_error FROM jobs WHERE id = ?', jobs(id)[0].id).last_error ?? '', /limit_notice/)
    assert.equal(audited('message.limit_held', id).length, 0, 'nothing reached a person')
    // Lifting: with no warning shown nothing is lifted; once it was recorded, it is.
    const message = get(env.db, 'SELECT id, area_id, guards_json FROM messages WHERE id = ?', id)
    const ana = get(env.db, "SELECT id FROM members WHERE email = 'ana@x.org'").id
    assert.deepEqual(openPersonGuards(env.db, message, [1]), [1])
    message.guards_json = '[1]'
    assert.equal(liftPersonGuards(env.db, message, { memberId: ana }), false)
    assert.equal(audited('message.guard_lifted', id).length, 0)
    audit(env.db, { memberId: ana, action: 'message.limit_notice', entity: 'message', entityId: id, detail: { guards: [1] } })
    assert.equal(liftPersonGuards(env.db, message, { memberId: ana }), true)
    assert.equal(audited('message.guard_lifted', id).length, 1)
  })

  it('an idea is shown and not delivered by the session either, and the approval of a person releases it', async () => {
    estimates = { idea: 0.9, idea_guard: true, idea_reason: 'lo dijo como una posibilidad' }
    await patchArea({ guards: [] })
    start()
    const id = await publish('una página con la esfera de la IA de venta y videos')
    await settled(id, 1)
    assert.deepEqual(refused(answers()[0]), ['deny', 'allow'])
    assert.match(answers()[0].answers.find((a) => a.command === 'team hook commands').stdout, /What is asked is an idea to explore/)
    assert.match((await thread(id)).replies.at(-1).body, /Lista para ver/)
    assert.equal(audited('message.idea_shown', id).length, 1)
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ review: 'approve', summary: 'Entendido: lo publico.' })
    assert.equal((await reply(id, 'Se ve bien, adelante.')).statusCode, 201)
    await settled(id, 3)
    assert.equal(audited('message.guard_lifted', id).length, 0, 'there was no limit to lift')
    assert.equal(audited('message.hold_released', id).length, 1)
    assert.deepEqual(refused(answers().at(-1)), [])
    assert.doesNotMatch(calls().at(-1).stdin, /<exploration>/, 'the pass that may deliver is not told to only show')
  })

  it('a limit installed after the message was assessed is judged once when its job starts, joins the message and holds the work', async () => {
    await patchArea({ guards: [] })
    start()
    const id = await publish('Revisar la cuenta del cliente.')
    await settled(id, 1)
    assert.equal(get(env.db, 'SELECT guards_seen_json FROM messages WHERE id = ?', id).guards_seen_json, '[]', 'the Guards the analyzer saw: none')
    assert.deepEqual(asked, [], 'nothing was unseen')
    // The equipment writes the limit afterwards; the message was assessed before it existed.
    await patchArea({ guards: [{ text: 'Nada toca pagos', mechanism: 'credencial de solo lectura', person: true }] })
    assert.deepEqual(unseenGuards(env.db, id).map((g) => g.id), [1])
    touching = [1, 99]
    const agentId = get(env.db, "SELECT id FROM members WHERE kind = 'agent'").id
    assert.ok(enqueueExecute(env.db, { messageId: id, memberId: agentId }))
    await settled(id, 2)
    assert.equal(asked.length, 1)
    assert.match(asked[0], /Eres el analizador de pedidos[\s\S]*<guardias>\n- G1 \(de una persona\): Nada toca pagos/)
    assert.equal(get(env.db, 'SELECT guards_json FROM messages WHERE id = ?', id).guards_json, '[1]', 'an id that is not a Guard of the area is dropped')
    assert.equal(get(env.db, 'SELECT guards_seen_json FROM messages WHERE id = ?', id).guards_seen_json, '[1]')
    assert.deepEqual(unseenGuards(env.db, id), [])
    assert.equal(audited('message.guards_judged', id).length, 1)
    assert.deepEqual(refused(answers().at(-1)), ['deny', 'allow'], 'the new limit holds the work of this very pass')
    assert.match((await thread(id)).replies.at(-1).body, /Toca un límite que solo una persona levanta \(G1: Nada toca pagos\)/)
    // Judged once: another pass asks nothing.
    assert.ok(enqueueExecute(env.db, { messageId: id, memberId: agentId }))
    await settled(id, 3)
    assert.equal(asked.length, 1)
  })

  it('a limit the analyzer did not mark but the session declares is treated as touched from then on', async () => {
    const [full] = (await env.app.inject({ method: 'GET', url: `/api/areas/${areaId}/templates`, headers: panel(editor) })).json()
    const template = full
    const withOutput = full.body_markdown.replace(/\noutput:\n/, '\noutput:\n  - { name: touches_1, label: Toca pagos, type: boolean, required: true }\n')
    const patched = await env.app.inject({ method: 'PATCH', url: `/api/areas/${areaId}/templates/${template.id}`, headers: { ...panel(editor), 'content-type': 'application/json' }, payload: { body_markdown: withOutput } })
    assert.equal(patched.statusCode, 200, patched.body)
    extra = { guards_touched: [] }
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ touches_1: true })
    start()
    const id = await publish('Ajustar la cuenta del cliente.')
    assert.equal(get(env.db, 'SELECT guards_json FROM messages WHERE id = ?', id).guards_json, '[]', 'the analyzer marked none')
    await settled(id, 1)
    assert.equal(get(env.db, 'SELECT guards_json FROM messages WHERE id = ?', id).guards_json, '[1]')
    const declared = audited('message.guards_declared', id)
    assert.equal(declared.length, 1)
    assert.deepEqual(JSON.parse(declared[0].detail_json).added, [1])
    assert.notEqual(get(env.db, 'SELECT status FROM messages WHERE id = ?', id).status, 'closed', 'a message that touches a limit of a person is not closed by itself')
    await env.app.inject({ method: 'PATCH', url: `/api/areas/${areaId}/templates/${template.id}`, headers: { ...panel(editor), 'content-type': 'application/json' }, payload: { body_markdown: full.body_markdown } })
  })

  it('without the list of delivery orders nothing can hold: the instance says it, and the session has only the instruction', async () => {
    writeFileSync(guardsFile, JSON.stringify({ commands: { builtin: ['forced-push'] } }))
    assert.equal(personLimitsDeclared(env.db), true)
    const state_ = limitsHoldState({ db: env.db, config: env.config })
    assert.deepEqual([state_.hold, state_.degraded, state_.idea_hold], ['none', true, false])
    assert.match(state_.reason, /retention of the delivery is not applied/)
    const health = (await env.app.inject({ url: '/health' })).json()
    assert.equal(health.status, 'degraded')
    const detail = (await env.app.inject({ url: '/health', headers: { cookie: author } })).json()
    assert.equal(detail.limits.hold, 'none')
    assert.deepEqual([detail.judge.calibrated, detail.judge.threshold], [false, 0.8], 'B3: the judge was never compared with people')
    extra = { guards_touched: [1] }
    start()
    const id = await publish('Cambiar el cobro del plan, sin lista de órdenes.')
    await settled(id, 1)
    assert.deepEqual(refused(answers()[0]), ['allow', 'allow'], 'the delivery order is not refused: the host listed none')
    assert.match(calls()[0].stdin, /this instance cannot refuse the delivery from here, so do not deliver this work to production yourself/)
    assert.doesNotMatch(calls()[0].stdin, /<hold>/)
    assert.notEqual(get(env.db, 'SELECT status FROM messages WHERE id = ?', id).status, 'closed', 'the limit still keeps the message from closing by itself')
    // With the list, or with the delivery command, the instance is not degraded; without a limit of a person there is nothing to degrade.
    writeFileSync(guardsFile, JSON.stringify(HOST))
    assert.equal((await env.app.inject({ url: '/health' })).json().status, 'ok')
    writeFileSync(guardsFile, JSON.stringify({ commands: { builtin: ['forced-push'] } }))
    await patchArea({ guards: [{ text: 'Sin credenciales en archivos', mechanism: 'gancho de commit' }] })
    assert.equal(limitsHoldState({ db: env.db, config: env.config }).degraded, false)
    assert.equal(limitsHoldState({ db: env.db, config: { execute: { deliverCommand: 'true', guardsFile: '' } } }).hold, 'deliver')
  })
})
