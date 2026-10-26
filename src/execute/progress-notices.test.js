// UD-293: while an `execute` session runs, the worker leaves a progress notice in the thread every `progress_interval_min` of the template, written from
// what the session really did, and stops when the session ends. The minute is shortened (`progressUnitMs`), never the logic: a notice is born from a timer
// of the job, and what the test reads is the row it left.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { createLogger } from '../log.js'
import { createPipeline } from '../domain/pipeline.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { noticeBody, waitBody } from '../domain/progress-notes.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { createExecuteHandler } from './handler.js'
import { createStreamReader } from './stream.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
const UNIT_MS = 40 // one «minute» of the test; the handler's own is 60 000
const SESSION_MS = 1500 // how long the fake session works

describe('progress notices of an execute session (UD-293)', () => {
  let env, state, worker, editor, author, agentId, vault
  const cookieHeaders = (cookie) => ({ cookie, 'x-team-request': 'panel' })

  function startWorker ({ execute = {}, logger } = {}) {
    const config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent' }, { execute: { bin: FAKE, machineBin: FAKE, killGraceMs: 200, dailyBudgetUsd: 1000, ...execute } })
    const handlers = { ...createPipeline({ db: env.db, config, queue: env.queue, events: env.events, modules: env.modules }), execute: createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault, getProviders: env.modules.getProviders, progressUnitMs: UNIT_MS }) }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers, ...(logger ? { logger } : {}) })
    worker.start()
  }
  const waitJob = (id) => until(() => { const j = env.queue.getJob(id); return ['done', 'failed', 'cancelled'].includes(j.status) && j }, { timeoutMs: 20000 })
  const allNotesOf = (messageId) => env.db.prepare('SELECT * FROM progress_notes WHERE message_id = ? ORDER BY id').all(messageId)
  const eventOf = (n) => JSON.parse(n.data_json).event
  // The periodic notices only: the rows of the start and the wait (UD-303) are told apart by `data_json.event`.
  const notesOf = (messageId) => allNotesOf(messageId).filter((n) => eventOf(n) === undefined)

  /** Publishes a message to Claude. `interval` is the `progress_interval_min` of the template the message is written with. */
  async function publishedMessage (text, interval) {
    env.db.prepare('UPDATE templates SET progress_interval_min = ?').run(interval)
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
    env = await makeEnv({ modules: { analyze } })
    state = join(env.dir, 'fake-state')
    mkdirSync(state)
    process.env.FAKE_EXECUTE_STATE = state
    vault = createVault(loadMasterKey({ dataDir: env.dir }))
    await addMember(env, { email: 'ed@x.org', role: 'editor' })
    editor = await login(env, 'ed@x.org')
    const created = await env.app.inject({ method: 'POST', url: '/api/members', headers: cookieHeaders(editor), payload: { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Perfil del agente.' } })
    agentId = Number(created.json().id)
    await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    author = await login(env, 'ana@x.org')
  })
  beforeEach(async () => {
    await worker?.stop()
    process.env.FAKE_EXECUTE_MODE = 'ok'
    process.env.FAKE_EXECUTE_SLEEP_MS = String(SESSION_MS)
    process.env.FAKE_EXECUTE_GIT = '1'
    delete process.env.FAKE_EXECUTE_REPLY
    env.db.prepare('INSERT OR IGNORE INTO message_assignees (message_id, member_id) SELECT id, ? FROM messages ORDER BY id LIMIT 1').run(agentId)
  })
  after(async () => {
    delete process.env.FAKE_EXECUTE_GIT
    delete process.env.FAKE_EXECUTE_SLEEP_MS
    await worker?.stop()
    await env.close()
  })

  it('posts a notice every interval with what the session did, and none after it ends', async () => {
    startWorker()
    const messageId = await publishedMessage('La agenda queda en blanco.', 5) // 5 «minutes» = 200 ms
    const job = env.db.prepare("SELECT id FROM jobs WHERE kind = 'execute' AND message_id = ?").get(messageId)
    const done = await waitJob(job.id)
    assert.equal(done.status, 'done', done.last_error)

    const notes = notesOf(messageId)
    assert.ok(notes.length >= 3, `the session lasted ${SESSION_MS} ms and the interval is 200 ms: ${notes.length} notices`)
    for (let i = 1; i < notes.length; i++) assert.ok(notes[i].created_at - notes[i - 1].created_at >= 5 * UNIT_MS - 20, 'never more than one per interval (20 ms of timer tolerance)')
    assert.ok(notes.every((n) => n.author_id === agentId && n.job_id === job.id))
    const last = JSON.parse(notes.at(-1).data_json)
    assert.ok(last.minutes >= 5 * (notes.length - 1), `minutes elapsed grow with the clock: ${last.minutes}`)
    assert.equal(last.turns, 4, 'main turns counted by the stream: the subagent turn does not count')
    assert.equal(last.tools, 5, 'the five tool calls the fake session made')
    assert.deepEqual(last.pushed, { sha: 'a1b2c3d', subject: 'Arregla la agenda en blanco', branch: `tp/${messageId}` }, 'the commit that git said it pushed')
    assert.match(notes.at(-1).body, /\n.*Ahora: .*\n.*Último commit empujado: a1b2c3d Arregla la agenda en blanco$/s)
    assert.match(notes.at(-1).body, /^\d+ min · 4 turnos · 5 herramientas/)
    const minutes = notes.map((n) => JSON.parse(n.data_json).minutes)
    assert.deepEqual([...minutes].sort((a, b) => a - b), minutes, 'in order')

    // The session ended: its clock is stopped. Nothing is written after the job closes.
    const count = notesOf(messageId).length
    await new Promise((resolve) => setTimeout(resolve, 6 * 5 * UNIT_MS))
    assert.equal(notesOf(messageId).length, count)

    // A notice is not a reply: the thread has the answer of the system, one reply count and the notices apart.
    const thread = (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}`, headers: { cookie: author } })).json()
    assert.equal(thread.progress_notes.length, count + 1, 'the periodic notices and the row of the start (UD-303)')
    assert.equal(thread.progress_notes[0].body, 'Claude empezó a trabajar')
    assert.equal(thread.progress_notes[1].body, notes[0].body)
    assert.ok(thread.replies.every((r) => !r.body.includes('herramientas')))
    assert.equal(thread.reply_count, thread.replies.length)
  })

  it('posts «Claude empezó a trabajar» when the session starts, once, and not as a reply (UD-303)', async () => {
    startWorker()
    const messageId = await publishedMessage('La agenda queda en blanco otra vez.', 5)
    const job = env.db.prepare("SELECT id FROM jobs WHERE kind = 'execute' AND message_id = ?").get(messageId)
    await until(() => allNotesOf(messageId).some((n) => eventOf(n) === 'started'), { timeoutMs: 10000 })
    const started = allNotesOf(messageId).filter((n) => eventOf(n) === 'started')
    assert.equal(started.length, 1)
    assert.equal(started[0].body, 'Claude empezó a trabajar')
    assert.equal(started[0].author_id, agentId)
    assert.equal(started[0].job_id, job.id)
    assert.ok(env.queue.getJob(job.id).status === 'running', 'it is written while the session runs, before the answer')
    assert.equal(allNotesOf(messageId)[0].id, started[0].id, 'it is the first row of the thread of the job')
    assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM replies WHERE message_id = ? AND body LIKE '%empezó a trabajar%'").get(messageId).n, 0, 'a row of the thread, never a reply')
    await waitJob(job.id)
    assert.equal(allNotesOf(messageId).filter((n) => eventOf(n) === 'started').length, 1)
    const thread = (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}`, headers: { cookie: author } })).json()
    assert.ok(thread.progress_notes.some((n) => n.body === 'Claude empezó a trabajar'), 'the thread carries it')
  })

  it('a job held by the spending reserved by the running ones says «En espera: N trabajos delante» and why, once, and the log says the reason (UD-303)', async () => {
    const lines = []
    const logger = createLogger({ logLevel: 'info' }, {}, { write: (l) => lines.push(JSON.parse(l)) })
    env.db.prepare("UPDATE jobs SET cost_usd = NULL WHERE kind = 'execute'").run()
    startWorker({ execute: { dailyBudgetUsd: 10, maxBudgetUsd: 10, capacityWaitMs: 100 }, logger })
    const first = await publishedMessage('Primer mensaje que toma todo el gasto.', 5)
    const jobFirst = env.db.prepare("SELECT id FROM jobs WHERE kind = 'execute' AND message_id = ?").get(first)
    await until(() => allNotesOf(first).some((n) => eventOf(n) === 'started'), { timeoutMs: 10000 })
    const second = await publishedMessage('Segundo mensaje que espera.', 5)
    const jobSecond = env.db.prepare("SELECT id FROM jobs WHERE kind = 'execute' AND message_id = ?").get(second)
    await until(() => allNotesOf(second).some((n) => eventOf(n) === 'waiting'), { timeoutMs: 10000 })
    const waiting = allNotesOf(second).filter((n) => eventOf(n) === 'waiting')
    assert.equal(waiting.length, 1)
    assert.equal(waiting[0].body, 'En espera: 1 trabajo de Claude delante\nMotivo: las sesiones en curso tienen reservado el gasto que queda hoy.')
    assert.equal(JSON.parse(waiting[0].data_json).reason.code, 'budget_reserved')
    // The wait repeats every 100 ms: the row stays one, with the same text.
    await new Promise((resolve) => setTimeout(resolve, 450))
    assert.equal(allNotesOf(second).filter((n) => eventOf(n) === 'waiting').length, 1)
    // The log says what holds it: the text of the step and the cap as data, never «[object Object]».
    const deferred = lines.filter((l) => l.job_id === jobSecond.id && /^job deferred/.test(l.msg))
    assert.ok(deferred.length >= 2, 'it was deferred more than once')
    assert.equal(deferred[0].msg, 'job deferred: En espera: tope diario de gasto')
    assert.equal(deferred[0].defer_code, 'budgetWait')
    assert.equal(deferred[0].reason.code, 'budget_reserved')
    assert.equal(deferred[0].reason.sessions, 1)
    assert.ok(lines.every((l) => !String(l.msg).includes('[object Object]')))
    // When the first one ends, the second starts: the waiting row closes and the start is written.
    await waitJob(jobFirst.id)
    await until(() => allNotesOf(second).some((n) => eventOf(n) === 'started'), { timeoutMs: 20000 })
    const rows = allNotesOf(second).map((n) => [eventOf(n), n.body])
    assert.deepEqual(rows[0], ['waited', 'Estuvo en espera 1 min'])
    assert.deepEqual(rows[1], ['started', 'Claude empezó a trabajar'])
    await waitJob(jobSecond.id)
  })

  it('a template with 0 posts no notice', async () => {
    startWorker()
    const messageId = await publishedMessage('Otro mensaje sin avisos.', 0)
    const job = env.db.prepare("SELECT id FROM jobs WHERE kind = 'execute' AND message_id = ?").get(messageId)
    assert.equal((await waitJob(job.id)).status, 'done')
    assert.deepEqual(notesOf(messageId), [], 'no periodic notice; the row of the start is not one')
  })

  it('tells the open screens that the thread changed', async () => {
    startWorker()
    const messageId = await publishedMessage('Mensaje para ver el aviso en vivo.', 5)
    const job = env.db.prepare("SELECT id FROM jobs WHERE kind = 'execute' AND message_id = ?").get(messageId)
    await until(() => notesOf(messageId).length > 0, { timeoutMs: 10000 })
    const seen = env.db.prepare("SELECT data_json FROM job_events WHERE kind = 'message' AND member_id IS NULL ORDER BY seq DESC").all().map((r) => JSON.parse(r.data_json))
      .filter((c) => c.reason === 'changed' && c.message_id === String(messageId))
    assert.ok(seen.length > 0, 'a `changed` event for the message, as a reply written through the API publishes')
    assert.deepEqual(seen[0].roots, ['messages'])
    await waitJob(job.id)
  })
})

