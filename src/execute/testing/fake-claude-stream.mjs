#!/usr/bin/env node
// Stand-in for `claude -p --output-format stream-json --verbose --include-partial-messages` in the `execute` tests.
// Records its arguments, cwd, PATH entries and TEAM_* variables, optionally calls `team reply` through the PATH as the
// real session would, and prints NDJSON. FAKE_EXECUTE_MODE: ok | no-structured | error | hang | exit | api-error | invalid-output | reject-flag.
// FAKE_EXECUTE_FAIL_FIRST=n makes the first n calls (counted in calls.jsonl) behave as FAKE_EXECUTE_FAIL_MODE and the rest as `ok`.
// FAKE_EXECUTE_SLEEP_MS holds the session that long before its result (a session that is still working).
import { execFileSync } from 'node:child_process'
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
  async function legacy () {
  out({ type: 'stream_event', session_id: sessionId, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Leo' } } })
  out({ type: 'assistant', session_id: sessionId, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/repo/src/screen.tsx' } }] } })
  out({ type: 'user', session_id: sessionId, message: { content: [{ type: 'tool_result', content: 'ok' }] } })
  out({ type: 'assistant', session_id: sessionId, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test', description: 'Pruebas de la pantalla' } }] } })
  out({ type: 'assistant', session_id: sessionId, parent_tool_use_id: 'tool-1', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/screen.tsx' } }] } })
  process.stdout.write('not json\n')
  if (mode === 'hang') { setInterval(() => {}, 1000); return }
  if (process.env.FAKE_EXECUTE_SLEEP_MS) await pause(Number(process.env.FAKE_EXECUTE_SLEEP_MS))
  if (state) appendFileSync(`${state}/ends.jsonl`, `${JSON.stringify({ pid: process.pid, t1: Date.now() })}\n`)
  const base = { type: 'result', subtype: 'success', is_error: false, session_id: sessionId, duration_ms: 61000, num_turns: 3, total_cost_usd: 1.2345, usage: { input_tokens: 52000, output_tokens: 3100, cache_read_input_tokens: 40000, cache_creation_input_tokens: 2000 }, modelUsage: { 'claude-sonnet-5-5': {} } }
  if (mode === 'error') return out({ ...base, subtype: 'error_max_budget_usd', is_error: true, result: 'budget reached' })
  if (mode === 'no-structured') return out({ ...base, result: 'done, but no structured output' })
  if (mode === 'api-error') return out({ ...base, is_error: true, result: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' })
  if (mode === 'invalid-output') return out({ ...base, result: '', structured_output: { outcome: 'done' } })
  out({ ...base, result: '', structured_output: { outcome: 'done', summary: 'Arreglé la pantalla que quedaba en blanco.\n\nYa carga con tus datos.', ...(process.env.FAKE_EXECUTE_EXTRA ? JSON.parse(process.env.FAKE_EXECUTE_EXTRA) : {}) } })
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
