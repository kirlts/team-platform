// Registros estructurados en JSON a stdout, con pino (el registro de Fastify). Cada línea del worker lleva
// `job_id` e `input_id` (log.child). Nunca se registran cabeceras de autorización ni cookies.

import pino from 'pino'

export function createLogger (config, bindings = {}) {
  return pino({ level: config.logLevel, base: { app: 'team-platform', ...bindings }, redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'] })
}
