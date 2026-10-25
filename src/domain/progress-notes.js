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

const HANDED = { 'es-419': 'Construido; entregando a producción.', en: 'Built; delivering to production.' }
/**
 * UD-298: the notice that the work is built and now in delivery. It is a notice and never the closing reply: it promises nothing, and the thread says
 * «En producción desde …» only when the delivery confirmed it.
 */
export function addDeliveryNote ({ db, events, now = Date.now }, { messageId, jobId, authorId, language = DEFAULT_LANGUAGE }) {
  const at = now()
  const body = HANDED[language] ?? HANDED[DEFAULT_LANGUAGE]
  events.transaction(() => {
    run(db, 'INSERT INTO progress_notes (message_id, job_id, author_id, body, data_json, session_started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', messageId, jobId, authorId, body, JSON.stringify({ delivery: true }), at, at)
    events.publish({ kind: 'message', data: { reason: 'changed', roots: ['messages'], message_id: String(messageId) } })
  })
  return body
}

// UD-303: the rows of the thread that say where the job of a message is: waiting for a turn, and started. Like a notice they are not replies: they
// are rows of `progress_notes`, told apart by `data_json.event` (`waiting`, `waited`, `started`), and they never change the state of the message.
const EVENT_TEXTS = {
  'es-419': {
    started: (name) => `${name} empezó a trabajar`,
    ahead: (n, name) => (n === 0 ? 'En espera: este trabajo es el siguiente' : `En espera: ${plural(n, 'trabajo', 'trabajos')} de ${name} delante`),
    budget_reserved: () => 'Motivo: las sesiones en curso tienen reservado el gasto que queda hoy.',
    capacity: (r) => (r.quota_machines > 0 ? `Motivo: la cuota de Google admite ${plural(r.quota_machines, 'máquina', 'máquinas')} y no queda espacio en ellas.` : 'Motivo: no hay una máquina de trabajo libre ahora.'),
    waited: (minutes) => `Estuvo en espera ${minutes} min`
  },
  en: {
    started: (name) => `${name} started working`,
    ahead: (n, name) => (n === 0 ? 'Waiting: this job is next' : `Waiting: ${plural(n, 'job', 'jobs')} of ${name} ahead`),
    budget_reserved: () => 'Reason: the running sessions hold the spending left today.',
    capacity: (r) => (r.quota_machines > 0 ? `Reason: the Google quota admits ${plural(r.quota_machines, 'machine', 'machines')} and they have no room left.` : 'Reason: no work machine is free right now.'),
    waited: (minutes) => `Waited ${minutes} min`
  }
}

/** The text of a waiting row: how many jobs are ahead and, in one sentence, what holds the job. `reason.code` is the code of the cap (see `Deferred`). */
export function waitBody ({ ahead, reason, name = 'Claude' }, language = DEFAULT_LANGUAGE) {
  const t = EVENT_TEXTS[language] ?? EVENT_TEXTS[DEFAULT_LANGUAGE]
  const lines = [t.ahead(ahead, name)]
  if (reason && t[reason.code]) lines.push(t[reason.code](reason))
  return lines.join('\n')
}

const insertEvent = (db, { messageId, jobId, authorId, body, data, at }) =>
  Number(run(db, 'INSERT INTO progress_notes (message_id, job_id, author_id, body, data_json, session_started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', messageId, jobId, authorId, body, JSON.stringify(data), at, at).lastInsertRowid)
const tellScreens = (events, messageId) => events.publish({ kind: 'message', data: { reason: 'changed', roots: ['messages'], message_id: String(messageId) } })
const rowOf = (db, jobId, event) => get(db, "SELECT * FROM progress_notes WHERE job_id = ? AND json_extract(data_json, '$.event') = ? ORDER BY id DESC LIMIT 1", jobId, event)

/**
 * The row «<name> started working», written when the session of an attempt really starts. One per attempt: a handler that runs again for the same
 * attempt (the worker restarted and attached to the session) does not write it twice. Returns the body, or null when the attempt already had it.
 */
