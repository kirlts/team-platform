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

/** Fila de `job_events` a la forma que ve el cliente. */
export function toWire (row) {
  const data = parseJson(row.data_json, {})
  if (row.kind === 'progress') {
    return { id: String(row.seq), event: 'progress', data: { job_id: row.job_id, input_id: data.input_id ?? null, percent: row.percent, phrase: row.phrase, at: iso(row.at) } }
  }
  if (row.kind === 'done') {
    return { id: String(row.seq), event: 'done', data: { job_id: row.job_id, done: true, ...data, at: iso(row.at) } }
  }
  return { id: String(row.seq), event: 'message', data: { ...data, at: iso(row.at) } }
}

export function createEvents ({ db, now = Date.now }) {
  const suscriptores = new Set()
  let ultimoDespachado = get(db, 'SELECT COALESCE(MAX(seq), 0) AS m FROM job_events').m
  let versionDatos = null
  let temporizador = null

  /** Despacha a los suscriptores todo lo que la base tenga después de lo ya despachado. */
  function drain () {
    const filas = all(db, 'SELECT * FROM job_events WHERE seq > ? ORDER BY seq', ultimoDespachado)
    for (const fila of filas) {
      ultimoDespachado = fila.seq
      for (const s of [...suscriptores]) {
        if (fila.member_id === null || fila.member_id === s.memberId) {
          try { s.callback(fila) } catch { /* un suscriptor roto no frena a los demás */ }
        }
      }
    }
    return filas.length
  }

  /** Escribe un evento. `memberId` null lo dirige a todo el equipo. Devuelve el `seq`. */
  function publish ({ kind, jobId = null, memberId = null, percent = null, phrase = null, data = null }) {
    if (!EVENT_KINDS.includes(kind)) throw new Error(`Tipo de evento desconocido: ${kind}`)
    const resultado = run(db,
      'INSERT INTO job_events (job_id, kind, member_id, percent, phrase, data_json, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      jobId, kind, memberId, percent, phrase, data === null ? null : JSON.stringify(data), now())
    if (!db.isTransaction) drain()
    return Number(resultado.lastInsertRowid)
  }

  /** Igual que `publish`, pero el destinatario es el autor del input al que pertenece el trabajo. */
  function publishForJob (jobId, { kind, percent = null, phrase = null, data = {} }) {
    const trabajo = get(db, 'SELECT j.input_id, i.author_id FROM jobs j LEFT JOIN inputs i ON i.id = j.input_id WHERE j.id = ?', jobId)
    if (!trabajo) return null
    return publish({ kind, jobId, memberId: trabajo.author_id, percent, phrase, data: { input_id: trabajo.input_id, ...data } })
  }

  /** Transacción que despacha lo publicado adentro una vez confirmada (nunca antes: un evento no confirmado no existe). */
  function transaction (fn) {
    const externa = !db.isTransaction
    const resultado = tx(db, fn)
    if (externa) drain()
    return resultado
  }

  function subscribe (memberId, callback) {
    const s = { memberId, callback }
    suscriptores.add(s)
    return () => suscriptores.delete(s)
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
    versionDatos = db.prepare('PRAGMA data_version').get().data_version
    temporizador = setInterval(() => {
      const actual = db.prepare('PRAGMA data_version').get().data_version
      if (actual !== versionDatos) {
        versionDatos = actual
        drain()
      }
    }, intervalMs)
    temporizador.unref()
  }

  function stopPolling () {
    if (temporizador) clearInterval(temporizador)
    temporizador = null
  }

  /** Retención: I03 §12, `job_events_retention_days` igual que los trabajos terminados. */
  function purge (olderThanMs) {
    return run(db, 'DELETE FROM job_events WHERE at < ?', olderThanMs).changes
  }

  return { publish, publishForJob, drain, transaction, subscribe, replay, snapshot, lastProgress, startPolling, stopPolling, purge }
}
