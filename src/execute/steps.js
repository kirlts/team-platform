// The history of what an `execute` session does (plan 1.0.0, «Historial de la sesión»). The NDJSON of `claude -p --output-format stream-json` already reaches the
// worker, both with the local runner and with a machine driver (the driver's RUN prints it on its standard output, which `onData` feeds to the reader), so this
// module only listens to the events the reader decodes: each `tool_use` block is a step, its `tool_result` closes it. Nothing here opens a channel from the machine.
//
// What can be known while the session runs: the tool, its input and, when a Bash call ran `look`, the line `LOOK_CAPTURE {json}` of its output (the description of the
// screenshot). What can only be known at the end: the files, which `storeCaptures` stores from the structured output; `attachCaptures` then writes their hash on the steps.
// Recording never fails the session: every entry point swallows its errors, like `onProgress`.

import { all, get, run } from '../db/index.js'
import { CAPTURE_MARKER } from './captures/declare.js'

/** The classes a person reads; `other` is every tool that has none (an MCP tool, a new one). */
export const ACTIONS = ['read', 'edit', 'command', 'search', 'subagent', 'web', 'plan', 'capture', 'other']

export const DETAIL_CHARS = 200 // declared courtesy: a path, a command or a pattern is read on one or two lines; the rest of a long command is not a detail anyone opens
export const NOTIFY_MS = 1000 // declared courtesy: the screen is told at most once a second; a session makes a few calls per second at most and the panel reads the list again each time
const RESULT_SCAN_CHARS = 20000 // declared courtesy: the same as the git output scan of stream.js; the capture line comes first in the output of `look`
const CAPTURE_LINE = new RegExp(`^${CAPTURE_MARKER} (\\{.*\\})\\s*$`, 'gm')

const clip = (text, n) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** The class and the technical detail of a tool call. */
export function stepOfTool (name, input = {}) {
  const file = input.file_path ?? input.path ?? input.notebook_path
  switch (name) {
    case 'Read': return { action: 'read', detail: clip(file, DETAIL_CHARS) }
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': return { action: 'edit', detail: clip(file, DETAIL_CHARS) }
    case 'Bash': return { action: 'command', detail: clip(input.command ?? input.description, DETAIL_CHARS) }
    case 'Grep': case 'Glob': return { action: 'search', detail: clip(input.pattern, DETAIL_CHARS) }
    case 'Task': case 'Agent': return { action: 'subagent', detail: clip(input.description ?? input.subagent_type, DETAIL_CHARS) }
    case 'WebFetch': return { action: 'web', detail: clip(input.url, DETAIL_CHARS) }
    case 'WebSearch': return { action: 'web', detail: clip(input.query, DETAIL_CHARS) }
    case 'TodoWrite': return { action: 'plan', detail: null }
    default: return { action: 'other', detail: null }
  }
}

const textOf = (content) => String(typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c?.text ?? '').join('\n') : '').slice(0, RESULT_SCAN_CHARS)

/** The captures a Bash output declares (`LOOK_CAPTURE {json}` lines); a line that is not JSON or has no description is ignored. */
export function capturesInOutput (text) {
  const found = []
  for (const m of String(text ?? '').matchAll(CAPTURE_LINE)) {
    try {
      const d = JSON.parse(m[1])
      if (typeof d?.alt === 'string' && d.alt.trim()) found.push({ alt: d.alt.trim().slice(0, 120), place: typeof d.place === 'string' ? d.place : null, as: typeof d.as === 'string' ? d.as : null, masked: d.masked === true })
    } catch { /* not a declaration */ }
  }
  return found
}

/**
 * The recorder of one attempt of a job. `onEvent(event)` takes the events of the stream reader. `max` caps the steps saved per job (0 = none saved).
 * `events` is the bus of the process; `message_id` goes in the change event so the open sheet reads the list again.
 */
