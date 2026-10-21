// Telemetría (UD-014, MASTER-SPEC §7.10 bis): el núcleo usa `src/telemetry/` tal cual. Este archivo sólo reexporta
// lo que usan la cola, el worker y la API, para que haya un único lugar donde mirar qué se instrumenta.
//   withSpan(name, attrs, fn)   un span activo alrededor de fn(span); sin `initTelemetry` el tracer es nulo y fn corre igual
//   initTelemetry({ db })       inicia el SDK con el exportador a la tabla `spans`
//   traceOfJob(db, jobId)       el árbol de spans de un trabajo, o null
//   pruneSpans(db)              retención de 7 días, igual que `job_events`

export { errorType, withSpan } from '../telemetry/api.js'
export { initTelemetry, pruneSpans, traceOfJob } from '../telemetry/index.js'
