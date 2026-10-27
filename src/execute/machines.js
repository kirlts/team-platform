// The register of the machines of the `execute` job (plan 2026, piece B4: nothing is left alive without being attended).
//
// A machine is written down BEFORE CREATE runs and closed when DESTROY exits 0. What stays open is what a worker that died (SIGKILL, a power cut) or
// a DESTROY that failed left behind; the worker destroys it when it starts and when a lease expires (an event of the queue), never a person.
// A DESTROY that fails (permission, network, a host that does not answer) is recorded with its message and stays open: it is never read as «there
// is no machine» (plan 2026 §4.6). It is tried again at the next start of the worker, not on a clock, because the host's orders may cost CPU or
// money on each call.

import { all, get, run as runSql } from '../db/index.js'
import { destroyMachine } from './runners.js'

const MS_PER_DAY = 24 * 3600 * 1000 // calendar constant, not a tunable
const ERROR_KEPT = 2000 // characters of the end of stderr kept: the cause comes last on a machine (job 132, 2026-10-24)

/** Writes the machine down before CREATE runs. Returns the id of the row. */
export function openMachine (db, { jobId, attempt, machine, workdir, now = Date.now() }) {
  return Number(runSql(db, 'INSERT INTO execute_machines (job_id, attempt, machine, workdir, created_at) VALUES (?, ?, ?, ?, ?)', jobId, attempt, machine, workdir, now).lastInsertRowid)
}

/** The name CREATE printed replaces the default one. */
export function nameMachine (db, id, machine) {
  runSql(db, 'UPDATE execute_machines SET machine = ? WHERE id = ?', machine, id)
}

/**
 * CREATE of the next attempt named `machine`: the older open rows of the job that name the same machine continue under the new row and are deleted (the
 * attempt that took over the machine of a worker that shut down or died owns it now). The ones that name another machine stay open: the sweep destroys
 * them when the job ends.
 */
export function adoptPrevious (db, { jobId, machine, exceptId }) {
  runSql(db, 'DELETE FROM execute_machines WHERE job_id = ? AND destroyed_at IS NULL AND machine = ? AND id < ?', jobId, machine, exceptId)
}

/** Records the result of a DESTROY: exit 0 closes the row; anything else keeps it open with the message. */
export function recordDestroy (db, id, { code, stderr = '', now = Date.now() }) {
  if (code === 0) {
    runSql(db, 'UPDATE execute_machines SET destroyed_at = ?, destroy_attempts = destroy_attempts + 1, destroy_error = NULL WHERE id = ?', now, id)
  } else {
    const why = `exit ${code ?? 'none'}: ${String(stderr).trim().slice(-ERROR_KEPT) || 'no message'}`
    runSql(db, 'UPDATE execute_machines SET destroy_attempts = destroy_attempts + 1, destroy_error = ? WHERE id = ?', why, id)
  }
}

// A machine has an owner while its job is still to run: `running` (a worker holds it, or its lease has expired and the queue is about to requeue it) or `queued` (it
// waits for its next attempt, which calls CREATE again and takes the machine over with `adoptPrevious`, or leaves it for the sweep when the job ends). The sweep must not
// destroy the machine of a job that is about to be claimed again: its CREATE would meet a container marked for removal (measured with a killed worker and a real Docker
// daemon: «container is marked for removal and cannot be started», machine_create_failed). Every other open row has no owner: its job is done, failed, cancelled or purged.
const ORPHANS = `
  SELECT m.* FROM execute_machines m LEFT JOIN jobs j ON j.id = m.job_id
   WHERE m.destroyed_at IS NULL
     AND COALESCE(j.status IN ('queued', 'running'), 0) = 0` // COALESCE: a purged job has no row, and NULL is not «false» for NOT

/** Open machines whose job is no longer to run. `untriedOnly`: only those whose DESTROY has not run yet (the ones that failed wait for the next start). */
export function orphanMachines (db, { untriedOnly = false } = {}) {
  return all(db, `${ORPHANS}${untriedOnly ? ' AND m.destroy_attempts = 0' : ''} ORDER BY m.id`)
}

/**
 * What the health view shows: `open` counts every machine without a recorded destruction (the ones of running jobs included, they are alive on purpose);
 * `failed` lists the ones whose DESTROY ran and did not exit 0. Healthy when idle: both are zero.
 */
export function machineHealth (db) {
  const open = get(db, 'SELECT COUNT(*) AS n FROM execute_machines WHERE destroyed_at IS NULL').n
  const failed = all(db, 'SELECT job_id, attempt, machine, destroy_attempts, destroy_error FROM execute_machines WHERE destroyed_at IS NULL AND destroy_attempts > 0 ORDER BY id')
    .map((r) => ({ job_id: String(r.job_id), attempt: r.attempt, machine: r.machine, attempts: r.destroy_attempts, error: r.destroy_error }))
  return { open, failed }
}

/** Own retention: the destroyed rows go with the runs. An open row is never deleted. */
export function pruneExecuteMachines (db, { now = Date.now(), retentionDays = 365 } = {}) {
  return Number(runSql(db, 'DELETE FROM execute_machines WHERE destroyed_at IS NOT NULL AND created_at < ?', now - retentionDays * MS_PER_DAY).changes)
}

/**
 * Destroys the orphan machines with the DESTROY order of the host. Several at a time (they are independent), at most `concurrency`.
 * `inFlight`: ids of the rows that this very process is destroying right now (a cancelled job whose DESTROY has not ended); they are not called twice.
 * Returns { destroyed, failed }. Never throws: a failure is in the row and in the log.
 */
export async function sweepMachines ({ db, config, logger = null, now = Date.now, untriedOnly = false, concurrency, inFlight = null }) {
  const x = config.execute
  if (!x || x.runner !== 'machine' || !x.machineDestroy) return { destroyed: 0, failed: 0 }
  let rows
  try { rows = orphanMachines(db, { untriedOnly }).filter((r) => !inFlight?.has(r.id)) } catch (error) { logger?.error({ err: error }, 'could not list the orphan machines'); return { destroyed: 0, failed: 0 } }
  const result = { destroyed: 0, failed: 0 }
  let next = 0
  const worker = async () => {
    for (;;) {
      const row = rows[next++]
      if (!row) return
      try {
        const done = await destroyMachine({ config, jobId: row.job_id, workdir: row.workdir, machine: row.machine })
        recordDestroy(db, row.id, { code: done.code, stderr: done.stderr, now: now() })
        if (done.code === 0) { result.destroyed++; logger?.warn({ job_id: row.job_id, machine: row.machine }, 'an orphan machine was destroyed') } else {
          result.failed++
          logger?.error({ job_id: row.job_id, machine: row.machine, exit: done.code, stderr: String(done.stderr).slice(-500) }, 'an orphan machine could not be destroyed; it stays registered and is tried again when the worker starts')
        }
      } catch (error) {
        result.failed++
        logger?.error({ err: error, job_id: row.job_id, machine: row.machine }, 'could not destroy or record an orphan machine')
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), rows.length) }, worker))
  return result
}