export function createStepRecorder ({ db, events = null, jobId, messageId, attempt, max, now = Date.now, notifyMs = NOTIFY_MS, logger = null }) {
  const seen = new Set() // a message of the stream may be repeated: each call counts once
  const open = new Map() // tool_use id -> { id (row), bash }
  let position = 0
  let saved = 0
  let lastNotice = 0
  let timer = null
  let dirty = false
  try {
    const row = get(db, 'SELECT COALESCE(MAX(position), 0) AS p, COUNT(*) AS n FROM execute_steps WHERE job_id = ?', jobId)
    position = row.p
    saved = row.n
  } catch (error) { logger?.warn({ err: error }, 'could not read the steps of the job') }

  const notify = () => {
    dirty = false
    lastNotice = now()
    try { events?.publish({ kind: 'message', data: { reason: 'changed', roots: ['session'], message_id: String(messageId) } }) } catch { /* the screen reads the list when it opens */ }
  }
  const touch = () => {
    if (!events) return
    dirty = true
    const wait = lastNotice + notifyMs - now()
    if (wait <= 0) { if (timer) { clearTimeout(timer); timer = null } notify(); return }
    if (!timer) {
      timer = setTimeout(() => { timer = null; if (dirty) notify() }, wait)
      timer.unref?.()
    }
  }

  function begin (block) {
    if (block.id && seen.has(block.id)) return
    if (block.id) seen.add(block.id)
    if (saved >= max) return
    const { action, detail } = stepOfTool(block.name, block.input ?? {})
    position += 1
    saved += 1
    const id = Number(run(db, 'INSERT INTO execute_steps (job_id, attempt, position, at, action, tool, detail) VALUES (?, ?, ?, ?, ?, ?, ?)', jobId, attempt, position, now(), action, String(block.name ?? 'unknown').slice(0, 80), detail).lastInsertRowid)
    if (block.id) open.set(block.id, { id, bash: block.name === 'Bash' })
    touch()
  }

  function finish (block) {
    const entry = open.get(block.tool_use_id)
    if (!entry) return
    open.delete(block.tool_use_id)
    run(db, 'UPDATE execute_steps SET ended_at = ?, failed = ? WHERE id = ?', now(), block.is_error === true ? 1 : 0, entry.id)
    if (entry.bash) {
      const [first, ...more] = capturesInOutput(textOf(block.content))
      if (first) {
        run(db, "UPDATE execute_steps SET action = 'capture', capture_alt = ?, capture_place = ?, capture_as = ?, capture_masked = ? WHERE id = ?", first.alt, first.place, first.as, first.masked ? 1 : 0, entry.id)
        for (const c of more) {
          // Another screenshot of the same call: its own step, right after.
          position += 1
          run(db, "INSERT INTO execute_steps (job_id, attempt, position, at, ended_at, action, tool, detail, capture_alt, capture_place, capture_as, capture_masked) VALUES (?, ?, ?, ?, ?, 'capture', 'Bash', NULL, ?, ?, ?, ?)", jobId, attempt, position, now(), now(), c.alt, c.place, c.as, c.masked ? 1 : 0)
        }
      }
    }
    touch()
  }

  return {
    onEvent (event) {
      try {
        const blocks = Array.isArray(event?.message?.content) ? event.message.content : []
        if (event?.type === 'assistant') {
          for (const b of blocks) if (b?.type === 'tool_use') begin(b)
        } else if (event?.type === 'user') {
          for (const b of blocks) if (b?.type === 'tool_result') finish(b)
        }
      } catch (error) { logger?.warn({ err: error }, 'could not record a step of the session') }
    },
    /** The session ended: what is pending is told now and the calls that never returned stay open (the panel reads them as not finished). */
    end () {
      if (timer) { clearTimeout(timer); timer = null }
      if (dirty) notify()
    },
    notify: touch
  }
}

/**
 * Writes the hash of the stored files on the steps that took them (matched by description, in order), and adds a step for each stored capture no step announced
 * (the session declared it in its structured output). Never throws. Returns the number of steps that got a file.
 */
