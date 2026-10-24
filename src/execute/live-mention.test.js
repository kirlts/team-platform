// A reply that mentions the agent while its session runs reaches that same session (UD-285), end to end with the fake `claude`: the hook declared in `--settings` runs
// after each batch of tools as Claude Code runs it, calls `team mentions`, and what it returns is the `additionalContext` the model reads next. The mention is taken once:
// the end of the session opens no second job for it, the thread shows that it was received, and a mention that arrives after the last step is not lost.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { createPipeline } from '../domain/pipeline.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { addMember, login, makeEnv, multipart, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { HOOK_CONTEXT_MAX_CHARS, liveMentionsContext } from '../../scripts/team.mjs'
import { createExecuteHandler, LIVE_MENTION_SETTINGS } from './handler.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
const PORT = 8662
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('imagen-de-prueba')])

describe('a mention that arrives while the session runs (UD-285)', () => {
  let env, state, worker, vault, agentId, editor, anaCookie, threadDir
  let cases = 0
  const api = (method, url, cookie, payload) => env.app.inject({ method, url, headers: { cookie, 'x-team-request': 'panel', ...(payload === undefined ? {} : { 'content-type': 'application/json' }) }, payload: payload === undefined ? undefined : JSON.stringify(payload) })
  const startWorker = () => {
    const cfg = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, {
      execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000, capacityWaitMs: 300, deliverCommand: '' }
    })
    const handlers = {
      ...createPipeline({ db: env.db, config: cfg, queue: env.queue, events: env.events, modules: env.modules }),
      execute: createExecuteHandler({ db: env.db, config: cfg, queue: env.queue, events: env.events, vault })
    }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config: cfg, handlers })
    worker.start()
  }
  const hookRuns = () => readFileSync(join(state, 'hook-context.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const calls = () => readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const settle = (messageId, n = 1) => until(() => {
    const jobs = env.db.prepare("SELECT status FROM jobs WHERE message_id = ? AND kind = 'execute'").all(messageId)
    return jobs.length >= n && jobs.every((j) => ['done', 'failed', 'cancelled'].includes(j.status))
  }, { timeoutMs: 40000 })
  const agentReplies = (id) => env.db.prepare('SELECT id, body FROM replies WHERE message_id = ? AND author_id = ? ORDER BY id').all(id, agentId)
  const executeJobs = (id) => env.db.prepare("SELECT id, status, payload_json FROM jobs WHERE message_id = ? AND kind = 'execute' ORDER BY id").all(id)

  async function publishedMessage () {
    const { payload, headers } = await multipart({ text: `La agenda queda en blanco (caso en vivo ${++cases}).` }, [])
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
  const gateFile = () => join(state, 'gate-reached')
  // The session is held after its first batch of tools on a named pipe; the test posts, then releases it. No timer: the session waits for the write.
  const hold = () => { const fifo = join(state, `gate-${++cases}`); execFileSync('mkfifo', [fifo]); process.env.FAKE_EXECUTE_GATE = fifo; return fifo }
  const release = (fifo) => writeFileSync(fifo, 'go')
  const holdingAtGate = (id) => until(() => existsSync(gateFile()) && env.db.prepare("SELECT status FROM jobs WHERE message_id = ? AND kind = 'execute'").get(id)?.status === 'running', { timeoutMs: 30000 })

  before(async () => {
    env = await makeEnv({ telemetry: true })
    state = join(env.dir, 'fake-state')
    mkdirSync(state)
    threadDir = mkdtempSync(join(tmpdir(), 'live-thread-'))
    process.env.FAKE_EXECUTE_STATE = state
    vault = createVault(loadMasterKey({ dataDir: env.dir }))
    await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
    await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    editor = await login(env, 'ed@x.org')
    anaCookie = await login(env, 'ana@x.org')
    const created = await api('POST', '/api/members', editor, { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Perfil del agente.' })
    agentId = Number(created.json().id)
    await env.app.listen({ host: '127.0.0.1', port: PORT })
  })
  beforeEach(async () => {
    await worker?.stop()
    process.env.FAKE_EXECUTE_MODE = 'ok'; process.env.FAKE_EXECUTE_REPLY = '1'; process.env.FAKE_EXECUTE_HOOK = '1'
    delete process.env.FAKE_EXECUTE_GATE; delete process.env.FAKE_EXECUTE_SLEEP_MS; delete process.env.FAKE_EXECUTE_EXTRA
    for (const f of ['gate-reached', 'hook-context.jsonl']) writeFileSync(join(state, f), '') // the files of the previous case
    if (existsSync(gateFile())) execFileSync('rm', ['-f', gateFile()])
    startWorker()
  })
  after(async () => { await worker?.stop(); await env.close() })

  it('the session is started with the hook that takes mentions at each step, and it keeps the ones of the repository', () => {
    assert.deepEqual(LIVE_MENTION_SETTINGS, { hooks: { PostToolBatch: [{ hooks: [{ type: 'command', command: 'team mentions' }] }] } })
  })

  it('a reply with text, a photo and a voice note reaches the running session at its next step; it is taken once, opens no second job and the thread shows it', async () => {
    const fifo = hold()
    const id = await publishedMessage()
    const first = await mention(id, editor, 'primero: arregla la agenda en blanco')
    await holdingAtGate(id)
    assert.equal(calls().at(-1).args[calls().at(-1).args.indexOf('--settings') + 1], JSON.stringify(LIVE_MENTION_SETTINGS), 'the real invocation carries the hook')
    const second = await mention(id, anaCookie, 'corrección: mejor solo el lunes', [{ name: 'foto.png', content: PNG, type: 'image/png' }, { name: 'nota.webm', content: Buffer.from('audio-de-prueba'), type: 'audio/webm' }])
    await until(() => !env.db.prepare("SELECT 1 AS ok FROM jobs WHERE kind = 'extract' AND message_id = ? AND status IN ('queued', 'running')").get(id), { timeoutMs: 20000 })
    assert.equal(env.db.prepare('SELECT pending FROM reply_mentions WHERE reply_id = ?').get(second).pending, 1, 'while the session works the mention waits')
    release(fifo)
    await settle(id)

    const runs = hookRuns()
    assert.equal(runs[0].context, null, 'the step before the mention brought nothing')
    assert.equal(runs[0].code, 0)
    const context = runs.at(-1).context
    assert.match(context, /NEW REPLY THAT MENTIONS YOU, received while you work/)
    assert.match(context, new RegExp(`reply ${second} by Ana`))
    assert.ok(context.includes('corrección: mejor solo el lunes'), 'the text')
    assert.match(context, new RegExp(`foto\\.png \\(image, image/png, \\d+ bytes\\): \\S*reply-${second}/foto\\.png`))
    assert.ok(context.includes('transcript of nota.webm:\n  extraído de audio'), 'what the voice note says, as text')
    assert.ok(!context.includes('primero: arregla'), 'only what is new, not the thread again')
    const photo = /(\S*reply-\d+\/foto\.png)/.exec(context)[1]
    assert.deepEqual(Buffer.from(runs.at(-1).files[photo], 'base64'), PNG, 'the photo was downloaded as a file the session can open')

    const jobs = executeJobs(id)
    assert.equal(jobs.length, 1, 'no second job: the session already took it')
    assert.equal(jobs[0].status, 'done')
    const row = env.db.prepare('SELECT pending, job_id, live_at, live_ack_reply_id FROM reply_mentions WHERE reply_id = ?').get(second)
    assert.deepEqual({ pending: row.pending, job_id: row.job_id, taken: row.live_at > 0 }, { pending: 0, job_id: jobs[0].id, taken: true })
    const line = agentReplies(id).find((r) => r.id === row.live_ack_reply_id)
    assert.match(line.body, /^Recibido\. Lo tomo en cuenta/, 'the thread shows that Claude received it, in the agent\'s name')
    assert.ok(first < second)
    assert.equal(runs.filter((r) => r.context).length, 1, 'delivered once, not at every later step')
  })

  it('a mention that arrives after the last step is not lost: the end of the session attends it in a job of its own', async () => {
    process.env.FAKE_EXECUTE_SLEEP_MS = '800' // after its steps the session is still finishing
    const id = await publishedMessage()
    await mention(id, editor, 'primero')
    await until(() => env.db.prepare("SELECT status FROM jobs WHERE message_id = ? AND kind = 'execute'").get(id)?.status === 'running', { timeoutMs: 20000 })
    await until(() => hookRuns().length >= 1, { timeoutMs: 20000 }) // the only hook of this session already ran
    const late = await mention(id, anaCookie, 'tarde, ya sin pasos')
    await settle(id, 2)
    const jobs = executeJobs(id)
    assert.equal(jobs.length, 2)
    assert.equal(JSON.parse(jobs[1].payload_json).mention.reply_id, late)
    assert.equal(env.db.prepare('SELECT live_at FROM reply_mentions WHERE reply_id = ?').get(late).live_at, null, 'it was not taken live')
    assert.ok(calls().at(-1).stdin.includes('tarde, ya sin pasos'))
  })

  it('the line of a mention taken live is a receipt, not the answer: a session that then fails still says it could not', async () => {
    process.env.FAKE_EXECUTE_MODE = 'error'
    process.env.FAKE_EXECUTE_REPLY = '0'
    const fifo = hold()
    const id = await publishedMessage()
    await mention(id, editor, 'hazlo')
    await holdingAtGate(id)
    const second = await mention(id, anaCookie, 'cambio de planes')
    release(fifo)
    await settle(id)
    const after = agentReplies(id)
    assert.ok(env.db.prepare('SELECT live_at FROM reply_mentions WHERE reply_id = ?').get(second).live_at > 0)
    assert.equal(after.at(-1).body, 'Claude no pudo responder: se alcanzó el tope de gasto.')
  })

  it('only the agent of a running job takes its mentions, and nothing new is an empty list', async () => {
    const fifo = hold()
    const id = await publishedMessage()
    await mention(id, editor, 'hazlo')
    await holdingAtGate(id)
    const job = executeJobs(id)[0]
    assert.equal((await api('POST', `/api/jobs/${job.id}/mentions/take`, editor)).statusCode, 403, 'a person is not the agent of the job')
    release(fifo)
    await settle(id)
    const done = await env.app.inject({ method: 'POST', url: `/api/jobs/${job.id}/mentions/take`, headers: { 'x-team-request': 'panel' } })
    assert.ok([401, 403].includes(done.statusCode), 'without credentials it does not answer')
  })

  it('the context stays under the cap of the hook and the whole text is left in a file', async () => {
    const long = 'x'.repeat(HOOK_CONTEXT_MAX_CHARS + 500)
    const warnings = []
    const text = await liveMentionsContext([{ reply_id: '7', by: 'Ana', at: '2026-10-24T10:00:00Z', body: long, attachments: [{ id: '1', kind: 'link', link: 'https://x.org' }] }], { dir: threadDir, jobId: '3', messageId: '5', download: async () => ({ ok: false, status: 404 }), warnings })
    assert.ok(text.length <= HOOK_CONTEXT_MAX_CHARS)
    const file = /in (\S+live-mentions-7\.md)/.exec(text)[1]
    assert.ok(readFileSync(file, 'utf8').includes(long), 'nothing is lost: the whole text is in the file')
  })
})
