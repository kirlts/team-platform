// The `execute` job (UD-254, UD-255, H-3724) end to end against a listening server and a fake `claude` that speaks
// stream-json: enqueued when a published message is assigned to an agent, the prompt with every piece, the NDJSON
// turned into progress, the `result` line with and without `structured_output`, the two replies in the thread, the
// trace with session and cost, and the machine runner that destroys its machine also on failure and on timeout.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig, otelPairs } from '../config.js'
import { updateMember } from '../domain/members.js'
import { createPipeline } from '../domain/pipeline.js'
import { setProjectDescription } from '../domain/settings.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { createExecuteHandler, dailyBudget, localDay } from './handler.js'
import { phraseForTool } from './stream.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
const PORT = 8641 // the range given to this work (8640 to 8649)

describe('execute job', () => {
  let env, state, worker, editor, author, agentId, agent, vault
  const cookieHeaders = (cookie) => ({ cookie, 'x-team-request': 'panel' })

  function startWorker (execute = {}) {
    const config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, {
      execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000, ...execute }
    })
    const handlers = { ...createPipeline({ db: env.db, config, queue: env.queue, events: env.events, modules: env.modules }), execute: createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault }) }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers })
    worker.start()
  }
  const calls = () => { try { return readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) } catch { return [] } }
  const waitJob = (id) => until(() => { const j = env.queue.getJob(id); return ['done', 'failed', 'cancelled'].includes(j.status) && j }, { timeoutMs: 20000 })
  const eventsOf = (jobId) => env.db.prepare('SELECT kind, percent, phrase, data_json, member_id FROM job_events WHERE job_id = ? ORDER BY seq').all(jobId)

  async function publishedMessage (text) {
    const res = await postInput(env, author, { text })
    const inputId = res.json().input_id
    await until(() => env.db.prepare('SELECT status FROM inputs WHERE id = ?').get(inputId).status === 'proposed', { timeoutMs: 10000 })
    const pub = await env.app.inject({ method: 'POST', url: `/api/inputs/${inputId}/publish`, headers: { ...cookieHeaders(author), 'content-type': 'application/json' }, payload: '{}' })
    assert.equal(pub.statusCode, 200, pub.body)
    return env.db.prepare('SELECT id FROM messages WHERE input_id = ?').get(inputId).id
  }

  before(async () => {
    // The analyzer assigns the member named Claude, reading the team as the real one does (pipeline.js bundle.members).
    const analyze = async (bundle, opts) => {
      const r = await fakeAnalyze(bundle, opts)
      r.proposal.messages[0].assignee_ids = bundle.members.filter((m) => m.name === 'Claude').map((m) => m.id)
      return r
    }
    env = await makeEnv({ telemetry: true, modules: { analyze } })
    state = join(env.dir, 'fake-state')
    mkdirSync(state)
    process.env.FAKE_EXECUTE_STATE = state
    vault = createVault(loadMasterKey({ dataDir: env.dir }))
    await addMember(env, { email: 'ed@x.org', role: 'editor' })
    editor = await login(env, 'ed@x.org')
    const created = await env.app.inject({ method: 'POST', url: '/api/members', headers: cookieHeaders(editor), payload: { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Perfil del agente: arreglo pantallas.' } })
    agent = created.json()
    agentId = Number(agent.id)
    const authorId = await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    updateMember(env.db, authorId, { profile: 'Perfil de Ana: llevo la agenda de la clínica.' })
    author = await login(env, 'ana@x.org')
    setProjectDescription(env.db, 'Descripción del proyecto: agenda de clínicas.')
    await env.app.listen({ host: '127.0.0.1', port: PORT })
  })
  beforeEach(async () => {
    await worker?.stop()
    rmSync(join(state, 'calls.jsonl'), { force: true })
    process.env.FAKE_EXECUTE_MODE = 'ok'
    process.env.FAKE_EXECUTE_REPLY = '1'
    delete process.env.FAKE_EXECUTE_EXTRA
    delete process.env.FAKE_EXECUTE_MULTI
  })
  after(async () => { await worker?.stop(); await env.close() })

  it('a message published to an agent enqueues execute; the session replies twice and the job closes with the summary', async () => {
    startWorker()
    const messageId = await publishedMessage('La pantalla de agenda queda en blanco al abrirla.')
    const job = env.db.prepare("SELECT * FROM jobs WHERE kind = 'execute' AND message_id = ?").get(messageId)
    assert.ok(job, 'execute job enqueued on publication')
    assert.deepEqual(JSON.parse(job.payload_json).member_id, agentId)
    assert.equal(job.max_attempts, 1)
    const done = await waitJob(job.id)
    assert.equal(done.status, 'done', done.last_error)

    const thread = (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}`, headers: { cookie: author } })).json()
    const mine = thread.replies.filter((r) => String(r.author_id) === String(agentId))
    assert.equal(mine.length, 2, 'two replies: on starting and on finishing')
    assert.match(mine[0].body, /^Recibido\. Empiezo por/)
    assert.match(mine[1].body, /^Arreglé la pantalla que quedaba en blanco\.\n\nYa carga con tus datos\.\n\n\*\*Resultado\*\*: done$/)
    assert.equal(thread.status, 'answered', 'the session does not close the message')

    const evs = eventsOf(job.id)
    const phrases = evs.filter((e) => e.kind === 'progress').map((e) => e.phrase)
    for (const p of ['Sesión iniciada', 'Lectura: screen.tsx', 'Orden: Pruebas de la pantalla', 'Revisión de la pantalla', 'Respondido']) assert.ok(phrases.includes(p), `${p} in ${phrases}`)
    assert.ok(evs.every((e) => e.member_id === null), 'progress of a message goes to the whole team')
    const percents = evs.filter((e) => e.kind === 'progress').map((e) => e.percent)
    assert.ok(percents.includes(3), 'two main turns of 60 → 3 %; the subagent turn does not count')
    const last = evs.at(-1)
    assert.equal(last.kind, 'done')
    assert.deepEqual({ ...JSON.parse(last.data_json), input_id: undefined }, { input_id: undefined, message_id: String(messageId), status: 'done', reply_id: String(mine[1].id), session_id: 'sess-0001', cost_usd: 1.2345 })

    const trace = (await env.app.inject({ method: 'GET', url: `/api/jobs/${job.id}/trace`, headers: { cookie: editor } })).json()
    const find = (nodes) => nodes.flatMap((n) => [n, ...find(n.children)])
    const span = find(trace.roots).find((n) => n.name === 'execute')
    assert.ok(span, 'execute span in the trace')
    assert.equal(span.attributes['team.session_id'], 'sess-0001')
    assert.equal(span.attributes['team.cost_usd'], 1.2345)
    assert.equal(span.attributes['gen_ai.usage.output_tokens'], 3100)
    assert.ok(trace.totals.cost_usd >= 1.2345, JSON.stringify(trace.totals))

    const queueRes = (await env.app.inject({ method: 'GET', url: '/api/jobs', headers: { cookie: editor } })).json()
    const row = queueRes.items.find((j) => j.id === String(job.id))
    assert.deepEqual([row.kind, row.message_id, row.member_id], ['execute', String(messageId), String(agentId)])
  })

  it('the invocation and the prompt carry every piece', async () => {
    const [call] = calls().length ? calls() : [null]
    const c = call ?? (startWorker(), await (async () => { const id = await publishedMessage('Otro mensaje.'); await waitJob(env.db.prepare("SELECT id FROM jobs WHERE message_id = ?").get(id).id); return calls()[0] })())
    const { args, stdin, team } = c
    const val = (flag) => args[args.indexOf(flag) + 1]
    assert.equal(args[0], '-p')
    assert.equal(val('--model'), 'claude-sonnet-5-5')
    assert.equal(val('--effort'), 'medium')
    assert.equal(val('--max-budget-usd'), '10')
    assert.equal(val('--max-turns'), '60')
    assert.equal(val('--permission-mode'), 'bypassPermissions')
    assert.equal(val('--output-format'), 'stream-json')
    assert.ok(args.includes('--verbose') && args.includes('--include-partial-messages'))
    // The template's declared output (A4 compileOutputSchema) plus `summary`, as the grammar of --json-schema.
    const schema = JSON.parse(val('--json-schema'))
    assert.ok(schema.required.includes('outcome') && schema.required.includes('summary'), JSON.stringify(schema.required))
    assert.deepEqual(schema.properties.outcome.enum, ['done', 'investigated', 'blocked', 'needs_decision'])
    assert.equal(schema.additionalProperties, false)
    for (const piece of ['Perfil del agente: arreglo pantallas.', 'Perfil de Ana: llevo la agenda de la clínica.', 'Descripción del proyecto: agenda de clínicas.', '## Método', 'up to 3 subagents', 'Parallelize', 'team reply', 'team progress [<job_id>]', 'tp/', 'Never push to `main`', 'Spanish (Latin America)']) {
      assert.ok(stdin.includes(piece), `prompt carries «${piece}»`)
    }
    assert.equal(team.TEAM_AGENT_EMAIL, 'claude@x.org')
    assert.equal(team.TEAM_AGENT_SECRET, agent.agent_secret)
    assert.equal(team.TEAM_URL, `http://127.0.0.1:${PORT}`)
  })

  it('EXECUTE_HOST_INSTRUCTIONS appends the host rules to the prompt; a missing file fails the job', async () => {
    const rules = join(env.dir, 'host-rules.md')
    writeFileSync(rules, 'Host rule: run npm test before you finish.\n')
    process.env.FAKE_EXECUTE_REPLY = '0'
    startWorker({ hostInstructions: rules })
    const messageId = env.db.prepare('SELECT id FROM messages ORDER BY id LIMIT 1').get().id
    const ok = await waitJob(Number((await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })).json().job_ids[0]))
    assert.equal(ok.status, 'done', ok.last_error)
    assert.match(calls().at(-1).stdin, /<host_instructions>\nHost rule: run npm test before you finish\.\n<\/host_instructions>/)
    await worker.stop()
    startWorker({ hostInstructions: join(env.dir, 'missing.md') })
    const id = Number((await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })).json().job_ids[0])
    const failed = await waitJob(id)
    assert.equal(failed.status, 'failed')
    assert.equal(JSON.parse(eventsOf(id).at(-1).data_json).error_code, 'host_instructions_missing')
  })

  describe('observability (UD-262)', () => {
    const find = (nodes) => nodes.flatMap((n) => [n, ...find(n.children)])
    let messageId, firstJob

    it('one trace joins the sending, the analysis, the publication and the execution, and the timing endpoint answers the figures', async () => {
      process.env.FAKE_EXECUTE_MULTI = '1'
      startWorker({ otelEnv: { CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_METRICS_EXPORTER: 'otlp' } })
      messageId = await publishedMessage('El botón de reservas no responde en el teléfono.')
      firstJob = env.db.prepare("SELECT * FROM jobs WHERE kind = 'execute' AND message_id = ?").get(messageId)
      const done = await waitJob(firstJob.id)
      assert.equal(done.status, 'done', done.last_error)
      const message = env.db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId)
      const input = env.db.prepare('SELECT * FROM inputs WHERE id = ?').get(message.input_id)
      const analyze = env.db.prepare("SELECT * FROM jobs WHERE kind = 'analyze' AND input_id = ?").get(input.id)
      assert.match(input.trace_id, /^[0-9a-f]{32}$/)
      assert.deepEqual([message.trace_id, firstJob.trace_id, analyze.trace_id], [input.trace_id, input.trace_id, input.trace_id], 'one trace id on the input, the analysis job, the message and the execute job')

      const timing = (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}/timing`, headers: { cookie: author } })).json()
      assert.equal(timing.trace_id, input.trace_id)
      const shown = (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}`, headers: { cookie: author } })).json()
      assert.equal(shown.trace_id, input.trace_id, 'the message exposes its trace id')

      // Spans of the same trace: send, analysis, publication, execution.
      const names = env.db.prepare('SELECT name, attributes_json FROM spans WHERE trace_id = ?').all(input.trace_id)
      const jobKinds = names.filter((r) => r.name === 'job').map((r) => JSON.parse(r.attributes_json)['team.job_kind'])
      for (const n of ['input.submit', 'message.publish', 'execute']) assert.ok(names.some((r) => r.name === n), `${n} in the trace`)
      assert.ok(jobKinds.includes('analyze') && jobKinds.includes('execute'), jobKinds.join())

      // Phases, tools and subagent with the right parents.
      assert.deepEqual(timing.phases.map((p) => p.name), ['run'])
      const run = find([timing.tree]).find((n) => n.name === 'execute.local.run')
      assert.ok(run, 'run phase span')
      const child = (node, name) => node.children.filter((c) => c.name === name)
      const tools = child(run, 'execute.tool')
      assert.deepEqual(tools.map((t) => t.attributes['gen_ai.tool.name']), ['Read', 'Bash'])
      assert.equal(tools[0].attributes['team.tool.success'], true)
      assert.equal(tools[1].attributes['team.tool.success'], false)
      assert.equal(tools[1].status, 'error')
      assert.ok(tools[1].duration_ms >= 35 && tools[1].duration_ms > tools[0].duration_ms, `Bash waited longer than Read (${tools[1].duration_ms} vs ${tools[0].duration_ms})`)
      const [sub] = child(run, 'execute.subagent')
      assert.equal(sub.attributes['gen_ai.agent.name'], 'reviewer')
      assert.deepEqual(child(sub, 'execute.tool').map((t) => t.attributes['gen_ai.tool.name']), ['Edit'], 'the subagent tool hangs from the subagent')
      assert.ok(sub.duration_ms >= child(sub, 'execute.tool')[0].duration_ms)
      assert.equal(timing.slowest[0].name, 'Bash')
      assert.deepEqual(timing.slowest.map((t) => t.kind).sort(), ['subagent', 'tool', 'tool', 'tool'])
      assert.equal(timing.turns.length, 4)
      assert.deepEqual([timing.turns[0].input_tokens, timing.turns[0].output_tokens, timing.turns[0].cache_read_tokens], [100 + 1000 + 50, 10, 1000])

      // Moments: first reply (the session's own) before the final one, both inside the total.
      assert.ok(timing.first_reply_ms !== null && timing.final_reply_ms !== null)
      assert.ok(timing.first_reply_ms <= timing.final_reply_ms && timing.final_reply_ms <= timing.total_ms, JSON.stringify([timing.first_reply_ms, timing.final_reply_ms, timing.total_ms]))
      assert.ok(timing.first_reply_since_message_ms >= timing.first_reply_ms)
      assert.ok(timing.queue_wait_ms !== null)

      // The session receives the context of the trace and the telemetry variables the host declared.
      const seen = calls()[0].otel
      assert.match(seen.TRACEPARENT, new RegExp(`^00-${input.trace_id}-[0-9a-f]{16}-01$`))
      assert.deepEqual([seen.CLAUDE_CODE_ENABLE_TELEMETRY, seen.OTEL_METRICS_EXPORTER], ['1', 'otlp'])
      assert.equal(env.queue.getJob(firstJob.id).phase, null, 'no phase once the job ends')
    })

    it('timing of a message that does not exist is a 404', async () => {
      const res = await env.app.inject({ method: 'GET', url: '/api/messages/999999/timing', headers: { cookie: author } })
      assert.equal(res.statusCode, 404)
    })

    it('a second execution links the span of the previous one', async () => {
      process.env.FAKE_EXECUTE_REPLY = '0'
      startWorker()
      const prev = env.db.prepare('SELECT last_span FROM jobs WHERE id = ?').get(firstJob.id).last_span
      assert.ok(prev, 'the first attempt stored its span context')
      const res = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })
      assert.equal(res.statusCode, 202, res.body)
      const second = Number(res.json().job_ids[0])
      assert.equal((await waitJob(second)).status, 'done')
      assert.equal(env.db.prepare('SELECT link_traceparent FROM jobs WHERE id = ?').get(second).link_traceparent, prev)
      await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}/timing`, headers: { cookie: author } }) // flushes
      const row = env.db.prepare("SELECT links_json FROM spans WHERE name = 'job' AND job_id = ?").get(String(second))
      const links = JSON.parse(row.links_json)
      assert.ok(links.some((l) => l.span_id === prev.split('-')[2] && l.attributes['team.link'] === 'previous_job'), row.links_json)
    })

    it('EXECUTE_OTEL_ENV accepts KEY=VALUE pairs and refuses the rest', () => {
      assert.deepEqual(otelPairs('CLAUDE_CODE_ENABLE_TELEMETRY=1\nOTEL_EXPORTER_OTLP_ENDPOINT=http://c:4318 OTEL_X=a=b'), { CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318', OTEL_X: 'a=b' })
      assert.deepEqual(otelPairs(''), {})
      for (const bad of ['sin_igual', 'TEAM_AGENT_SECRET=x', 'TRACEPARENT=00-x', 'minuscula=1']) assert.throws(() => otelPairs(bad), /EXECUTE_OTEL_ENV/)
    })
  })

  it('an editor enqueues it by hand; a second while one is queued is refused', async () => {
    const messageId = env.db.prepare('SELECT id FROM messages ORDER BY id LIMIT 1').get().id
    const first = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })
    assert.equal(first.statusCode, 202, first.body)
    const again = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })
    assert.equal(again.json().code, 'execute_busy')
    const byMember = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(author) })
    assert.equal(byMember.statusCode, 403)
    process.env.FAKE_EXECUTE_REPLY = '0'
    startWorker()
    assert.equal((await waitJob(Number(first.json().job_ids[0]))).status, 'done')
  })

  for (const [mode, code, reason] of [['no-structured', 'invalid_output', /sin salida estructurada/], ['error', 'execute_error', /error_max_budget_usd/], ['exit', 'execute_no_result', /código 3/]]) {
    it(`a result ${mode === 'no-structured' ? 'without structured_output' : `in mode ${mode}`} fails the job with the reason`, async () => {
      process.env.FAKE_EXECUTE_MODE = mode
      process.env.FAKE_EXECUTE_REPLY = '0'
      startWorker()
      const messageId = env.db.prepare('SELECT id FROM messages ORDER BY id LIMIT 1').get().id
      const id = Number((await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })).json().job_ids[0])
      const job = await waitJob(id)
      assert.equal(job.status, 'failed')
      assert.match(job.last_error, reason)
      const done = eventsOf(id).at(-1)
      assert.equal(JSON.parse(done.data_json).error_code, code)
    })
  }

  it('a failed job leaves the author a closing reply in plain words, never the internal code', async () => {
    process.env.FAKE_EXECUTE_MODE = 'exit'
    process.env.FAKE_EXECUTE_REPLY = '0'
    startWorker()
    const messageId = env.db.prepare('SELECT id FROM messages ORDER BY id LIMIT 1').get().id
    const id = Number((await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })).json().job_ids[0])
    assert.equal((await waitJob(id)).status, 'failed')
    const replies = env.db.prepare('SELECT body, author_id FROM replies WHERE message_id = ? ORDER BY id').all(messageId)
    const last = replies.at(-1)
    assert.equal(String(last.author_id), String(agentId))
    assert.match(last.body, /No pude terminar este trabajo por un problema del sistema\./)
    assert.match(last.body, /todavía no está en producción/)
    assert.match(last.body, /\*\*Resultado\*\*: blocked$/)
    assert.doesNotMatch(last.body, /execute_no_result|código 3/, 'the internal reason stays in the job, not in the reply')
  })

  it('the progress endpoint belongs to the agent of the job', async () => {
    const id = env.db.prepare("SELECT id FROM jobs WHERE kind = 'execute' ORDER BY id LIMIT 1").get().id
    const res = await env.app.inject({ method: 'POST', url: `/api/jobs/${id}/progress`, headers: cookieHeaders(author), payload: { percent: 10, phrase: 'x' } })
    assert.equal(res.json().code, 'not_job_agent')
  })

  describe('daily spend cap', () => {
    // Every earlier job of this file ran today; the cap tests start from a clean day.
    beforeEach(() => { env.db.prepare("UPDATE jobs SET cost_usd = NULL, runner = NULL WHERE kind = 'execute'").run() })
    const spend = (cost, runner = 'local', at = Date.now()) => env.db.prepare("INSERT INTO jobs (kind, payload_json, status, run_at, created_at, finished_at, cost_usd, runner) VALUES ('execute', '{}', 'done', ?, ?, ?, ?, ?)").run(at, at, at, cost, runner)
    const jobOf = (messageId) => env.db.prepare("SELECT * FROM jobs WHERE kind = 'execute' AND message_id = ?").get(messageId)

    it('cap reached defers the job to the next day without calling claude', async () => {
      spend(9.5)
      spend(0.5)
      startWorker({ dailyBudgetUsd: 10 })
      const messageId = await publishedMessage('Tope alcanzado.')
      const job = await until(() => { const j = jobOf(messageId); return j && j.status === 'queued' && j.run_at > Date.now() + 1000 && j }, { timeoutMs: 10000 })
      assert.equal(job.attempts, 0, 'the deferral does not spend the attempt')
      assert.equal(job.runner, null)
      assert.equal(calls().length, 0, 'claude is not called')
      const next = new Date(); next.setHours(24, 0, 0, 0)
      assert.ok(Math.abs(job.run_at - next.getTime()) < 5000, `run_at ${new Date(job.run_at).toISOString()} is the next local midnight`)
      assert.ok(eventsOf(job.id).some((e) => e.kind === 'progress' && e.phrase === 'En espera: tope diario de gasto'))
      env.queue.cancel(job.id)
    })

    it('partial remainder lowers --max-budget-usd and the job keeps its cost', async () => {
      spend(6.5)
      startWorker({ dailyBudgetUsd: 10 })
      const messageId = await publishedMessage('Saldo parcial.')
      const done = await waitJob(jobOf(messageId).id)
      assert.equal(done.status, 'done', done.last_error)
      const args = calls().at(-1).args
      assert.equal(args[args.indexOf('--max-budget-usd') + 1], '3.5')
      assert.deepEqual([done.cost_usd, done.runner], [1.2345, 'local'])
    })

    it('machine cost counts for each machine job', async () => {
      spend(1, 'machine')
      spend(1, 'machine')
      startWorker({ dailyBudgetUsd: 10, machineCostUsd: 0.07 })
      const messageId = await publishedMessage('Costo de máquina.')
      await waitJob(jobOf(messageId).id)
      const args = calls().at(-1).args
      assert.equal(args[args.indexOf('--max-budget-usd') + 1], '7.86', '10 - 2 - 2 × 0.07')
    })

    it('a new day frees the cap', () => {
      const t = Date.now()
      spend(10, 'local', localDay(t).start - 1)
      const x = { dailyBudgetUsd: 10, machineCostUsd: 0.07 }
      assert.equal(dailyBudget(env.db, x, t).remaining, 10, 'yesterday does not count today')
      spend(10, 'local', localDay(t).start)
      assert.equal(dailyBudget(env.db, x, t).remaining, 0)
      assert.equal(dailyBudget(env.db, x, localDay(t).next).remaining, 10, 'the next day starts at zero')
    })
  })

  describe('machine runner', () => {
    let log
    const machine = (extra = {}) => ({
      runner: 'machine',
      machineCreate: `echo create {job_id} >> ${log}; echo vm-{job_id}`,
      machineRun: `echo run {machine} >> ${log}; bash {workdir}/run.sh`,
      machineDestroy: `echo destroy {machine} >> ${log}`,
      ...extra
    })
    const lines = () => readFileSync(log, 'utf8').trim().split('\n')
    const enqueue = async () => {
      const messageId = env.db.prepare('SELECT id FROM messages ORDER BY id LIMIT 1').get().id
      return Number((await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })).json().job_ids[0])
    }
    beforeEach(() => { log = join(env.dir, `machine-${Date.now()}.log`); writeFileSync(log, '') })

    it('creates the machine, runs the session inside and destroys it', async () => {
      startWorker(machine())
      const id = await enqueue()
      const job = await waitJob(id)
      assert.equal(job.status, 'done', job.last_error)
      assert.deepEqual(lines(), [`create ${id}`, `run vm-${id}`, `destroy vm-${id}`])
      assert.equal(calls().at(-1).team.TEAM_AGENT_EMAIL, 'claude@x.org', 'env.sh carries the agent credential into the machine')
      // UD-262: one span per phase, create before run before destroy, all under `execute`; the context travels in env.sh.
      const messageId = env.db.prepare('SELECT id FROM messages ORDER BY id LIMIT 1').get().id
      const timing = (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}/timing`, headers: { cookie: editor } })).json()
      assert.deepEqual(timing.phases.map((p) => p.name), ['create', 'run', 'destroy'])
      const offsets = timing.phases.map((p) => p.offset_ms)
      assert.deepEqual([...offsets].sort((a, b) => a - b), offsets, 'create, run and destroy follow one another')
      assert.match(calls().at(-1).otel.TRACEPARENT, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    })

    it('destroys it when the session fails', async () => {
      process.env.FAKE_EXECUTE_MODE = 'exit'
      startWorker(machine())
      const id = await enqueue()
      assert.equal((await waitJob(id)).status, 'failed')
      assert.deepEqual(lines(), [`create ${id}`, `run vm-${id}`, `destroy vm-${id}`])
    })

    it('destroys it when creating it fails half way', async () => {
      startWorker(machine({ machineCreate: `echo create {job_id} >> ${log}; echo vm-{job_id}; exit 1` }))
      const id = await enqueue()
      const job = await waitJob(id)
      assert.equal(job.status, 'failed')
      assert.match(job.last_error, /crea la máquina/)
      assert.deepEqual(lines(), [`create ${id}`, `destroy vm-${id}`])
    })

    it('destroys it when the session runs out of time', async () => {
      process.env.FAKE_EXECUTE_MODE = 'hang'
      startWorker(machine({ timeoutMs: 1500 }))
      const id = await enqueue()
      const job = await waitJob(id)
      assert.equal(job.status, 'failed')
      assert.match(job.last_error, /tiempo máximo/)
      assert.deepEqual(lines(), [`create ${id}`, `run vm-${id}`, `destroy vm-${id}`])
      const messageId = JSON.parse(job.payload_json).message_id
      const last = env.db.prepare('SELECT body FROM replies WHERE message_id = ? ORDER BY id DESC LIMIT 1').get(messageId)
      assert.match(last.body, /No alcancé a terminar dentro del tiempo máximo \(1 min\)/)
    })
  })

  it('the local runner works on a worktree of EXECUTE_REPO_DIR on the branch tp/<message_id> and leaves the branch', async () => {
    const repo = join(env.dir, 'host-repo')
    mkdirSync(repo)
    const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    git('-c', 'user.email=t@x.org', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
    process.env.FAKE_EXECUTE_REPLY = '0'
    startWorker({ repoDir: repo })
    const messageId = env.db.prepare('SELECT id FROM messages ORDER BY id LIMIT 1').get().id
    const id = Number((await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })).json().job_ids[0])
    assert.equal((await waitJob(id)).status, 'done')
    assert.match(calls().at(-1).cwd, /\/repo$/)
    assert.match(git('branch', '--list', `tp/${messageId}`), new RegExp(`tp/${messageId}`))
    assert.equal(git('worktree', 'list').trim().split('\n').length, 1, 'the worktree is removed')
  })

  it('tool calls become short phrases', () => {
    assert.equal(phraseForTool('Edit', { file_path: '/a/b/c.ts' }), 'Edición: c.ts')
    assert.equal(phraseForTool('Agent', { description: 'Revisar estilos' }), 'Subagente: Revisar estilos')
    assert.equal(phraseForTool('Grep', { pattern: 'foo' }), 'Búsqueda: foo')
  })
})
