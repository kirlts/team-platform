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
import { createLogger } from '../log.js'
import { createPipeline } from '../domain/pipeline.js'
import { setProjectDescription } from '../domain/settings.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { runTeam } from '../../scripts/team.mjs'
import { listExecuteRuns, pruneExecuteRuns } from '../telemetry/execute-runs.js'
import { createExecuteHandler, dailyBudget, localDay, otelSessionEnv, stderrTail } from './handler.js'
import { phraseForTool, toolParts } from './stream.js'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-stream.mjs', import.meta.url))
let PORT = 0 // ephemeral, set after listen: a fixed port made a second run of the same file cancel itself with EADDRINUSE (2026-10-26)

describe('execute job', () => {
  let env, state, worker, editor, author, agentId, agent, vault
  const cookieHeaders = (cookie) => ({ cookie, 'x-team-request': 'panel' })

  function startWorker (execute = {}, extraEnv = {}, logger = undefined) {
    const config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT), ...extraEnv }, {
      execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000, infraRetryWaitMs: 50, ...execute }
    })
    const handlers = { ...createPipeline({ db: env.db, config, queue: env.queue, events: env.events, modules: env.modules }), execute: createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault, getProviders: env.modules.getProviders }) }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers, ...(logger ? { logger } : {}) })
    worker.start()
  }
  // The id of the first message; a job that fails hands the message to a person (UD-269), so asking for it gives it back to Claude, as `beforeEach` does between tests.
  const messageId0 = () => { env.db.prepare('INSERT OR IGNORE INTO message_assignees (message_id, member_id) SELECT id, ? FROM messages ORDER BY id LIMIT 1').run(agentId); return env.db.prepare('SELECT id FROM messages ORDER BY id LIMIT 1').get().id }
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
    await env.app.listen({ host: '127.0.0.1', port: 0 }); PORT = env.app.server.address().port
  })
  beforeEach(async () => {
    await worker?.stop()
    rmSync(join(state, 'calls.jsonl'), { force: true })
    process.env.FAKE_EXECUTE_MODE = 'ok'
    process.env.FAKE_EXECUTE_REPLY = '1'
    delete process.env.FAKE_EXECUTE_EXTRA
    delete process.env.FAKE_EXECUTE_STDERR_NOISE
    delete process.env.FAKE_EXECUTE_CAPTURE_FILES
    delete process.env.FAKE_EXECUTE_START_CAPTURES
    delete process.env.FAKE_EXECUTE_START_ZONE
    delete process.env.FAKE_EXECUTE_MULTI
    delete process.env.FAKE_EXECUTE_MARKS
    // A job that fails ends with a person holding the message and not Claude (UD-269): the tests that chain on the first message get it back for Claude.
    env.db.prepare('INSERT OR IGNORE INTO message_assignees (message_id, member_id) SELECT id, ? FROM messages ORDER BY id LIMIT 1').run(agentId)
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
    assert.match(mine[1].body, /^Arreglé la pantalla que quedaba en blanco\.\n\nYa carga con tus datos\.$/)
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
    assert.deepEqual(schema.properties.outcome.enum, ['done', 'investigated', 'blocked', 'needs_decision', 'not_mine'])
    assert.equal(schema.additionalProperties, false)
    for (const piece of ['Perfil del agente: arreglo pantallas.', 'Perfil de Ana: llevo la agenda de la clínica.', 'Descripción del proyecto: agenda de clínicas.', '## Método', 'up to 3 subagents', 'Parallelize', 'team reply', 'team progress [<job_id>]', 'tp/', 'Never push to `main`', 'Spanish (Latin America)']) {
      assert.ok(stdin.includes(piece), `prompt carries «${piece}»`)
    }
    assert.equal(team.TEAM_AGENT_EMAIL, 'claude@x.org')
    assert.equal(team.TEAM_AGENT_SECRET, agent.agent_secret)
    assert.equal(team.TEAM_URL, `http://127.0.0.1:${PORT}`)
  })

  it('with EXECUTE_STABLE_AS_SYSTEM the job runs: the system file is written after the job directory exists', async () => {
    startWorker({ stableAsSystem: true })
    const messageId = await publishedMessage('La pantalla de sedes mezcla tamaños de letra.')
    const job = env.db.prepare("SELECT * FROM jobs WHERE kind = 'execute' AND message_id = ?").get(messageId)
    const done = await waitJob(job.id)
    assert.equal(done.status, 'done', done.last_error)
    assert.ok(calls()[0].args.includes('--append-system-prompt-file'), 'the stable part travels as a system prompt file')
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

  it('EXECUTE_GUARDS_FILE declares the hooks of the host in the session, the hooks answer from the job directory, and an invalid file fails the job with its reason', async () => {
    const file = join(env.dir, 'guards.json')
    writeFileSync(file, JSON.stringify({
      commands: { builtin: ['protected-push'], protected_branches: ['trunk'], rules: [{ match: 'deploy-now\\.sh', message: 'The system deploys, not the session.' }] },
      tools: { deny_background: [{ tools: ['Agent'], message: 'Foreground only.' }] },
      close: { clean_tree: true, pushed_branch: true, base: 'origin/trunk' }
    }))
    const bash = (command) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } })
    process.env.FAKE_EXECUTE_REPLY = '0'
    process.env.FAKE_EXECUTE_GUARDS = '1'
    process.env.FAKE_EXECUTE_GUARD_EVENTS = JSON.stringify([bash('git push origin trunk'), bash('bash deploy-now.sh'), bash('git push -u origin HEAD'), { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { run_in_background: true } }, { hook_event_name: 'Stop', stop_hook_active: false }])
    try {
      startWorker({ guardsFile: file })
      const messageId = env.db.prepare('SELECT id FROM messages ORDER BY id LIMIT 1').get().id
      const ok = await waitJob(Number((await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })).json().job_ids[0]))
      assert.equal(ok.status, 'done', ok.last_error)
      const [session] = readFileSync(join(state, 'guards.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
      assert.deepEqual(session.declared.PreToolUse.map((g) => [g.matcher, g.hooks[0].command]), [['Bash', 'team hook commands'], ['Agent', 'team hook tools']])
      assert.deepEqual(session.declared.Stop.map((g) => g.hooks[0].command), ['team hook close'])
      assert.match(session.guardsFile, /execute-\d+-[^/]+\/guards\.json$/, 'the session reads the copy that lives in the job directory')
      const answer = (i) => ({ command: session.answers[i].command, code: session.answers[i].code, out: session.answers[i].stdout.trim() ? JSON.parse(session.answers[i].stdout) : null })
      assert.deepEqual(session.answers.map((a) => [a.command, a.code]), [['team hook commands', 0], ['team hook commands', 0], ['team hook commands', 0], ['team hook tools', 0], ['team hook close', 0]])
      assert.match(answer(0).out.hookSpecificOutput.permissionDecisionReason, /Pushing to trunk is not allowed/)
      assert.equal(answer(1).out.hookSpecificOutput.permissionDecisionReason, 'The system deploys, not the session.')
      assert.equal(answer(2).out, null, 'the branch of the job goes through')
      assert.equal(answer(3).out.hookSpecificOutput.permissionDecisionReason, 'Foreground only.')
      assert.equal(answer(4).out, null, 'the closing check has no base to count from in this directory and lets the session end')
    } finally { delete process.env.FAKE_EXECUTE_GUARDS; delete process.env.FAKE_EXECUTE_GUARD_EVENTS }
    await worker.stop()
    for (const [text, why] of [['{"comands":{}}', /does not know «comands»/], ['{', /not JSON/]]) {
      writeFileSync(file, text)
      startWorker({ guardsFile: file })
      const id = Number((await env.app.inject({ method: 'POST', url: `/api/messages/${messageId0()}/execute`, headers: cookieHeaders(editor) })).json().job_ids[0])
      const failed = await waitJob(id)
      assert.equal(failed.status, 'failed')
      assert.equal(JSON.parse(eventsOf(id).at(-1).data_json).error_code, 'guards_file_invalid')
      assert.match(failed.last_error, why)
      await worker.stop()
    }
    startWorker({ guardsFile: join(env.dir, 'missing-guards.json') })
    const missing = await waitJob(Number((await env.app.inject({ method: 'POST', url: `/api/messages/${messageId0()}/execute`, headers: cookieHeaders(editor) })).json().job_ids[0]))
    assert.equal(missing.status, 'failed')
    assert.match(missing.last_error, /EXECUTE_GUARDS_FILE .*ENOENT/)
  })

  it('the machine script points the session at the copy of the guards file', async () => {
    const dir = join(env.dir, 'machine-files')
    mkdirSync(dir)
    const { writeMachineFiles } = await import('./runners.js')
    await writeMachineFiles({ workdir: dir, args: ['-p'], prompt: 'p', env: {}, claudeBin: 'claude' })
    assert.match(readFileSync(join(dir, 'run.sh'), 'utf8'), /\[ -f "\$JOB_DIR\/guards\.json" \] && export TEAM_GUARDS_FILE="\$JOB_DIR\/guards\.json" \|\| true/)
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
      assert.deepEqual([timing.delivers, timing.machine], [false, false], 'no delivery command and the local runner: the panel shows only the session (B7)')
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
      // The class and the detail travel without a language, so the panel writes the phrase in the language of the account; the slowest list of the timing carries them too.
      assert.deepEqual(tools.map((t) => t.attributes['team.tool.action']), ['read', 'command'])
      assert.ok(tools.every((t) => typeof t.attributes['team.tool.detail'] === 'string'))
      assert.ok(timing.slowest.filter((r) => r.kind === 'tool').every((r) => r.action && typeof r.detail === 'string'), JSON.stringify(timing.slowest))
      // The span lasts from the line that opens the tool to the line that closes it, as the worker reads them: on a stalled worker both arrive together and last ~0 ms. No test can bound that from below or compare two tools; only that it is measured.
      assert.ok(tools.every((t) => Number.isFinite(t.duration_ms) && t.duration_ms >= 0), 'every tool span has a duration')
      const [sub] = child(run, 'execute.subagent')
      assert.equal(sub.attributes['gen_ai.agent.name'], 'reviewer')
      assert.deepEqual(child(sub, 'execute.tool').map((t) => t.attributes['gen_ai.tool.name']), ['Edit'], 'the subagent tool hangs from the subagent')
      assert.ok(sub.duration_ms >= child(sub, 'execute.tool')[0].duration_ms)
      // The order of the slowest follows measured durations, which move under load: it is sorted from the slowest, and Bash (which waited) is among them.
      assert.deepEqual(timing.slowest.map((t) => t.duration_ms), timing.slowest.map((t) => t.duration_ms).sort((a, b) => b - a))
      assert.ok(timing.slowest.some((t) => t.name === 'Bash'))
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

  it('a person enqueues it by hand; a second while one is queued is refused', async () => {
    const messageId = env.db.prepare('SELECT id FROM messages ORDER BY id LIMIT 1').get().id
    const first = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })
    assert.equal(first.statusCode, 202, first.body)
    const again = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })
    assert.equal(again.json().code, 'execute_busy')
    const byMember = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(author) })
    assert.equal(byMember.statusCode, 409) // a member reaches it too (UD-287): the answer is the busy one
    assert.equal(byMember.json().code, 'execute_busy')
    process.env.FAKE_EXECUTE_REPLY = '0'
    startWorker()
    assert.equal((await waitJob(Number(first.json().job_ids[0]))).status, 'done')
  })

  for (const [mode, code, reason] of [['no-structured', 'invalid_output', /sin salida estructurada/], ['error', 'execute_budget', /error_max_budget_usd/], ['exit', 'execute_no_result', /código 3/]]) {
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

  it('the detail of a session that dies keeps the END of its stderr, where the cause is, and not the ssh and useradd noise at its start', async () => {
    process.env.FAKE_EXECUTE_MODE = 'exit'
    process.env.FAKE_EXECUTE_STDERR_NOISE = '1'
    process.env.FAKE_EXECUTE_REPLY = '0'
    try {
      startWorker()
      const messageId = env.db.prepare('SELECT id FROM messages ORDER BY id LIMIT 1').get().id
      const id = Number((await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })).json().job_ids[0])
      const job = await waitJob(id)
      assert.equal(job.status, 'failed')
      assert.match(job.last_error, /useradd: warning: the home directory already exists\.\nsession not started$/)
      assert.ok(job.last_error.split('WARNING: To increase').length - 1 < 12, 'the noise at the start is cut, not the cause')
    } finally { delete process.env.FAKE_EXECUTE_STDERR_NOISE }
  })

  it('stderrTail keeps the last non-empty lines, and the end of a single line that is too long', () => {
    assert.equal(stderrTail('a\n\nb\n  \nc\n'), 'a\nb\nc')
    assert.equal(stderrTail('x'.repeat(100) + '\n' + 'y'.repeat(100), 150), 'y'.repeat(100))
    assert.equal(stderrTail(`${'z'.repeat(50)}CAUSE`, 20), `${'z'.repeat(15)}CAUSE`)
    assert.equal(stderrTail('   \n'), '')
    assert.equal(stderrTail(undefined), '')
  })

  it('a failed job leaves the author a closing reply in plain words, never the internal code, and a person holds the message', async () => {
    process.env.FAKE_EXECUTE_MODE = 'exit'
    process.env.FAKE_EXECUTE_REPLY = '0'
    startWorker()
    const messageId = env.db.prepare('SELECT id FROM messages ORDER BY id LIMIT 1').get().id
    const id = Number((await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })).json().job_ids[0])
    const job = await waitJob(id)
    assert.deepEqual([job.status, job.attempts], ['failed', 2], 'an infrastructure failure is tried once more')
    const replies = env.db.prepare('SELECT body, author_id, kind FROM replies WHERE message_id = ? ORDER BY id').all(messageId)
    const last = replies.at(-1)
    assert.equal(String(last.author_id), String(agentId))
    assert.equal(last.kind, 'clarification', 'a question to the person who decides, not an answer')
    assert.match(last.body, /No pude terminar este trabajo por un problema del sistema/)
    assert.match(last.body, /Todavía no está en producción/)
    assert.doesNotMatch(last.body, /\*\*Resultado\*\*/)
    assert.match(last.body, /desde la ficha\.$/)
    assert.doesNotMatch(last.body, /execute_no_result|código 3/, 'the internal reason stays in the job, not in the reply')
    assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM message_assignees a JOIN members p ON p.id = a.member_id WHERE a.message_id = ? AND p.kind = 'person'").get(messageId).n, 1, 'a person has it')
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
      // Each attempt creates and destroys its own machine: a session that dies with no result is tried once more (infrastructure).
      assert.deepEqual(lines(), [`create ${id}`, `run vm-${id}`, `destroy vm-${id}`, `create ${id}`, `run vm-${id}`, `destroy vm-${id}`])
    })

    it('destroys it when creating it fails half way', async () => {
      startWorker(machine({ machineCreate: `echo create {job_id} >> ${log}; echo vm-{job_id}; exit 1` }))
      const id = await enqueue()
      const job = await waitJob(id)
      assert.equal(job.status, 'failed')
      assert.match(job.last_error, /crea la máquina/)
      assert.deepEqual(lines(), [`create ${id}`, `destroy vm-${id}`, `create ${id}`, `destroy vm-${id}`], 'a machine that was not created is tried once more, and each try is destroyed')
    })

    it('EXECUTE_MACHINE_COLLECT copies the transcript after the session and before destroying the machine; its last line goes to the row', async () => {
      const kept = join(env.dir, 'kept')
      startWorker(machine({ machineCollect: `echo collect {machine} >> ${log}; mkdir -p ${kept} && cp ${state}/projects/-job/sess-0001.jsonl ${kept}/{job_id}.jsonl && echo copied && echo ${kept}/{job_id}.jsonl` }))
      const id = await enqueue()
      assert.equal((await waitJob(id)).status, 'done')
      assert.deepEqual(lines(), [`create ${id}`, `run vm-${id}`, `collect vm-${id}`, `destroy vm-${id}`])
      const r = env.db.prepare('SELECT * FROM execute_runs WHERE job_id = ?').get(id)
      assert.equal(r.transcript_ref, `${kept}/${id}.jsonl`)
      assert.equal(r.machine, `vm-${id}`)
      assert.equal(typeof r.create_ms, 'number')
      assert.equal(typeof r.destroy_ms, 'number')
      assert.match(readFileSync(r.transcript_ref, 'utf8'), /sess-0001/)
    })

    it('a collector that fails does not fail the job or skip the destruction, and the run keeps no reference', async () => {
      startWorker(machine({ machineCollect: `echo collect {machine} >> ${log}; echo lost-it; exit 4` }))
      const id = await enqueue()
      assert.equal((await waitJob(id)).status, 'done')
      assert.deepEqual(lines(), [`create ${id}`, `run vm-${id}`, `collect vm-${id}`, `destroy vm-${id}`])
      assert.equal(env.db.prepare('SELECT transcript_ref FROM execute_runs WHERE job_id = ?').get(id).transcript_ref, null)
    })

    it('a collector that fails leaves its cause in the row, and one that succeeds leaves none (measured: job 144 had a null ref and no why)', async () => {
      startWorker(machine({ machineCollect: `echo no jsonl >&2; exit 3` }))
      const id = await enqueue()
      assert.equal((await waitJob(id)).status, 'done')
      assert.equal(env.db.prepare('SELECT transcript_error FROM execute_runs WHERE job_id = ?').get(id).transcript_error, 'exit 3: no jsonl')
    })

    it('the collector also runs when the session fails, so the transcript of a failure survives', async () => {
      process.env.FAKE_EXECUTE_MODE = 'exit'
      const kept = join(env.dir, 'kept-failed')
      startWorker(machine({ machineCollect: `mkdir -p ${kept} && cp ${state}/projects/-job/sess-0001.jsonl ${kept}/{job_id}.jsonl && echo ${kept}/{job_id}.jsonl` }))
      const id = await enqueue()
      assert.equal((await waitJob(id)).status, 'failed')
      assert.equal(env.db.prepare('SELECT transcript_ref FROM execute_runs WHERE job_id = ?').get(id).transcript_ref, `${kept}/${id}.jsonl`)
    })

    it('there is no collection when the machine was never created', async () => {
      startWorker(machine({ machineCreate: `echo create {job_id} >> ${log}; echo vm-{job_id}; exit 1`, machineCollect: `echo collect >> ${log}` }))
      const id = await enqueue()
      assert.equal((await waitJob(id)).status, 'failed')
      assert.deepEqual(lines(), [`create ${id}`, `destroy vm-${id}`, `create ${id}`, `destroy vm-${id}`])
    })

    it('waits and tries again when the host has no capacity now (create exits 75)', async () => {
      const flag = join(env.dir, `capacity-${Date.now()}`)
      startWorker(machine({ machineCreate: `if [ -e ${flag} ]; then echo create {job_id} >> ${log}; echo vm-{job_id}; else touch ${flag}; exit 75; fi`, capacityWaitMs: 300 }))
      const id = await enqueue()
      const job = await waitJob(id)
      assert.equal(job.status, 'done', job.last_error)
      assert.deepEqual(lines().slice(-3), [`create ${id}`, `run vm-${id}`, `destroy vm-${id}`])
      assert.equal(env.db.prepare('SELECT attempts FROM jobs WHERE id = ?').get(id).attempts, 1, 'the wait does not spend the attempt')
      const phrases = eventsOf(id).filter((e) => e.kind === 'progress').map((e) => e.phrase)
      assert.ok(phrases.includes('En espera: máquina disponible'), `${phrases}`)
    })

    it('no count of machines holds the second job: both sessions run at once (UD-304)', async () => {
      process.env.FAKE_EXECUTE_REPLY = '0'
      startWorker(machine({ machineRun: `echo run {machine} >> ${log}; sleep 2; bash {workdir}/run.sh` }))
      const first = await publishedMessage('Primer arreglo para la máquina.')
      const second = await publishedMessage('Segundo arreglo para la máquina.')
      const ids = [first, second].map((m) => env.db.prepare("SELECT id FROM jobs WHERE kind = 'execute' AND message_id = ?").get(m).id)
      const done = await Promise.all(ids.map((i) => waitJob(i)))
      assert.deepEqual(done.map((j) => j.status), ['done', 'done'])
      const order = lines().filter((l) => /^(create \d+|destroy vm-\d+)$/.test(l)).map((l) => l.split(' ')[0])
      assert.deepEqual(order.slice(0, 2), ['create', 'create'], 'the second machine is created while the first session still runs')
      for (const id of ids) assert.ok(!eventsOf(id).some((e) => e.kind === 'progress' && e.phrase === 'En espera: máquina disponible'), 'neither waited')
    })

    it('a host that refuses with 75 and says its quota leaves the thread a row with the quota in words (UD-303)', async () => {
      const flag = join(env.dir, `quota-${Date.now()}`)
      startWorker(machine({ machineCreate: `if [ -e ${flag} ]; then echo create {job_id} >> ${log}; echo vm-{job_id}; else touch ${flag}; echo '##team quota machines=2' >&2; exit 75; fi`, capacityWaitMs: 300 }))
      const id = await enqueue()
      await until(() => env.db.prepare("SELECT body FROM progress_notes WHERE job_id = ? AND json_extract(data_json, '$.event') IN ('waiting', 'waited')").get(id), { timeoutMs: 10000 })
      assert.equal((await waitJob(id)).status, 'done')
      const rows = env.db.prepare("SELECT body, data_json FROM progress_notes WHERE job_id = ? ORDER BY id").all(id)
      assert.deepEqual(JSON.parse(rows[0].data_json).reason, { code: 'capacity', quota_machines: 2 })
      assert.equal(JSON.parse(rows[0].data_json).event, 'waited', 'it closed when the session started')
      assert.equal(rows[1].body, 'Claude empezó a trabajar')
    })

    it('capacity wait: one «En espera» row with the reason and the hour it began, updated and never duplicated, closed on start; the log says the reason (UD-303)', async () => {
      const count = join(env.dir, `refusals-${Date.now()}`)
      const lines2 = []
      const logger = createLogger({ logLevel: 'info' }, {}, { write: (l) => lines2.push(JSON.parse(l)) })
      // Refuses with 75 three times, saying the quota the second time, and then creates the machine.
      startWorker(machine({ machineCreate: `n=$(cat ${count} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${count}; if [ $n -le 3 ]; then [ $n -eq 2 ] && echo '##team quota machines=2' >&2; exit 75; fi; echo create {job_id} >> ${log}; echo vm-{job_id}`, capacityWaitMs: 150 }), {}, logger)
      const id = await enqueue()
      const rows = () => env.db.prepare("SELECT id, body, data_json, created_at FROM progress_notes WHERE job_id = ? AND json_extract(data_json, '$.event') = 'waiting'").all(id)
      await until(() => rows()[0], { timeoutMs: 10000 })
      const first = rows()[0]
      assert.match(first.body, /^En espera: .*\nMotivo: no hay una máquina de trabajo libre ahora\.$/)
      assert.equal(JSON.parse(first.data_json).since, first.created_at, 'the hour it began waiting is kept')
      await until(() => rows()[0]?.body.includes('cuota de Google admite 2 máquinas'), { timeoutMs: 10000 })
      const second = rows()
      assert.equal(second.length, 1, 'rewritten in place, not duplicated')
      assert.equal(second[0].id, first.id)
      assert.equal(second[0].created_at, first.created_at, 'the hour does not move with each deferral')
      assert.equal((await waitJob(id)).status, 'done')
      const all2 = env.db.prepare('SELECT data_json FROM progress_notes WHERE job_id = ? ORDER BY id').all(id).map((r) => JSON.parse(r.data_json).event)
      assert.deepEqual(all2, ['waited', 'started'], 'closed when the session started')
      const deferred = lines2.filter((l) => l.job_id === id && /^job deferred/.test(l.msg))
      assert.ok(deferred.length >= 3)
      assert.equal(deferred[0].msg, 'job deferred: En espera: máquina disponible')
      assert.equal(deferred[0].reason.code, 'capacity')
      assert.ok(lines2.every((l) => !String(l.msg).includes('[object Object]')))
    })

    it('capacity wait: the row closes when the job fails for good', async () => {
      const flag = join(env.dir, `refused-${Date.now()}`)
      startWorker(machine({ machineCreate: `if [ -e ${flag} ]; then exit 1; else touch ${flag}; exit 75; fi`, capacityWaitMs: 150 }))
      const id = await enqueue()
      assert.equal((await waitJob(id)).status, 'failed')
      const events = env.db.prepare("SELECT data_json FROM progress_notes WHERE job_id = ? ORDER BY id").all(id).map((r) => JSON.parse(r.data_json).event)
      assert.ok(events.includes('waited') && !events.includes('waiting'), `${events}`)
    })

    it('with EXECUTE_KEEP_SESSION_ON_SHUTDOWN=0 a restart in the middle of the session destroys the machine, returns the job to the queue and the next worker creates its own (B4)', async () => {
      process.env.FAKE_EXECUTE_MODE = 'hang'
      startWorker(machine({ keepSessionOnShutdown: false }))
      const id = await enqueue()
      await until(() => lines().includes(`run vm-${id}`) && calls().length > 0, { timeoutMs: 10000 })
      await worker.stop() // what a deploy does: SIGTERM, the jobs in progress go back to the queue
      assert.deepEqual(lines(), [`create ${id}`, `run vm-${id}`, `destroy vm-${id}`], 'DESTROY ran; COLLECT did not: nobody reads the transcript of a session that was cut')
      const parked = env.queue.getJob(id)
      assert.equal(parked.status, 'queued')
      assert.equal(parked.attempts, 0, 'the attempt is refunded: a deploy is not a failure of the job')
      assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM execute_machines WHERE destroyed_at IS NULL').get().n, 0, 'no machine is left without a recorded destruction')
      process.env.FAKE_EXECUTE_MODE = 'ok'
      startWorker(machine({ keepSessionOnShutdown: false }))
      const done = await waitJob(id)
      assert.equal(done.status, 'done', done.last_error)
      assert.deepEqual(lines(), [`create ${id}`, `run vm-${id}`, `destroy vm-${id}`, `create ${id}`, `run vm-${id}`, `destroy vm-${id}`], 'the second attempt has its own machine, destroyed at its end')
    })

    it('by default (EXECUTE_KEEP_SESSION_ON_SHUTDOWN=1) a restart leaves the machine alone, the next worker runs the same machine command again and destroys only at the end', async () => {
      process.env.FAKE_EXECUTE_MODE = 'hang'
      startWorker(machine())
      const id = await enqueue()
      await until(() => lines().includes(`run vm-${id}`) && calls().length > 0, { timeoutMs: 10000 })
      await worker.stop() // what a deploy does: SIGTERM, the jobs in progress go back to the queue
      assert.deepEqual(lines(), [`create ${id}`, `run vm-${id}`], 'neither collect nor destroy ran: the session is still the machine\'s')
      const parked = env.queue.getJob(id)
      assert.equal(parked.status, 'queued')
      assert.equal(parked.attempts, 0, 'the attempt is refunded: a deploy is not a failure of the job')
      const kept = env.db.prepare('SELECT machine, destroyed_at FROM execute_machines WHERE job_id = ?').all(id)
      assert.deepEqual(kept.map((r) => [r.machine, r.destroyed_at]), [[`vm-${id}`, null]], 'the register keeps the machine open: it is waiting for the next attempt')
      process.env.FAKE_EXECUTE_MODE = 'ok'
      startWorker(machine())
      const done = await waitJob(id)
      assert.equal(done.status, 'done', done.last_error)
      assert.deepEqual(lines(), [`create ${id}`, `run vm-${id}`, `create ${id}`, `run vm-${id}`, `destroy vm-${id}`], 'one destroy, after the session finished')
      assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM execute_machines WHERE job_id = ?').get(id).n, 1, 'the second attempt took the machine over: one machine, one row')
      assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM execute_machines WHERE destroyed_at IS NULL').get().n, 0)
    })

    it('destroys it when the session runs out of time', async () => {
      process.env.FAKE_EXECUTE_MODE = 'hang'
      startWorker(machine({ timeoutMs: 1500, killGraceMs: 2000 })) // the job's own cap is the timeout plus three graces: a stalled worker must not reach it before the session's timeout does
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

  describe('run history (UD-262)', () => {
    const rowOf = (jobId) => env.db.prepare('SELECT * FROM execute_runs WHERE job_id = ?').get(jobId)
    const enqueueFirst = async () => {
      const messageId = env.db.prepare('SELECT id FROM messages ORDER BY id LIMIT 1').get().id
      return { messageId, id: Number((await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })).json().job_ids[0]) }
    }

    it('a run whose subagents moved the tokens records them and the table price, not the CLI fallback rate (measured 2026-10-25, job 165)', async () => {
      process.env.FAKE_EXECUTE_MODEL_USAGE = JSON.stringify({ 'claude-haiku-5-5': { inputTokens: 334, outputTokens: 84734, cacheReadInputTokens: 6302596, cacheCreationInputTokens: 196404, costUSD: 4.0957, costBasis: 'unknown' } })
      try {
        startWorker()
        const { id } = await enqueueFirst()
        const job = await waitJob(id)
        assert.equal(job.status, 'done', job.last_error)
        const r = rowOf(id)
        assert.equal(r.cache_read_tokens, 6302596, 'the subagents\' reads are in the column, not only the session\'s own turns')
        assert.ok(r.cost_usd > 0 && r.cost_usd < 1, `cost ${r.cost_usd}`)
        assert.ok(Math.abs(env.db.prepare('SELECT cost_usd FROM jobs WHERE id = ?').get(id).cost_usd - r.cost_usd) < 1e-6, 'the daily budget counts the same figure')
        const [m] = JSON.parse(r.model_usage_json)
        assert.deepEqual([m.model, m.cli_cost_usd, m.cost_basis], ['claude-haiku-5-5', 4.0957, 'unknown'])
      } finally { delete process.env.FAKE_EXECUTE_MODEL_USAGE }
    })

    it('a finished run leaves one row with the times, the tokens, the cost and the ten slowest tools', async () => {
      process.env.FAKE_EXECUTE_MULTI = '1'
      startWorker()
      const { messageId, id } = await enqueueFirst()
      const job = await waitJob(id)
      assert.equal(job.status, 'done', job.last_error)
      const r = rowOf(id)
      assert.deepEqual([r.attempt, r.message_id, r.instance, r.session_id, r.model, r.runner, r.machine], [1, messageId, 'local', 'sess-0001', 'claude-sonnet-5-5', 'local', null])
      assert.equal(r.trace_id, job.trace_id)
      assert.deepEqual([r.outcome, r.error_code, r.delivered, r.transcript_ref], ['done', null, null, null])
      assert.equal(r.cost_usd, 0.5)
      assert.deepEqual([r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens], [11500, 100, 10000, 500])
      assert.deepEqual([r.tool_count, r.subagent_count], [3, 1])
      for (const k of ['queue_wait_ms', 'first_reply_ms', 'final_reply_ms', 'total_ms', 'run_ms', 'tools_ms']) assert.equal(typeof r[k], 'number', k)
      assert.equal(r.create_ms, null, 'the local runner has no machine to create')
      assert.ok(r.first_reply_ms <= r.final_reply_ms && r.final_reply_ms <= r.total_ms + 1, `${r.first_reply_ms} ≤ ${r.final_reply_ms} ≤ ${r.total_ms}`)
      assert.ok(r.tools_ms >= 35, 'the time inside tools adds up the calls that ran (Bash waited 40 ms)')
      const slowest = JSON.parse(r.slowest_tools_json)
      assert.deepEqual(slowest.map((t) => t.duration_ms), slowest.map((t) => t.duration_ms).sort((a, b) => b - a), 'sorted from the slowest')
      assert.equal(slowest.find((t) => t.name === 'Bash').success, false)
      assert.ok(slowest.length <= 10 && slowest.every((t, i) => i === 0 || slowest[i - 1].duration_ms >= t.duration_ms), 'slowest first')
      assert.equal(listExecuteRuns(env.db, { messageId }).items.some((x) => x.job_id === id), true)
    })

    it('a failed run also leaves its row, with the reason', async () => {
      process.env.FAKE_EXECUTE_MODE = 'exit'
      startWorker()
      const { id } = await enqueueFirst()
      assert.equal((await waitJob(id)).status, 'failed')
      const r = rowOf(id)
      assert.deepEqual([r.outcome, r.error_code, r.final_reply_ms], ['failed', 'execute_no_result', null])
      assert.equal(typeof r.total_ms, 'number')
      assert.equal(r.session_id, 'sess-0001', 'what the session said before failing stays')
    })

    it('a run that times out leaves its row too', async () => {
      process.env.FAKE_EXECUTE_MODE = 'hang'
      startWorker({ timeoutMs: 1200, killGraceMs: 2000 }) // the job's own cap is the timeout plus three graces
      const { id } = await enqueueFirst()
      assert.equal((await waitJob(id)).status, 'failed')
      const r = rowOf(id)
      assert.deepEqual([r.outcome, r.error_code], ['failed', 'execute_timeout'])
      assert.ok(r.total_ms >= 1000, `total ${r.total_ms}`)
    })

    it('the session reports judge, delivery and wait with `team mark`; the times add up and delivery says if it arrived', async () => {
      process.env.FAKE_EXECUTE_MARKS = '1'
      startWorker()
      const { id } = await enqueueFirst()
      assert.equal((await waitJob(id)).status, 'done')
      const r = rowOf(id)
      assert.deepEqual([r.judge_ms, r.wait_ms, r.delivery_ms, r.delivered], [5000, 2500, 9000, 1])
    })

    it('marks belong to the agent of a running job', async () => {
      const id = env.db.prepare("SELECT id FROM jobs WHERE kind = 'execute' ORDER BY id DESC LIMIT 1").get().id
      const byMember = await env.app.inject({ method: 'POST', url: `/api/jobs/${id}/marks`, headers: cookieHeaders(author), payload: { name: 'judge', ms: 5 } })
      assert.equal(byMember.json().code, 'not_job_agent')
      const asAgent = (argv) => runTeam(argv, { TEAM_URL: `http://127.0.0.1:${PORT}`, TEAM_AGENT_EMAIL: agent.email, TEAM_AGENT_SECRET: agent.agent_secret, TEAM_JOB_ID: String(id) })
      const finished = await asAgent(['mark', 'judge', '--ms', '5'])
      assert.equal(finished.code, 1)
      assert.match(finished.err, /job_not_running/)
      assert.match((await asAgent(['mark', 'coffee', '--ms', '5'])).err, /team mark: use/)
      assert.match((await asAgent(['mark', 'wait', '--ms', '-3'])).err, /team mark: use/)
      assert.match((await asAgent(['mark', 'delivery', '--ms', '3', '--ok', 'maybe'])).err, /--ok is true or false/)
    })

    it('without a collector the transcript reference stays empty and the job is the same', async () => {
      startWorker({ runner: 'local' })
      const { id } = await enqueueFirst()
      assert.equal((await waitJob(id)).status, 'done')
      assert.equal(rowOf(id).transcript_ref, null)
    })

    it('EXECUTE_RUNS_RETENTION_DAYS is the retention of the history, 365 days by default', () => {
      assert.equal(loadConfig({ DATA_DIR: env.dir }).execute.runsRetentionDays, 365)
      assert.equal(loadConfig({ DATA_DIR: env.dir, EXECUTE_RUNS_RETENTION_DAYS: '30' }).execute.runsRetentionDays, 30)
      env.db.prepare("INSERT INTO execute_runs (job_id, attempt, started_at, finished_at) VALUES (990, 1, ?, ?)").run(Date.now() - 40 * 24 * 3600 * 1000, Date.now())
      assert.equal(pruneExecuteRuns(env.db, { retentionDays: 30 }), 1)
      assert.equal(rowOf(990), undefined)
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

  describe('screenshots in the replies (UD-268)', () => {
    // The template declares the `zone` the host reads (the platform knows no zones; the open one is EXECUTE_CAPTURES_OPEN_ZONE).
    before(() => {
      for (const t of env.db.prepare('SELECT id, body_markdown FROM templates').all()) {
        if (t.body_markdown.includes('name: zone')) continue
        const entry = '  - { name: zone, label: Zona tocada, type: text, required: false, enum: [ninguna, pagos, datos de personas] }\n'
        const body = /\noutput:\n/.test(t.body_markdown) ? t.body_markdown.replace('\noutput:\n', `\noutput:\n${entry}`) : t.body_markdown.replace(/\n---\n/, `\noutput:\n${entry}---\n`)
        env.db.prepare('UPDATE templates SET body_markdown = ? WHERE id = ?').run(body, t.id)
      }
    })
    const shot = (path, extra = {}) => ({ path, alt: 'Ficha de pacientes con el error', masked: true, place: 'Pacientes > Ficha', as: 'Clínica Sur, doctor', ...extra })
    const run = async (text, extraEnv = {}) => {
      startWorker({}, extraEnv)
      const messageId = await publishedMessage(text)
      const job = env.db.prepare("SELECT * FROM jobs WHERE kind = 'execute' AND message_id = ?").get(messageId)
      const finished = await waitJob(job.id)
      assert.equal(finished.status, 'done', finished.last_error)
      const thread = (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}`, headers: { cookie: author } })).json()
      return { messageId, job, mine: thread.replies.filter((r) => String(r.author_id) === String(agentId)) }
    }
    const names = (reply) => reply.attachments.map((a) => a.name)

    it('the first reply carries the before and the closing reply carries the before next to the after', async () => {
      process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify({ 'antes.png': 'png', 'despues.png': 'png' })
      process.env.FAKE_EXECUTE_START_CAPTURES = JSON.stringify([shot('antes.png')])
      process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ captures: [shot('despues.png', { alt: 'Ficha de pacientes sin el error' })] })
      const { mine } = await run('La ficha de pacientes muestra un error.')
      assert.equal(mine.length, 2)
      assert.deepEqual(names(mine[0]), ['Antes - Ficha de pacientes con el error.png'])
      assert.match(mine[0].body, /^Recibido\. Empiezo por leer la pantalla\.\n\n\*\*Antes\*\*: Ficha de pacientes con el error\. Pacientes > Ficha, Clínica Sur, doctor\.(\n\nCerrado: .+)?$/)
      assert.deepEqual(names(mine[1]), ['Antes - Ficha de pacientes con el error.png', 'Después - Ficha de pacientes sin el error.png'])
      assert.deepEqual(mine[1].attachments.map((a) => a.kind), ['image', 'image'])
      assert.match(mine[1].body, /^Arreglé[\s\S]*Ya carga con tus datos\.\n\n\*\*Después\*\*: Ficha de pacientes sin el error\. Pacientes > Ficha, Clínica Sur, doctor\.(\n\nCerrado: .+)?$/)
      assert.ok(!mine[1].body.includes('"path"') && !mine[1].body.includes('Captures'), 'the list of captures is not printed as text')
      // The before is one file in the volume, referenced by both replies.
      assert.equal(env.db.prepare("SELECT COUNT(DISTINCT sha256) AS n FROM reply_attachments WHERE name LIKE 'Antes - %'").get().n >= 1, true)
      const served = await env.app.inject({ method: 'GET', url: `/api/replies/attachments/${mine[1].attachments[1].id}`, headers: { cookie: author } })
      assert.equal(served.statusCode, 200)
      assert.equal(served.headers['content-type'], 'image/png')
    })

    it('an investigation answers with the summary and the closing line only; the technical fields stay with the run and «Tiempos» (UD-276)', async () => {
      process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify({ 'despues.png': 'png' })
      process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ outcome: 'investigated', zone: 'ninguna', summary: 'Revisé la ficha.\n\nNo hay nada que cambiar.', captures: [shot('despues.png', { alt: 'Ficha de pacientes sin el error' })] })
      const { messageId, job, mine } = await run('Consulta sobre la ficha de pacientes.')
      assert.equal(mine.length, 2)
      assert.match(mine[1].body, /^Revisé la ficha\.\n\nNo hay nada que cambiar\.\n\n\*\*Después\*\*: Ficha de pacientes sin el error\. Pacientes > Ficha, Clínica Sur, doctor\.(\n\nCerrado: .+)?$/)
      assert.doesNotMatch(mine[1].body, /Resultado|Zona tocada|investigated|ninguna/)
      const run_ = env.db.prepare('SELECT outcome, detail_json FROM execute_runs WHERE job_id = ?').get(job.id)
      assert.equal(run_.outcome, 'investigated')
      assert.deepEqual(JSON.parse(run_.detail_json), [['Resultado', 'investigated'], ['Zona tocada', 'ninguna']])
      const timing = (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}/timing`, headers: { cookie: author } })).json()
      assert.deepEqual(timing.detail, { entries: [{ label: 'Resultado', value: 'investigated' }, { label: 'Zona tocada', value: 'ninguna' }], delivery_ref: null })
    })

    it('a closing capture that is not an image, is outside the directory or is not masked with a sensitive zone is left out and the job still closes', async () => {
      process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify({ 'texto.png': 'text', 'ok.png': 'png', 'sin-mascara.png': 'png' })
      process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({
        outcome: 'done', zone: 'datos de personas',
        captures: [shot('texto.png'), shot('/etc/passwd'), shot('falta.png'), shot('sin-mascara.png', { masked: false }), shot('ok.png'), shot('ok.png'), shot('ok.png'), shot('ok.png')]
      })
      const { job, mine } = await run('Otra falla en la ficha.')
      assert.equal(mine.length, 2)
      assert.deepEqual(names(mine[1]), ['Después - Ficha de pacientes con el error.png', 'Después - Ficha de pacientes con el error.png', 'Después - Ficha de pacientes con el error.png'], 'ok.png three times (the cap), none of the others')
      const traceId = env.db.prepare('SELECT trace_id FROM jobs WHERE id = ?').get(job.id).trace_id
      const events = await until(() => env.db.prepare("SELECT events_json FROM spans WHERE trace_id = ? AND name = 'execute'").get(traceId)?.events_json, { timeoutMs: 10000 })
      const reasons = [...events.matchAll(/"team\.capture_reason":"([a-z_]+)"/g)].map((m) => m[1])
      assert.deepEqual(reasons, ['not_image', 'outside', 'missing', 'unmasked_sensitive', 'too_many'], 'each skipped capture is an event of the execute span with its reason')
    })

    it('masked false is attached when the zone is the open one, in the first reply and in the closing one', async () => {
      process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify({ 'a.png': 'png', 'b.png': 'png', 'c.png': 'png' })
      process.env.FAKE_EXECUTE_START_CAPTURES = JSON.stringify([shot('a.png', { masked: false }), shot('c.png', { masked: false })])
      process.env.FAKE_EXECUTE_START_ZONE = 'ninguna'
      process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ outcome: 'done', zone: 'ninguna', captures: [shot('b.png', { masked: false })] })
      const { mine } = await run('Un rótulo mal escrito en la pestaña correos.')
      assert.equal(mine[0].attachments.length, 2)
      assert.equal(mine[1].attachments.length, 3, 'the two before and the after')
    })

    it('with EXECUTE_CAPTURES_UNMASKED=allowed, masked false is attached whatever the zone, in the first reply and in the closing one', async () => {
      process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify({ 'a.png': 'png', 'b.png': 'png' })
      process.env.FAKE_EXECUTE_START_CAPTURES = JSON.stringify([shot('a.png', { masked: false })])
      process.env.FAKE_EXECUTE_START_ZONE = 'datos de personas'
      process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ outcome: 'done', zone: 'datos de personas', captures: [shot('b.png', { masked: false })] })
      const { mine } = await run('Ficha de un paciente con el nombre cortado.', { EXECUTE_CAPTURES_UNMASKED: 'allowed' })
      assert.equal(mine[0].attachments.length, 1)
      assert.equal(mine[1].attachments.length, 2, 'the before and the after')
    })

    it('a first reply whose captures are all rejected (unmasked with a sensitive zone) is not posted and the session fails with the reason', async () => {
      process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify({ 'a.png': 'png' })
      process.env.FAKE_EXECUTE_START_CAPTURES = JSON.stringify([shot('a.png', { masked: false })])
      process.env.FAKE_EXECUTE_START_ZONE = 'datos de personas'
      startWorker()
      const messageId = await publishedMessage('Falla en la agenda.')
      const job = env.db.prepare("SELECT * FROM jobs WHERE kind = 'execute' AND message_id = ?").get(messageId)
      const finished = await waitJob(job.id)
      assert.notEqual(finished.status, 'done')
      assert.match(finished.last_error, /unmasked_sensitive/)
      const thread = (await env.app.inject({ method: 'GET', url: `/api/messages/${messageId}`, headers: { cookie: author } })).json()
      // The only reply of the agent is the worker's notice of the failure: the session's first reply never went out.
      assert.ok(thread.replies.every((r) => !r.body.startsWith('Recibido. Empiezo por leer la pantalla.')), 'no first reply without the before')
    })

    it('a session without captures posts the same two replies as before', async () => {
      const { mine } = await run('Un mensaje sin capturas.')
      assert.equal(mine[0].attachments.length, 0)
      assert.match(mine[1].body, /^Arreglé la pantalla que quedaba en blanco\.\n\nYa carga con tus datos\.$/)
      assert.equal(mine[1].attachments.length, 0)
    })

    it('the schema and the environment carry the contract', async () => {
      process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify({})
      await run('Para ver el esquema.')
      const { args, team } = calls().at(-1)
      const schema = JSON.parse(args[args.indexOf('--json-schema') + 1])
      assert.deepEqual(schema.properties.captures.items.required, ['path', 'alt', 'masked', 'place', 'as'])
      assert.ok(!schema.required.includes('captures'), 'optional')
      assert.match(team.TEAM_CAPTURES_DIR, /captures$/)
      assert.deepEqual([team.TEAM_CAPTURES_MAX, team.TEAM_CAPTURES_MAX_BYTES, team.TEAM_CAPTURES_OPEN_ZONE, team.TEAM_LANGUAGE], ['3', String(7 * 1024 * 1024), 'ninguna', 'es-419'])
      assert.equal(team.TEAM_CAPTURES_UNMASKED, 'denied')
    })
  })

  it('tool calls become short phrases', () => {
    assert.equal(phraseForTool('Edit', { file_path: '/a/b/c.ts' }), 'Edición: c.ts')
    assert.equal(phraseForTool('Agent', { description: 'Revisar estilos' }), 'Subagente: Revisar estilos')
    assert.equal(phraseForTool('Grep', { pattern: 'foo' }), 'Búsqueda: foo')
  })

  it('a tool call has a class and a detail with no language (the panel writes the phrase)', () => {
    assert.deepEqual(toolParts('Read', { file_path: '/a/b/Reservas.tsx' }), { action: 'read', detail: 'Reservas.tsx' })
    assert.deepEqual(toolParts('Write', { file_path: '/a/b/c.ts' }), { action: 'edit', detail: 'c.ts' })
    assert.deepEqual(toolParts('Bash', { command: 'npm test', description: 'Run tests' }), { action: 'command', detail: 'Run tests' })
    assert.deepEqual(toolParts('Glob', { pattern: '*.ts' }), { action: 'search', detail: '*.ts' })
    assert.deepEqual(toolParts('WebFetch', {}), { action: 'web', detail: '' })
    assert.deepEqual(toolParts('TodoWrite', {}), { action: 'plan', detail: '' })
    assert.deepEqual(toolParts('mcp__x__y', {}), { action: 'other', detail: 'mcp__x__y' })
  })
})

it('otelSessionEnv correlates the session telemetry with the job and adds nothing without EXECUTE_OTEL_ENV', () => {
  assert.deepEqual(otelSessionEnv({}, { jobId: 7 }), {})
  const e = otelSessionEnv({ CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_RESOURCE_ATTRIBUTES: 'a=b' }, { jobId: 132, attempt: 1, messageId: 9, traceId: 'abc' })
  assert.equal(e.CLAUDE_CODE_ENABLE_TELEMETRY, '1')
  assert.equal(e.OTEL_RESOURCE_ATTRIBUTES, 'a=b,tp.job_id=132,tp.attempt=1,tp.message_id=9,tp.trace_id=abc')
})
