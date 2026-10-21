// Punto de enganche de la telemetría (UD-014, MASTER-SPEC §7.10 bis). El núcleo usa estas tres funciones y no
// importa OpenTelemetry: cuando existe `src/telemetry/index.js` (que escribe otro módulo) se delega en él; mientras
// no exista rige un `withSpan` mínimo que ejecuta la función sin registrar nada y `traceOfJob` devuelve un árbol vacío.
//
// Contrato que se espera de `src/telemetry/index.js`:
//   initTelemetry({ db })                     inicia el SDK con el exportador a la tabla `spans`
//   withSpan(name, attrs, fn)                 ejecuta fn(span) dentro de un span; devuelve lo que devuelva fn
//   traceOfJob(db, jobId)                     el árbol de spans de un trabajo
//   shutdownTelemetry()                       (opcional) vacía lo pendiente al apagar

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const routePath = new URL('../telemetry/index.js', import.meta.url)
const impl = existsSync(fileURLToPath(routePath)) ? await import(routePath.href) : null

const EMPTY_SPAN = Object.freeze({ setAttribute () {}, setAttributes () {}, addEvent () {}, setStatus () {}, recordException () {} })

export const telemetryAvailable = Boolean(impl)

export async function initTelemetry (deps) {
  return impl?.initTelemetry?.(deps)
}

export function withSpan (name, attrs, fn) {
  return impl?.withSpan ? impl.withSpan(name, attrs, fn) : fn(EMPTY_SPAN)
}

export function traceOfJob (db, jobId) {
  return impl?.traceOfJob ? impl.traceOfJob(db, jobId) : { job_id: String(jobId), available: false, spans: [] }
}

export async function shutdownTelemetry () {
  return impl?.shutdownTelemetry?.()
}
