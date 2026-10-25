#!/usr/bin/env node
// Stand-in for `claude -p --output-format stream-json --verbose --include-partial-messages` in the `execute` tests.
// Records its arguments, cwd, PATH entries and TEAM_* variables, optionally calls `team reply` through the PATH as the
// real session would, and prints NDJSON. FAKE_EXECUTE_MODE: ok | no-structured | error | hang | exit | api-error | invalid-output | reject-flag.
// FAKE_EXECUTE_FAIL_FIRST=n makes the first n calls (counted in calls.jsonl) behave as FAKE_EXECUTE_FAIL_MODE and the rest as `ok`.
// FAKE_EXECUTE_MODEL_USAGE (JSON) replaces the `modelUsage` of the result: the tokens of every model, subagents included, and the CLI's own cost.
// FAKE_EXECUTE_SLEEP_MS holds the session that long before its result (a session that is still working).
// FAKE_EXECUTE_GIT=1 makes the session commit and push, with the lines git prints in the results of its Bash calls.
// FAKE_EXECUTE_HOOK=1 runs, after every simulated batch of tools, the PostToolBatch hook that came in `--settings` the way Claude Code does (the command with the event as JSON on stdin,
// its stdout read as a hook output) and records the `additionalContext` it returned in hook-context.jsonl. FAKE_EXECUTE_GATE=<fifo> holds the session after its first batch until something is
// written to that named pipe (the test posts a mention in between, then releases it); the file gate-reached tells the test the session is there.
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const state = process.env.FAKE_EXECUTE_STATE
let mode = process.env.FAKE_EXECUTE_MODE ?? 'ok'
if (process.env.FAKE_EXECUTE_FAIL_FIRST) {
  const before = existsSync(`${state}/calls.jsonl`) ? readFileSync(`${state}/calls.jsonl`, 'utf8').trim().split('\n').filter(Boolean).length : 0
  mode = before < Number(process.env.FAKE_EXECUTE_FAIL_FIRST) ? (process.env.FAKE_EXECUTE_FAIL_MODE ?? 'exit') : 'ok'
}
let stdin = ''
process.stdin.on('data', (d) => { stdin += d })
process.stdin.on('end', async () => {
  // UD-295: the IMK judge is one more call of `claude -p` (a single JSON result, no stream). It is answered here and is not one of the session's calls: calls.jsonl keeps only those.
  // FAKE_JUDGE=off makes it fail the way a missing binary does; otherwise it scores the KPI 2.1 and 1.2 and leaves the rest as not observed.
  // UD-307: the Guard of the idea for a message analyzed before it existed. FAKE_IDEA_GUARD=off fails the call; `true` says the Guard applies; otherwise it does not.
  if (stdin.startsWith('Eres el analizador de pedidos')) {
    if (process.env.FAKE_IDEA_GUARD === 'off') process.exit(1)
    const applies = process.env.FAKE_IDEA_GUARD === 'true'
    process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, structured_output: { idea: applies ? 0.9 : 0.1, idea_guard: applies, idea_reason: 'razón del juicio tardío' } })}\n`)
    process.exit(0)
  }
  if (stdin.startsWith('Eres un juez del IMK')) {
    if (process.env.FAKE_JUDGE === 'off') process.exit(1)
    const ids = ['1.1', '1.2', '1.3', '2.1', '2.2', '2.3', '3.1', '3.2', '3.3', '4.1', '4.2', '4.3']
    const kpis = ids.map((id) => ({ id, applies: id === '2.1' || id === '1.2', score: id === '2.1' ? 1 : id === '1.2' ? 0 : 0, quote: id === '2.1' || id === '1.2' ? 'Arreglé la pantalla' : '', claim: 'c', reasoning: 'r' }))
    process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0123, structured_output: { quadrant: 'execute', kpis, summary: 'Adecuado.' } })}\n`)
    process.exit(0)
  }
  const team = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('TEAM_')))
  if (state) appendFileSync(`${state}/calls.jsonl`, `${JSON.stringify({ pid: process.pid, t0: Date.now(), args: process.argv.slice(2), cwd: process.cwd(), team, stdin, otel: Object.fromEntries(Object.entries(process.env).filter(([k]) => k === 'TRACEPARENT' || k.startsWith('OTEL_') || k.startsWith('CLAUDE_CODE_'))) })}\n`)
  const out = (e) => process.stdout.write(`${JSON.stringify(e)}\n`)
  // A binary that does not know a flag of the invocation (an image older than the environment that asks for it) prints its usage and exits at once, with no event.
  if (mode === 'reject-flag' && process.argv.includes('--append-system-prompt-file')) { process.stderr.write("error: unknown option '--append-system-prompt-file'\n"); process.exit(1) }
  const sessionId = 'sess-0001'
  out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-sonnet-5-5', tools: ['Read', 'Bash'] })
  // The session file Claude Code leaves under ~/.claude/projects/<dir>/<session>.jsonl (what EXECUTE_MACHINE_COLLECT copies).
  if (state) { mkdirSync(`${state}/projects/-job`, { recursive: true }); writeFileSync(`${state}/projects/-job/${sessionId}.jsonl`, `${JSON.stringify({ type: 'user', session_id: sessionId })}\n`) }
  // FAKE_EXECUTE_STDERR_NOISE=1: the stderr starts with warnings of the tunnel and of useradd, and the cause is the last line.
  if (mode === 'exit') { process.stderr.write(`${process.env.FAKE_EXECUTE_STDERR_NOISE === '1' ? `${'WARNING: To increase the performance of the tunnel, consider installing numpy.\n'.repeat(12)}useradd: warning: the home directory already exists.\n` : ''}session not started`); process.exit(3) }
  // A second pass after a failed delivery carries <delivery_failure> and, as the prompt says, sends no first reply (UD-263).
  // FAKE_EXECUTE_CAPTURE_FILES: { name: 'png' | 'text' } written into $TEAM_CAPTURES_DIR, as the screenshot tool does (UD-268).
  if (process.env.FAKE_EXECUTE_CAPTURE_FILES) {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-image-bytes')])
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('fake-video-bytes')]) // the EBML mark of a WebM (UD-275)
    for (const [name, kind] of Object.entries(JSON.parse(process.env.FAKE_EXECUTE_CAPTURE_FILES))) writeFileSync(`${team.TEAM_CAPTURES_DIR}/${name}`, kind === 'png' ? png : kind === 'webm' ? webm : 'not an image')
  }
  // FAKE_EXECUTE_ATTACHMENT_FILES: { name: 'pdf' | 'text' } written into $TEAM_ATTACHMENTS_DIR, as a session that writes a document does (UD-272).
  if (process.env.FAKE_EXECUTE_ATTACHMENT_FILES) {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('fake-document-bytes')])
    for (const [name, kind] of Object.entries(JSON.parse(process.env.FAKE_EXECUTE_ATTACHMENT_FILES))) writeFileSync(`${team.TEAM_ATTACHMENTS_DIR}/${name}`, kind === 'pdf' ? pdf : 'not a pdf')
  }
  // FAKE_EXECUTE_START_CAPTURES: the JSON list the first reply passes to `team reply --captures` (with --zone FAKE_EXECUTE_START_ZONE).
  const startCaptures = process.env.FAKE_EXECUTE_START_CAPTURES ? ['--captures', process.env.FAKE_EXECUTE_START_CAPTURES, ...(process.env.FAKE_EXECUTE_START_ZONE ? ['--zone', process.env.FAKE_EXECUTE_START_ZONE] : [])] : []
  if (process.env.FAKE_EXECUTE_REPLY === '1' && !stdin.includes('<delivery_failure>') && !stdin.includes('pass: retry after a failure')) {
    // `team` prints its own reason to the inherited stderr; the fake ends there, without the stack trace of the failed call (the reason is the end of the stderr).
    try { execFileSync('team', ['reply', team.TEAM_MESSAGE_ID, '--body', 'Recibido. Empiezo por leer la pantalla.', ...startCaptures], { stdio: 'inherit' }) } catch { process.exit(1) }
    execFileSync('team', ['progress', team.TEAM_JOB_ID, '--percent', '20', '--phrase', 'Revisión de la pantalla'], { stdio: 'inherit' })
  }
  if (mode === 'exit-late') { process.stderr.write('session died after its first reply'); process.exit(3) } // the machine is lost once the session has already replied
  // Times the session reports with `team mark` (FAKE_EXECUTE_MARKS=1): judge 4000 + 1000, wait 2500, delivery 9000 that reached production.
  if (process.env.FAKE_EXECUTE_MARKS === '1') {
    for (const a of [['judge', '4000'], ['judge', '1000'], ['wait', '2500'], ['delivery', '9000', 'true']]) execFileSync('team', ['mark', a[0], '--ms', a[1], ...(a[2] ? ['--ok', a[2]] : [])], { stdio: 'inherit' })
  }
  const usage = (n) => ({ input_tokens: 100 * n, output_tokens: 10 * n, cache_read_input_tokens: 1000 * n, cache_creation_input_tokens: 50 * n })
  if (process.env.FAKE_EXECUTE_MULTI === '1') return multi()
  await legacy()
  // The hook of Claude Code after a batch of tools: the declared command, the event on stdin; what it prints is a hook output whose `additionalContext` the model reads next.
  function hook () {
    if (process.env.FAKE_EXECUTE_HOOK !== '1') return
    const at = process.argv.indexOf('--settings')
    const command = at < 0 ? null : JSON.parse(process.argv[at + 1]).hooks?.PostToolBatch?.[0]?.hooks?.[0]?.command
    if (!command) return appendFileSync(`${state}/hook-context.jsonl`, `${JSON.stringify({ declared: false })}\n`)
    const r = spawnSync('sh', ['-c', command], { input: JSON.stringify({ hook_event_name: 'PostToolBatch', session_id: sessionId }), encoding: 'utf8', env: process.env })
    let context = null
    try { context = JSON.parse(r.stdout).hookSpecificOutput.additionalContext } catch { /* nothing printed: nothing new */ }
    // The files the context points at, as the session would open them now (the directory of the job goes away when it ends).
    const files = {}
    for (const m of (context ?? '').matchAll(/: (\S*reply-\d+\/\S+)/g)) { try { files[m[1]] = readFileSync(m[1]).toString('base64') } catch { files[m[1]] = null } }
    appendFileSync(`${state}/hook-context.jsonl`, `${JSON.stringify({ declared: true, code: r.status, context, files, stderr: r.stderr })}\n`)
  }
  async function legacy () {
  out({ type: 'stream_event', session_id: sessionId, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Leo' } } })
  out({ type: 'assistant', session_id: sessionId, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/repo/src/screen.tsx' } }] } })
  out({ type: 'user', session_id: sessionId, message: { content: [{ type: 'tool_result', content: 'ok' }] } })
  hook()
  if (process.env.FAKE_EXECUTE_GATE) { writeFileSync(`${state}/gate-reached`, ''); readFileSync(process.env.FAKE_EXECUTE_GATE); hook() }
  out({ type: 'assistant', session_id: sessionId, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test', description: 'Pruebas de la pantalla' } }] } })
  out({ type: 'assistant', session_id: sessionId, parent_tool_use_id: 'tool-1', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/screen.tsx' } }] } })
  // FAKE_EXECUTE_GIT=1: the session commits and pushes its branch, and git's own lines come back in the results of the Bash calls (progress notices, UD-293).
  if (process.env.FAKE_EXECUTE_GIT === '1') {
    out({ type: 'assistant', session_id: sessionId, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu-commit', name: 'Bash', input: { command: 'git commit -am arreglo' } }] } })
    out({ type: 'user', session_id: sessionId, message: { content: [{ type: 'tool_result', tool_use_id: 'tu-commit', content: `[tp/${team.TEAM_MESSAGE_ID} a1b2c3d] Arregla la agenda en blanco\n 1 file changed, 2 insertions(+)` }] } })
    out({ type: 'assistant', session_id: sessionId, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tu-push', name: 'Bash', input: { command: 'git push origin HEAD' } }] } })
    out({ type: 'user', session_id: sessionId, message: { content: [{ type: 'tool_result', tool_use_id: 'tu-push', content: [{ type: 'text', text: `To github.com:x/y.git\n * [new branch]      tp/${team.TEAM_MESSAGE_ID} -> tp/${team.TEAM_MESSAGE_ID}` }] }] } })
  }
  process.stdout.write('not json\n')
  if (mode === 'hang') { setInterval(() => {}, 1000); return }
  if (process.env.FAKE_EXECUTE_SLEEP_MS) await pause(Number(process.env.FAKE_EXECUTE_SLEEP_MS))
  if (state) appendFileSync(`${state}/ends.jsonl`, `${JSON.stringify({ pid: process.pid, t1: Date.now() })}\n`)
  const base = { type: 'result', subtype: 'success', is_error: false, session_id: sessionId, duration_ms: 61000, num_turns: 3, total_cost_usd: 1.2345, usage: { input_tokens: 52000, output_tokens: 3100, cache_read_input_tokens: 40000, cache_creation_input_tokens: 2000 }, modelUsage: process.env.FAKE_EXECUTE_MODEL_USAGE ? JSON.parse(process.env.FAKE_EXECUTE_MODEL_USAGE) : { 'claude-sonnet-5-5': {} } }
  if (mode === 'error') return out({ ...base, subtype: 'error_max_budget_usd', is_error: true, result: 'budget reached' })
  if (mode === 'no-structured') return out({ ...base, result: 'done, but no structured output' })
  if (mode === 'api-error') return out({ ...base, is_error: true, result: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' })
  if (mode === 'invalid-output') return out({ ...base, result: '', structured_output: { outcome: 'done' } })
  out({ ...base, result: '', structured_output: { outcome: 'done', summary: 'Arreglé la pantalla que quedaba en blanco.\n\nYa carga con tus datos.', ...(process.env.FAKE_EXECUTE_EXTRA ? JSON.parse(process.env.FAKE_EXECUTE_EXTRA) : {}), ...(process.env.FAKE_CANNOT_CLOSE_ON && process.argv.includes(process.env.FAKE_CANNOT_CLOSE_ON) ? { cannot_close: true } : {}) } })
  }
  // Several tools with ids, one failing, a subagent with its own tool, a turn per model message (FAKE_EXECUTE_MULTI=1).
  async function multi () {
    const sid = sessionId
    const asst = (id, parent, content, n) => out({ type: 'assistant', session_id: sid, parent_tool_use_id: parent, message: { id, content, usage: usage(n) } })
    const result = (toolUseId, parent, isError = false) => out({ type: 'user', session_id: sid, parent_tool_use_id: parent, message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content: isError ? 'boom' : 'ok' }] } })
    if (process.env.FAKE_EXECUTE_REPLY === '1') execFileSync('team', ['reply', team.TEAM_MESSAGE_ID, '--body', 'Recibido. Empiezo por leer la pantalla.'], { stdio: 'inherit' })
    asst('m1', null, [{ type: 'tool_use', id: 'tu-read', name: 'Read', input: { file_path: '/repo/src/screen.tsx' } }], 1)
    await pause(15); result('tu-read', null)
    asst('m2', null, [{ type: 'tool_use', id: 'tu-bash', name: 'Bash', input: { command: 'npm test', description: 'Pruebas de la pantalla' } }], 2)
    await pause(40); result('tu-bash', null, true)
    asst('m3', null, [{ type: 'tool_use', id: 'tu-sub', name: 'Task', input: { description: 'Revisar estilos', subagent_type: 'reviewer' } }], 3)
    asst('m4', 'tu-sub', [{ type: 'tool_use', id: 'tu-edit', name: 'Edit', input: { file_path: '/repo/src/screen.tsx' } }], 4)
    await pause(20); result('tu-edit', 'tu-sub')
    result('tu-sub', null)
    await pause(5)
    out({ type: 'result', subtype: 'success', is_error: false, session_id: sid, duration_ms: 61000, num_turns: 4, total_cost_usd: 0.5, usage: usage(10), modelUsage: { 'claude-sonnet-5-5': {} }, result: '', structured_output: { outcome: 'done', summary: 'Listo.' } })
  }
})
