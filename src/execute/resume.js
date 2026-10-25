// A message does not stay dead on an infrastructure failure. The `execute` or `deliver` job that ended in a cause of the environment (the work machine, the
// connection, the time limit, the delivery command missing from the image: exit 127) is launched again by the system, by event and never by clock: when the
// worker starts (a deploy that brings the fix restarts it) and when capacity comes back (a session ended well). It is the same origin and the same rule as
// «Reintentar» (`retryBlock`, `retryExecute`), so what a person could not retry (`not_retryable`), a closed message, an agent that left it and a job already
// queued (`retry_stale`, `execute_busy`) are not launched. A work shown and waiting for a person's answer (UD-307) has no failed job: it is not here.
// Nothing reads text (RULES 4): the cause is the code of the failure.

import { all, get } from '../db/index.js'
import { addResumeNote } from '../domain/progress-notes.js'
import { retryBlock, retryExecute, watchBudget } from './retry.js'

// Failure code of a notice → cause of the environment. A code that is not here is not an infrastructure failure: the verification of a change that failed
// (`deliver_failed`) goes back to Claude by its own rule (UD-298), and the limits of one session (steps, spend) are not fixed by trying again at start.
const INFRA = {
  machine_create_failed: 'machine', execute_no_result: 'machine', execute_api_error: 'machine', capacity: 'machine',
  execute_timeout: 'timeout', deliver_timeout: 'timeout',
  deliver_env: 'deliver', lease_expired: 'interrupted', system: 'system'
}
// What comes back with capacity: the failures of getting a machine. The rest waits for the next start.
const CAPACITY = new Set(['machine_create_failed', 'capacity', 'execute_no_result'])

/**
 * Launches again the infrastructure failures of open messages, once each. `trigger`: `start` (every infrastructure failure) or `capacity` (the machine
 * ones that the system had not already relaunched). Returns the job ids it enqueued. A failure that cannot be relaunched is skipped with its reason.
 */
export function resumeInfraFailures ({ db, config, events, now = Date.now, logger = null }, { trigger = 'start' } = {}) {
  watchBudget(db, config, now)
  const codes = Object.keys(INFRA).filter((c) => trigger === 'start' || CAPACITY.has(c))
  const rows = all(db, `
    SELECT r.id AS reply_id, r.message_id, r.failed_code, r.failed_job_id, j.kind, j.payload_json
      FROM replies r
      JOIN jobs j ON j.id = r.failed_job_id AND j.status = 'failed'
      JOIN messages m ON m.id = r.message_id AND m.deleted_at IS NULL AND m.status <> 'closed'
     WHERE r.deleted_at IS NULL AND r.failed_code IN (${codes.map(() => '?').join(',')})
       AND r.id = (SELECT MAX(x.id) FROM replies x WHERE x.message_id = r.message_id AND x.failed_job_id IS NOT NULL AND x.deleted_at IS NULL)
     ORDER BY r.id`, ...codes)
  const launched = []
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json ?? '{}')
      if (trigger === 'capacity' && payload.auto_resumed) continue // already relaunched once by the system: a person decides the next one
      const reply = get(db, 'SELECT id, message_id, failed_job_id, failed_code, deleted_at FROM replies WHERE id = ?', row.reply_id)
      if (retryBlock(db, reply) !== null) continue
      const memberId = payload.member_id
      const jobId = retryExecute({ db, config, events, now }, { messageId: row.message_id, replyId: row.reply_id, actor: { id: memberId }, source: `auto_${trigger}` })
      const language = get(db, 'SELECT a.language FROM messages m JOIN members a ON a.id = m.author_id WHERE m.id = ?', row.message_id)?.language
      addResumeNote({ db, events, now }, { messageId: row.message_id, jobId, authorId: memberId, cause: INFRA[row.failed_code], trigger, language })
      launched.push(jobId)
    } catch (e) {
      logger?.warn({ err: e, reply_id: row.reply_id }, 'could not relaunch a failed job on its own')
    }
  }
  if (launched.length > 0) logger?.info({ trigger, jobs: launched }, 'infrastructure failures relaunched on their own')
  return launched
}
