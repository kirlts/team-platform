// Interface telemetry (UD-091, MASTER-SPEC §7.10 ter). The panel sends counts and durations of how it is used;
// an active person reads them back as a summary. No event carries text of a person (src/telemetry/ui-spec.js).

import Ajv from 'ajv'
import { audit } from '../../domain/audit.js'
import { getUiTelemetryEnabled, setUiTelemetryEnabled } from '../../domain/settings.js'
import { recordUiBatch, uiSummary } from '../../telemetry/ui.js'
import { batchSchema } from '../../telemetry/ui-spec.js'

const MS_PER_HOUR = 3600000 // MS §7.7: milliseconds in an hour, to express SESSION_ABSOLUTE_HOURS
const MS_PER_DAY = 86400000 // unit conversion

export function registerTelemetryRoutes (app, ctx) {
  const { db, config, requireRole } = ctx
  const limits = config.uiTelemetry
  // No duration may last longer than the session that measured it (the absolute lifetime of a session, MS §7.7).
  const maxDurationMs = config.identity.session.absoluteHours * MS_PER_HOUR
  const schema = batchSchema({ maxEvents: limits.maxEvents, maxDurationMs })

  // The body is JSON, so no value needs coercing: «12» in a numeric field is a malformed event, not a number. The
  // instance the rest of the API uses coerces types, so this route validates with its own.
  const ajv = new Ajv({ allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false, strict: true })
  const validatorCompiler = ({ schema: s }) => ajv.compile(s)

  app.post('/telemetry/ui', {
    onRequest: [requireRole('member')],
    bodyLimit: limits.maxBodyBytes,
    // Per address: the rate limiter runs before the identity hook, and behind the proxy the address is the real one (trustProxy).
    config: { rateLimit: { max: limits.rateMax, timeWindow: limits.rateWindowMs } },
    validatorCompiler,
    schema: {
      summary: 'Interface events of the panel (member)',
      description: 'A batch of events: navigation, screen_usage, task, error and vitals. Counts, durations and identifiers only: no field holds text of a person. The body is capped (UI_TELEMETRY_MAX_BODY_BYTES), the batch too (UI_TELEMETRY_MAX_EVENTS) and so is the rate per address. With the switch off in Configuración the batch is discarded and the answer is the same 204.',
      body: schema,
      response: { 204: { type: 'null', description: 'Accepted, or discarded because telemetry is off.' } }
    }
  }, async (request, reply) => {
    if (getUiTelemetryEnabled(db, config)) recordUiBatch(request.body)
    return reply.code(204).send()
  })

  app.get('/telemetry/ui-summary', {
    onRequest: [requireRole('person')],
    schema: {
      summary: 'Summary of how the interface is used',
      description: 'Percentiles (p50, p75, p95, nearest rank) by task and by screen, error and abandonment rates, and the worst journeys by clicks to complete. The window is the last `days` days, at most the span retention.',
      querystring: { type: 'object', additionalProperties: false, properties: { days: { type: 'integer', minimum: 1, maximum: config.worker.retentionDays } } },
      response: { 200: { type: 'object', additionalProperties: true } }
    }
  }, async (request) => {
    await ctx.telemetry?.flush() // what is queued is written now: the batch that has just arrived is visible too
    const now = Date.now()
    const days = request.query.days ?? config.worker.retentionDays
    return { ...uiSummary(db, { sinceMs: now - days * MS_PER_DAY, untilMs: now + 1 }), days }
  })

  app.patch('/settings/telemetry', {
    onRequest: [requireRole('person')],
    schema: {
      summary: 'Turn interface telemetry on or off',
      body: { type: 'object', required: ['ui_enabled'], additionalProperties: false, properties: { ui_enabled: { type: 'boolean' } } },
      response: { 200: { type: 'object', properties: { ui_enabled: { type: 'boolean' } } } }
    }
  }, async (request) => {
    setUiTelemetryEnabled(db, request.body.ui_enabled)
    audit(db, { memberId: request.member.id, action: 'settings.telemetry', entity: 'settings', detail: { ui_enabled: request.body.ui_enabled } })
    return { ui_enabled: getUiTelemetryEnabled(db, config) }
  })
}
