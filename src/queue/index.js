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

export function createQueue ({ db, config, events, now = Date.now, random = Math.random }) {
  const señales = new EventEmitter() // 'enqueued', 'cancelled'
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
    queueMicrotask(() => señales.emit('enqueued', id))
    return id
  }

  /**
   * Devuelve a la cola, o marca fallidos, los trabajos `running` con arriendo vencido (MS §7.3, §4.3).
   * El intento ya se contó al reclamar: si agotó `max_attempts` pasa a `failed`.
   */
  function recoverExpiredLeases () {
    const t = now()
    return tx(db, () => {
      const vencidos = all(db, "SELECT id, attempts, max_attempts FROM jobs WHERE status = 'running' AND lease_until < ?", t)
      const terminados = []
      for (const j of vencidos) {
        if (j.attempts >= j.max_attempts) {
          run(db, "UPDATE jobs SET status = 'failed', lease_until = NULL, worker_id = NULL, finished_at = ?, last_error = ? WHERE id = ?",
            t, 'El arriendo venció sin que el trabajo terminara (el proceso se detuvo o tardó más que el límite).', j.id)
          terminados.push(j.id)
        } else {
          run(db, "UPDATE jobs SET status = 'queued', lease_until = NULL, worker_id = NULL, run_at = ?, last_error = ? WHERE id = ?",
            t, 'El arriendo venció; el trabajo vuelve a la cola.', j.id)
        }
      }
      return { recuperados: vencidos.length - terminados.length, fallidos: terminados }
    })
  }

  /** Reclama el siguiente trabajo vencido de `run_at`. Devuelve la fila (con `attempts` = el intento en curso) o null. */
  function claim (workerId, leaseMs = w.leaseMs) {
    const t = now()
    return tx(db, () => {
      // Recuperar primero mantiene la consulta de reclamo exactamente como la fija §7.3 (sólo `queued`).
      const vencidos = get(db, "SELECT 1 AS hay FROM jobs WHERE status = 'running' AND lease_until < ? LIMIT 1", t)
      if (vencidos) recoverExpiredLeases()
      const fila = get(db, `
        UPDATE jobs
           SET status = 'running', worker_id = ?, lease_until = ?, attempts = attempts + 1
         WHERE id = (SELECT id FROM jobs
                      WHERE status = 'queued' AND run_at <= ?
                      ORDER BY priority DESC, run_at, id
                      LIMIT 1)
        RETURNING *`, workerId, t + leaseMs, t)
      return fila ?? null
    })
  }

  const vigente = (job) => get(db, "SELECT 1 AS ok FROM jobs WHERE id = ? AND status = 'running' AND attempts = ?", job.id, job.attempts)

  /** Renueva el arriendo. Devuelve false si el trabajo ya no es de este intento (cancelado, vencido, reasignado). */
  function heartbeat (job, leaseMs = w.leaseMs) {
    const r = run(db, "UPDATE jobs SET lease_until = ? WHERE id = ? AND status = 'running' AND attempts = ?", now() + leaseMs, job.id, job.attempts)
    return r.changes === 1
  }

  /** Registra el avance del trabajo (porcentaje y frase breve). Devuelve false si se perdió el intento. */
  function progress (job, percent, phrase) {
    return events.transaction(() => {
      if (!vigente(job)) return false
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
    const mensaje = String(error?.message ?? error ?? 'Error desconocido').slice(0, 2000)
    const definitivo = permanent || error?.retryable === false || job.attempts >= job.max_attempts
    const t = now()
    if (definitivo) {
      const r = run(db, "UPDATE jobs SET status = 'failed', lease_until = NULL, worker_id = NULL, finished_at = ?, last_error = ? WHERE id = ? AND status = 'running' AND attempts = ?",
        t, mensaje, job.id, job.attempts)
      return { state: r.changes === 1 ? 'failed' : 'lost', delayMs: 0 }
    }
    const espera = backoffMs(job.attempts)
    const r = run(db, "UPDATE jobs SET status = 'queued', lease_until = NULL, worker_id = NULL, run_at = ?, last_error = ? WHERE id = ? AND status = 'running' AND attempts = ?",
      t + espera, mensaje, job.id, job.attempts)
    if (r.changes === 1) {
      queueMicrotask(() => señales.emit('enqueued', job.id))
      return { state: 'requeued', delayMs: espera }
    }
    return { state: 'lost', delayMs: 0 }
  }

  /** Apagado: el trabajo vuelve a la cola y el intento se reembolsa (MS §7.3; `refundRetry` de liteque). */
  function release (job) {
    const r = run(db, "UPDATE jobs SET status = 'queued', lease_until = NULL, worker_id = NULL, run_at = ?, attempts = attempts - 1 WHERE id = ? AND status = 'running' AND attempts = ?",
      now(), job.id, job.attempts)
    return r.changes === 1
  }

  /** Cancela un trabajo en cola o en curso. El worker se entera por la barrera (latido o progreso) o por la señal. */
  function cancel (jobId) {
    const r = run(db, "UPDATE jobs SET status = 'cancelled', lease_until = NULL, worker_id = NULL, finished_at = ? WHERE id = ? AND status IN ('queued', 'running')", now(), jobId)
    if (r.changes === 1) señales.emit('cancelled', jobId)
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
    const fila = get(db, "SELECT MIN(run_at) AS t FROM jobs WHERE status = 'queued'")
    return fila?.t ?? null
  }

  function stats () {
    const filas = all(db, 'SELECT status, COUNT(*) AS n FROM jobs GROUP BY status')
    return Object.fromEntries(filas.map((f) => [f.status, f.n]))
  }

  /** Retención (I03 §12): trabajos terminados y eventos con más de `retentionDays` días. */
  function sweepRetention () {
    const limite = now() - w.retentionDays * 24 * 3600 * 1000
    return tx(db, () => {
      const trabajos = run(db, "DELETE FROM jobs WHERE status IN ('done', 'failed', 'cancelled') AND finished_at < ?", limite).changes
      const eventos = events.purge(limite)
      const sesiones = run(db, 'DELETE FROM sessions WHERE expires_at < ?', now()).changes
      const nonces = run(db, 'DELETE FROM sso_nonces WHERE created_at < ?', limite).changes
      return { trabajos, eventos, sesiones, nonces }
    })
  }

  return {
    enqueue, claim, heartbeat, progress, complete, fail, release, cancel, cancelForInput, recoverExpiredLeases,
    sweepRetention, nextRunAt, stats, backoffMs, getJob, latestJobForInput, señales
  }
}
