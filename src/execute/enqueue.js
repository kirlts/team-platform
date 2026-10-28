// The `execute` job (UD-254): when a published message is assigned to an agent member, the engine enqueues one job per
// agent, with `message_id` and `member_id`. It runs inside the transaction that publishes or edits the message, so the
// job exists exactly when the assignment does. A message that already has a queued or running job for that agent does
// not get a second one. `enqueueDeliver` enqueues the job that follows it (UD-263).

import { all, get, run } from '../db/index.js'
import { jobDefaults, queueWake } from '../queue/wake.js'
import { traceContextFor } from '../queue/trace-context.js'

/** Enqueues one `execute` job for (message, agent) unless one is queued or running. Returns the job id or null. */
export function enqueueExecute (db, { messageId, memberId, requestedBy = null, now = Date.now, maxAttempts = jobDefaults.executeMaxAttempts, extra = {}, exceptJobId = 0, exceptDeliverJobId = 0 }) {
  // `exceptJobId`: the job that is ending and asks for its own continuation (UD-295) does not block it.
  const busy = get(db, `SELECT id FROM jobs WHERE kind = 'execute' AND message_id = ? AND status IN ('queued', 'running') AND id <> ?
                         AND json_extract(payload_json, '$.member_id') = ?`, messageId, exceptJobId, memberId)
  if (busy) return null
  // A delivery of the message is verifying or deploying its branch: a second session on the same branch now would change what it checks.
  if (get(db, "SELECT id FROM jobs WHERE kind = 'deliver' AND message_id = ? AND status IN ('queued', 'running') AND id <> ?", messageId, exceptDeliverJobId)) return null
  const t = now()
  const tc = traceContextFor(db, { kind: 'execute', messageId })
  const r = run(db, `INSERT INTO jobs (kind, message_id, payload_json, status, priority, attempts, max_attempts, run_at, created_at, trace_id, traceparent, link_traceparent)
                     VALUES ('execute', ?, ?, 'queued', 0, 0, ?, ?, ?, ?, ?, ?)`,
  messageId, JSON.stringify({ message_id: messageId, member_id: memberId, requested_by: requestedBy, ...extra }), maxAttempts, t, t, tc.traceId, tc.traceparent, tc.link)
  const id = Number(r.lastInsertRowid)
  queueMicrotask(() => queueWake.emit('enqueued', id))
  return id
}

/**
 * Enqueues the `deliver` job of a message (UD-263): the host's delivery command, run after `execute` ends with `outcome: done`, or by hand.
 * `payload` carries { member_id, branch, round, output, execute_job_id, execute_attempt, requested_by }. A message has one `deliver` job at
 * a time: with another queued or running it returns null.
 */
export function enqueueDeliver (db, { messageId, payload, now = Date.now, maxAttempts = jobDefaults.deliverMaxAttempts }) {
  if (get(db, "SELECT id FROM jobs WHERE kind = 'deliver' AND message_id = ? AND status IN ('queued', 'running')", messageId)) return null
  const t = now()
  const tc = traceContextFor(db, { kind: 'deliver', messageId })
  const r = run(db, `INSERT INTO jobs (kind, message_id, payload_json, status, priority, attempts, max_attempts, run_at, created_at, trace_id, traceparent, link_traceparent)
                     VALUES ('deliver', ?, ?, 'queued', 0, 0, ?, ?, ?, ?, ?, ?)`,
  messageId, JSON.stringify({ message_id: messageId, ...payload }), maxAttempts, t, t, tc.traceId, tc.traceparent, tc.link)
  const id = Number(r.lastInsertRowid)
  queueMicrotask(() => queueWake.emit('enqueued', id))
  return id
}

/** The active agents among `memberIds` (or among the message's assignees when omitted) get their `execute` job. */
export function enqueueExecuteForAgents (db, messageId, { memberIds = null, now = Date.now } = {}) {
  const ids = memberIds ?? all(db, 'SELECT member_id FROM message_assignees WHERE message_id = ?', messageId).map((r) => r.member_id)
  if (ids.length === 0) return []
  const agents = all(db, `SELECT id FROM members WHERE kind = 'agent' AND active = 1 AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ...ids)
  return agents.map((a) => enqueueExecute(db, { messageId, memberId: a.id, now })).filter((id) => id !== null)
}

/**
 * The agent left the message (an edit took it out of the assignees): its `execute` jobs, queued or running, and its queued `deliver` job stop. A
 * running session is stopped by the worker (`cancelled` reaches it through the queue wake-up); a delivery already running is not cut half way: it is
 * a deploy, and it posts its reply when it ends. Returns the cancelled job ids.
 */
export function cancelAgentJobs (db, { messageId, memberIds, now = Date.now }) {
  const ids = []
  for (const memberId of memberIds) {
    const rows = all(db, `SELECT id FROM jobs WHERE message_id = ? AND json_extract(payload_json, '$.member_id') = ?
                           AND ((kind = 'execute' AND status IN ('queued', 'running')) OR (kind = 'deliver' AND status = 'queued'))`, messageId, memberId)
    for (const { id } of rows) {
      run(db, "UPDATE jobs SET status = 'cancelled', lease_until = NULL, worker_id = NULL, finished_at = ? WHERE id = ?", now(), id)
      ids.push(id)
    }
  }
  if (ids.length > 0) queueMicrotask(() => { for (const id of ids) queueWake.emit('cancelled', id) })
  return ids
}
