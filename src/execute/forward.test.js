// A message forwarded to an agent (UD-272) end to end with the fake `claude`: the session sees the forward and its reason, says in `mode` whether it resolves or
// investigates, and the system enforces what `investigate` means (no delivery, no close, whatever the rest of the output says). The documents the reason asked
// for are checked by form: a real PDF inside the directory is attached, anything else is left out and the reply says why.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { createPipeline } from '../domain/pipeline.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { createDeliverHandler } from './deliver.js'
import { createExecuteHandler } from './handler.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
const PORT = 8645 // the range given to this work (8640 to 8649)
const REASON = 'Investiga por qué falla la agenda y dime qué recomiendas, en un PDF.'
const ASK = { close: true, close_reason: 'Ya no queda nada para quien lo envió.' }

describe('a message forwarded to an agent (UD-272)', () => {
  let env, state, worker, vault, edId, agentId, editor
  let cases = 0
  const cookieHeaders = (cookie) => ({ cookie, 'x-team-request': 'panel' })
  const api = (method, url, cookie, payload) => env.app.inject({ method, url, headers: { ...cookieHeaders(cookie), ...(payload === undefined ? {} : { 'content-type': 'application/json' }) }, payload: payload === undefined ? undefined : JSON.stringify(payload) })

  function startWorker (config = {}) {
    const cfg = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, {
      execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000, capacityWaitMs: 300, deliverCommand: 'echo abc1234', deliverRetries: 0 }, ...config
    })
    const handlers = {
      ...createPipeline({ db: env.db, config: cfg, queue: env.queue, events: env.events, modules: env.modules }),
      execute: createExecuteHandler({ db: env.db, config: cfg, queue: env.queue, events: env.events, vault, getProviders: env.modules.getProviders }),
      deliver: createDeliverHandler({ db: env.db, config: cfg, queue: env.queue, events: env.events })
    }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config: cfg, handlers })
    worker.start()
  }
  const calls = () => readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const settle = (messageId) => until(() => {
    const jobs = env.db.prepare("SELECT status FROM jobs WHERE message_id = ? AND kind IN ('execute', 'deliver')").all(messageId)
    return jobs.length > 0 && jobs.every((j) => ['done', 'failed', 'cancelled'].includes(j.status))
  }, { timeoutMs: 40000 })
  const jobs = (id, kind) => env.db.prepare('SELECT status FROM jobs WHERE message_id = ? AND kind = ?').all(id, kind)
  const status = (id) => env.db.prepare('SELECT status FROM messages WHERE id = ?').get(id).status
  const lastAgentReply = (id) => env.db.prepare('SELECT id, kind, body FROM replies WHERE message_id = ? AND author_id = ? ORDER BY id DESC LIMIT 1').get(id, agentId)
  const files = (replyId) => env.db.prepare('SELECT id, kind, name, mime, size FROM reply_attachments WHERE reply_id = ? ORDER BY position, id').all(replyId)

  /** A message of Ana assigned to Ed; Ed forwards it to the agent with `comment`; waits for the work to end. */
  async function forwarded ({ extra, attachmentFiles, config, comment = REASON } = {}) {
    await worker?.stop()
    for (const [name, value] of [['FAKE_EXECUTE_EXTRA', extra], ['FAKE_EXECUTE_ATTACHMENT_FILES', attachmentFiles]]) {
      if (value) process.env[name] = JSON.stringify(value)
      else delete process.env[name]
    }
    startWorker(config)
    const res = await postInput(env, env.ana, { text: `La agenda queda en blanco (caso ${++cases}).` })
    const inputId = res.json().input_id
    await until(() => env.db.prepare('SELECT status FROM inputs WHERE id = ?').get(inputId).status === 'proposed', { timeoutMs: 10000 })
    const pub = await api('POST', `/api/inputs/${inputId}/publish`, env.ana, {})
    assert.equal(pub.statusCode, 200, pub.body)
    const id = env.db.prepare('SELECT id FROM messages WHERE input_id = ?').get(inputId).id
    assert.deepEqual(env.db.prepare('SELECT member_id FROM message_assignees WHERE message_id = ?').all(id).map((r) => r.member_id), [edId], 'it starts with a person')
    const r = await api('POST', `/api/messages/${id}/forward`, editor, { member_id: agentId, comment })
    assert.equal(r.statusCode, 201, r.body)
    await settle(id)
    return id
  }

  before(async () => {
    env = await makeEnv({ telemetry: true })
    state = join(env.dir, 'fake-state')
    mkdirSync(state)
    process.env.FAKE_EXECUTE_STATE = state
    vault = createVault(loadMasterKey({ dataDir: env.dir }))
    edId = await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
    await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    editor = await login(env, 'ed@x.org')
    env.ana = await login(env, 'ana@x.org')
    const created = await api('POST', '/api/members', editor, { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Perfil del agente.' })
    agentId = Number(created.json().id)
    await env.app.listen({ host: '127.0.0.1', port: PORT })
  })
  beforeEach(() => { process.env.FAKE_EXECUTE_MODE = 'ok'; process.env.FAKE_EXECUTE_REPLY = '1' })
  after(async () => { await worker?.stop(); await env.close() })

  it('the session gets the forward: who sent it, the reason, the same words in the thread and a grammar that offers `mode` and `attachments`', async () => {
    const id = await forwarded({ extra: { mode: 'investigate' } })
    const call = calls().at(-1)
    assert.match(call.stdin, /<forwarded>\nforwarded by: Ed\n\nreason:\nInvestiga por qué falla la agenda y dime qué recomiendas, en un PDF\.\n<\/forwarded>/)
    assert.ok(call.stdin.indexOf('<message>') < call.stdin.indexOf('<forwarded>') && call.stdin.indexOf('<forwarded>') < call.stdin.indexOf('<job>'), 'after the message, before the job')
    const schema = JSON.parse(call.args[call.args.indexOf('--json-schema') + 1])
    assert.deepEqual(schema.properties.mode.enum, ['resolve', 'investigate'])
    assert.ok(schema.properties.attachments, 'the grammar offers the documents')
    assert.equal(call.team.TEAM_ATTACHMENTS_DIR.endsWith('/attachments'), true)
    const forward = env.db.prepare("SELECT body, forwarded_to FROM replies WHERE message_id = ? AND kind = 'forward'").get(id)
    assert.deepEqual([forward.body, forward.forwarded_to], [REASON, agentId], 'the thread carries the same words')
  })

  it('investigate: the answer is in the thread, nothing is delivered and nothing is closed, even with a branch, outcome done and close true', async () => {
    const id = await forwarded({ extra: { mode: 'investigate', ...ASK } })
    assert.deepEqual(jobs(id, 'deliver'), [], 'no deliver job')
    assert.equal(status(id), 'answered')
    const reply = lastAgentReply(id)
    assert.equal(reply.kind, 'answer')
    assert.match(reply.body, /Arreglé la pantalla que quedaba en blanco\./)
    assert.doesNotMatch(reply.body, /Cerrado: |Ya está en producción|\*\*mode\*\*|investigate|close_reason/)
    assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'message.close' AND entity_id = ?").get(id).n, 0)
  })

  it('resolve, and no mode at all, keep the delivery as it was (the control of the test above)', async () => {
    const id = await forwarded({ extra: { mode: 'resolve', ...ASK } })
    assert.equal(jobs(id, 'deliver').length, 1, 'the delivery is queued')
    assert.equal(status(id), 'closed', 'and the close request holds when the delivery is green')
    const other = await forwarded({ extra: {} })
    assert.equal(jobs(other, 'deliver').length, 1)
  })

  it('a PDF the session wrote is attached to the answer, named as the session said and served as a PDF', async () => {
    const id = await forwarded({ extra: { mode: 'investigate', attachments: [{ path: 'analisis.pdf', name: 'Análisis de la agenda' }] }, attachmentFiles: { 'analisis.pdf': 'pdf' } })
    const reply = lastAgentReply(id)
    const attached = files(reply.id)
    assert.deepEqual(attached.map((f) => [f.kind, f.name, f.mime]), [['document', 'Análisis de la agenda.pdf', 'application/pdf']])
    assert.doesNotMatch(reply.body, /No se adjuntó/)
    const served = await api('GET', `/api/replies/attachments/${attached[0].id}`, editor)
    assert.equal(served.statusCode, 200)
    assert.equal(served.rawPayload.subarray(0, 5).toString(), '%PDF-')
    assert.equal(attached[0].size, served.rawPayload.length)
  })

  it('a file that is not a PDF, one outside the directory, one that does not exist and one that is too large are left out, and the reply says why', async () => {
    const declared = [
      { path: 'nota.pdf', name: 'Una nota' }, { path: '../bin/team', name: 'Fuera' }, { path: 'no-existe.pdf', name: 'Fantasma' }, { path: 'bueno.pdf', name: 'Bueno' }
    ]
    const id = await forwarded({ extra: { mode: 'investigate', attachments: declared }, attachmentFiles: { 'nota.pdf': 'text', 'bueno.pdf': 'pdf' } })
    const reply = lastAgentReply(id)
    assert.deepEqual(files(reply.id).map((f) => f.name), ['Bueno.pdf'], 'only the real PDF')
    for (const line of ['No se adjuntó «Una nota.pdf»: no es un PDF.', 'No se adjuntó «Fuera.pdf»: estaba fuera del directorio de documentos.', 'No se adjuntó «Fantasma.pdf»: el archivo no existe.']) assert.ok(reply.body.includes(line), line)
    const big = await forwarded({ extra: { mode: 'investigate', attachments: [{ path: 'grande.pdf', name: 'Grande' }] }, attachmentFiles: { 'grande.pdf': 'pdf' }, config: { uploads: { maxDocumentBytes: 12 } } })
    assert.deepEqual(files(lastAgentReply(big).id), [])
    assert.ok(lastAgentReply(big).body.includes('No se adjuntó «Grande.pdf»: superaba el tamaño máximo.'))
  })

  it('a document with resolve travels with the delivery: it is attached to the reply that says it is in production', async () => {
    const id = await forwarded({ extra: { mode: 'resolve', attachments: [{ path: 'informe.pdf', name: 'Informe' }, { path: 'x.pdf', name: 'Roto' }] }, attachmentFiles: { 'informe.pdf': 'pdf', 'x.pdf': 'text' } })
    const reply = lastAgentReply(id)
    assert.match(reply.body, /En producción desde/)
    assert.deepEqual(files(reply.id).map((f) => f.name), ['Informe.pdf'])
    assert.ok(reply.body.includes('No se adjuntó «Roto.pdf»: no es un PDF.'))
  })
})
