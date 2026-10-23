#!/usr/bin/env node
// Stand-in for `claude -p --output-format stream-json --verbose --include-partial-messages` in the `execute` tests.
// Records its arguments, cwd, PATH entries and TEAM_* variables, optionally calls `team reply` through the PATH as the
// real session would, and prints NDJSON. FAKE_EXECUTE_MODE: ok | no-structured | error | hang | exit.
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'

const state = process.env.FAKE_EXECUTE_STATE
const mode = process.env.FAKE_EXECUTE_MODE ?? 'ok'
let stdin = ''
process.stdin.on('data', (d) => { stdin += d })
process.stdin.on('end', () => {
  const team = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('TEAM_')))
  if (state) appendFileSync(`${state}/calls.jsonl`, `${JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), team, stdin, otel: Object.fromEntries(Object.entries(process.env).filter(([k]) => k === 'TRACEPARENT' || k.startsWith('OTEL_') || k.startsWith('CLAUDE_CODE_'))) })}\n`)
  const out = (e) => process.stdout.write(`${JSON.stringify(e)}\n`)
  const sessionId = 'sess-0001'
  out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-sonnet-5-5', tools: ['Read', 'Bash'] })
  // The session file Claude Code leaves under ~/.claude/projects/<dir>/<session>.jsonl (what EXECUTE_MACHINE_COLLECT copies).
  if (state) { mkdirSync(`${state}/projects/-job`, { recursive: true }); writeFileSync(`${state}/projects/-job/${sessionId}.jsonl`, `${JSON.stringify({ type: 'user', session_id: sessionId })}\n`) }
  if (mode === 'exit') { process.stderr.write('session not started'); process.exit(3) }
  // A second pass after a failed delivery carries <delivery_failure> and, as the prompt says, sends no first reply (UD-263).
  // FAKE_EXECUTE_CAPTURE_FILES: { name: 'png' | 'text' } written into $TEAM_CAPTURES_DIR, as the screenshot tool does (UD-268).
  if (process.env.FAKE_EXECUTE_CAPTURE_FILES) {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-image-bytes')])
    for (const [name, kind] of Object.entries(JSON.parse(process.env.FAKE_EXECUTE_CAPTURE_FILES))) writeFileSync(`${team.TEAM_CAPTURES_DIR}/${name}`, kind === 'png' ? png : 'not an image')
  }
  // FAKE_EXECUTE_START_CAPTURES: the JSON list the first reply passes to `team reply --captures` (with --zone FAKE_EXECUTE_START_ZONE).
  const startCaptures = process.env.FAKE_EXECUTE_START_CAPTURES ? ['--captures', process.env.FAKE_EXECUTE_START_CAPTURES, ...(process.env.FAKE_EXECUTE_START_ZONE ? ['--zone', process.env.FAKE_EXECUTE_START_ZONE] : [])] : []
  if (process.env.FAKE_EXECUTE_REPLY === '1' && !stdin.includes('<delivery_failure>')) {
    execFileSync('team', ['reply', team.TEAM_MESSAGE_ID, '--body', 'Recibido. Empiezo por leer la pantalla.', ...startCaptures], { stdio: 'inherit' })
    execFileSync('team', ['progress', team.TEAM_JOB_ID, '--percent', '20', '--phrase', 'Revisión de la pantalla'], { stdio: 'inherit' })
  }
  // Times the session reports with `team mark` (FAKE_EXECUTE_MARKS=1): judge 4000 + 1000, wait 2500, delivery 9000 that reached production.
  if (process.env.FAKE_EXECUTE_MARKS === '1') {
    for (const a of [['judge', '4000'], ['judge', '1000'], ['wait', '2500'], ['delivery', '9000', 'true']]) execFileSync('team', ['mark', a[0], '--ms', a[1], ...(a[2] ? ['--ok', a[2]] : [])], { stdio: 'inherit' })
  }
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const usage = (n) => ({ input_tokens: 100 * n, output_tokens: 10 * n, cache_read_input_tokens: 1000 * n, cache_creation_input_tokens: 50 * n })
  if (process.env.FAKE_EXECUTE_MULTI === '1') return multi()
  legacy()
  function legacy () {
  out({ type: 'stream_event', session_id: sessionId, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Leo' } } })
  out({ type: 'assistant', session_id: sessionId, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/repo/src/screen.tsx' } }] } })
  out({ type: 'user', session_id: sessionId, message: { content: [{ type: 'tool_result', content: 'ok' }] } })
  out({ type: 'assistant', session_id: sessionId, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test', description: 'Pruebas de la pantalla' } }] } })
  out({ type: 'assistant', session_id: sessionId, parent_tool_use_id: 'tool-1', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/screen.tsx' } }] } })
  process.stdout.write('not json\n')
  if (mode === 'hang') { setInterval(() => {}, 1000); return }
  const base = { type: 'result', subtype: 'success', is_error: false, session_id: sessionId, duration_ms: 61000, num_turns: 3, total_cost_usd: 1.2345, usage: { input_tokens: 52000, output_tokens: 3100, cache_read_input_tokens: 40000, cache_creation_input_tokens: 2000 }, modelUsage: { 'claude-sonnet-5-5': {} } }
  if (mode === 'error') return out({ ...base, subtype: 'error_max_budget_usd', is_error: true, result: 'budget reached' })
  if (mode === 'no-structured') return out({ ...base, result: 'done, but no structured output' })
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
