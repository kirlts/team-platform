# Core contracts

What the core (`src/server.js`, `src/worker.js`, `src/db`, `src/queue`, `src/api`, `src/events`, `src/identity`, `src/domain`) expects from the other modules and what it offers to its clients. The numbers and their sources are in `src/config.js` and in `.env.example`.

## 1. Modules the core loads

They are imported by path (`ANALYZE_MODULE`, `EXTRACT_MODULE`, `PROVIDERS_MODULE`). If a file does not exist the server starts anyway and the job that needs it fails with `error_code: module_unavailable`.

| Module | Signature | What the core does with the result |
|---|---|---|
| `src/extract/index.js` | `extract(attachment, { providers, onProgress, signal }) → { text, meta }`. `attachment = { id, input_id, kind, name, mime, size, sha256, path }`; `path` is absolute (for `link`, the URL). `onProgress(percent, phrase)` with `percent` from 0 to 100 for the attachment step. It does not receive the application configuration. | Stores `text` and `meta` in the attachment row. |
| `src/extract/index.js` | `estimateAudioSeconds(attachment, { signal }) → seconds`, `createAudioBudget() → { check(seconds, at), record(seconds, at) }` | Before extracting audio or video: `check`; with no quota the job is deferred `waitMs` without spending the attempt (`phrase: «Esperando cupo de transcripción»`); with quota, `record`. An infinite `waitMs` fails with `audio_budget_exceeded`. |
| `src/analyze/index.js` | `analyze(bundle, { providers, analyzer, onProgress, signal }) → { status, proposal, units, calls, stats }`. `onProgress({ percent, phrase })`. `bundle = { text, attachments:[{id,kind,name,extracted}], areas:[{id,title,description,position}], templates:[{id,area_id,name,description,body_markdown}], members:[{id,name,responsibilities,domains}] }`, with `domains` as comma-joined text and only current areas and templates. | `status: 'ok'`: stores the proposal (`proposal.messages[]` with `area_id` and `template_id` per message, `discarded`) and `units`. `refusal`, `max_tokens` or `invalid`: the input fails without a retry, with `error_code` equal to the status. A proposal with `area_id` and `template_id` at the root is normalized to one per message. |
| `src/analyze/index.js` | `warmTemplate({ providers, config, templateMarkdown })`, `resolveConfig()` | The core calls it when a template is saved (`template.saved` event), with no clock-based waits. |
| `src/analyze/seed.js` | `loadSeed(dir) → { areas, templates }` | Installation seed (`templates/areas.json` and the files it lists). |
| `src/analyze/templates.js`, `errors.js` | `parseTemplate(markdown)`, `compileFieldsSchema(fields, { validation: true })` | A single definition of a valid template: the core uses it when saving a template (422 if it does not comply) and when validating the `fields` of each message on publish. |
| `src/providers/index.js` | `createProviders(env) → { text, vision, speech, textFallback, describe() }` | Built from the environment plus what is stored in «Configuración» (`TEXT_*`, `VISION_*`, `SPEECH_*`) and rebuilt when that changes. `describe()` feeds `GET /settings/providers` and `GET /health`. A key is never exposed. |

**Errors and retries.** An error with `retryable === false` fails the job immediately. The core assigns it to `ExtractError`s except `link_timeout` and `link_fetch_failed`, and to analyzer and provider errors with `code` in `input`, `template`, `harness_unavailable`, `config`, `refusal`, `max_tokens`, `invalid_output`, `unsupported`. The rest are retried with exponential backoff and jitter up to `QUEUE_MAX_ATTEMPTS`. The model calls that a job managed to make stay traced even if the job fails. The error's `code` reaches the client in `error_code` (`GET /inputs/:id` and the `done` event).

**Model calls.** Each provider opens its own span with the `gen_ai.*` attributes (UD-014); the core stores nothing separately. `llm_calls` is a view over `spans` (`0002_telemetry.sql`, a copy of `src/telemetry/migration.sql`).

## 2. Telemetry (UD-014)

`src/telemetry/` is used as it is (`src/domain/tracing.js` re-exports what the worker and the API use). `initTelemetry({ db, serviceVersion })` runs after migrating and before the API and the worker, in the server and in the separate worker; `shutdown()` flushes the batches on shutdown. Each attempt of a queue job is the root of its own tree: `withSpan('job', { 'team.job_id', 'team.input_id', 'team.step': 'job', 'team.job_kind', 'team.attempt' })` with the result in `team.outcome` (`done`, `requeued`, `failed`, `deferred`, `released`, `lost`) and `error.type` if it failed. Publishing, closing and reopening open `input.publish`, `message.close` and `message.reopen`. `GET /api/jobs/:id/trace` (editor) returns `traceOfJob` after flushing the export queue; 404 if the job left no spans. Span retention (`pruneSpans`) goes with that of jobs and events (`RETENTION_DAYS`).

