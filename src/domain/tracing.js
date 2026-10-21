// Telemetry (UD-014, MASTER-SPEC §7.10 bis): the core uses `src/telemetry/` as is. This file only re-exports
// what the queue, the worker and the API use, so there is a single place to look at what is instrumented.
//   withSpan(name, attrs, fn)   an active span around fn(span); without `initTelemetry` the tracer is null and fn runs anyway
//   initTelemetry({ db })       starts the SDK with the exporter to the `spans` table
//   traceOfJob(db, jobId)       the span tree of a job, or null
//   pruneSpans(db)              7-day retention, same as `job_events`

export { errorType, withSpan } from '../telemetry/api.js'
export { initTelemetry, pruneSpans, traceOfJob } from '../telemetry/index.js'
