// The history of the session (plan 1.0.0): the steps of an `execute` job written from the stream, the captures that can be known while it runs and the ones that arrive
// when the files are stored, the route that returns them, the cap and the promise that recording never fails the session.
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { createPipeline } from '../domain/pipeline.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { createExecuteHandler } from './handler.js'
import { capturesInOutput, createStepRecorder, DETAIL_CHARS, stepOfTool } from './steps.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))

describe('the class and the detail of a tool call', () => {
  it('names the class a person reads for each tool and keeps the technical detail', () => {
    assert.deepEqual(stepOfTool('Read', { file_path: '/repo/src/a.tsx' }), { action: 'read', detail: '/repo/src/a.tsx' })
    for (const name of ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']) assert.equal(stepOfTool(name, { file_path: '/x' }).action, 'edit')
    assert.deepEqual(stepOfTool('Bash', { command: 'npm test', description: 'Pruebas' }), { action: 'command', detail: 'npm test' })
    assert.deepEqual(stepOfTool('Grep', { pattern: 'foo' }), { action: 'search', detail: 'foo' })
    assert.equal(stepOfTool('Glob', { pattern: '**/*.js' }).action, 'search')
    assert.deepEqual(stepOfTool('Task', { description: 'Revisar estilos' }), { action: 'subagent', detail: 'Revisar estilos' })
    assert.deepEqual(stepOfTool('WebFetch', { url: 'https://x.org' }), { action: 'web', detail: 'https://x.org' })
    assert.equal(stepOfTool('TodoWrite', {}).action, 'plan')
    assert.deepEqual(stepOfTool('mcp__x__y', {}), { action: 'other', detail: null })
  })
  it('cuts a long command to the declared length, on one line', () => {
    const d = stepOfTool('Bash', { command: `echo ${'a\n'.repeat(400)}` }).detail
    assert.equal(d.length, DETAIL_CHARS)
    assert.ok(!d.includes('\n') && d.endsWith('…'))
  })
  it('reads the capture lines of an output and ignores the rest', () => {
    const text = 'Page\nLOOK_CAPTURE {"path":"a.png","alt":"Agenda del día","place":"/agenda","as":"recepción","masked":true}\nLOOK_CAPTURE not json\nLOOK_CAPTURE {"path":"b.png"}\n'
    assert.deepEqual(capturesInOutput(text), [{ alt: 'Agenda del día', place: '/agenda', as: 'recepción', masked: true }])
  })
})

describe('recording never fails the session', () => {
  it('a database that cannot be written, or an event that is not what was expected, throws nothing', () => {
    const warnings = []
    const recorder = createStepRecorder({ db: {}, events: { publish () { throw new Error('bus down') } }, jobId: 1, messageId: 1, attempt: 1, max: 10, logger: { warn: (...a) => warnings.push(a) } })
    assert.doesNotThrow(() => {
      recorder.onEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x' } }] } })
      recorder.onEvent({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } })
      recorder.onEvent(null)
      recorder.onEvent({ type: 'assistant', message: { content: 'text' } })
      recorder.end()
    })
    assert.ok(warnings.length > 0, 'the failure is logged, not raised')
  })
})