export function attachCaptures (db, { jobId, attempt, stored, now = Date.now, events = null, messageId = null }) {
  try {
    const rows = all(db, 'SELECT id, capture_alt FROM execute_steps WHERE job_id = ? AND attempt = ? AND capture_alt IS NOT NULL AND capture_sha256 IS NULL ORDER BY position', jobId, attempt)
    let matched = 0
    for (const c of stored ?? []) {
      const at = rows.findIndex((r) => r.capture_alt === String(c.alt ?? '').slice(0, 120))
      if (at >= 0) {
        const [row] = rows.splice(at, 1)
        run(db, 'UPDATE execute_steps SET capture_sha256 = ?, capture_kind = ?, capture_mime = ? WHERE id = ?', c.sha256, c.kind ?? 'image', c.mime ?? null, row.id)
        matched += 1
      } else {
        const p = get(db, 'SELECT COALESCE(MAX(position), 0) + 1 AS p FROM execute_steps WHERE job_id = ?', jobId).p
        run(db, "INSERT INTO execute_steps (job_id, attempt, position, at, ended_at, action, tool, capture_alt, capture_place, capture_as, capture_masked, capture_sha256, capture_kind, capture_mime) VALUES (?, ?, ?, ?, ?, 'capture', 'StructuredOutput', ?, ?, ?, ?, ?, ?, ?)",
          jobId, attempt, p, now(), now(), String(c.alt ?? '').slice(0, 120), c.place ?? null, c.as ?? null, c.masked === true ? 1 : 0, c.sha256, c.kind ?? 'image', c.mime ?? null)
        matched += 1
      }
    }
    if (events && messageId && matched) events.publish({ kind: 'message', data: { reason: 'changed', roots: ['session'], message_id: String(messageId) } })
    return matched
  } catch { return 0 }
}

const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString())

/**
 * The history of a message for the API: the steps of its `execute` jobs in the order they happened, each capture with the reply attachment that holds its file
 * (null until the closing reply carries it).
 */
export function stepsOfMessage (db, messageId, { max }) {
  const jobs = all(db, "SELECT id, status, attempts, phase FROM jobs WHERE kind = 'execute' AND message_id = ? ORDER BY id", messageId)
  if (jobs.length === 0) return null
  const latest = jobs.at(-1)
  const rows = all(db, 'SELECT * FROM execute_steps WHERE job_id IN (SELECT id FROM jobs WHERE kind = \'execute\' AND message_id = ?) ORDER BY job_id, position', messageId)
  const counts = new Map()
  for (const r of rows) counts.set(r.job_id, (counts.get(r.job_id) ?? 0) + 1)
  const attachments = new Map()
  const attachmentOf = (sha256) => {
    if (!attachments.has(sha256)) {
      attachments.set(sha256, get(db, `SELECT ra.id, ra.kind, ra.mime, ra.size, ra.name FROM reply_attachments ra JOIN replies r ON r.id = ra.reply_id
        WHERE r.message_id = ? AND r.deleted_at IS NULL AND ra.sha256 = ? ORDER BY ra.id DESC LIMIT 1`, messageId, sha256) ?? null)
    }
    return attachments.get(sha256)
  }
  return {
    message_id: String(messageId),
    job_id: String(latest.id),
    job_status: latest.status,
    phase: latest.phase ?? null,
    max_steps: max,
    capped: max > 0 && [...counts.values()].some((n) => n >= max),
    steps: rows.map((r) => {
      let capture = null
      if (r.capture_alt) {
        const a = r.capture_sha256 ? attachmentOf(r.capture_sha256) : null
        capture = {
          alt: r.capture_alt, place: r.capture_place ?? null, as: r.capture_as ?? null, masked: r.capture_masked === null ? null : r.capture_masked === 1,
          kind: r.capture_kind ?? null,
          attachment: a ? { id: String(a.id), kind: a.kind, mime: a.mime, size: a.size, name: a.name } : null
        }
      }
      return { id: String(r.id), job_id: String(r.job_id), attempt: r.attempt, at: iso(r.at), ended_at: iso(r.ended_at), action: r.action, tool: r.tool, detail: r.detail ?? null, failed: r.failed === 1, capture }
    })
  }
}
