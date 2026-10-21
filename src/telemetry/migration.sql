-- Telemetría (MASTER-SPEC §7.10 bis, UD-014): la tabla `spans` y la vista `llm_calls`.
-- El núcleo copia este archivo a su carpeta de migraciones con el número que corresponda.
-- Sólo hacia adelante, sin BEGIN ni COMMIT: el ejecutor de migraciones ya abre la transacción.
-- Si el núcleo creó antes una tabla `llm_calls`, la migración que copia este archivo debe
-- eliminarla primero (`DROP TABLE llm_calls;`): desde UD-014 es una vista sobre `spans`.

-- Un span es una unidad de trabajo medida: un trabajo, un paso, una llamada a un proveedor.
-- Los tiempos van en nanosegundos desde la época Unix (INTEGER de 64 bits de SQLite).
CREATE TABLE spans (
  trace_id        TEXT    NOT NULL,
  span_id         TEXT    NOT NULL,
  parent_id       TEXT,                       -- NULL en la raíz de un árbol
  name            TEXT    NOT NULL,
  kind            TEXT    NOT NULL,           -- INTERNAL | SERVER | CLIENT | PRODUCER | CONSUMER
  start_ns        INTEGER NOT NULL,
  end_ns          INTEGER NOT NULL,
  status          TEXT    NOT NULL,           -- unset | ok | error
  status_message  TEXT,
  attributes_json TEXT    NOT NULL,           -- objeto JSON: team.* y gen_ai.*
  events_json     TEXT    NOT NULL,           -- lista JSON de {name, time_ns, attributes}
  -- Columnas generadas: dejan buscar por trabajo y por operación sin duplicar el dato.
  job_id          TEXT GENERATED ALWAYS AS (json_extract(attributes_json, '$."team.job_id"')) VIRTUAL,
  operation       TEXT GENERATED ALWAYS AS (json_extract(attributes_json, '$."gen_ai.operation.name"')) VIRTUAL,
  PRIMARY KEY (trace_id, span_id)
) WITHOUT ROWID;

CREATE INDEX spans_job ON spans (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX spans_start ON spans (start_ns);
CREATE INDEX spans_operation ON spans (operation) WHERE operation IS NOT NULL;

-- `llm_calls` conserva las columnas de MASTER-SPEC §7.2 y suma las que el árbol ya conoce.
-- Es una vista de los spans de llamada a un modelo (los que `recordGenAiCall` marca con
-- `gen_ai.operation.name`); las herramientas (`execute_tool`) no cuentan como llamada.
--   id            = span_id (texto)
--   input_tokens  = gen_ai.usage.input_tokens, que según la convención de GenAI incluye lo leído
--                   y lo escrito en la caché; `cached_tokens` es la parte leída de la caché
--   at            = inicio de la llamada en milisegundos Unix
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
