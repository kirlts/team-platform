// SQLite job queue (MASTER-SPEC §7.3, report 03). pg-boss pattern: atomic claim with
// lease, heartbeat, retries with exponential backoff and jitter, attempt fence on close.
//
// Rules measured in report 03:
//  - The claim is UPDATE … WHERE id = (SELECT … LIMIT 1) RETURNING. `UPDATE … LIMIT 1` is a syntax error.
//  - Every transaction that reads and then writes starts with BEGIN IMMEDIATE; with a 5 s busy_timeout there was not
//    a single error or duplicate claim (M2: 13,768 claims, 13,768 distinct jobs).
//  - Attempt fence: complete/fail/heartbeat/progress only count if the job is still
//    `running` with the same attempt number. A worker whose lease expired cannot close another's attempt.

import { traceContextFor } from './trace-context.js'
import { EventEmitter } from 'node:events'
import { all, get, run, tx } from '../db/index.js'
import { iso, parseJson } from '../db/util.js'
import { pruneSpans } from '../telemetry/index.js'
import { pruneExecuteRuns } from '../telemetry/execute-runs.js'
import { jobDefaults, queueWake } from './wake.js'

export { queueWake } from './wake.js'

/** Attempts a job gets when it fails by infrastructure or its lease expires, whatever its `max_attempts` (a job with 1 still gets one more try). */
export const INFRA_ATTEMPTS = 2 // Martín's decision 2026-10-23: what fails by infrastructure runs once more and then goes to a person

