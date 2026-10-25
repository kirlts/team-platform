// Operations routes (any active person): the job queue, its purge and the log.

import { audit, listAudit } from '../../domain/audit.js'
import { AppError, notFound } from '../../domain/errors.js'
import { traceOfJob } from '../../domain/tracing.js'
import { dayStart, instanceLabel, listExecuteRuns, PHASES, summarizeExecuteRuns } from '../../telemetry/execute-runs.js'
import { iso } from '../../db/util.js'
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

const nullableInt = { type: 'integer', nullable: true }
const runRow = {
  type: 'object',
  description: 'One run of an execute job (UD-262). Times in milliseconds; null = unknown.',
  properties: {
    id: { type: 'string' }, job_id: { type: 'string' }, attempt: { type: 'integer' }, message_id: { type: 'string', nullable: true }, instance: { type: 'string' },
    trace_id: { type: 'string', nullable: true }, session_id: { type: 'string', nullable: true }, model: { type: 'string', nullable: true },
    runner: { type: 'string', nullable: true }, machine: { type: 'string', nullable: true }, started_at: { type: 'string' }, finished_at: { type: 'string' },
    ...Object.fromEntries(PHASES.map((p) => [p, nullableInt])),
    input_tokens: nullableInt, output_tokens: nullableInt, cache_read_tokens: nullableInt, cache_write_tokens: nullableInt,
    cost_usd: { type: 'number', nullable: true }, turns: nullableInt, tool_count: nullableInt, subagent_count: nullableInt,
    outcome: { type: 'string', nullable: true }, error_code: { type: 'string', nullable: true }, delivered: { type: 'boolean', nullable: true },
    transcript_ref: { type: 'string', nullable: true }, transcript_error: { type: 'string', nullable: true },
    deliver_job_id: { type: 'string', nullable: true }, delivery_ref: { type: 'string', nullable: true }, delivery_held: { type: 'boolean', nullable: true }, // the `deliver` job that followed the run and what its command printed (UD-263)
    slowest_tools: { type: 'array', items: { type: 'object', additionalProperties: true } }
  }
}
const periodQuery = {
  since: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'First day, YYYY-MM-DD (server local day).' },
  until: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Last day included, YYYY-MM-DD.' },
  instance: { type: 'string', description: 'Instance label; «*» for all. Default: this instance.' }
}
const stat = { type: 'object', properties: { n: { type: 'integer' }, avg: nullableInt, p50: nullableInt, p95: nullableInt } }

/** `since`/`until` (inclusive days) and `instance` as filters for `listExecuteRuns` / `summarizeExecuteRuns`. */
function runFilters (query, config) {
  const since = query.since === undefined ? null : dayStart(query.since)
  const last = query.until === undefined ? null : dayStart(query.until)
  if ((query.since !== undefined && since === null) || (query.until !== undefined && last === null)) throw new AppError(400, 'invalid_date', 'La fecha debe ser AAAA-MM-DD.')
  const instance = query.instance === '*' ? null : (query.instance ?? instanceLabel(config))
  const until = last === null ? null : new Date(new Date(last).setDate(new Date(last).getDate() + 1)).getTime()
  return { since, until, instance, messageId: query.message_id ?? null, outcome: query.outcome ?? null }
}

export function registerOpsRoutes (app, ctx) {
  const { db, config, queue, events, requireRole, telemetry } = ctx

  app.get('/jobs', {
    onRequest: [requireRole('person')],
    schema: {
      summary: 'The job queue, filterable by state',
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
    onRequest: [requireRole('person')],
    schema: {
      summary: 'The span tree of a job',
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

  app.get('/ops/execute-runs', {
    onRequest: [requireRole('person')],
    schema: {
      summary: 'History of the execute runs, newest first',
      description: 'One row per run of an `execute` job: times per phase, tokens, cost, outcome, delivery and where the session transcript was copied. Kept EXECUTE_RUNS_RETENTION_DAYS (365 by default), longer than the spans (UD-262).',
      querystring: { type: 'object', additionalProperties: false, properties: { ...pageQuerySchema(config), ...periodQuery, message_id: { type: 'string', pattern: '^[0-9]+$' }, outcome: { type: 'string' } } },
      response: { 200: pageEnvelope(runRow) }
    }
  }, async (request) => {
    const p = pageParams(request.query, config)
    const r = listExecuteRuns(db, runFilters(request.query, config), { limit: p.limit, offset: p.offset })
    return pageResult(r.items.map((x) => ({ ...x, id: String(x.id), job_id: String(x.job_id), message_id: x.message_id === null ? null : String(x.message_id), started_at: iso(x.started_at), finished_at: iso(x.finished_at) })), r.total, p)
  })

  app.get('/ops/execute-runs/summary', {
    onRequest: [requireRole('person')],
    schema: {
      summary: 'Figures of the execute runs of a period',
      description: 'Average, p50 and p95 per phase, mean and total cost, delivery rate, rate of runs whose outcome is `investigated` (already resolved) and the ten slowest tool calls of the period. Nearest-rank percentiles.',
      querystring: { type: 'object', additionalProperties: false, properties: periodQuery },
      response: {
        200: {
          type: 'object',
          properties: {
            runs: { type: 'integer' }, failed: { type: 'integer' }, from: { type: 'string', nullable: true }, to: { type: 'string', nullable: true },
            phases: { type: 'object', properties: Object.fromEntries(PHASES.map((p) => [p, stat])) },
            cost: { type: 'object', properties: { n: { type: 'integer' }, avg_usd: { type: 'number', nullable: true }, total_usd: { type: 'number' } } },
            tokens: { type: 'object', properties: { input: { type: 'integer' }, output: { type: 'integer' }, cache_read: { type: 'integer' }, cache_write: { type: 'integer' } } },
            delivery: { type: 'object', properties: { known: { type: 'integer' }, delivered: { type: 'integer' }, held: { type: 'integer' }, rate: { type: 'number', nullable: true } } },
            resolved: { type: 'object', properties: { runs: { type: 'integer' }, investigated: { type: 'integer' }, rate: { type: 'number', nullable: true } } },
            slowest_tools: { type: 'array', items: { type: 'object', additionalProperties: true } }
          }
        }
      }
    }
  }, async (request) => {
    const s = summarizeExecuteRuns(db, runFilters(request.query, config))
    return { ...s, from: iso(s.from), to: iso(s.to), slowest_tools: s.slowest_tools.map((t) => ({ ...t, job_id: String(t.job_id), message_id: t.message_id === null ? null : String(t.message_id) })) }
  })

  app.delete('/jobs', {
    onRequest: [requireRole('person')],
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
    onRequest: [requireRole('person')],
    schema: {
      summary: 'Empty the test data (requires ?confirm=true)',
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
    onRequest: [requireRole('person')],
    schema: {
      summary: 'Load the sample set of ejemplos/ (requires ?confirm=true)',
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
    onRequest: [requireRole('person')],
    schema: {
      summary: 'Log: who created, published, closed, reopened or edited, and when',
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