describe('what a notice says', () => {
  it('reads commits and pushes from what git printed, and counts each tool call once', () => {
    const reader = createStreamReader({ maxTurns: 60, onProgress () {} })
    const send = (e) => reader.push(`${JSON.stringify(e)}\n`)
    const call = (id, name, input) => send({ type: 'assistant', message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name, input }] } })
    const result = (id, content) => send({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } })
    call('t1', 'Bash', { command: 'git commit -m a' })
    send({ type: 'assistant', message: { id: 'm-t1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git commit -m a' } }] } }) // the same call repeated by the stream
    result('t1', '[tp/9 1111111] Primer commit\n 1 file changed')
    assert.equal(reader.state().tools, 1)
    assert.deepEqual(reader.state().lastCommit, { sha: '1111111', subject: 'Primer commit', branch: 'tp/9' })
    assert.equal(reader.state().pushed, null, 'a commit that was not pushed is not a pushed commit')
    call('t2', 'Bash', { command: 'git commit -m b' })
    result('t2', '[tp/9 2222222] Segundo commit')
    call('t3', 'Bash', { command: 'git push' })
    result('t3', 'To github.com:x/y.git\n   1111111..2222222  tp/9 -> tp/9')
    assert.deepEqual(reader.state().pushed, { sha: '2222222', subject: 'Segundo commit', branch: 'tp/9' })
    // The output of a call that is not Bash is never read, whatever it says.
    call('t4', 'Read', { file_path: '/x' })
    result('t4', '[tp/9 3333333] Esto no es un commit')
    assert.equal(reader.state().lastCommit.sha, '2222222')
    assert.equal(reader.state().tools, 4)
  })

  it('writes only the lines whose fact exists, in the language of the account', () => {
    const base = { minutes: 20, turns: 14, tools: 1, phrase: null, pushed: null, last_commit: null }
    assert.equal(noticeBody(base), '20 min · 14 turnos · 1 herramienta')
    assert.equal(noticeBody({ ...base, phrase: 'Orden: npm test' }, 'en'), '20 min · 14 turns · 1 tool\nNow: Orden: npm test')
    assert.match(noticeBody({ ...base, last_commit: { sha: 'abc1234', subject: null } }), /\nÚltimo commit sin empujar: abc1234$/)
    assert.match(noticeBody({ ...base, pushed: { sha: 'abc1234', subject: 'Asunto' }, last_commit: { sha: 'zzz', subject: 'x' } }), /\nÚltimo commit empujado: abc1234 Asunto$/)
  })
})

describe('what the waiting row says (UD-303)', () => {
  it('counts the jobs ahead, names the cap in one sentence and speaks the language of the account', () => {
    assert.equal(waitBody({ ahead: 4, reason: { code: 'capacity', quota_machines: 2 } }), 'En espera: 4 trabajos de Claude delante\nMotivo: la cuota de Google admite 2 máquinas y no queda espacio en ellas.')
    assert.equal(waitBody({ ahead: 1, reason: { code: 'capacity', quota_machines: 1 }, name: 'Deva' }), 'En espera: 1 trabajo de Deva delante\nMotivo: la cuota de Google admite 1 máquina y no queda espacio en ellas.')
    assert.equal(waitBody({ ahead: 0, reason: { code: 'capacity' } }), 'En espera: este trabajo es el siguiente\nMotivo: no hay una máquina de trabajo libre ahora.')
    assert.equal(waitBody({ ahead: 2, reason: { code: 'budget_reserved' } }, 'en'), 'Waiting: 2 jobs of Claude ahead\nReason: the running sessions hold the spending left today.')
    assert.equal(waitBody({ ahead: 2, reason: null }), 'En espera: 2 trabajos de Claude delante', 'a cap with no sentence leaves only the count')
  })
})
