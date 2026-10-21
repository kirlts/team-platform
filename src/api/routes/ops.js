// Rutas de operación del editor: la cola de trabajos, su purga y la bitácora.

import { audit, listAudit } from '../../domain/audit.js'
import { requireConfirm } from '../confirm.js'
import { pageEnvelope, pageParams, pageQuerySchema, pageResult } from '../pagination.js'

const trabajo = {
  type: 'object',
  properties: {
    id: { type: 'string' }, kind: { type: 'string' }, input_id: { type: ['string', 'null'] }, status: { type: 'string' },
    priority: { type: 'integer' }, attempts: { type: 'integer' }, max_attempts: { type: 'integer' },
    run_at: { type: 'string' }, lease_until: { type: ['string', 'null'] }, worker_id: { type: ['string', 'null'] },
    last_error: { type: ['string', 'null'] }, created_at: { type: 'string' }, finished_at: { type: ['string', 'null'] }
  }
}

const registro = {
  type: 'object',
  properties: {
    id: { type: 'string' }, at: { type: 'string' }, member_id: { type: ['string', 'null'] }, member_name: { type: ['string', 'null'] },
    action: { type: 'string' }, entity: { type: 'string' }, entity_id: { type: ['string', 'null'] }, detail: { type: ['object', 'null'], additionalProperties: true }
  }
}

export function registerOpsRoutes (app, ctx) {
  const { db, config, queue, requireRole } = ctx

  app.get('/jobs', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'La cola de trabajos, filtrable por estado (editor)',
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { ...pageQuerySchema(config), state: { type: 'string', enum: ['queued', 'running', 'done', 'failed', 'cancelled'] } }
      },
      response: { 200: pageEnvelope(trabajo) }
    }
  }, async (request) => {
    const p = pageParams(request.query, config)
    const r = queue.listJobs({ state: request.query.state ?? null, limit: p.limit, offset: p.offset })
    return pageResult(r.items, r.total, p)
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
      response: { 200: pageEnvelope(registro) }
    }
  }, async (request) => {
    const p = pageParams(request.query, config)
    const r = listAudit(db, { limit: p.limit, offset: p.offset, entity: request.query.entity ?? null, action: request.query.action ?? null })
    return pageResult(r.items, r.total, p)
  })
}
