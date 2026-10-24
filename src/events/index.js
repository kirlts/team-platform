// Events and progress (MASTER-SPEC §7.10). Every event is written to `job_events`; its autoincrement `seq`
// is the id of the SSE event and, therefore, the `Last-Event-ID` the browser resends on reconnect.
// A single event thread for progress, job completion and message notices: one SSE stream per member.
//
// How a subscriber learns of what another process wrote: with the worker separate, the API queries
// `PRAGMA data_version` (1.15 µs per query, I03 §5.3) and reads what it has not yet dispatched. With the worker in the
// same process, direct dispatch is enough. In both cases dispatch always reads the database in order, so
// there are no gaps even if two processes write at the same time.

import { all, get, run, tx } from '../db/index.js'
import { iso, parseJson } from '../db/util.js'
import { DEFAULT_LANGUAGE } from '../domain/language.js'
import { codeOfPhrase, isStep, renderPhrase } from '../domain/progress-phrases.js'

export const EVENT_KINDS = ['progress', 'done', 'message']

const id = (v) => (v === null || v === undefined ? undefined : String(v))

/**
 * `job_events` row to the shape the client sees. Every id travels as text, as in the REST responses
 * (the panel compares `job_id` and `message_id` as strings).
 */
export function toWire (row) {
  const data = parseJson(row.data_json, {})
  if (row.kind === 'progress') {
    const { code, vars } = progressCode(row, data)
    return { id: String(row.seq), event: 'progress', data: { job_id: id(row.job_id), input_id: id(data.input_id) ?? null, ...(data.message_id ? { message_id: id(data.message_id) } : {}), percent: row.percent, phrase: row.phrase, code, vars, at: iso(row.at) } }
  }
  if (row.kind === 'done') {
    return { id: String(row.seq), event: 'done', data: { ...data, job_id: id(row.job_id), input_id: id(data.input_id) ?? null, attachment_id: id(data.attachment_id), done: true, at: iso(row.at) } }
  }
  return { id: String(row.seq), event: 'message', data: { ...data, message_id: id(data.message_id), author_id: id(data.author_id), input_id: id(data.input_id), at: iso(row.at) } }
}

/**
 * Code of a progress row (H-3722). A row written since the codes carries it in `data_json`; an older row carries only the
 * phrase, and the catalogue recovers its code. A phrase outside the catalogue has none: the client shows it as it is.
 */
export function progressCode (row, data = parseJson(row.data_json, {})) {
  if (typeof data.code === 'string') return { code: data.code, vars: data.vars ?? {} }
  const legacy = codeOfPhrase(row.phrase)
  return legacy ?? { code: null, vars: {} }
}