The database connection keeps `synchronous=FULL` and SQLite's WAL autocheckpoint (1,000 pages). The telemetry report measured that each automatic checkpoint pauses the loop for about 30 ms and that `wal_autocheckpoint=0` with a checkpoint of our own brings it down to 1.4 ms (`src/telemetry/README.md`); it is not adopted because 30 ms every ~4 MB of WAL is not on the critical path of an input (the steps last seconds) and a checkpoint of our own adds a timer that, if it fails, lets the WAL grow without bound.

## 3. What the core offers

**Process.** Reads `DATA_DIR` (default `/data`), `DB_PATH` (default `$DATA_DIR/team.db`), `HOST` and `PORT`. Attachments in `$DATA_DIR/attachments`, a copy of the edited templates in `$DATA_DIR/templates`. `GET /health` answers 200 only with the database migrated and 503 otherwise. SIGTERM: stops claiming, closes the SSE streams, aborts the jobs in progress and returns them to the queue with the attempt refunded, closes the API and the database (measured under 1 s, Docker deadline 10 s). JSON logs to stdout (pino); each worker line carries `job_id` and `input_id`.

**API.** Everything under `/api` (plus `/health` at the root). The OpenAPI 3.1 contract comes from the route schemas: `GET /api/openapi.json`. Conventions:

- Every id travels as text in responses, SSE included. In inputs, text or integer is accepted; an invalid id is 400.
- Every POST and PATCH with a body rejects unknown properties. 401 without a session, 403 without the role, 409 for uniqueness (member email, current area title, template name within an area).
- Every list is `{ items, page, limit, total }`, with `?page=&limit=` and a cap of 100. Areas and the templates of an area are bounded lists and return an array.
- Every destructive operation requires `?confirm=true`. Areas and templates are soft-deleted (`deleted_at`) and restored with `POST /areas/:id/restore` and `POST /templates/:id/restore`; the messages that reference them are not lost.
- Error bodies: `{ code, message, ...extra }`, messages in Spanish.
- Messages come out flat (`area_id`, `author_id`, `assignee_ids`, `reply_count`, `last_reply`); names are resolved with `GET /members` and `GET /areas`. A member's `domains` is a list. `GET /me` brings `project_name`. `GET /inputs/:id` brings `units: [{ id, text }]` and the proposal with text ids.
- Publishing (`POST /inputs/:id/publish`) accepts the proposal exactly as `GET /inputs/:id` delivers it (`messages`, `discarded`, `unit_ids`). A null `template_id` uses the first current template of the message's area.
- An unsafe request with the session cookie requires `X-Team-Request` (the panel sends `panel`).
- The accepted image attachments are raster (png, jpeg, webp, gif, heic, heif, avif). SVG is rejected with 415 because it can carry scripts.

**Events.** `GET /api/events`, one stream per member. Events `progress` (`job_id`, `input_id`, `percent`, `phrase`, `at`), `done` (`job_id`, `input_id`, `done: true`, plus `status`, `error`, `error_code`) and `message` (`message_id`, `title`, `author_id`, `at`, one per published message). `id` is `job_events.seq`; `Last-Event-ID` replays without duplicates or gaps. `?job_id=` narrows to one job and answers 204 if it already finished and there is nothing to replay.

**Cross-origin.** `CORS_ORIGINS` (list of origins; empty = same origin, no CORS) with `credentials: true`. `COOKIE_MODE=cross-origin` sets `SameSite=None; Secure` and the CSRF hook accepts only a listed `Origin`. With `same-origin` (the default) the cookie is `__Host-` with `SameSite=Lax`.

**Editor operations.** `GET /jobs?state=` and `DELETE /jobs?state=&confirm=true` (finished only), `POST /inputs/:id/reprocess`, `GET /audit`, `GET /health` with database, queue and provider detail, `GET /jobs/:id/trace`.

**Development.** `POST /api/auth/dev-login` exists only with `NODE_ENV=development`.

## 4. Tests

`npm test` runs everything with `node --test` on an ephemeral SQLite database. `node src/testing/smoke-panel.mjs` starts the server with the compiled panel and walks the main flow in a windowless browser.
