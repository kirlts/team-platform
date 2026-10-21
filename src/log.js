// Structured JSON logs to stdout, with pino (Fastify's logger). Every worker line carries
// `job_id` and `input_id` (log.child). Authorization headers and cookies are never logged.

import pino from 'pino'

export function createLogger (config, bindings = {}, destination = undefined) {
  return pino({ level: config.logLevel, base: { app: 'team-platform', ...bindings }, redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'] }, destination)
}
