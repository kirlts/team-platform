// Translation of `claude -p --output-format stream-json --verbose --include-partial-messages` (NDJSON, one event per
// line) into progress: a short phrase of what the session does and a percentage of turns used over EXECUTE_MAX_TURNS
// (a count of completed steps, never a clock, MS §7.10). The `result` line closes the run.

import { basename } from 'node:path'

const clip = (text, n) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
const PHRASE_CHARS = 80 // declared courtesy: one line of the message card

/** Short interface phrase (Spanish, instrument register) for a tool call. */
export function phraseForTool (name, input = {}) {
  const file = input.file_path ?? input.path ?? input.notebook_path
  switch (name) {
    case 'Read': return `Lectura: ${basename(String(file ?? ''))}`
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': return `Edición: ${basename(String(file ?? ''))}`
    case 'Bash': return clip(`Orden: ${input.description ?? input.command ?? ''}`, PHRASE_CHARS)
    case 'Grep': case 'Glob': return clip(`Búsqueda: ${input.pattern ?? ''}`, PHRASE_CHARS)
    case 'Task': case 'Agent': return clip(`Subagente: ${input.description ?? input.subagent_type ?? ''}`, PHRASE_CHARS)
    case 'WebFetch': case 'WebSearch': return 'Consulta web'
    case 'TodoWrite': return 'Plan de trabajo'
    default: return clip(`Herramienta: ${name}`, PHRASE_CHARS)
  }
}

/**
 * Line-by-line reader. `onProgress(percent, phrase)` is called when the phrase or the percentage changes.
 * `state()` returns { sessionId, model, turns, result, lines, invalid }.
 */
export function createStreamReader ({ maxTurns, onProgress, onEvent = null }) {
  const st = { sessionId: null, model: null, turns: 0, result: null, lines: 0, invalid: 0 }
  let buffer = ''
  let last = { percent: -1, phrase: null }
  const emit = (phrase) => {
    const percent = Math.min(99, Math.floor((100 * st.turns) / maxTurns)) // 100 is marked by the `done` event
    if (percent === last.percent && phrase === last.phrase) return
    last = { percent, phrase }
    // Recording the progress must never lose the lines that follow, among them the `result`: a database that is busy for a moment is not a failed session.
    try { onProgress?.(percent, phrase) } catch { /* the next change of phrase records it again */ }
  }
  function handle (event) {
    try { onEvent?.(event) } catch { /* measuring the session never changes how it is read */ }
    if (event.type === 'system' && event.subtype === 'init') {
      st.sessionId = event.session_id ?? st.sessionId
      st.model = event.model ?? st.model
      emit('Sesión iniciada')
    } else if (event.type === 'assistant') {
      st.sessionId = event.session_id ?? st.sessionId
      if (!event.parent_tool_use_id) st.turns += 1 // a turn of the main session; a subagent's turns do not count against max-turns
      const tools = (event.message?.content ?? []).filter((c) => c?.type === 'tool_use')
      if (tools.length > 0) for (const t of tools) emit(phraseForTool(t.name, t.input))
      else emit(last.phrase ?? 'Trabajando')
    } else if (event.type === 'result') {
      st.result = event
      st.sessionId = event.session_id ?? st.sessionId
    }
  }
  function push (chunk) {
    buffer += chunk
    let i
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim()
      buffer = buffer.slice(i + 1)
      if (line) feed(line)
    }
  }
  function feed (line) {
    st.lines += 1
    let event
    try { event = JSON.parse(line) } catch { st.invalid += 1; return }
    if (event && typeof event === 'object') handle(event)
  }
  function end () {
    if (buffer.trim()) feed(buffer.trim())
    buffer = ''
  }
  return { push, end, state: () => st }
}
