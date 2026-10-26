// A message does not stay dead on an infrastructure failure. The `execute` or `deliver` job that ended in a cause of the environment (the work machine, the
// connection, the time limit, the delivery command missing from the image: exit 127) is launched again by the system, by event and never by clock: when the
// worker starts (a deploy that brings the fix restarts it) and when capacity comes back (a session ended well). It is the same origin and the same rule as
// «Reintentar» (`retryBlock`, `retryExecute`), so what a person could not retry (`not_retryable`), a closed message, an agent that left it and a job already
// queued (`retry_stale`, `execute_busy`) are not launched. A work shown and waiting for a person's answer (UD-307) has no failed job: it is not here.
// Nothing reads text (RULES 4): the cause is the code of the failure.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { all, get, run } from '../db/index.js'
import { addResumeNote } from '../domain/progress-notes.js'
import { retryBlock, retryExecute, watchBudget } from './retry.js'

// Failure code of a notice → cause of the environment. A code that is not here is not an infrastructure failure: the verification of a change that failed
// (`deliver_failed`) goes back to Claude by its own rule (UD-298), and the limits of one session (steps, spend) are not fixed by trying again at start.
const INFRA = {
  machine_create_failed: 'machine', execute_no_result: 'machine', execute_api_error: 'machine', capacity: 'machine',
  execute_timeout: 'timeout', deliver_timeout: 'timeout',
  deliver_env: 'deliver', lease_expired: 'interrupted', system: 'system',
  // The Guard of the idea could not be judged (the model service did not answer): the `infra` error of `idea-guard.js`. The failure of #125 on 2026-10-26 (jobs 204 to 220)
  // ended with this code and was not here, so no start picked it up. `resume.test.js` makes every code thrown with `infra(...)` appear in this table.
  idea_guard_unavailable: 'service'
}
// What comes back with capacity: the failures of getting a machine. The rest waits for the next start.
const CAPACITY = new Set(['machine_create_failed', 'capacity', 'execute_no_result'])

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let cachedVersion = null
/**
 * The identity of the code this worker runs: `TEAM_WORKER_VERSION` when the host declares it, else a hash of the source files. `package.json` carries a version that
 * never changes between deploys, so it cannot tell a start with the fix from a start without it. A failure is relaunched once per version: a cause that outlives
 * the relaunch is not tried at every restart of the same code.
 */
export function workerVersion (env = process.env) {
  if (env.TEAM_WORKER_VERSION) return env.TEAM_WORKER_VERSION
  if (cachedVersion) return cachedVersion
  const hash = createHash('sha256')
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) hash.update(entry.name).update(readFileSync(full))
    }
  }
  walk(SRC)
  cachedVersion = hash.digest('hex').slice(0, 12)
  return cachedVersion
}

/**
 * Launches again the infrastructure failures of open messages, once each per worker version. `trigger`: `start` (every infrastructure failure) or `capacity` (the machine
 * ones that the system had not already relaunched). Returns the job ids it enqueued. A failure that cannot be relaunched is skipped with its reason.
 */
export function resumeInfraFailures ({ db, config, events, now = Date.now, logger = null }, { trigger = 'start', version = workerVersion() } = {}) {
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
      if (payload.auto_resumed_version === version) continue // this version already relaunched it once: if the cause is still there, the next version (or a person) decides
      if (trigger === 'capacity' && payload.auto_resumed) continue // already relaunched once by the system: a person decides the next one
      const reply = get(db, 'SELECT id, message_id, failed_job_id, failed_code, deleted_at FROM replies WHERE id = ?', row.reply_id)
      if (retryBlock(db, reply) !== null) continue
      const memberId = payload.member_id
      const jobId = retryExecute({ db, config, events, now }, { messageId: row.message_id, replyId: row.reply_id, actor: { id: memberId }, source: `auto_${trigger}` })
      run(db, "UPDATE jobs SET payload_json = json_set(COALESCE(payload_json, '{}'), '$.auto_resumed_version', ?) WHERE id = ?", version, jobId) // the mark that stops a second relaunch by this version
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
