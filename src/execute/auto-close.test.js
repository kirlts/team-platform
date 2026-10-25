// Claude closes the message when it corresponds (UD-271): the session asks with `close` and `close_reason`, and the system closes only when the delivery
// ended in green (or the outcome needs no change), the «after» of a «before» is there, and no person replied meanwhile. Each exclusion is a test that asks
// to close and is refused; the switch EXECUTE_AUTO_CLOSE off never closes.
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { updateMember } from '../domain/members.js'
import { createPipeline } from '../domain/pipeline.js'
import { setProjectDescription } from '../domain/settings.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { closeLine, closeRequest } from './auto-close.js'
import { createDeliverHandler } from './deliver.js'
import { createExecuteHandler } from './handler.js'
import { buildExecuteParts, finalSchema } from './prompt.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
const PORT = 8649 // the range given to this work (8640 to 8649)
const REASON = 'La agenda ya carga y está en producción.'
const ASK = { close: true, close_reason: REASON }
const CHECK = { searched: ['docs/USER-DECISIONS.md'], why_not_covered: 'Ninguna lo fija.', recommendation: 'Cobrar al cierre.', if_wrong: 'Se devuelve.', question: '¿Al inicio o al cierre?' }
const shot = (path, alt) => ({ path, alt, masked: true, place: 'Agenda > Día', as: 'Clínica Sur, administrador' })

