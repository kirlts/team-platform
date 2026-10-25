// Progress notices (UD-293). While Claude works on a message, the worker leaves a short row in the thread every `progress_interval_min`
// minutes of its template: how long it has been working, what it has done and what it is doing now. A notice is not a reply: it never
// changes the state of the message, its reply count, its last reply or who answered first (migration 0035 explains why it has its own table).

import { all, get, run } from '../db/index.js'
import { iso, parseJson } from '../db/util.js'
import { DEFAULT_LANGUAGE } from './language.js'

export const DEFAULT_PROGRESS_INTERVAL_MIN = 20 // Martín, 2026-10-25 02:31 (UD-293): on by default, every 20 minutes
export const MAX_PROGRESS_INTERVAL_MIN = 1440 // calendar constant: one day, far above the 60 minutes a session may last (EXECUTE_TIMEOUT_MS)

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// The words of a notice, by account language (UD-018). Every figure and name in it comes from `data`; nothing in these texts is a fact.
const TEXTS = {
  'es-419': {
    head: (d) => [`${d.minutes} min`, plural(d.turns, 'turno', 'turnos'), plural(d.tools, 'herramienta', 'herramientas')].join(' · '),
    now: (phrase) => `Ahora: ${phrase}`,
    pushed: (c) => `Último commit empujado: ${c.sha}${c.subject ? ` ${c.subject}` : ''}`,
    committed: (c) => `Último commit sin empujar: ${c.sha}${c.subject ? ` ${c.subject}` : ''}`
  },
  en: {
    head: (d) => [`${d.minutes} min`, plural(d.turns, 'turn', 'turns'), plural(d.tools, 'tool', 'tools')].join(' · '),
    now: (phrase) => `Now: ${phrase}`,
    pushed: (c) => `Last commit pushed: ${c.sha}${c.subject ? ` ${c.subject}` : ''}`,
    committed: (c) => `Last commit not pushed: ${c.sha}${c.subject ? ` ${c.subject}` : ''}`
  }
}

/**
 * The text of a notice. `data` is what the worker measured: { minutes, turns, tools, phrase, pushed, last_commit }. A line is written only
 * when its fact exists: a session that has made no commit says nothing about commits.
 */
export function noticeBody (data, language = DEFAULT_LANGUAGE) {
  const t = TEXTS[language] ?? TEXTS[DEFAULT_LANGUAGE]
  const lines = [t.head(data)]
  if (data.phrase) lines.push(t.now(data.phrase))
  if (data.pushed) lines.push(t.pushed(data.pushed))
  else if (data.last_commit) lines.push(t.committed(data.last_commit))
  return lines.join('\n')
}

/** Writes a notice in the thread and tells the open screens (the same `changed` event as a reply written through the API). */
export function addProgressNote ({ db, events, now = Date.now }, { messageId, jobId, authorId, data, language, sessionStartedAt }) {
  const body = noticeBody(data, language)
  const id = events.transaction(() => {
    const r = run(db, 'INSERT INTO progress_notes (message_id, job_id, author_id, body, data_json, session_started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      messageId, jobId, authorId, body, JSON.stringify(data), sessionStartedAt, now())
    events.publish({ kind: 'message', data: { reason: 'changed', roots: ['messages'], message_id: String(messageId) } })
    return Number(r.lastInsertRowid)
  })
  return { id, body }
}

/** When the first notice of this job was based on the session's start: a second attempt that attaches to the same session keeps counting from there. */
export const sessionStartOf = (db, jobId) => get(db, 'SELECT MIN(session_started_at) AS at FROM progress_notes WHERE job_id = ?', jobId)?.at ?? null

/** The notices of a message, in the order they were written, as the thread draws them. */
export function listProgressNotes (db, messageId) {
  return all(db, 'SELECT * FROM progress_notes WHERE message_id = ? ORDER BY id', messageId).map((n) => {
    const data = parseJson(n.data_json, {})
    return { id: n.id, message_id: n.message_id, job_id: n.job_id, author_id: n.author_id, body: n.body, minutes: data.minutes ?? null, created_at: iso(n.created_at) }
  })
}
