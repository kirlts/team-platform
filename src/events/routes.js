// GET /events (MASTER-SPEC §7.10): un flujo SSE por miembro con progreso, fin de trabajo y avisos de mensajes.
//  - `id` de cada evento = job_events.seq; el navegador reenvía `Last-Event-ID` al reconectar.
//  - Se suscribe ANTES de reponer y se descarta lo ya enviado: cero repetidos y cero huecos (I03 §5.1, M4).
//  - Latido de comentario cada `sse.heartbeatMs` (15 s, sugerencia del estándar HTML).
//  - `?job_id=N` acota el flujo a un trabajo, lo cierra tras su `done`, y responde 204 si ese trabajo ya
//    terminó y no hay nada que reponer: el estándar fija el 204 para que el navegador deje de reconectar.
//  - Sin `Last-Event-ID`, una conexión nueva recibe el último progreso de cada trabajo en curso del miembro.

import fastifySse from '@fastify/sse'
import { get } from '../db/index.js'
import { toWire } from './index.js'
import { notFound } from '../domain/errors.js'

const TERMINALES = new Set(['done', 'failed', 'cancelled'])

export async function registerEventRoutes (app, { db, config, events, requireRole }) {
  // Versión exacta fijada en package.json: es una 0.x (I07 §5.2).
  await app.register(fastifySse, { heartbeatInterval: config.sse.heartbeatMs })
  const abiertos = new Set()

  app.get('/events', {
    onRequest: [requireRole('member')],
    sse: 'manual',
    schema: {
      querystring: { type: 'object', properties: { job_id: { type: 'integer', minimum: 1 } }, additionalProperties: false },
      response: {
        200: { type: 'string', description: 'Flujo text/event-stream. Eventos: progress, done, message. El id es job_events.seq (Last-Event-ID).' },
        204: { type: 'null', description: 'Con job_id: el trabajo ya terminó y no hay nada que reponer; el navegador deja de reconectar.' }
      }
    }
  }, async (request, reply) => {
    const miembro = request.member.id
    const jobId = request.query.job_id ?? null
    const crudo = request.headers['last-event-id']
    const ultimo = crudo !== undefined && /^\d+$/.test(crudo) ? Number(crudo) : null

    let trabajo = null
    if (jobId !== null) {
      trabajo = get(db, 'SELECT j.id, j.status FROM jobs j JOIN inputs i ON i.id = j.input_id WHERE j.id = ? AND i.author_id = ?', jobId, miembro)
      if (!trabajo) throw notFound('El trabajo no existe.')
    }

    // Reposición inicial (después de suscribir).
    const pendientes = []
    let reponiendo = true
    const enviados = new Set()
    const cola = { cadena: Promise.resolve() }

    const enviar = (fila) => {
      cola.cadena = cola.cadena.then(async () => {
        if (!reply.sse.isConnected) return
        await reply.sse.send(toWire(fila))
        if (jobId !== null && fila.kind === 'done') reply.sse.close() // el cliente cierra su EventSource al recibirlo
      }).catch(() => {})
    }
    const despachar = (fila) => {
      if (jobId !== null && fila.job_id !== jobId) return
      if (reponiendo) pendientes.push(fila)
      else enviar(fila)
    }
    const desuscribir = events.subscribe(miembro, despachar)

    const historia = ultimo !== null
      ? events.replay(miembro, ultimo, { jobId })
      : jobId !== null ? events.replay(miembro, 0, { jobId }) : events.snapshot(miembro)

    // 204: el trabajo ya terminó y el cliente no se perdió nada. Sin estas condiciones la conexión sigue abierta.
    if (trabajo && TERMINALES.has(trabajo.status) && historia.length === 0) {
      desuscribir()
      return reply.code(204).send()
    }

    reply.sse.sendHeaders()
    reply.raw.write(': conectado\n\n') // fuerza el primer byte a través de proxies con búfer
    for (const fila of historia) { enviados.add(fila.seq); enviar(fila) }
    reponiendo = false
    for (const fila of pendientes) if (!enviados.has(fila.seq)) enviar(fila)

    const entrada = { close: () => reply.sse.close() }
    abiertos.add(entrada)
    await new Promise((resolver) => {
      reply.sse.onClose(resolver)
    })
    desuscribir()
    abiertos.delete(entrada)
  })

  // Apagado (I03 §4, paso 2): cerrar los flujos antes de `app.close()`.
  return { closeAll () { for (const e of [...abiertos]) e.close() } }
}
