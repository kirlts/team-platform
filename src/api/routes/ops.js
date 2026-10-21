// Rutas de operación del editor: la cola de trabajos, su purga y la bitácora.

import { audit, listAudit } from '../../domain/audit.js'
import { notFound } from '../../domain/errors.js'
import { traceOfJob } from '../../domain/tracing.js'
import { idParams } from '../schemas.js'
import { requireConfirm } from '../confirm.js'
import { pageEnvelope, pageParams, pageQuerySchema, pageResult } from '../pagination.js'

const jobRow = {
  type: 'object',
  properties: {
    id: { type: 'string' }, kind: { type: 'string' }, input_id: { type: 'string', nullable: true }, status: { type: 'string' },
    priority: { type: 'integer' }, attempts: { type: 'integer' }, max_attempts: { type: 'integer' },
    run_at: { type: 'string' }, lease_until: { type: 'string', nullable: true }, worker_id: { type: 'string', nullable: true },
    last_error: { type: 'string', nullable: true }, created_at: { type: 'string' }, finished_at: { type: 'string', nullable: true }
  }
}

const registryList = {
  type: 'object',
  properties: {
    id: { type: 'string' }, at: { type: 'string' }, member_id: { type: 'string', nullable: true }, member_name: { type: 'string', nullable: true },
    action: { type: 'string' }, entity: { type: 'string' }, entity_id: { type: 'string', nullable: true }, detail: { type: ['object', 'null'], additionalProperties: true }
  }
}

export function registerOpsRoutes (app, ctx) {
  const { db, config, queue, requireRole, telemetry } = ctx

  app.get('/jobs', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'La cola de trabajos, filtrable por estado (editor)',
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { ...pageQuerySchema(config), state: { type: 'string', enum: ['queued', 'running', 'done', 'failed', 'cancelled'] } }
      },
      response: { 200: pageEnvelope(jobRow) }
    }
  }, async (request) => {
    const p = pageParams(request.query, config)
    const r = queue.listJobs({ state: request.query.state ?? null, limit: p.limit, offset: p.offset })
    return pageResult(r.items, r.total, p)
  })

  app.get('/jobs/:id/trace', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'El árbol de spans de un trabajo (editor)',
      description: 'Un árbol por intento de la cola: tiempos por paso, llamadas a proveedores con sus tokens y costo. Los nanosegundos viajan como texto. 404 si el trabajo no dejó spans.',
      params: idParams(),
      response: { 200: { type: 'object', additionalProperties: true } }
    }
  }, async (request) => {
    await telemetry?.flush() // escribe ya lo que esté en cola: el trabajo recién terminado también se ve
    const trace = traceOfJob(db, request.params.id)
    if (!trace) throw notFound('El trabajo no dejó spans.')
    return trace
  })

  app.delete('/jobs', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Purgar los trabajos terminados de un estado (exige ?confirm=true)',
      querystring: {
        type: 'object', additionalProperties: false, required: ['state'],
        properties: { state: { type: 'string', enum: ['done', 'failed', 'cancelled'] }, confirm: { type: 'boolean' } }
      },
      response: { 200: { type: 'object', properties: { purged: { type: 'integer' } } } }
    }
  }, async (request) => {
    requireConfirm(request)
    const purged = queue.purgeJobs(request.query.state)
    audit(db, { memberId: request.member.id, action: 'jobs.purge', entity: 'job', detail: { state: request.query.state, purged } })
    return { purged }
  })

  app.get('/audit', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Bitácora: quién creó, publicó, cerró, reabrió o editó, y cuándo (editor)',
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { ...pageQuerySchema(config), entity: { type: 'string' }, action: { type: 'string' } }
      },
      response: { 200: pageEnvelope(registryList) }
    }
  }, async (request) => {
    const p = pageParams(request.query, config)
    const r = listAudit(db, { limit: p.limit, offset: p.offset, entity: request.query.entity ?? null, action: request.query.action ?? null })
    return pageResult(r.items, r.total, p)
  })
}
