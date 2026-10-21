-- Telemetry (MASTER-SPEC §7.10 bis, UD-014): the `spans` table and the `llm_calls` view.
-- Copy of src/telemetry/migration.sql (UD-014): the `spans` table and the `llm_calls` view.
-- Forward only, without BEGIN or COMMIT: the migration runner already opens the transaction.
-- This installation never created an `llm_calls` table, so there is nothing to drop first.

-- A span is a measured unit of work: a job, a step, a call to a provider.
-- Times are in nanoseconds since the Unix epoch (SQLite's 64-bit INTEGER).
CREATE TABLE spans (
  trace_id        TEXT    NOT NULL,
  span_id         TEXT    NOT NULL,
  parent_id       TEXT,                       -- NULL at the root of a tree
  name            TEXT    NOT NULL,
  kind            TEXT    NOT NULL,           -- INTERNAL | SERVER | CLIENT | PRODUCER | CONSUMER
  start_ns        INTEGER NOT NULL,
  end_ns          INTEGER NOT NULL,
  status          TEXT    NOT NULL,           -- unset | ok | error
  status_message  TEXT,
  attributes_json TEXT    NOT NULL,           -- JSON object: team.* and gen_ai.*
  events_json     TEXT    NOT NULL,           -- JSON list of {name, time_ns, attributes}
  -- Generated columns: they allow searching by job and by operation without duplicating the data.
  job_id          TEXT GENERATED ALWAYS AS (json_extract(attributes_json, '$."team.job_id"')) VIRTUAL,
  operation       TEXT GENERATED ALWAYS AS (json_extract(attributes_json, '$."gen_ai.operation.name"')) VIRTUAL,
  PRIMARY KEY (trace_id, span_id)
) WITHOUT ROWID;

CREATE INDEX spans_job ON spans (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX spans_start ON spans (start_ns);
CREATE INDEX spans_operation ON spans (operation) WHERE operation IS NOT NULL;

-- `llm_calls` keeps the columns of MASTER-SPEC §7.2 and adds the ones the tree already knows.
-- It is a view of the spans of a call to a model (those `recordGenAiCall` marks with
-- `gen_ai.operation.name`); tools (`execute_tool`) do not count as a call.
--   id            = span_id (text)
--   input_tokens  = gen_ai.usage.input_tokens, which under the GenAI convention includes what was read
--                   and written in the cache; `cached_tokens` is the part read from the cache
--   at            = start of the call in Unix milliseconds
CREATE VIEW llm_calls AS
SELECT
  span_id                                                                            AS id,
  job_id                                                                             AS job_id,
  COALESCE(json_extract(attributes_json, '$."team.provider"'),
           json_extract(attributes_json, '$."gen_ai.provider.name"'))                AS provider,
  COALESCE(json_extract(attributes_json, '$."gen_ai.response.model"'),
           json_extract(attributes_json, '$."gen_ai.request.model"'))                AS model,
  json_extract(attributes_json, '$."team.modality"')                                 AS modality,
  COALESCE(json_extract(attributes_json, '$."gen_ai.usage.input_tokens"'), 0)        AS input_tokens,
  COALESCE(json_extract(attributes_json, '$."gen_ai.usage.output_tokens"'), 0)       AS output_tokens,
  COALESCE(json_extract(attributes_json, '$."gen_ai.usage.cache_read.input_tokens"'), 0) AS cached_tokens,
  json_extract(attributes_json, '$."team.cost_usd"')                                 AS cost_usd,
  CAST(ROUND((end_ns - start_ns) / 1000000.0) AS INTEGER)                              AS duration_ms,
  start_ns / 1000000                                                                 AS at,
  trace_id                                                                           AS trace_id,
  status                                                                             AS status,
  json_extract(attributes_json, '$."error.type"')                                    AS error_type,
  json_extract(attributes_json, '$."team.step"')                                     AS step
FROM spans
WHERE operation IS NOT NULL AND operation <> 'execute_tool';
