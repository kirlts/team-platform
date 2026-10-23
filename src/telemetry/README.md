# Telemetry

Traceability of everything that goes through a model (UD-014, MASTER-SPEC §7.10 bis). There is one span per job, per step and per call to a provider. The full input and output are kept in SQLite.

## Connection with the core

1. Copy `migration.sql` to the core's migrations folder. It creates the `spans` table and the `llm_calls` view; if the core previously created an `llm_calls` table, the migration drops it first.
2. After opening the database and migrating, and before bringing up the API and the worker:

   ```js
   import { initTelemetry } from './telemetry/index.js';
   const telemetry = initTelemetry({ db, serviceVersion });
   // on shutdown: await telemetry.shutdown();
   ```

   The `db` connection is the one the core opens; telemetry opens and closes nothing.
3. `GET /jobs/:id/trace` answers `await telemetry.flush(); traceOfJob(db, id)` (404 if it returns `null`). The shape of the response is in `trace.js`; nanoseconds travel as text.
4. Retention: `pruneSpans(db)` deletes anything older than 7 days, the same as `job_events`.
5. The worker opens a `withSpan('job', { 'team.job_id': id, 'team.input_id': inputId, 'team.step': 'job' }, ...)` span per attempt. Every child span inherits `team.job_id` and `team.input_id`.

Reading `spans` with `SELECT *` fails with `ERR_OUT_OF_RANGE`: `start_ns` and `end_ns` are 64-bit integers (Unix nanoseconds) and `node:sqlite` does not hand them over as a number without losing precision. Ask for them with `CAST(start_ns AS TEXT)`, or read the `llm_calls` view and `traceOfJob`, which already do so.

## What to import

Instrumented modules import from `telemetry/api.js`, which loads only `@opentelemetry/api`. Without `initTelemetry` the tracer is a no-op and the code works the same. `telemetry/index.js` brings in the full SDK and re-exports the same things.

| Function | Use |
|---|---|
| `withSpan(name, attributes, fn)` | An active span around `fn(span)`; a thrown error marks it with `error.type` |
| `withGenAiCall({ provider, model, modality, request }, fn)` | CLIENT span of a model call; records `gen_ai.*` attributes and the content event |
| `recordGenAiCall(span, { provider, model, request, response, usage, cost })` | The same on an already open span (the harness) |
| `withToolSpan(tool, attributes, fn)` | Use of a tool (`execute_tool`); does not count in `llm_calls` |
| `annotate(attributes)` | Adds attributes to the active span |

## For the analyzer (`src/analyze/`, left untouched by this assignment)

- Import `{ withSpan, recordGenAiCall } from '../telemetry/api.js'`. Wrap with `withSpan(name, { 'team.job_id': ..., 'team.step': name }, ...)` the whole analysis (`'analyze'`), the classification (`'classify'`), each per-group decomposition (`'decompose'`, with `team.group_index`, `team.area_id`, `team.template_id` and `team.units`), the rescue pass (`'rescue'`) and each validation (`'validate'`, with `team.errors` and the result).
- The `api` calls become children of those spans with no further code: providers bring their own span and the context passes by itself across the `await`s.
- In the harness: `withSpan('harness', { 'team.step': 'harness' }, async (span) => { ...; recordGenAiCall(span, { provider: 'claude-code', model, request: { messages: [{ role: 'user', content: prompt }] }, response: { text: JSON.stringify(structured_output) }, usage, cost: result.total_cost_usd }); })`, passing the real cost from `total_cost_usd` in `cost` so that it is not estimated.

## Variables

| Variable | Effect |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | If set, spans are also sent over OTLP/HTTP to `<endpoint>/v1/traces`. Without it no connection is made (HP-001) |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Full traces address; takes precedence over the previous one |
| `OTEL_EXPORTER_OTLP_HEADERS` | Collector headers, `key=value,key=value` |
| `OTEL_SDK_DISABLED=true` | Turns the SDK off; the instrumented code keeps working with the null tracer |
| `TELEMETRY_INLINE_BLOBS=0` | Images and frames keep their size and lose the base64 bytes (by default they are stored) |
| `TELEMETRY_FLUSH_MS` | Batch flush interval; 5000 ms by default |
| `TELEMETRY_QUEUE_MAX_BYTES` | Queued bytes (per destination) that force an early flush; 4 MiB by default: the span of a 48-frame call fits (3.48 MiB measured, `span-size.bench.mjs`) and two do not |
| `TELEMETRY_QUEUE_HARD_BYTES` | Above this cap new calls store the size of their images and frames and not the bytes, and the span carries `team.telemetry.blobs_dropped`; by default the previous cap plus 32 MiB (the largest request to a provider, report 05 §8.3) |
| `TELEMETRY_SLICE_ROWS` | Rows per transaction of the SQLite exporter; 16 by default |

Audio is never copied into the span: it stays by reference (`file://` and size) and the full transcription goes in the output event.

## Attributes and events

OpenTelemetry GenAI convention current as of 2026-10-20 (details and sources in the header of `index.js`). Project-specific: `team.job_id`, `team.input_id`, `team.step`, `team.cost_usd`, `team.provider`, `team.modality`, `team.input_bytes`, `team.output_bytes`, `team.output_chars`. The content of a call goes in the `gen_ai.client.inference.operation.details` event: `gen_ai.system_instructions`, `gen_ai.input.messages`, `gen_ai.output.messages`, `team.request.schema` and, in transcription, `team.response.segments`.

`gen_ai.usage.input_tokens` includes what was read and written in the cache, as the convention sets. The project's providers report `input_tokens` without cache; `recordGenAiCall` does the sum. `llm_calls.input_tokens` is that total and `llm_calls.cached_tokens` the part read.

The cost comes from `pricing.js` for the models with a price documented in the repository (Haiku 5.5 and Groq's Whisper turbo). A model without a price keeps `cost_usd` as `NULL`.

## Measurement

Per-call overhead and duration of each write slice: header of `overhead.bench.mjs` (measure again with `node src/telemetry/overhead.bench.mjs`).

## One trace per message (UD-262)

The trace id and the W3C `traceparent` travel in rows: `inputs`, `messages` and `jobs` (`trace_id`, `traceparent`; migration 0017). `input.submit` opens the trace, the `analyze` job continues it, `message.publish` is a span per published message and the `execute` job continues from there. `jobs.last_span` keeps the context of the latest attempt and `jobs.link_traceparent` the previous job of the same input or message; the next `job` span links both (`team.link` = `previous_attempt` | `previous_job`, stored in `spans.links_json`). Helpers in `propagation.js`: `currentTraceparent`, `contextFromTraceparent`, `inTrace`, `linkTo`. `withSpan(..., { links })` takes span links.

`timing.js` reads the latest `execute` job of a message and returns the figures of `GET /messages/:id/timing`: `reply.start` and `reply.final` events of the `job` span, phases (`execute.<runner>.create|run|destroy`), tools and subagents sorted by duration, and per-turn tokens (`execute.turn` events). `startManualSpan` and `endManualSpan` open and close a span by hand, for the tools of a session (`src/execute/session-spans.js`).

## Interface events (UD-091)

`ui-spec.js` is the contract of the events the panel sends; `ui.js` turns a validated batch into `ui.*` spans (`recordUiBatch`) and reads them back (`uiSummary`); `ui-report.js` prints the summary. The route is `src/api/routes/telemetry.js`. Spans of the interface are roots with `ui.session` (16 random hexadecimal characters, one page load) and no member. Retention is the same 7 days. See MASTER-SPEC §7.10 ter.
