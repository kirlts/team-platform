#!/usr/bin/env node
// Stand-in for `claude -p --output-format stream-json --verbose --include-partial-messages` in the `execute` tests.
// Records its arguments, cwd, PATH entries and TEAM_* variables, optionally calls `team reply` through the PATH as the
// real session would, and prints NDJSON. FAKE_EXECUTE_MODE: ok | no-structured | error | hang | exit.
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const state = process.env.FAKE_EXECUTE_STATE
const mode = process.env.FAKE_EXECUTE_MODE ?? 'ok'
let stdin = ''
process.stdin.on('data', (d) => { stdin += d })
process.stdin.on('end', () => {
  const team = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('TEAM_')))
  if (state) appendFileSync(`${state}/calls.jsonl`, `${JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), team, stdin })}\n`)
  const out = (e) => process.stdout.write(`${JSON.stringify(e)}\n`)
  const sessionId = 'sess-0001'
  out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-sonnet-5-5', tools: ['Read', 'Bash'] })
  if (mode === 'exit') { process.stderr.write('session not started'); process.exit(3) }
  if (process.env.FAKE_EXECUTE_REPLY === '1') {
    execFileSync('team', ['reply', team.TEAM_MESSAGE_ID, '--body', 'Recibido. Empiezo por leer la pantalla.'], { stdio: 'inherit' })
    execFileSync('team', ['progress', team.TEAM_JOB_ID, '--percent', '20', '--phrase', 'Revisión de la pantalla'], { stdio: 'inherit' })
  }
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
  out({ ...base, result: '', structured_output: { summary: 'Arreglé la pantalla que quedaba en blanco.\n\nYa carga con tus datos.', ...(process.env.FAKE_EXECUTE_EXTRA ? JSON.parse(process.env.FAKE_EXECUTE_EXTRA) : {}) } })
})
