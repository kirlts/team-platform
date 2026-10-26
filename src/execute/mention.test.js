// A reply that mentions an agent (UD-278) end to end with the fake `claude`: the session receives the whole thread in order with who wrote what, the
// attachments of the message and of the replies as files, and who called it; a mention that arrives while the agent works is attended afterwards; a session
// that fails still leaves a reply in the thread.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { createPipeline } from '../domain/pipeline.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { addMember, login, makeEnv, multipart, postInput, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { createExecuteHandler } from './handler.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
let PORT = 0 // the port the server got when it listened on an ephemeral one: the sessions call it back (`team reply`)
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('imagen-de-prueba')])

describe('a reply that mentions an agent (UD-278)', () => {
  let env, state, worker, vault, edId, agentId, editor, anaCookie
  let cases = 0
  const api = (method, url, cookie, payload) => env.app.inject({ method, url, headers: { cookie, 'x-team-request': 'panel', ...(payload === undefined ? {} : { 'content-type': 'application/json' }) }, payload: payload === undefined ? undefined : JSON.stringify(payload) })

  function startWorker (config = {}) {
    const cfg = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, {
      execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000, capacityWaitMs: 300, deliverCommand: '', ...config }
    })
    const handlers = {
      ...createPipeline({ db: env.db, config: cfg, queue: env.queue, events: env.events, modules: env.modules }),
      execute: createExecuteHandler({ db: env.db, config: cfg, queue: env.queue, events: env.events, vault, getProviders: env.modules.getProviders })
    }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config: cfg, handlers })
    worker.start()
  }
  const calls = () => readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  // The sessions of the messages of every case write to the same file, and a session of an earlier case may still start when the next one
  // begins (its worker was stopped and the job returned to the queue): the last call of the file is not the last call of this message.
  const callsOf = (messageId) => calls().filter((c) => c.team.TEAM_MESSAGE_ID === String(messageId))
  const settle = (messageId, n = 1) => until(() => {
    const jobs = env.db.prepare("SELECT status FROM jobs WHERE message_id = ? AND kind = 'execute'").all(messageId)
    return jobs.length >= n && jobs.every((j) => ['done', 'failed', 'cancelled'].includes(j.status))
  }, { timeoutMs: 40000 })
  const agentReplies = (id) => env.db.prepare('SELECT id, kind, body FROM replies WHERE message_id = ? AND author_id = ? ORDER BY id').all(id, agentId)

  async function publishedMessage (files = []) {
    const { payload, headers } = await multipart({ text: `La agenda queda en blanco (caso ${++cases}).` }, files)
    const res = await env.app.inject({ method: 'POST', url: '/api/inputs', payload, headers: { ...headers, cookie: anaCookie, 'x-team-request': 'panel' } })
    const inputId = res.json().input_id
    await until(() => env.db.prepare('SELECT status FROM inputs WHERE id = ?').get(inputId).status === 'proposed', { timeoutMs: 10000 })
    const pub = await api('POST', `/api/inputs/${inputId}/publish`, anaCookie, {})
    assert.equal(pub.statusCode, 200, pub.body)
    return env.db.prepare('SELECT id FROM messages WHERE input_id = ?').get(inputId).id
  }
  async function mention (id, cookie, body, files = []) {
    const { payload, headers } = await multipart({ body, mention_ids: [String(agentId)] }, files)
    const r = await env.app.inject({ method: 'POST', url: `/api/messages/${id}/replies`, payload, headers: { ...headers, cookie, 'x-team-request': 'panel' } })
    assert.equal(r.statusCode, 201, r.body)
    return Number(r.json().replies.at(-1).id)
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
    anaCookie = await login(env, 'ana@x.org')
    const created = await api('POST', '/api/members', editor, { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Perfil del agente.' })
    agentId = Number(created.json().id)
    await env.app.listen({ host: '127.0.0.1', port: 0 })
    PORT = env.app.server.address().port
  })
  beforeEach(() => { process.env.FAKE_EXECUTE_MODE = 'ok'; process.env.FAKE_EXECUTE_REPLY = '1'; delete process.env.FAKE_EXECUTE_EXTRA; delete process.env.FAKE_EXECUTE_SLEEP_MS; delete process.env.FAKE_EXECUTE_FAIL_FIRST })
  after(async () => { await worker?.stop(); await env.close() })

  it('the session gets the whole thread in order, who called it, the files of the message and of the replies, and a grammar with `mode`', async () => {
    await worker?.stop()
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ mode: 'investigate' })
    startWorker()
    const id = await publishedMessage([{ name: 'captura.png', content: PNG, type: 'image/png' }])
    await api('POST', `/api/messages/${id}/replies`, editor, { body: 'Primera respuesta de Ed.' })
    await settle(id, 0) // the message is assigned to Ed, not to the agent: nothing runs
    const replyId = await mention(id, editor, '@Claude mira la foto y dime qué recomiendas', [{ name: 'foto.png', content: PNG, type: 'image/png' }, { name: 'datos.pdf', content: Buffer.from('%PDF-1.7 x'), type: 'application/pdf' }])
    await settle(id)
    const call = callsOf(id).at(-1)
    const block = /<mentioned>\n([\s\S]*?)\n<\/mentioned>/.exec(call.stdin)[1]
    assert.match(block, /mentioned by: Ed\nreply: \d+/)
    assert.ok(block.indexOf('Message ') < block.indexOf('Primera respuesta de Ed.') && block.indexOf('Primera respuesta de Ed.') < block.indexOf('mira la foto'), 'the thread is in order')
    assert.match(block, new RegExp(`id ${replyId}\\): Ed \\(person\\) replied, \\S+  <- THIS REPLY MENTIONS YOU`))
    assert.match(block, /attachments of the message:\n- captura\.png \(image, image\/png, \d+ bytes\): \$TEAM_THREAD_DIR\/message\/captura\.png/)
    assert.match(block, new RegExp(`- foto\\.png .*\\$TEAM_THREAD_DIR/reply-${replyId}/foto\\.png`))
    assert.match(block, new RegExp(`- datos\\.pdf .*\\$TEAM_THREAD_DIR/reply-${replyId}/datos\\.pdf`))
    assert.ok(call.stdin.indexOf('<message>') < call.stdin.indexOf('<mentioned>') && call.stdin.indexOf('<mentioned>') < call.stdin.indexOf('<job>'))
    assert.ok(call.team.TEAM_THREAD_DIR.endsWith('/thread'))
    const schema = JSON.parse(call.args[call.args.indexOf('--json-schema') + 1])
    assert.deepEqual(schema.properties.mode.enum, ['resolve', 'investigate'])
    assert.ok(agentReplies(id).length >= 1, 'the agent answered in the thread')
  })

  it('the files of the thread are staged where the session reads them', async () => {
    // The fake session does not read them; a spy on the staging proves the files were copied before it ran.
    const { planThread, stageThread, threadDir } = await import('./mention-context.js')
    const { mkdtempSync } = await import('node:fs')
    const id = await publishedMessage([{ name: 'captura.png', content: PNG, type: 'image/png' }])
    await mention(id, editor, '@Claude', [{ name: 'foto.png', content: PNG, type: 'image/png' }])
    await settle(id) // the mention starts a session in the worker of the first case: it ends before the next case stops that worker
    const cfg = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent' })
    const plan = planThread(env.db, { messageId: id })
    const workdir = mkdtempSync(join(env.dir, 'stage-'))
    assert.equal(await stageThread({ config: cfg, plan, workdir }), 2)
    for (const f of plan.files) assert.ok(existsSync(join(threadDir(workdir), f.rel)), f.rel)
    assert.deepEqual(readFileSync(join(threadDir(workdir), plan.files.find((f) => f.rel.startsWith('message/')).rel)), PNG)
  })

  it('the audio of the mention reaches the session as text in the thread, and its photo as a file (UD-279)', async () => {
    await worker?.stop()
    startWorker()
    const id = await publishedMessage()
    const replyId = await mention(id, editor, '', [{ name: 'nota.webm', content: Buffer.from('audio-de-prueba'), type: 'audio/webm' }, { name: 'foto.png', content: PNG, type: 'image/png' }])
    await settle(id)
    const stdin = callsOf(id).at(-1).stdin
    assert.ok(stdin.includes('transcript of nota.webm:\nextraído de audio'), 'the speech is in the thread as text')
    assert.match(stdin, new RegExp(`foto\\.png .*\\$TEAM_THREAD_DIR/reply-${replyId}/foto\\.png`))
    assert.ok(stdin.indexOf('transcript of nota.webm') > stdin.indexOf(`id ${replyId})`), 'under the reply that carries it')
  })

  it('a mention while the agent works the message is attended in a run that follows', async () => {
    await worker?.stop()
    process.env.FAKE_EXECUTE_SLEEP_MS = '800'
    startWorker()
    const id = await publishedMessage()
    const first = await mention(id, editor, '@Claude primero')
    await until(() => env.db.prepare("SELECT status FROM jobs WHERE message_id = ? AND kind = 'execute'").get(id)?.status === 'running', { timeoutMs: 20000 })
    const second = await mention(id, anaCookie, '@Claude y además esto')
    assert.equal(env.db.prepare('SELECT pending FROM reply_mentions WHERE reply_id = ?').get(second).pending, 1, 'kept, not lost')
    await settle(id, 2)
    const jobs = env.db.prepare("SELECT payload_json, status FROM jobs WHERE message_id = ? AND kind = 'execute' ORDER BY id").all(id)
    assert.equal(jobs.length, 2)
    assert.equal(JSON.parse(jobs[1].payload_json).mention.reply_id, second)
    assert.ok(jobs.every((j) => j.status === 'done'))
    assert.ok(first < second)
    assert.ok(callsOf(id).at(-1).stdin.includes('y además esto'), 'the second run saw the second mention')
  })

  it('a session that fails leaves a reply of the agent in the thread that says it could not and why', async () => {
    await worker?.stop()
    process.env.FAKE_EXECUTE_MODE = 'error'
    process.env.FAKE_EXECUTE_REPLY = '0'
    startWorker()
    const id = await publishedMessage()
    const replyId = await mention(id, editor, '@Claude hazlo')
    await settle(id)
    const after = agentReplies(id).filter((r) => r.id > replyId)
    assert.ok(after.length >= 2, 'the acknowledgement and then the reply that says it could not')
    assert.match(after[0].body, /^Recibido\./, 'the first reply is the acknowledgement of the system')
    assert.equal(after.at(-1).body, 'Claude no pudo responder: se alcanzó el tope de gasto.', 'the acknowledgement does not count as the answer of UD-278')
    assert.doesNotMatch(after.at(-1).body, /execute|trabajo|sesión|agente|invalid_output/i)
  })

  it('the first reply of a mention is the system\'s: it exists when the session never sends one, it comes before the session, and the session is told', async () => {
    await worker?.stop()
    delete process.env.FAKE_EXECUTE_MODE
    process.env.FAKE_EXECUTE_REPLY = '0' // the session omits `team reply`, as job 138 did
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ mode: 'investigate' })
    startWorker()
    const id = await publishedMessage()
    const replyId = await mention(id, editor, '@Claude revisa esto')
    await settle(id)
    const mine = agentReplies(id).filter((r) => r.id > replyId)
    assert.match(mine[0].body, /^Recibido\./)
    assert.equal(mine.filter((r) => /^Recibido\./.test(r.body)).length, 1, 'one acknowledgement, not one per attempt')
    assert.match(callsOf(id).at(-1).stdin, /already posted a one-line acknowledgement/)
  })
})