export function createQueue ({ db, config, events, now = Date.now, random = Math.random }) {
  const signals = new EventEmitter() // 'enqueued', 'cancelled', 'leaseFailed'
  queueWake.on('enqueued', (id) => signals.emit('enqueued', id))
  queueWake.on('cancelled', (id) => signals.emit('cancelled', id)) // a job cancelled outside a queue (the agent left the message)
  if (config.execute) { jobDefaults.executeMaxAttempts = config.execute.maxAttempts; jobDefaults.deliverMaxAttempts = config.execute.deliverMaxAttempts }
  const w = config.worker
  jobDefaults.extractMaxAttempts = w.maxAttempts

  /** Delay of retry n (n ≥ 1): min(cap, base × 2^(n−1)) minus a random fraction of up to `jitter`. */
  function backoffMs (attempt) {
    const base = Math.min(w.retryMaxMs, w.retryBaseMs * 2 ** (attempt - 1))
    return Math.max(0, Math.round(base * (1 - random() * w.retryJitter)))
  }

  function enqueue (kind, payload = {}, { priority = 0, runAt = null, inputId = null, messageId = null, maxAttempts = w.maxAttempts } = {}) {
    const t = now()
    const tc = traceContextFor(db, { kind, inputId, messageId })
    const r = run(db,
      `INSERT INTO jobs (kind, input_id, message_id, payload_json, status, priority, attempts, max_attempts, run_at, created_at, trace_id, traceparent, link_traceparent)
       VALUES (?, ?, ?, ?, 'queued', ?, 0, ?, ?, ?, ?, ?, ?)`,
      kind, inputId, messageId, JSON.stringify(payload), priority, maxAttempts, runAt ?? t, t, tc.traceId, tc.traceparent, tc.link)
    const id = Number(r.lastInsertRowid)
    // Notifies the worker in the same process; with a separate worker `PRAGMA data_version` wakes it.
    queueMicrotask(() => signals.emit('enqueued', id))
    return id
  }

  /**
   * Returns to the queue, or marks as failed, the `running` jobs with an expired lease (MS §7.3, §4.3).
   * The attempt was already counted on claim: if it exhausted `max_attempts` it goes to `failed`. An expired lease is a failure of the
   * infrastructure (the process died), so a job whose `max_attempts` is 1 still gets one more try (INFRA_ATTEMPTS).
   * The jobs it fails are announced as `leaseFailed` (after the transaction): the claim recovers leases too, and a handler that never hears of a job
   * that the queue failed leaves its message without an answer (2026-10-23, job 99).
   */
  function recoverExpiredLeases ({ spare = null, running = null } = {}) {
    const t = now()
    const result = tx(db, () => {
      // `spare`: the worker that asks. A job it still runs is alive in its own process, and an expired lease on it means the clock jumped (a laptop that
      // slept, an NTP step) and its heartbeat has not run yet: recovering it would requeue a healthy session and kill it through the fence.
      // `running`: the ids of the jobs that worker really holds in memory. With it the worker spares exactly those, not everything under its name: a job
      // of its own whose end could not be written (the database refused) has no heartbeat and nobody running it, and only its lease can free it.
      const own = Array.isArray(running)
      const expired = own
        ? all(db, "SELECT id, attempts, max_attempts FROM jobs WHERE status = 'running' AND lease_until < ?", t).filter((j) => !running.includes(j.id))
        : all(db, "SELECT id, attempts, max_attempts FROM jobs WHERE status = 'running' AND lease_until < ? AND (worker_id IS NULL OR worker_id <> ?)", t, spare ?? '')
      const finished = []
      for (const j of expired) {
        const limit = Math.max(j.max_attempts, INFRA_ATTEMPTS)
        if (j.attempts >= limit) {
          run(db, "UPDATE jobs SET status = 'failed', lease_until = NULL, worker_id = NULL, finished_at = ?, last_error = ? WHERE id = ?",
            t, 'El arriendo venció sin que el trabajo terminara (el proceso se detuvo o tardó más que el límite).', j.id)
          finished.push(j.id)
        } else {
          run(db, "UPDATE jobs SET status = 'queued', lease_until = NULL, worker_id = NULL, run_at = ?, max_attempts = ?, last_error = ? WHERE id = ?",
            t, limit, 'El arriendo venció; el trabajo vuelve a la cola.', j.id)
        }
      }
      return { recovered: expired.length - finished.length, failedIds: finished }
    })
    if (result.failedIds.length > 0) queueMicrotask(() => signals.emit('leaseFailed', result.failedIds))
    return result
  }

  /**
   * How many jobs of a kind may run at once, for the kinds that hold a lane. `deliver` is one: two deliveries to production at the same time collide
   * («lo servido no es un antecesor de este árbol», three messages with the same fix, 2026-10-23). `execute` leaves two slots of the worker to the analysis:
   * sessions last up to an hour and, with the eight slots taken, the analysis of every new input waited behind them.
   */
  function lanes () {
    const x = config.execute
    if (!x) return {}
    return {
      deliver: x.deliverConcurrency,
      execute: x.concurrency > 0 ? x.concurrency : Math.max(1, w.concurrency - 2)
    }
  }

  /**
   * Claims the next due job, or null. UD-025 fairness: inside the queue, the jobs of one author keep their arrival
   * order (job id) and different authors interleave. Each due job gets a `turn` = the author's jobs already running
   * plus its position among the author's due jobs (the author of its input; a job without input is its own author).
   * Counting the running ones is what makes the rotation hold while a burst is being claimed: without it, claiming
   * an author's first job would turn its second into turn 1 again. Every author's next job therefore goes before
   * anybody's following one, and the ties of a turn keep the old order: priority, run_at, id. The attempt count of
   * the returned row is the attempt in progress.
   */
  function claim (workerId, leaseMs = w.leaseMs, { running = null } = {}) {
    const t = now()
    return tx(db, () => {
      // Recovering first keeps the claim a pure `queued` query (MS §7.3).
      const expired = get(db, "SELECT 1 AS hay FROM jobs WHERE status = 'running' AND lease_until < ? AND worker_id <> ? LIMIT 1", t, workerId)
      if (expired) recoverExpiredLeases({ spare: workerId, running })
      const caps = lanes()
      const busy = Object.fromEntries(all(db, "SELECT kind, COUNT(*) AS n FROM jobs WHERE status = 'running' AND kind IN ('execute', 'deliver') GROUP BY kind").map((r) => [r.kind, r.n]))
      const full = Object.keys(caps).filter((kind) => (busy[kind] ?? 0) >= caps[kind])
      const dbRow = get(db, `
        UPDATE jobs
           SET status = 'running', worker_id = ?, lease_until = ?, attempts = attempts + 1
         WHERE id = (SELECT id FROM (
                       SELECT j.id, j.priority, j.run_at,
                              ROW_NUMBER() OVER (PARTITION BY COALESCE(i.author_id, -j.id) ORDER BY j.id)
                              + (SELECT COUNT(*) FROM jobs r JOIN inputs ri ON ri.id = r.input_id
                                  WHERE r.status = 'running' AND ri.author_id = i.author_id) AS turn
                         FROM jobs j LEFT JOIN inputs i ON i.id = j.input_id
                        WHERE j.status = 'queued' AND j.run_at <= ?${full.length ? ` AND j.kind NOT IN (${full.map(() => '?').join(', ')})` : ''})
                      ORDER BY turn, priority DESC, run_at, id
                      LIMIT 1)
        RETURNING *`, workerId, t + leaseMs, t, ...full)
      return dbRow ?? null
    })
  }

  const isCurrent = (job) => get(db, "SELECT 1 AS ok FROM jobs WHERE id = ? AND status = 'running' AND attempts = ?", job.id, job.attempts)

  /** Renews the lease. Returns false if the job is no longer this attempt's (cancelled, expired, reassigned). */
  function heartbeat (job, leaseMs = w.leaseMs) {
    const r = run(db, "UPDATE jobs SET lease_until = ? WHERE id = ? AND status = 'running' AND attempts = ?", now() + leaseMs, job.id, job.attempts)
    return r.changes === 1
  }

  /** Records the job's progress (percentage and short phrase). Returns false if the attempt was lost. */
  function progress (job, percent, phrase) {
    return events.transaction(() => {
      if (!isCurrent(job)) return false
      events.publishForJob(job.id, { kind: 'progress', percent: Math.max(0, Math.min(100, Math.round(percent))), phrase })
      return true
    })
  }

  /** Closes the attempt successfully. Returns false if the attempt fence was lost. */
  function complete (job) {
    const r = run(db, "UPDATE jobs SET status = 'done', lease_until = NULL, worker_id = NULL, finished_at = ?, last_error = NULL WHERE id = ? AND status = 'running' AND attempts = ?",
      now(), job.id, job.attempts)
    return r.changes === 1
  }

  /**
   * Closes the attempt with an error. Requeues with exponential backoff and jitter up to `max_attempts`; an error with
   * `retryable === false` (or `permanent: true`) fails immediately with the reason visible.
   * Returns { state: 'requeued' | 'failed' | 'lost', delayMs } ('lost': the attempt fence was lost).
   */
  function fail (job, error, { permanent = false } = {}) {
    const msgRow = String(error?.message ?? error ?? 'Error desconocido').slice(0, 2000)
    // A failure of the infrastructure gets one more try even when `max_attempts` is 1 (UD-255 allows one attempt because a rerun spends the budget again;
    // a machine that never ran or a service that answered 529 spent nothing worth saving, and a person is told only after the second one).
    const limit = error?.infra ? Math.max(job.max_attempts, INFRA_ATTEMPTS) : job.max_attempts
    const isFinal = permanent || error?.retryable === false || job.attempts >= limit
    const t = now()
    if (isFinal) {
      const r = run(db, "UPDATE jobs SET status = 'failed', lease_until = NULL, worker_id = NULL, finished_at = ?, last_error = ? WHERE id = ? AND status = 'running' AND attempts = ?",
        t, msgRow, job.id, job.attempts)
      return { state: r.changes === 1 ? 'failed' : 'lost', delayMs: 0 }
    }
    // If the provider declared how long to wait (Retry-After header of a 429), that wait is the floor of the backoff:
    // with full jitter the delay could drop to ~100 ms and repeat the collision (measured on the VPS, 2026-10-21).
    const declared = Number(error?.retryAfterMs)
    const hinted = Number.isFinite(declared) && declared > 0 ? Math.min(declared, w.retryMaxMs) : 0
    const waitUntil = Math.max(backoffMs(job.attempts), hinted)
    const r = run(db, "UPDATE jobs SET status = 'queued', lease_until = NULL, worker_id = NULL, run_at = ?, max_attempts = ?, last_error = ? WHERE id = ? AND status = 'running' AND attempts = ?",
      t + waitUntil, limit, msgRow, job.id, job.attempts)
    if (r.changes === 1) {
      queueMicrotask(() => signals.emit('enqueued', job.id))
      return { state: 'requeued', delayMs: waitUntil }
    }
    return { state: 'lost', delayMs: 0 }
  }

  /** Shutdown: the job returns to the queue and the attempt is refunded (MS §7.3; `refundRetry` of liteque). */
  function release (job) {
    const r = run(db, "UPDATE jobs SET status = 'queued', lease_until = NULL, worker_id = NULL, run_at = ?, attempts = attempts - 1 WHERE id = ? AND status = 'running' AND attempts = ?",
      now(), job.id, job.attempts)
    return r.changes === 1
  }

  /**
   * Defers the job `delayMs` and refunds the attempt: it did not fail, it had no capacity (e.g. the hourly audio
   * budget of the extractors, MASTER-SPEC §7.4).
   */
  function defer (job, delayMs) {
    const r = run(db, "UPDATE jobs SET status = 'queued', lease_until = NULL, worker_id = NULL, run_at = ?, attempts = attempts - 1 WHERE id = ? AND status = 'running' AND attempts = ?",
      now() + delayMs, job.id, job.attempts)
    return r.changes === 1
  }

  /** Cancels a queued or running job. The worker learns of it through the fence (heartbeat or progress) or the signal. */
  function cancel (jobId) {
    const r = run(db, "UPDATE jobs SET status = 'cancelled', lease_until = NULL, worker_id = NULL, finished_at = ? WHERE id = ? AND status IN ('queued', 'running')", now(), jobId)
    if (r.changes === 1) signals.emit('cancelled', jobId)
    return r.changes === 1
  }

  function cancelForInput (inputId) {
    const ids = all(db, "SELECT id FROM jobs WHERE input_id = ? AND status IN ('queued', 'running')", inputId).map((j) => j.id)
    for (const id of ids) cancel(id)
    return ids
  }

  const getJob = (id) => get(db, 'SELECT * FROM jobs WHERE id = ?', id)
  const latestJobForInput = (inputId) => get(db, 'SELECT * FROM jobs WHERE input_id = ? ORDER BY id DESC LIMIT 1', inputId)

  /** Instant of the next queued job with a future `run_at` (to sleep exactly until then), or null. */
  function nextRunAt () {
    const dbRow = get(db, "SELECT MIN(run_at) AS t FROM jobs WHERE status = 'queued'")
    return dbRow?.t ?? null
  }

  const jobView = (j) => ({
    id: j.id, kind: j.kind, input_id: j.input_id, message_id: j.message_id ?? null, member_id: parseJson(j.payload_json, {}).member_id ?? null, status: j.status, priority: j.priority, attempts: j.attempts, max_attempts: j.max_attempts,
    run_at: iso(j.run_at), lease_until: iso(j.lease_until), worker_id: j.worker_id, last_error: j.last_error, created_at: iso(j.created_at), finished_at: iso(j.finished_at),
    trace_id: j.trace_id ?? null, phase: j.phase ?? null
  })

  /** The queue, filterable by state and paginated, for the editor. */
  function listJobs ({ state = null, limit, offset }) {
    const cond = state ? 'WHERE status = ?' : ''
    const params = state ? [state] : []
    const total = get(db, `SELECT COUNT(*) AS n FROM jobs ${cond}`, ...params).n
    const rows = all(db, `SELECT * FROM jobs ${cond} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, offset)
    return { total, items: rows.map(jobView) }
  }

  /** Purge of finished jobs (done, failed or cancelled); their events go with them (ON DELETE CASCADE). */
  function purgeJobs (state) {
    if (!['done', 'failed', 'cancelled'].includes(state)) throw new Error('Sólo se purgan trabajos terminados.')
    return run(db, 'DELETE FROM jobs WHERE status = ?', state).changes
  }

  function stats () {
    const rows = all(db, 'SELECT status, COUNT(*) AS n FROM jobs GROUP BY status')
    return Object.fromEntries(rows.map((f) => [f.status, f.n]))
  }

  /** Retention (I03 §12): finished jobs and events older than `retentionDays` days. */
  function sweepRetention () {
    const cap = now() - w.retentionDays * 24 * 3600 * 1000
    return tx(db, () => {
      const jobs = run(db, "DELETE FROM jobs WHERE status IN ('done', 'failed', 'cancelled') AND finished_at < ?", cap).changes
      const eventsDeleted = events.purge(cap)
      const sessions = run(db, 'DELETE FROM sessions WHERE expires_at < ?', now()).changes
      const nonces = run(db, 'DELETE FROM sso_nonces WHERE created_at < ?', cap).changes
      const spans = pruneSpans(db, { now: now(), retentionDays: w.retentionDays }) // same retention as the events (§7.10 bis)
      const runs = config.execute ? pruneExecuteRuns(db, { now: now(), retentionDays: config.execute.runsRetentionDays }) : 0 // its own retention: EXECUTE_RUNS_RETENTION_DAYS (UD-262)
      return { jobs, events: eventsDeleted, sessions, nonces, spans, runs }
    })
  }

  return {
    enqueue, claim, heartbeat, progress, complete, fail, release, defer, cancel, cancelForInput, recoverExpiredLeases,
    sweepRetention, nextRunAt, stats, listJobs, purgeJobs, backoffMs, getJob, latestJobForInput, signals
  }
}
