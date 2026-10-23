// Routes of the `execute` job (UD-254, UD-255): an Editor enqueues it by hand, and the unattended session reports its
// progress with `team progress`.

import { all, get, run as runSql } from '../db/index.js'
import { parseJson } from '../db/util.js'
import { conflict, forbidden, notFound } from '../domain/errors.js'
import { audit } from '../domain/audit.js'
import { idIn, idParams } from '../api/schemas.js'
import { enqueueExecute } from './enqueue.js'

export function registerExecuteRoutes (app, ctx) {
  const { db, events, queue, requireRole } = ctx

  app.post('/messages/:id/execute', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Encolar el trabajo `execute` de un mensaje (Editor)',
      description: 'Una sesión desatendida de Claude Code trabaja el mensaje como el miembro agente indicado (UD-254). Sin `member_id`, un trabajo por cada agente activo entre sus destinatarios. Responde 202 con los trabajos creados. 409 `no_agent_assignee` si el mensaje no tiene un agente activo asignado, 409 `execute_busy` si cada agente ya tiene uno en cola o corriendo, 409 `message_closed` si está cerrado, 400 `not_an_agent` si `member_id` no es un agente.',
      params: idParams(),
      body: { type: ['object', 'null'], additionalProperties: false, properties: { member_id: idIn } },
      response: { 202: { type: 'object', properties: { job_ids: { type: 'array', items: { type: 'string' } } } } }
    }
  }, async (request, reply) => {
    const messageId = request.params.id
    const message = get(db, 'SELECT id, status FROM messages WHERE id = ? AND deleted_at IS NULL', messageId)
    if (!message) throw notFound('El mensaje no existe.')
    if (message.status === 'closed') throw conflict('El mensaje está cerrado. Hay que reabrirlo para trabajarlo.', 'message_closed')
    let agentIds
    if (request.body?.member_id !== undefined) {
      const m = get(db, 'SELECT id, kind, active FROM members WHERE id = ?', request.body.member_id)
      if (!m || m.kind !== 'agent' || m.active !== 1) throw conflict('El miembro no es un agente activo.', 'not_an_agent')
      agentIds = [m.id]
    } else {
      agentIds = all(db, `SELECT m.id FROM message_assignees a JOIN members m ON m.id = a.member_id
                          WHERE a.message_id = ? AND m.kind = 'agent' AND m.active = 1 ORDER BY m.id`, messageId).map((r) => r.id)
      if (agentIds.length === 0) throw conflict('El mensaje no tiene un agente asignado.', 'no_agent_assignee')
    }
    const jobIds = events.transaction(() => {
      const ids = agentIds.map((memberId) => enqueueExecute(db, { messageId, memberId, requestedBy: request.member.id })).filter((id) => id !== null)
      if (ids.length > 0) audit(db, { memberId: request.member.id, action: 'message.execute', entity: 'message', entityId: messageId, detail: { job_ids: ids } })
      return ids
    })
    if (jobIds.length === 0) throw conflict('El agente ya tiene un trabajo en cola o corriendo para este mensaje.', 'execute_busy')
    reply.code(202)
    return { job_ids: jobIds.map(String) }
  })

  app.post('/jobs/:id/progress', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Informar el avance de un trabajo `execute` (sólo su agente)',
      description: 'Lo usa la sesión desatendida con `team progress`. Publica un evento `progress` con `percent` y `phrase`. 403 `not_job_agent` si quien llama no es el agente del trabajo; 409 `job_not_running` si el trabajo no está corriendo.',
      params: idParams(),
      body: {
        type: 'object', required: ['percent', 'phrase'], additionalProperties: false,
        properties: { percent: { type: 'number', minimum: 0, maximum: 100 }, phrase: { type: 'string', minLength: 1, maxLength: 200 } } // declared courtesy: a short phrase of the card
      },
      response: { 204: { type: 'null', description: 'Avance publicado.' } }
    }
  }, async (request, reply) => {
    const job = queue.getJob(request.params.id)
    if (!job || job.kind !== 'execute') throw notFound('El trabajo no existe.')
    if (parseJson(job.payload_json, {}).member_id !== request.member.id) throw forbidden('Sólo el agente del trabajo informa su avance.', 'not_job_agent')
    // 99 at most: 100 is marked by the `done` event (§7.10).
    if (!queue.progress(job, Math.min(99, request.body.percent), request.body.phrase)) throw conflict('El trabajo no está corriendo.', 'job_not_running')
    return reply.code(204).send()
  })

  app.post('/jobs/:id/marks', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Informar el tiempo de una parte del trabajo `execute` (sólo su agente)',
      description: 'Lo usa la sesión desatendida con `team mark`. `judge`, `delivery` y `wait` suman `ms` al tiempo que la sesión pasó en el juez, en la entrega y en espera; los valores se suman. `ok` en `delivery` dice si la entrega llegó a producción (la última marca manda). Quedan en la fila de `execute_runs` del intento (UD-262). 403 `not_job_agent` si quien llama no es el agente del trabajo; 409 `job_not_running` si el trabajo no está corriendo.',
      params: idParams(),
      body: {
        type: 'object', required: ['name', 'ms'], additionalProperties: false,
        properties: { name: { type: 'string', enum: ['judge', 'delivery', 'wait'] }, ms: { type: 'integer', minimum: 0 }, ok: { type: 'boolean' } }
      },
      response: { 204: { type: 'null', description: 'Marca registrada.' } }
    }
  }, async (request, reply) => {
    const job = queue.getJob(request.params.id)
    if (!job || job.kind !== 'execute') throw notFound('El trabajo no existe.')
    if (parseJson(job.payload_json, {}).member_id !== request.member.id) throw forbidden('Sólo el agente del trabajo informa sus marcas.', 'not_job_agent')
    if (job.status !== 'running') throw conflict('El trabajo no está corriendo.', 'job_not_running')
    const { name, ms, ok } = request.body
    const marks = parseJson(job.marks_json, {}) ?? {}
    marks[`${name}_ms`] = (marks[`${name}_ms`] ?? 0) + ms
    if (name === 'delivery' && ok !== undefined) marks.delivered = ok ? 1 : 0
    runSql(db, 'UPDATE jobs SET marks_json = ? WHERE id = ?', JSON.stringify(marks), job.id)
    return reply.code(204).send()
  })
}
