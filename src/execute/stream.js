// Translation of `claude -p --output-format stream-json --verbose --include-partial-messages` (NDJSON, one event per
// line) into progress: a short phrase of what the session does and a percentage of turns used over EXECUTE_MAX_TURNS
// (a count of completed steps, never a clock, MS §7.10). The `result` line closes the run.

import { basename } from 'node:path'
import { estimateCostUsd } from '../telemetry/pricing.js'

const clip = (text, n) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
const PHRASE_CHARS = 80 // declared courtesy: one line of the message card
const SUBJECT_CHARS = 80 // declared courtesy: the subject of a commit in a progress notice is one line
const RESULT_SCAN_CHARS = 20000 // declared courtesy: the summary of a commit or of a push comes first in the output of the command; what follows is not read
const COMMITS_KEPT = 50 // declared courtesy: commits remembered to match a push with its subject; a session of 60 turns makes a handful

// What `git commit` prints: `[tp/12 a1b2c3d] Subject` (`[tp/12 (root-commit) a1b2c3d]` for the first one, `[detached HEAD a1b2c3d]` without a branch).
const COMMIT_SUMMARY = /^\[(\S+?)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/gm
// What `git push` prints for a branch that moved: `   a1b2c3d..e4f5a6b  tp/12 -> tp/12`; for a new one: ` * [new branch]      tp/12 -> tp/12`.
const PUSH_UPDATED = /^\s*[+ ]?\s*[0-9a-f]{7,40}\.{2,3}([0-9a-f]{7,40})\s+(\S+) -> (\S+)\s*$/gm
const PUSH_NEW = /^\s*\*\s+\[new branch\]\s+(\S+) -> (\S+)\s*$/gm

/**
 * The class and the detail of a tool call, without any language: `action` is one of the classes of `execute_steps` (`ACTIONS` in steps.js) and `detail` the part a person
 * recognizes (file name, command, pattern). The panel writes the phrase from them in the language of the account (`tool.phrase.<action>`); `phraseForTool` is the Spanish
 * text kept for what has no panel (the CLI, rows written before the classes existed).
 */
export function toolParts (name, input = {}) {
  const file = input.file_path ?? input.path ?? input.notebook_path
  switch (name) {
    case 'Read': return { action: 'read', detail: basename(String(file ?? '')) }
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': return { action: 'edit', detail: basename(String(file ?? '')) }
    case 'Bash': return { action: 'command', detail: clip(input.description ?? input.command ?? '', PHRASE_CHARS) }
    case 'Grep': case 'Glob': return { action: 'search', detail: clip(input.pattern ?? '', PHRASE_CHARS) }
    case 'Task': case 'Agent': return { action: 'subagent', detail: clip(input.description ?? input.subagent_type ?? '', PHRASE_CHARS) }
    case 'WebFetch': case 'WebSearch': return { action: 'web', detail: '' }
    case 'TodoWrite': return { action: 'plan', detail: '' }
    default: return { action: 'other', detail: clip(name ?? '', PHRASE_CHARS) }
  }
}

const PHRASE_PREFIX = { read: 'Lectura: ', edit: 'Edición: ', command: 'Orden: ', search: 'Búsqueda: ', subagent: 'Subagente: ', other: 'Herramienta: ' }

/** Short interface phrase (Spanish, instrument register) for a tool call. */
export function phraseForTool (name, input = {}) {
  const { action, detail } = toolParts(name, input)
  if (action === 'web') return 'Consulta web'
  if (action === 'plan') return 'Plan de trabajo'
  const phrase = `${PHRASE_PREFIX[action]}${detail}`
  return action === 'read' || action === 'edit' ? phrase : clip(phrase, PHRASE_CHARS)
}

/**
 * Line-by-line reader. `onProgress(percent, phrase)` is called when the phrase or the percentage changes.
 * `state()` returns { sessionId, model, turns, result, lines, invalid }.
 */
export function createStreamReader ({ maxTurns, budgetUsd = 0, onProgress, onEvent = null }) {
  // `tools`: tool calls so far (a subagent's too); `phrase`: the last step; `lastCommit`: the last commit the session made; `pushed`: the commit the last
  // successful push left on the remote, with its subject when the session made it (progress notices of UD-293: read from what git printed, never guessed).
  const st = { sessionId: null, model: null, turns: 0, result: null, lines: 0, invalid: 0, spentUsd: 0, tools: 0, phrase: null, lastCommit: null, pushed: null }
  const toolIds = new Set() // a message may be repeated by the stream: each call counts once
  const bashIds = new Set()
  const commits = new Map() // short sha -> { sha, subject, branch }
  const costs = new Map() // message id -> cost of its latest usage: partial messages repeat the usage of the same message
  let buffer = ''
  let last = { percent: -1, phrase: null }
  const emit = (phrase) => {
    // With a cap on turns, the share of turns used; without one (UD-283), the share of `--max-budget-usd` spent, the cap that governs then. 100 is marked by the `done` event.
    const share = maxTurns > 0 ? st.turns / maxTurns : (budgetUsd > 0 ? st.spentUsd / budgetUsd : 0)
    const percent = Math.min(99, Math.floor(100 * share))
    if (percent === last.percent && phrase === last.phrase) return
    last = { percent, phrase }
    st.phrase = phrase
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
      const m = event.message
      if (m?.usage && m.id) {
        const u = m.usage
        const usd = estimateCostUsd({ provider: 'anthropic', model: m.model ?? st.model, usage: { input_tokens: u.input_tokens, cached_tokens: u.cache_read_input_tokens, cache_creation_tokens: u.cache_creation_input_tokens, output_tokens: u.output_tokens } })
        if (usd !== null) { costs.set(m.id, usd); st.spentUsd = [...costs.values()].reduce((a, b) => a + b, 0) }
      }
      const tools = (event.message?.content ?? []).filter((c) => c?.type === 'tool_use')
      for (const t of tools) {
        if (t.id && toolIds.has(t.id)) continue
        if (t.id) toolIds.add(t.id)
        st.tools += 1
        if (t.name === 'Bash' && t.id) bashIds.add(t.id)
      }
      if (tools.length > 0) for (const t of tools) emit(phraseForTool(t.name, t.input))
      else emit(last.phrase ?? 'Trabajando')
    } else if (event.type === 'user') {
      for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
        if (block?.type === 'tool_result' && bashIds.has(block.tool_use_id)) readGitOutput(resultText(block.content))
      }
    } else if (event.type === 'result') {
      st.result = event
      st.sessionId = event.session_id ?? st.sessionId
    }
  }
  const resultText = (content) => String(typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c?.text ?? '').join('\n') : '').slice(0, RESULT_SCAN_CHARS)
  /** The commits and pushes that the output of a Bash call reports. Anything else in the output is ignored. */
  function readGitOutput (text) {
    for (const m of text.matchAll(COMMIT_SUMMARY)) {
      const commit = { sha: m[2].slice(0, 7), subject: clip(m[3], SUBJECT_CHARS), branch: m[1] }
      commits.set(commit.sha, commit)
      if (commits.size > COMMITS_KEPT) commits.delete(commits.keys().next().value)
      st.lastCommit = commit
    }
    for (const m of text.matchAll(PUSH_UPDATED)) {
      const sha = m[1].slice(0, 7)
      st.pushed = commits.get(sha) ?? { sha, subject: null, branch: m[3] }
    }
    for (const m of text.matchAll(PUSH_NEW)) {
      // A new branch prints no sha: it is the last commit the session made on that branch.
      const onBranch = [...commits.values()].filter((c) => c.branch === m[1]).at(-1) ?? (st.lastCommit && m[1] === 'HEAD' ? st.lastCommit : null)
      if (onBranch) st.pushed = onBranch
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