export function createEvents ({ db, now = Date.now }) {
  const subscribers = new Set()
  let lastDispatched = get(db, 'SELECT COALESCE(MAX(seq), 0) AS m FROM job_events').m
  let dataVersion = null
  let timerHandle = null

  /** Dispatches to the subscribers everything the database has after what was already dispatched. */
  function drain () {
    const rows = all(db, 'SELECT * FROM job_events WHERE seq > ? ORDER BY seq', lastDispatched)
    for (const dbRow of rows) {
      lastDispatched = dbRow.seq
      for (const s of [...subscribers]) {
        if (dbRow.member_id === null || dbRow.member_id === s.memberId) {
          try { s.callback(dbRow) } catch { /* a broken subscriber does not hold back the others */ }
        }
      }
    }
    return rows.length
  }

  /** Writes an event. A null `memberId` directs it to the whole team. Returns the `seq`. */
  function publish ({ kind, jobId = null, memberId = null, percent = null, phrase = null, data = null }) {
    if (!EVENT_KINDS.includes(kind)) throw new Error(`Unknown event kind: ${kind}`)
    const result = run(db,
      'INSERT INTO job_events (job_id, kind, member_id, percent, phrase, data_json, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      jobId, kind, memberId, percent, phrase, data === null ? null : JSON.stringify(data), now())
    if (!db.isTransaction) drain()
    return Number(result.lastInsertRowid)
  }

  /** Same as `publish`, but the recipient is the author of the input the job belongs to. */
  function publishForJob (jobId, { kind, percent = null, phrase = null, data = {} }) {
    const jobRow = get(db, 'SELECT j.input_id, j.message_id, i.author_id, m.language FROM jobs j LEFT JOIN inputs i ON i.id = j.input_id LEFT JOIN members m ON m.id = i.author_id WHERE j.id = ?', jobId)
    if (!jobRow) return null
    // H-3722: a progress step is written with its code and in the author's language (UD-018); a text of the catalogue
    // without a code gets its code; any other text goes as it came.
    let progress = {}
    if (kind === 'progress') {
      const s = isStep(phrase) ? phrase : codeOfPhrase(phrase)
      if (s) {
        phrase = renderPhrase(s.code, s.vars, jobRow.language ?? DEFAULT_LANGUAGE)
        progress = { code: s.code, vars: s.vars }
      }
    }
    // A job on a message (`execute`) has no input: its progress goes to the whole team, as the message does (§7.10).
    return publish({ kind, jobId, memberId: jobRow.author_id, percent, phrase, data: { input_id: jobRow.input_id, ...(jobRow.message_id ? { message_id: jobRow.message_id } : {}), ...progress, ...data } })
  }

  /** Transaction that dispatches what was published inside once committed (never before: an uncommitted event does not exist). */
  function transaction (fn) {
    const outer = !db.isTransaction
    const result = tx(db, fn)
    if (outer) drain()
    return result
  }

  function subscribe (memberId, callback) {
    const s = { memberId, callback }
    subscribers.add(s)
    return () => subscribers.delete(s)
  }

  /** Events with `seq` greater than `afterSeq` that the member sees, in order. `jobId` narrows to one job. */
  function replay (memberId, afterSeq, { jobId = null } = {}) {
    if (jobId !== null) {
      return all(db, 'SELECT * FROM job_events WHERE seq > ? AND job_id = ? AND (member_id IS NULL OR member_id = ?) ORDER BY seq', afterSeq, jobId, memberId)
    }
    return all(db, 'SELECT * FROM job_events WHERE seq > ? AND (member_id IS NULL OR member_id = ?) ORDER BY seq', afterSeq, memberId)
  }

  /** The last `seq` ever issued, even if retention or a reset removed every row (AUTOINCREMENT keeps it in `sqlite_sequence`). */
  function lastIssued () {
    return get(db, "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'job_events'), 0) AS last").last
  }

  /**
   * Whether a replay after `afterSeq` leaves the client without a hole (the `replay` event of GET /events). `complete` is
   * true when every event the client may have missed is still in `job_events`, so replaying them is all it needs; it is
   * false when retention (or a reset of the test data) removed some of them, or when `afterSeq` is ahead of this database.
   *    */
  function replayCoverage (afterSeq) {
    const issued = lastIssued()
    if (afterSeq > issued) return { complete: false, from: afterSeq }
    if (afterSeq === issued) return { complete: true, from: afterSeq }
    const oldest = get(db, 'SELECT MIN(seq) AS oldest FROM job_events').oldest
    return { complete: oldest !== null && oldest <= afterSeq + 1, from: afterSeq }
  }

  /**
   * Initial snapshot of a new connection without `Last-Event-ID`: the latest progress of each of the member's
   * running jobs, so that a freshly opened tab shows the bar where it stands.
   */
  function snapshot (memberId) {
    return all(db, `
      SELECT e.* FROM job_events e
      WHERE e.kind = 'progress' AND e.member_id = ?
        AND e.seq = (SELECT MAX(x.seq) FROM job_events x WHERE x.job_id = e.job_id AND x.kind = 'progress')
        AND e.job_id IN (SELECT id FROM jobs WHERE status IN ('queued', 'running'))
      ORDER BY e.seq`, memberId)
  }

  function lastProgress (jobId) {
    const row = get(db, "SELECT percent, phrase, data_json, at FROM job_events WHERE job_id = ? AND kind = 'progress' ORDER BY seq DESC LIMIT 1", jobId)
    return row ? { percent: row.percent, phrase: row.phrase, at: row.at, ...progressCode(row) } : row
  }

  /**
   * With the worker in another process: queries `PRAGMA data_version` every `intervalMs` and dispatches what is new.
   * The value only changes through commits from OTHER connections (I03 §5.3).
   */
  function startPolling (intervalMs) {
    stopPolling()
    dataVersion = db.prepare('PRAGMA data_version').get().data_version
    timerHandle = setInterval(() => {
      const current = db.prepare('PRAGMA data_version').get().data_version
      if (current !== dataVersion) {
        dataVersion = current
        drain()
      }
    }, intervalMs)
    timerHandle.unref()
  }

  function stopPolling () {
    if (timerHandle) clearInterval(timerHandle)
    timerHandle = null
  }

  /** Retention: I03 §12, `job_events_retention_days` the same as finished jobs. */
  function purge (olderThanMs) {
    return run(db, 'DELETE FROM job_events WHERE at < ?', olderThanMs).changes
  }

  return { publish, publishForJob, drain, transaction, subscribe, replay, replayCoverage, lastIssued, snapshot, lastProgress, startPolling, stopPolling, purge }
}
