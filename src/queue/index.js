// Cola de trabajos sobre SQLite (MASTER-SPEC §7.3, informe 03). Patrón de pg-boss: reclamo atómico con
// arriendo, latido, reintentos con retroceso exponencial y jitter, barrera de intento al cerrar.
//
// Reglas medidas en el informe 03:
//  - El reclamo es UPDATE … WHERE id = (SELECT … LIMIT 1) RETURNING. `UPDATE … LIMIT 1` es error de sintaxis.
//  - Toda transacción que lee y luego escribe empieza con BEGIN IMMEDIATE; con busy_timeout de 5 s no hubo
//    un solo error ni reclamo duplicado (M2: 13.768 reclamos, 13.768 trabajos distintos).
//  - Barrera de intento (attempt fence): complete/fail/heartbeat/progress sólo valen si el trabajo sigue
//    `running` con el mismo número de intento. Un worker cuyo arriendo venció no puede cerrar el intento de otro.

import { EventEmitter } from 'node:events'
import { all, get, run, tx } from '../db/index.js'
import { iso } from '../db/util.js'

export function createQueue ({ db, config, events, now = Date.now, random = Math.random }) {
  const signals = new EventEmitter() // 'enqueued', 'cancelled'
  const w = config.worker

  /** Retraso del reintento n (n ≥ 1): min(tope, base × 2^(n−1)) menos una fracción al azar de hasta `jitter`. */
  function backoffMs (attempt) {
    const base = Math.min(w.retryMaxMs, w.retryBaseMs * 2 ** (attempt - 1))
    return Math.max(0, Math.round(base * (1 - random() * w.retryJitter)))
  }

  function enqueue (kind, payload = {}, { priority = 0, runAt = null, inputId = null, maxAttempts = w.maxAttempts } = {}) {
    const t = now()
    const r = run(db,
      `INSERT INTO jobs (kind, input_id, payload_json, status, priority, attempts, max_attempts, run_at, created_at)
       VALUES (?, ?, ?, 'queued', ?, 0, ?, ?, ?)`,
      kind, inputId, JSON.stringify(payload), priority, maxAttempts, runAt ?? t, t)
    const id = Number(r.lastInsertRowid)
    // Avisa al worker del mismo proceso; con worker aparte lo despierta `PRAGMA data_version`.
    queueMicrotask(() => signals.emit('enqueued', id))
    return id
  }

  /**
   * Devuelve a la cola, o marca fallidos, los trabajos `running` con arriendo vencido (MS §7.3, §4.3).
   * El intento ya se contó al reclamar: si agotó `max_attempts` pasa a `failed`.
   */
  function recoverExpiredLeases () {
    const t = now()
    return tx(db, () => {
      const expired = all(db, "SELECT id, attempts, max_attempts FROM jobs WHERE status = 'running' AND lease_until < ?", t)
      const finished = []
      for (const j of expired) {
        if (j.attempts >= j.max_attempts) {
          run(db, "UPDATE jobs SET status = 'failed', lease_until = NULL, worker_id = NULL, finished_at = ?, last_error = ? WHERE id = ?",
            t, 'El arriendo venció sin que el trabajo terminara (el proceso se detuvo o tardó más que el límite).', j.id)
          finished.push(j.id)
        } else {
          run(db, "UPDATE jobs SET status = 'queued', lease_until = NULL, worker_id = NULL, run_at = ?, last_error = ? WHERE id = ?",
            t, 'El arriendo venció; el trabajo vuelve a la cola.', j.id)
        }
      }
      return { recovered: expired.length - finished.length, failedIds: finished }
    })
  }

  /** Reclama el siguiente trabajo vencido de `run_at`. Devuelve la fila (con `attempts` = el intento en curso) o null. */
  function claim (workerId, leaseMs = w.leaseMs) {
    const t = now()
    return tx(db, () => {
      // Recuperar primero mantiene la consulta de reclamo exactamente como la fija §7.3 (sólo `queued`).
      const expired = get(db, "SELECT 1 AS hay FROM jobs WHERE status = 'running' AND lease_until < ? LIMIT 1", t)
      if (expired) recoverExpiredLeases()
      const dbRow = get(db, `
        UPDATE jobs
           SET status = 'running', worker_id = ?, lease_until = ?, attempts = attempts + 1
         WHERE id = (SELECT id FROM jobs
                      WHERE status = 'queued' AND run_at <= ?
                      ORDER BY priority DESC, run_at, id
                      LIMIT 1)
        RETURNING *`, workerId, t + leaseMs, t)
      return dbRow ?? null
    })
  }

  const isCurrent = (job) => get(db, "SELECT 1 AS ok FROM jobs WHERE id = ? AND status = 'running' AND attempts = ?", job.id, job.attempts)

  /** Renueva el arriendo. Devuelve false si el trabajo ya no es de este intento (cancelado, vencido, reasignado). */
  function heartbeat (job, leaseMs = w.leaseMs) {
    const r = run(db, "UPDATE jobs SET lease_until = ? WHERE id = ? AND status = 'running' AND attempts = ?", now() + leaseMs, job.id, job.attempts)
    return r.changes === 1
  }

  /** Registra el avance del trabajo (porcentaje y frase breve). Devuelve false si se perdió el intento. */
  function progress (job, percent, phrase) {
    return events.transaction(() => {
      if (!isCurrent(job)) return false
      events.publishForJob(job.id, { kind: 'progress', percent: Math.max(0, Math.min(100, Math.round(percent))), phrase })
      return true
    })
  }

  /** Cierra el intento con éxito. Devuelve false si se perdió la barrera de intento. */
  function complete (job) {
    const r = run(db, "UPDATE jobs SET status = 'done', lease_until = NULL, worker_id = NULL, finished_at = ?, last_error = NULL WHERE id = ? AND status = 'running' AND attempts = ?",
      now(), job.id, job.attempts)
    return r.changes === 1
  }

  /**
   * Cierra el intento con error. Reencola con retroceso exponencial y jitter hasta `max_attempts`; un error con
   * `retryable === false` (o `permanent: true`) falla de inmediato con el motivo visible.
   * Devuelve { state: 'requeued' | 'failed' | 'lost', delayMs } ('lost': se perdió la barrera de intento).
   */
  function fail (job, error, { permanent = false } = {}) {
    const msgRow = String(error?.message ?? error ?? 'Error desconocido').slice(0, 2000)
    const isFinal = permanent || error?.retryable === false || job.attempts >= job.max_attempts
    const t = now()
    if (isFinal) {
      const r = run(db, "UPDATE jobs SET status = 'failed', lease_until = NULL, worker_id = NULL, finished_at = ?, last_error = ? WHERE id = ? AND status = 'running' AND attempts = ?",
        t, msgRow, job.id, job.attempts)
      return { state: r.changes === 1 ? 'failed' : 'lost', delayMs: 0 }
    }
    const waitUntil = backoffMs(job.attempts)
    const r = run(db, "UPDATE jobs SET status = 'queued', lease_until = NULL, worker_id = NULL, run_at = ?, last_error = ? WHERE id = ? AND status = 'running' AND attempts = ?",
      t + waitUntil, msgRow, job.id, job.attempts)
    if (r.changes === 1) {
      queueMicrotask(() => signals.emit('enqueued', job.id))
      return { state: 'requeued', delayMs: waitUntil }
    }
    return { state: 'lost', delayMs: 0 }
  }

  /** Apagado: el trabajo vuelve a la cola y el intento se reembolsa (MS §7.3; `refundRetry` de liteque). */
  function release (job) {
    const r = run(db, "UPDATE jobs SET status = 'queued', lease_until = NULL, worker_id = NULL, run_at = ?, attempts = attempts - 1 WHERE id = ? AND status = 'running' AND attempts = ?",
      now(), job.id, job.attempts)
    return r.changes === 1
  }

  /**
   * Aplaza el trabajo `delayMs` y reembolsa el intento: no falló, no tuvo cupo (p. ej. el presupuesto de audio
   * por hora de los extractores, MASTER-SPEC §7.4).
   */
  function defer (job, delayMs) {
    const r = run(db, "UPDATE jobs SET status = 'queued', lease_until = NULL, worker_id = NULL, run_at = ?, attempts = attempts - 1 WHERE id = ? AND status = 'running' AND attempts = ?",
      now() + delayMs, job.id, job.attempts)
    return r.changes === 1
  }

  /** Cancela un trabajo en cola o en curso. El worker se entera por la barrera (latido o progreso) o por la señal. */
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

  /** Instante del próximo trabajo en cola con `run_at` futuro (para dormir exactamente hasta entonces), o null. */
  function nextRunAt () {
    const dbRow = get(db, "SELECT MIN(run_at) AS t FROM jobs WHERE status = 'queued'")
    return dbRow?.t ?? null
  }

  const jobView = (j) => ({
    id: j.id, kind: j.kind, input_id: j.input_id, status: j.status, priority: j.priority, attempts: j.attempts, max_attempts: j.max_attempts,
    run_at: iso(j.run_at), lease_until: iso(j.lease_until), worker_id: j.worker_id, last_error: j.last_error, created_at: iso(j.created_at), finished_at: iso(j.finished_at)
  })

  /** La cola, filtrable por estado y paginada, para el editor. */
  function listJobs ({ state = null, limit, offset }) {
    const cond = state ? 'WHERE status = ?' : ''
    const params = state ? [state] : []
    const total = get(db, `SELECT COUNT(*) AS n FROM jobs ${cond}`, ...params).n
    const rows = all(db, `SELECT * FROM jobs ${cond} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, offset)
    return { total, items: rows.map(jobView) }
  }

  /** Purga de trabajos terminados (done, failed o cancelled); sus eventos caen con ellos (ON DELETE CASCADE). */
  function purgeJobs (state) {
    if (!['done', 'failed', 'cancelled'].includes(state)) throw new Error('Sólo se purgan trabajos terminados.')
    return run(db, 'DELETE FROM jobs WHERE status = ?', state).changes
  }

  function stats () {
    const rows = all(db, 'SELECT status, COUNT(*) AS n FROM jobs GROUP BY status')
    return Object.fromEntries(rows.map((f) => [f.status, f.n]))
  }

  /** Retención (I03 §12): trabajos terminados y eventos con más de `retentionDays` días. */
  function sweepRetention () {
    const cap = now() - w.retentionDays * 24 * 3600 * 1000
    return tx(db, () => {
      const jobList = run(db, "DELETE FROM jobs WHERE status IN ('done', 'failed', 'cancelled') AND finished_at < ?", cap).changes
      const eventList = events.purge(cap)
      const sessionCount = run(db, 'DELETE FROM sessions WHERE expires_at < ?', now()).changes
      const nonces = run(db, 'DELETE FROM sso_nonces WHERE created_at < ?', cap).changes
      return { jobList, eventList, sessionCount, nonces }
    })
  }

  return {
    enqueue, claim, heartbeat, progress, complete, fail, release, defer, cancel, cancelForInput, recoverExpiredLeases,
    sweepRetention, nextRunAt, stats, listJobs, purgeJobs, backoffMs, getJob, latestJobForInput, signals
  }
}