export function addStartNote ({ db, events, now = Date.now }, { messageId, jobId, authorId, name = 'Claude', language = DEFAULT_LANGUAGE, attempt = 1 }) {
  const t = EVENT_TEXTS[language] ?? EVENT_TEXTS[DEFAULT_LANGUAGE]
  const at = now()
  return events.transaction(() => {
    const had = rowOf(db, jobId, 'started')
    if (had && parseJson(had.data_json, {}).attempt === attempt) return null
    const body = t.started(name)
    insertEvent(db, { messageId, jobId, authorId, body, data: { event: 'started', attempt }, at })
    tellScreens(events, messageId)
    return body
  })
}

/**
 * The row «waiting» of a job: written once, and rewritten in place when the jobs ahead or the cap that holds it change. Returns the body when the
 * thread changed, null when the row already said exactly this.
 */
export function upsertWaitNote ({ db, events, now = Date.now }, { messageId, jobId, authorId, name = 'Claude', language = DEFAULT_LANGUAGE, ahead, reason }) {
  const body = waitBody({ ahead, reason, name }, language)
  const data = { event: 'waiting', ahead, reason }
  return events.transaction(() => {
    const had = rowOf(db, jobId, 'waiting')
    if (!had) {
      const at = now()
      insertEvent(db, { messageId, jobId, authorId, body, data: { ...data, since: at }, at })
    } else {
      if (had.body === body) return null
      run(db, 'UPDATE progress_notes SET body = ?, data_json = ? WHERE id = ?', body, JSON.stringify({ ...data, since: parseJson(had.data_json, {}).since ?? had.created_at }), had.id)
    }
    tellScreens(events, messageId)
    return body
  })
}

/** When the job starts (or ends for good) the waiting row stops saying «waiting»: it says how long the wait was. */
export function closeWaitNote ({ db, events, now = Date.now }, { jobId, language = DEFAULT_LANGUAGE }) {
  const t = EVENT_TEXTS[language] ?? EVENT_TEXTS[DEFAULT_LANGUAGE]
  return events.transaction(() => {
    const had = rowOf(db, jobId, 'waiting')
    if (!had) return null
    const data = parseJson(had.data_json, {})
    const minutes = Math.max(1, Math.round((now() - (data.since ?? had.created_at)) / 60000))
    run(db, 'UPDATE progress_notes SET body = ?, data_json = ? WHERE id = ?', t.waited(minutes), JSON.stringify({ event: 'waited', minutes, reason: data.reason ?? null }), had.id)
    tellScreens(events, had.message_id)
    return t.waited(minutes)
  })
}

// The row that says a failed job was taken up again by the system, and when. Like the other event rows it is not a reply.
const RESUME_TEXTS = {
  'es-419': {
    cause: { machine: 'la máquina de trabajo', timeout: 'el tiempo máximo', deliver: 'el entorno de entrega', interrupted: 'una interrupción del servicio', system: 'un problema del sistema' },
    when: { start: 'al arrancar el servicio', capacity: 'al volver la capacidad' },
    body: (cause, when) => `Retomado solo tras fallar por ${cause}, ${when}.`
  },
  en: {
    cause: { machine: 'the work machine', timeout: 'the time limit', deliver: 'the delivery environment', interrupted: 'a service interruption', system: 'a system problem' },
    when: { start: 'when the service started', capacity: 'when capacity came back' },
    body: (cause, when) => `Picked up again on its own after failing on ${cause}, ${when}.`
  }
}

/** The one-line row «picked up again on its own»: `cause` is one of machine, timeout, deliver, interrupted, system; `trigger` is `start` or `capacity`. */
export function addResumeNote ({ db, events, now = Date.now }, { messageId, jobId, authorId, cause = 'system', trigger = 'start', language = DEFAULT_LANGUAGE }) {
  const t = RESUME_TEXTS[language] ?? RESUME_TEXTS[DEFAULT_LANGUAGE]
  const body = t.body(t.cause[cause] ?? t.cause.system, t.when[trigger] ?? t.when.start)
  const at = now()
  events.transaction(() => {
    insertEvent(db, { messageId, jobId, authorId, body, data: { event: 'resumed', trigger, cause }, at })
    tellScreens(events, messageId)
  })
  return body
}