describe('Claude closes the message (UD-271)', () => {
  let env, state, worker, editor, author, agentId, vault, gateCounter
  const cookieHeaders = (cookie) => ({ cookie, 'x-team-request': 'panel' })

  function startWorker (execute = {}) {
    const config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, {
      execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000, capacityWaitMs: 300, deliverCommand: 'echo abc1234', deliverRetries: 0, ...execute }
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
  const settle = (messageId) => until(() => {
    const all = env.db.prepare("SELECT status FROM jobs WHERE message_id = ? AND kind IN ('execute', 'deliver')").all(messageId)
    return all.length > 0 && all.every((j) => ['done', 'failed', 'cancelled'].includes(j.status))
  }, { timeoutMs: 40000 })
  const status = (id) => env.db.prepare('SELECT status FROM messages WHERE id = ?').get(id).status
  const closeAudit = (id) => env.db.prepare("SELECT member_id FROM audit_log WHERE action = 'message.close' AND entity_id = ?").all(id)
  const lastAgentReply = (id) => env.db.prepare('SELECT body FROM replies WHERE message_id = ? AND author_id = ? ORDER BY id DESC LIMIT 1').get(id, agentId).body

  async function run (text, { extra, files, before: beforeShot, command, config = {} } = {}) {
    await worker?.stop() // one worker at a time: an old one would take the job with its own configuration
    for (const [name, value] of [['FAKE_EXECUTE_EXTRA', extra], ['FAKE_EXECUTE_CAPTURE_FILES', files], ['FAKE_EXECUTE_START_CAPTURES', beforeShot && [beforeShot]]]) {
      if (value) process.env[name] = JSON.stringify(value)
      else delete process.env[name]
    }
    startWorker({ ...(command ? { deliverCommand: command } : {}), ...config })
    const res = await postInput(env, author, { text })
    const inputId = res.json().input_id
    await until(() => env.db.prepare('SELECT status FROM inputs WHERE id = ?').get(inputId).status === 'proposed', { timeoutMs: 10000 })
    const pub = await env.app.inject({ method: 'POST', url: `/api/inputs/${inputId}/publish`, headers: { ...cookieHeaders(author), 'content-type': 'application/json' }, payload: '{}' })
    assert.equal(pub.statusCode, 200, pub.body)
    const messageId = env.db.prepare('SELECT id FROM messages WHERE input_id = ?').get(inputId).id
    await settle(messageId)
    return messageId
  }
  const notClosed = (id, why) => {
    assert.notEqual(status(id), 'closed', why)
    assert.deepEqual(closeAudit(id), [], `${why}: no message.close row`)
    assert.doesNotMatch(env.db.prepare('SELECT group_concat(body) AS b FROM replies WHERE message_id = ?').get(id).b, /Cerrado: /, `${why}: no «Cerrado» line`)
  }

  before(async () => {
    const analyze = async (bundle, opts) => {
      const r = await fakeAnalyze(bundle, opts)
      r.proposal.messages[0].assignee_ids = bundle.members.filter((m) => m.name === 'Claude').map((m) => m.id)
      return r
    }
    env = await makeEnv({ telemetry: true, modules: { analyze } })
    gateCounter = 0
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
    env.config.execute.deliverCommand = 'true'
    await env.app.listen({ host: '127.0.0.1', port: PORT })
  })
  beforeEach(async () => {
    await worker?.stop()
    rmSync(join(state, 'calls.jsonl'), { force: true })
    process.env.FAKE_EXECUTE_MODE = 'ok'
    process.env.FAKE_EXECUTE_REPLY = '1'
    for (const k of ['FAKE_EXECUTE_EXTRA', 'FAKE_EXECUTE_CAPTURE_FILES', 'FAKE_EXECUTE_START_CAPTURES']) delete process.env[k]
  })
  after(async () => { await worker?.stop(); await env.close() })

  it('closes with the delivery in exit 0 and close true: the final reply ends with «Cerrado: …», the audit row is the agent\'s and the output does not carry the request', async () => {
    const seen = join(state, 'output.json')
    const id = await run('La agenda queda en blanco, arréglala.', { extra: ASK, command: `printf '%s' "$TEAM_OUTPUT_JSON" > ${seen}; echo abc1234` })
    assert.equal(status(id), 'closed')
    assert.match(lastAgentReply(id), new RegExp(`En producción desde \\d\\d:\\d\\d \\S+\\.\\n\\nCerrado: ${REASON.replace('.', '\\.')}$`))
    assert.deepEqual(closeAudit(id).map((r) => r.member_id), [agentId], 'message.close by the agent member')
    assert.ok(env.db.prepare('SELECT closed_at FROM messages WHERE id = ?').get(id).closed_at > 0)
    assert.deepEqual(JSON.parse(readFileSync(seen, 'utf8')), { outcome: 'done' }, 'TEAM_OUTPUT_JSON has no close fields')
    assert.doesNotMatch(lastAgentReply(id), /close_reason|\*\*close\*\*/, 'the request is not rendered as a structured entry')
  })

  it('does not close with close false, with no reason, or without the field', async () => {
    notClosed(await run('Un arreglo que deja algo para revisar.', { extra: { close: false, close_reason: 'Queda algo.' } }), 'close false')
    notClosed(await run('Un arreglo sin motivo.', { extra: { close: true, close_reason: '   ' } }), 'close true with no reason')
    notClosed(await run('Un arreglo sin el campo.'), 'no field')
  })

  it('does not close when the delivery is held for a person (76), failed, or never started because the session did not ask', async () => {
    const held = await run('Un cambio de cobros.', { extra: ASK, command: "echo 'toca pagos'; exit 76" })
    notClosed(held, 'delivery held')
    assert.equal(status(held), 'open', 'a held delivery is a question for a person')
    notClosed(await run('Una entrega que no pasa la verificación.', { extra: ASK, command: 'echo falla; exit 1' }), 'delivery failed')
    notClosed(await run('Una entrega agotada por el entorno.', { extra: ASK, command: 'exit 255' }), 'delivery exhausted')
  })

  it('does not close with needs_decision, not_mine or blocked, whatever the session asks', async () => {
    notClosed(await run('Una decisión de cobro.', { extra: { outcome: 'needs_decision', decision_check: CHECK, ...ASK } }), 'needs_decision')
    notClosed(await run('Algo que no es del agente.', { extra: { outcome: 'not_mine', ...ASK } }), 'not_mine')
    notClosed(await run('Algo que no se puede hacer.', { extra: { outcome: 'blocked', ...ASK } }), 'blocked')
  })

  it('a «before» without an «after» does not close; with the «after» of production it does', async () => {
    const files = { 'antes.png': 'png' }
    const withoutAfter = await run('Un error en la agenda con captura.', { extra: ASK, files, before: shot('antes.png', 'Agenda con el error') })
    notClosed(withoutAfter, 'before without after')
    const png = "'\\211PNG\\r\\n\\032\\n\\000\\000\\000\\000'"
    const place = JSON.stringify({ path: 'prod.png', alt: 'Agenda en producción', masked: true, place: 'Agenda > Día', as: 'Clínica Sur, administrador' })
    const command = `printf ${png} > "$TEAM_WORKDIR/captures/prod.png"; echo '##team capture ${place}'; echo abc1234`
    const withAfter = await run('Otro error en la agenda con captura.', { extra: ASK, files, before: shot('antes.png', 'Agenda con el error'), command })
    assert.equal(status(withAfter), 'closed')
    assert.match(lastAgentReply(withAfter), /\*\*Después\*\*: Agenda en producción\. Agenda > Día, Clínica Sur, administrador\.\n\nCerrado: /)
  })

  it('does not close when a person replied after the first reply of the agent', async () => {
    const gate = join(env.dir, `gate-${++gateCounter}`)
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify(ASK)
    startWorker({ deliverCommand: `echo '##team phase deploy'; while [ ! -e ${gate} ]; do sleep 0.05; done; echo abc1234` })
    const res = await postInput(env, author, { text: 'Un arreglo mientras alguien opina.' })
    const inputId = res.json().input_id
    await until(() => env.db.prepare('SELECT status FROM inputs WHERE id = ?').get(inputId).status === 'proposed', { timeoutMs: 10000 })
    await env.app.inject({ method: 'POST', url: `/api/inputs/${inputId}/publish`, headers: { ...cookieHeaders(author), 'content-type': 'application/json' }, payload: '{}' })
    const id = env.db.prepare('SELECT id FROM messages WHERE input_id = ?').get(inputId).id
    await until(() => env.db.prepare("SELECT phase FROM jobs WHERE kind = 'deliver' AND message_id = ?").get(id)?.phase === 'deliverDeploy', { timeoutMs: 20000 })
    const said = await env.app.inject({ method: 'POST', url: `/api/messages/${id}/replies`, headers: { ...cookieHeaders(editor), 'content-type': 'application/json' }, payload: { body: 'Espera, cambia también la vista semanal.', kind: 'answer' } })
    assert.equal(said.statusCode, 201, said.body)
    writeFileSync(gate, '')
    await settle(id)
    assert.equal(env.db.prepare("SELECT status FROM jobs WHERE kind = 'deliver' AND message_id = ?").get(id).status, 'done')
    notClosed(id, 'a person replied after the first reply')
  })

  it('EXECUTE_AUTO_CLOSE off never closes, and the session is not offered the fields', async () => {
    const id = await run('Un arreglo con la perilla apagada.', { extra: ASK, config: { autoClose: false } })
    notClosed(id, 'switch off')
    assert.equal(status(id), 'answered')
    const args = calls().at(-1).args
    const schema = JSON.parse(args[args.indexOf('--json-schema') + 1])
    assert.deepEqual(['close' in schema.properties, 'close_reason' in schema.properties], [false, false])
    assert.match(calls().at(-1).stdin, /Do not close the message: a person closes it/)
  })

  it('without a delivery command, `done` leaves the branch for a person and does not close; `investigated` with nothing left does close', async () => {
    notClosed(await run('Un arreglo que queda en la rama.', { extra: ASK, config: { deliverCommand: undefined } }), 'done without delivery')
    const investigated = await run('Algo que ya estaba decidido.', { extra: { outcome: 'investigated', summary: 'Ya estaba decidido en UD-100.\n\nNo cambié nada.', ...ASK } })
    assert.equal(status(investigated), 'closed')
    assert.match(lastAgentReply(investigated), new RegExp(`Cerrado: ${REASON.replace('.', '\\.')}$`))
    assert.deepEqual(closeAudit(investigated).map((r) => r.member_id), [agentId])
    const kept = await run('Otro ya decidido, con algo por confirmar.', { extra: { outcome: 'investigated', summary: 'Ya estaba decidido.\n\nConfirma si aplica.', close: false, close_reason: 'Falta tu confirmación.' } })
    notClosed(kept, 'investigated with close false')
  })

  it('the request is read from the output, the label follows the language, and the prompt and the switch declare it', () => {
    assert.deepEqual(closeRequest({ close: true, close_reason: '  Listo\n y en producción.  ' }), { reason: 'Listo y en producción.' })
    assert.equal(closeRequest({ close: true }), null)
    assert.equal(closeRequest({ close: 'true', close_reason: 'x' }), null)
    assert.equal(closeRequest({ close: false, close_reason: 'x' }), null)
    assert.equal(closeLine('Done.', 'en'), 'Closed: Done.')
    assert.equal(closeLine('Listo.', 'es-419'), 'Cerrado: Listo.')
    assert.equal(loadConfig({ DATA_DIR: '/tmp/x' }).execute.autoClose, true, 'on by default')
    assert.equal(loadConfig({ DATA_DIR: '/tmp/x', EXECUTE_AUTO_CLOSE: 'off' }).execute.autoClose, false)
    assert.throws(() => loadConfig({ DATA_DIR: '/tmp/x', EXECUTE_AUTO_CLOSE: 'maybe' }), /EXECUTE_AUTO_CLOSE/)
    const on = finalSchema(null)
    assert.equal(on.properties.close.type, 'boolean')
    assert.ok(!on.required.includes('close') && !on.required.includes('close_reason'), 'optional')
    assert.ok(!('close' in finalSchema(null, { autoClose: false }).properties), 'the grammar does not offer it with the switch off')
    assert.ok('close' in finalSchema(null, { autoClose: false, validation: true }).properties, 'the validation tolerates it')
    const input = { message: { id: 1, title: 't', body: 'b', fields: {}, area: 'A', status: 'open' }, template: null, author: { name: 'A', profile: '', language: 'es-419' }, agent: { name: 'C', profile: '' }, project: { name: 'P', description: 'D' }, jobId: 1, maxSubagents: 3, branch: 'tp/1' }
    const { stable } = buildExecuteParts(input)
    assert.match(stable, /Set `close` to true in your final output only when all three hold/)
    assert.match(stable, /Never with `needs_decision`, `not_mine` or `blocked`[\s\S]*When in doubt, `close` is false/)
    assert.doesNotMatch(buildExecuteParts({ ...input, autoClose: false }).stable, /Set `close` to true/)
  })
})
