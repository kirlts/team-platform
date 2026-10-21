// Eventos y progreso (MASTER-SPEC §7.10). Todo evento se escribe en `job_events`; su `seq` autoincremental
// es el `id` del evento SSE y, por lo tanto, el `Last-Event-ID` que el navegador reenvía al reconectar.
// Un solo hilo de eventos para progreso, fin de trabajo y avisos de mensajes: un flujo SSE por miembro.
//
// Cómo se entera un suscriptor de lo que escribió otro proceso: con el worker aparte, la API consulta
// `PRAGMA data_version` (1,15 µs por consulta, I03 §5.3) y lee lo que no ha despachado. Con el worker en el
// mismo proceso basta el despacho directo. En ambos casos el despacho siempre lee la base en orden, así que
// no hay huecos aunque dos procesos escriban a la vez.

import { all, get, run, tx } from '../db/index.js'
import { iso, parseJson } from '../db/util.js'

export const EVENT_KINDS = ['progress', 'done', 'message']

const id = (v) => (v === null || v === undefined ? undefined : String(v))

/**
 * Fila de `job_events` a la forma que ve el cliente. Todo id viaja como texto, igual que en las respuestas
 * REST (el panel compara `job_id` y `message_id` como cadenas).
 */
export function toWire (row) {
  const data = parseJson(row.data_json, {})
  if (row.kind === 'progress') {
    return { id: String(row.seq), event: 'progress', data: { job_id: id(row.job_id), input_id: id(data.input_id) ?? null, percent: row.percent, phrase: row.phrase, at: iso(row.at) } }
  }
  if (row.kind === 'done') {
    return { id: String(row.seq), event: 'done', data: { ...data, job_id: id(row.job_id), input_id: id(data.input_id) ?? null, attachment_id: id(data.attachment_id), done: true, at: iso(row.at) } }
  }
  return { id: String(row.seq), event: 'message', data: { ...data, message_id: id(data.message_id), author_id: id(data.author_id), input_id: id(data.input_id), at: iso(row.at) } }
}

export function createEvents ({ db, now = Date.now }) {
  const subscribers = new Set()
  let lastDispatched = get(db, 'SELECT COALESCE(MAX(seq), 0) AS m FROM job_events').m
  let dataVersion = null
  let timerHandle = null

  /** Despacha a los suscriptores todo lo que la base tenga después de lo ya despachado. */
  function drain () {
    const rows = all(db, 'SELECT * FROM job_events WHERE seq > ? ORDER BY seq', lastDispatched)
    for (const dbRow of rows) {
      lastDispatched = dbRow.seq
      for (const s of [...subscribers]) {
        if (dbRow.member_id === null || dbRow.member_id === s.memberId) {
          try { s.callback(dbRow) } catch { /* un suscriptor roto no frena a los demás */ }
        }
      }
    }
    return rows.length
  }

  /** Escribe un evento. `memberId` null lo dirige a todo el equipo. Devuelve el `seq`. */
  function publish ({ kind, jobId = null, memberId = null, percent = null, phrase = null, data = null }) {
    if (!EVENT_KINDS.includes(kind)) throw new Error(`Tipo de evento desconocido: ${kind}`)
    const result = run(db,
      'INSERT INTO job_events (job_id, kind, member_id, percent, phrase, data_json, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      jobId, kind, memberId, percent, phrase, data === null ? null : JSON.stringify(data), now())
    if (!db.isTransaction) drain()
    return Number(result.lastInsertRowid)
  }

  /** Igual que `publish`, pero el destinatario es el autor del input al que pertenece el trabajo. */
  function publishForJob (jobId, { kind, percent = null, phrase = null, data = {} }) {
    const jobRow = get(db, 'SELECT j.input_id, i.author_id FROM jobs j LEFT JOIN inputs i ON i.id = j.input_id WHERE j.id = ?', jobId)
    if (!jobRow) return null
    return publish({ kind, jobId, memberId: jobRow.author_id, percent, phrase, data: { input_id: jobRow.input_id, ...data } })
  }

  /** Transacción que despacha lo publicado adentro una vez confirmada (nunca antes: un evento no confirmado no existe). */
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

  /** Eventos con `seq` mayor que `afterSeq` que ve el miembro, en orden. `jobId` acota a un trabajo. */
  function replay (memberId, afterSeq, { jobId = null } = {}) {
    if (jobId !== null) {
      return all(db, 'SELECT * FROM job_events WHERE seq > ? AND job_id = ? AND (member_id IS NULL OR member_id = ?) ORDER BY seq', afterSeq, jobId, memberId)
    }
    return all(db, 'SELECT * FROM job_events WHERE seq > ? AND (member_id IS NULL OR member_id = ?) ORDER BY seq', afterSeq, memberId)
  }

  /**
   * Foto inicial de una conexión nueva sin `Last-Event-ID`: el último progreso de cada trabajo en curso del
   * miembro, para que una pestaña recién abierta muestre la barra donde va.
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
    return get(db, "SELECT percent, phrase, at FROM job_events WHERE job_id = ? AND kind = 'progress' ORDER BY seq DESC LIMIT 1", jobId)
  }

  /**
   * Con el worker en otro proceso: consulta `PRAGMA data_version` cada `intervalMs` y despacha lo nuevo.
   * El valor sólo cambia por confirmaciones de OTRAS conexiones (I03 §5.3).
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

  /** Retención: I03 §12, `job_events_retention_days` igual que los trabajos terminados. */
  function purge (olderThanMs) {
    return run(db, 'DELETE FROM job_events WHERE at < ?', olderThanMs).changes
  }

  return { publish, publishForJob, drain, transaction, subscribe, replay, snapshot, lastProgress, startPolling, stopPolling, purge }
}
