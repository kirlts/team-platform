// The `execute` job (UD-254): when a published message is assigned to an agent member, the engine enqueues one job per
// agent, with `message_id` and `member_id`. It runs inside the transaction that publishes or edits the message, so the
// job exists exactly when the assignment does. A message that already has a queued or running job for that agent does
// not get a second one.

import { all, get, run } from '../db/index.js'
import { jobDefaults, queueWake } from '../queue/wake.js'

/** Enqueues one `execute` job for (message, agent) unless one is queued or running. Returns the job id or null. */
export function enqueueExecute (db, { messageId, memberId, requestedBy = null, now = Date.now, maxAttempts = jobDefaults.executeMaxAttempts }) {
  const busy = get(db, `SELECT id FROM jobs WHERE kind = 'execute' AND message_id = ? AND status IN ('queued', 'running')
                         AND json_extract(payload_json, '$.member_id') = ?`, messageId, memberId)
  if (busy) return null
  const t = now()
  const r = run(db, `INSERT INTO jobs (kind, message_id, payload_json, status, priority, attempts, max_attempts, run_at, created_at)
                     VALUES ('execute', ?, ?, 'queued', 0, 0, ?, ?, ?)`,
  messageId, JSON.stringify({ message_id: messageId, member_id: memberId, requested_by: requestedBy }), maxAttempts, t, t)
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