describe('the history of an execute session', () => {
  let env, state, worker, editor, author, agentId, vault, PORT
  const ok = (cookie) => ({ cookie, 'x-team-request': 'panel' })
  function startWorker (execute = {}) {
    const config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, { execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000, infraRetryWaitMs: 50, ...execute } })
    const handlers = { ...createPipeline({ db: env.db, config, queue: env.queue, events: env.events, modules: env.modules }), execute: createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault, getProviders: env.modules.getProviders }) }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers })
    worker.start()
  }
  async function session (text, { extra = {}, look = null, files = null, execute = {} } = {}) {
    process.env.FAKE_EXECUTE_MULTI = '1'
    if (files) process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify(files)
    if (look) process.env.FAKE_EXECUTE_LOOK = JSON.stringify(look)
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify(extra)
    startWorker(execute)
    const res = await postInput(env, author, { text })
    const inputId = res.json().input_id
    await until(() => env.db.prepare('SELECT status FROM inputs WHERE id = ?').get(inputId).status === 'proposed', { timeoutMs: 10000 })
    const pub = await env.app.inject({ method: 'POST', url: `/api/inputs/${inputId}/publish`, headers: { ...ok(author), 'content-type': 'application/json' }, payload: '{}' })
    assert.equal(pub.statusCode, 200, pub.body)
    const messageId = env.db.prepare('SELECT id FROM messages WHERE input_id = ?').get(inputId).id
    const job = env.db.prepare("SELECT * FROM jobs WHERE kind = 'execute' AND message_id = ?").get(messageId)
    const done = await until(() => { const j = env.queue.getJob(job.id); return ['done', 'failed', 'cancelled'].includes(j.status) && j }, { timeoutMs: 20000 })
    assert.equal(done.status, 'done', done.last_error)
    return { messageId, job }
  }
  const history = async (messageId, cookie = author) => env.app.inject({ method: 'GET', url: `/api/messages/${messageId}/session`, headers: cookie ? { cookie } : {} })
  const shot = { path: 'agenda.png', alt: 'Agenda del día de la clínica', masked: true, place: '/agenda', as: 'recepción' }

  before(async () => {
    const analyze = async (bundle, opts) => {
      const r = await fakeAnalyze(bundle, opts)
      r.proposal.messages[0].assignee_ids = bundle.members.filter((m) => m.name === 'Claude').map((m) => m.id)
      return r
    }
    env = await makeEnv({ modules: { analyze } })
    state = join(env.dir, 'fake-state')
    mkdirSync(state)
    process.env.FAKE_EXECUTE_STATE = state
    vault = createVault(loadMasterKey({ dataDir: env.dir }))
    await addMember(env, { email: 'ed@x.org', role: 'editor' })
    editor = await login(env, 'ed@x.org')
    const created = await env.app.inject({ method: 'POST', url: '/api/members', headers: ok(editor), payload: { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Perfil del agente.' } })
    agentId = Number(created.json().id)
    await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    author = await login(env, 'ana@x.org')
    await env.app.listen({ host: '127.0.0.1', port: 0 }); PORT = env.app.server.address().port
  })
  beforeEach(async () => {
    await worker?.stop()
    process.env.FAKE_EXECUTE_MODE = 'ok'
    process.env.FAKE_EXECUTE_REPLY = '1'
    for (const k of ['FAKE_EXECUTE_EXTRA', 'FAKE_EXECUTE_CAPTURE_FILES', 'FAKE_EXECUTE_START_CAPTURES', 'FAKE_EXECUTE_LOOK', 'FAKE_EXECUTE_MULTI']) delete process.env[k]
    env.db.prepare('INSERT OR IGNORE INTO message_assignees (message_id, member_id) SELECT id, ? FROM messages ORDER BY id LIMIT 1').run(agentId)
  })
  after(async () => { await worker?.stop(); await env.close() })

  it('returns the calls of the session in order, with the class, the tool and the detail, and a screenshot opens once its file is in the thread', async () => {
    const { messageId, job } = await session('La agenda queda en blanco.', { look: shot, files: { 'agenda.png': 'png' }, extra: { captures: [shot] } })
    const res = await history(messageId)
    assert.equal(res.statusCode, 200, res.body)
    const h = res.json()
    assert.deepEqual([h.job_id, h.job_status, h.capped], [String(job.id), 'done', false])
    assert.deepEqual(h.steps.map((s) => [s.action, s.tool]), [['read', 'Read'], ['capture', 'Bash'], ['command', 'Bash'], ['subagent', 'Task'], ['edit', 'Edit']])
    assert.deepEqual(h.steps.map((s) => s.detail), ['/repo/src/screen.tsx', 'look /agenda --shot', 'npm test', 'Revisar estilos', '/repo/src/screen.tsx'])
    assert.ok(h.steps.every((s) => s.ended_at !== null), 'every call returned')
    assert.equal(h.steps[2].failed, true, 'the failing Bash call says so')
    assert.equal(h.steps[0].failed, false)
    const times = h.steps.map((s) => Date.parse(s.at))
    assert.deepEqual([...times].sort((a, b) => a - b), times, 'in the order they happened')
    const capture = h.steps[1].capture
    assert.deepEqual({ alt: capture.alt, place: capture.place, as: capture.as, masked: capture.masked, kind: capture.kind }, { alt: shot.alt, place: '/agenda', as: 'recepción', masked: true, kind: 'image' })
    assert.ok(capture.attachment, 'the closing reply carries the file')
    assert.equal(capture.attachment.kind, 'image')
    const file = await env.app.inject({ method: 'GET', url: `/api/replies/attachments/${capture.attachment.id}`, headers: { cookie: author } })
    assert.equal(file.statusCode, 200)
    assert.equal(file.headers['content-type'], 'image/png')
    assert.equal(h.steps.filter((s) => s.capture).length, 1, 'the declared capture matched the step of look: it adds no second one')
  })

  it('tells the open screens at each change: a message event with the root «session» and the message', async () => {
    const { messageId } = await session('El botón de reservas no responde.')
    const events = env.db.prepare("SELECT data_json FROM job_events WHERE kind = 'message'").all().map((e) => JSON.parse(e.data_json)).filter((d) => d.reason === 'changed' && d.roots?.includes('session'))
    const mine = events.filter((e) => e.message_id === String(messageId))
    assert.ok(mine.length >= 1)
    assert.ok(mine.length < 12, `coalesced, not one per call: ${mine.length}`)
  })

  it('a capture only declared at the end becomes its own step, openable', async () => {
    const { messageId } = await session('La ficha tiene un error.', { files: { 'agenda.png': 'png' }, extra: { captures: [shot] } })
    const h = (await history(messageId)).json()
    const last = h.steps.at(-1)
    assert.deepEqual([last.action, last.tool, last.capture.alt], ['capture', 'StructuredOutput', shot.alt])
    assert.ok(last.capture.attachment)
  })

  it('a capture whose file was left out stays in the history with its description and no file', async () => {
    const { messageId } = await session('La ficha muestra otro error.', { look: shot, files: { 'agenda.png': 'text' }, extra: { captures: [shot] } })
    const step = (await history(messageId)).json().steps.find((s) => s.action === 'capture')
    assert.equal(step.capture.alt, shot.alt)
    assert.equal(step.capture.attachment, null)
  })

  it('keeps at most EXECUTE_STEPS_MAX steps per job and says so; 0 keeps none', async () => {
    env.config.execute.stepsMax = 2 // the route reports the cap of the instance; the worker below gets the same
    const two = await session('Primer pedido con tope.', { execute: { stepsMax: 2 } })
    const h = (await history(two.messageId)).json()
    assert.equal(h.steps.length, 2)
    assert.deepEqual([h.max_steps, h.capped], [2, true])
    await worker.stop()
    env.config.execute.stepsMax = 0
    const none = await session('Segundo pedido sin pasos.', { execute: { stepsMax: 0 } })
    const n = (await history(none.messageId)).json()
    assert.deepEqual([n.steps.length, n.max_steps, n.capped], [0, 0, false])
  })

  it('answers 401 without a session, 404 for a message with no execution or that does not exist', async () => {
    const { messageId } = await session('Pedido para el permiso.')
    assert.equal((await history(messageId, null)).statusCode, 401)
    assert.equal((await history(999999)).statusCode, 404)
    const other = env.db.prepare("INSERT INTO messages (area_id, author_id, title, body, status, created_at, updated_at) SELECT area_id, author_id, 'Sin agente', '', 'open', created_at, updated_at FROM messages WHERE id = ?").run(messageId).lastInsertRowid
    assert.equal((await history(Number(other))).statusCode, 404)
  })
})
