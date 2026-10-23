// Editor operations routes: the job queue, its purge and the log.

import { audit, listAudit } from '../../domain/audit.js'
import { AppError, notFound } from '../../domain/errors.js'
import { traceOfJob } from '../../domain/tracing.js'
import { resetData, SCOPES } from '../../domain/reset.js'
import { submitExamples } from '../../domain/seed-examples.js'
import { readSeedSet } from '../../db/seed.js'
import { idParams } from '../schemas.js'
import { requireConfirm } from '../confirm.js'
import { pageEnvelope, pageParams, pageQuerySchema, pageResult } from '../pagination.js'

const jobRow = {
  type: 'object',
  properties: {
    id: { type: 'string' }, kind: { type: 'string' }, input_id: { type: 'string', nullable: true }, message_id: { type: 'string', nullable: true }, member_id: { type: 'string', nullable: true }, status: { type: 'string' },
    priority: { type: 'integer' }, attempts: { type: 'integer' }, max_attempts: { type: 'integer' },
    run_at: { type: 'string' }, lease_until: { type: 'string', nullable: true }, worker_id: { type: 'string', nullable: true },
    last_error: { type: 'string', nullable: true }, created_at: { type: 'string' }, finished_at: { type: 'string', nullable: true },
    trace_id: { type: 'string', nullable: true }, phase: { type: 'string', nullable: true, description: 'Current step of a running execute job: create, run or destroy.' }
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
  const { db, config, queue, events, requireRole, telemetry } = ctx

  app.get('/jobs', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'The job queue, filterable by state (editor)',
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
      summary: 'The span tree of a job (editor)',
      description: 'One tree per queue attempt: times per step, provider calls with their tokens and cost. Nanoseconds travel as text. 404 if the job left no spans.',
      params: idParams(),
      response: { 200: { type: 'object', additionalProperties: true } }
    }
  }, async (request) => {
    await telemetry?.flush() // writes now whatever is queued: a job that has just finished is visible too
    const trace = traceOfJob(db, request.params.id)
    if (!trace) throw notFound('El trabajo no dejó spans.')
    return trace
  })

  app.delete('/jobs', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Purge the finished jobs of a state (requires ?confirm=true)',
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

  app.post('/ops/reset', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Empty the test data (editor; requires ?confirm=true)',
      description: '`content`: inputs, attachments, jobs, proposals, messages, replies and telemetry spans, plus the files of the attachments volume left without a reference; members, areas, templates, settings and provider connections stay. `everything`: also every member except the one who asks, and areas and templates go back to the initial set of `templates/`. One transaction; the audit log keeps its history and gains a `data.reset` row with the same figures (UD-240).',
      querystring: { type: 'object', additionalProperties: false, properties: { confirm: { type: 'boolean' } } },
      body: { type: 'object', additionalProperties: false, required: ['scope'], properties: { scope: { type: 'string', enum: SCOPES } } },
      response: {
        200: {
          type: 'object',
          properties: {
            scope: { type: 'string' }, deleted: { type: 'object', additionalProperties: { type: 'integer' } },
            files: { type: 'integer' }, bytes_freed: { type: 'integer' }
          }
        }
      }
    }
  }, async (request) => {
    requireConfirm(request)
    const { scope } = request.body
    await telemetry?.flush() // spans still queued would land after the delete
    const seedSet = scope === 'everything' ? await readSeedSet(config) : null
    if (scope === 'everything' && !seedSet) throw new AppError(500, 'seed_missing', 'No está el juego inicial de áreas y plantillas.')
    return resetData(db, config, { scope, actorId: request.member.id, keepMemberId: request.member.id, seedSet })
  })

  app.post('/ops/seed', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Load the sample set of ejemplos/ (editor; requires ?confirm=true)',
      description: 'Sends each file and subfolder of `ejemplos/` as one input in the name of who asks, through the real analysis; the progress shows in the sender\'s tray like any send. Answers 202 with `created` (new sends) and `existing` (already there, by content). Real cost of the full set: about 0.01 USD with Claude Haiku 5.5 (UD-252).',
      querystring: { type: 'object', additionalProperties: false, properties: { confirm: { type: 'boolean' } } },
      response: { 202: { type: 'object', properties: { created: { type: 'integer' }, existing: { type: 'integer' } } } }
    }
  }, async (request, reply) => {
    requireConfirm(request)
    const r = await submitExamples({ db, config, queue, events }, { authorId: request.member.id })
    audit(db, { memberId: request.member.id, action: 'data.seed', entity: 'input', detail: r })
    reply.code(202)
    return r
  })

  app.get('/audit', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Log: who created, published, closed, reopened or edited, and when (editor)',
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
