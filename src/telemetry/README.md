# Telemetría

Trazabilidad de todo lo que pasa por un modelo (UD-014, MASTER-SPEC §7.10 bis). Hay un span por trabajo, por paso y por llamada a un proveedor. La entrada y la salida completas quedan en SQLite.

## Conexión con el núcleo

1. Copiar `migration.sql` a la carpeta de migraciones del núcleo. Crea la tabla `spans` y la vista `llm_calls`; si el núcleo creó antes una tabla `llm_calls`, la migración la elimina primero.
2. Después de abrir la base y migrar, y antes de levantar la API y el worker:

   ```js
   import { initTelemetry } from './telemetry/index.js';
   const telemetry = initTelemetry({ db, serviceVersion });
   // al apagar: await telemetry.shutdown();
   ```

   La conexión `db` es la que abre el núcleo; la telemetría no abre ni cierra nada.
3. `GET /jobs/:id/trace` responde `await telemetry.flush(); traceOfJob(db, id)` (404 si devuelve `null`). La forma de la respuesta está en `trace.js`; los nanosegundos viajan como texto.
4. Retención: `pruneSpans(db)` borra lo anterior a 7 días, igual que `job_events`.
5. El worker abre un span `withSpan('job', { 'team.job_id': id, 'team.input_id': inputId, 'team.step': 'job' }, ...)` por intento. Todo span hijo hereda `team.job_id` y `team.input_id`.

Leer `spans` con `SELECT *` falla con `ERR_OUT_OF_RANGE`: `start_ns` y `end_ns` son enteros de 64 bits (nanosegundos Unix) y `node:sqlite` no los entrega como número sin perder precisión. Pedirlos con `CAST(start_ns AS TEXT)`, o leer la vista `llm_calls` y `traceOfJob`, que ya lo hacen.

## Qué importar

Los módulos instrumentados importan de `telemetry/api.js`, que sólo carga `@opentelemetry/api`. Sin `initTelemetry` el tracer es nulo y el código funciona igual. `telemetry/index.js` trae el SDK completo y reexporta lo mismo.

| Función | Uso |
|---|---|
| `withSpan(name, attributes, fn)` | Un span activo alrededor de `fn(span)`; un error lanzado lo marca con `error.type` |
| `withGenAiCall({ provider, model, modality, request }, fn)` | Span CLIENT de una llamada a un modelo; registra atributos `gen_ai.*` y el evento de contenido |
| `recordGenAiCall(span, { provider, model, request, response, usage, cost })` | Lo mismo sobre un span ya abierto (el harness) |
| `withToolSpan(tool, attributes, fn)` | Uso de una herramienta (`execute_tool`); no cuenta en `llm_calls` |
| `annotate(attributes)` | Agrega atributos al span activo |

## Para el analizador (`src/analyze/`, sin tocar desde este encargo)

- Importar `{ withSpan, recordGenAiCall } from '../telemetry/api.js'`. Envolver con `withSpan(nombre, { 'team.job_id': ..., 'team.step': nombre }, ...)` el análisis completo (`'analyze'`), la clasificación (`'classify'`), cada descomposición por grupo (`'decompose'`, con `team.group_index`, `team.area_id`, `team.template_id` y `team.units`), el pase de rescate (`'rescue'`) y cada validación (`'validate'`, con `team.errors` y el resultado).
- Las llamadas de `api` quedan como hijos de esos spans sin más código: los proveedores traen su propio span y el contexto pasa solo por los `await`.
- En el harness: `withSpan('harness', { 'team.step': 'harness' }, async (span) => { ...; recordGenAiCall(span, { provider: 'claude-code', model, request: { messages: [{ role: 'user', content: prompt }] }, response: { text: JSON.stringify(structured_output) }, usage, cost: result.total_cost_usd }); })`, pasando el costo real de `total_cost_usd` en `cost` para que no se estime.

## Variables

| Variable | Efecto |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Si existe, los spans salen además por OTLP/HTTP a `<endpoint>/v1/traces`. Sin ella no sale ninguna conexión (HP-001) |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Dirección completa de trazas; manda sobre la anterior |
| `OTEL_EXPORTER_OTLP_HEADERS` | Cabeceras del colector, `clave=valor,clave=valor` |
| `OTEL_SDK_DISABLED=true` | Apaga el SDK; el código instrumentado sigue andando con el tracer nulo |
| `TELEMETRY_INLINE_BLOBS=0` | Las imágenes y fotogramas quedan con su tamaño y sin los bytes en base64 (por omisión se guardan) |
| `TELEMETRY_FLUSH_MS` | Intervalo de vaciado de los lotes; 5000 ms por omisión |
| `TELEMETRY_SLICE_ROWS` | Filas por transacción del exportador a SQLite; 16 por omisión |

El audio nunca se copia al span: queda por referencia (`file://` y tamaño) y la transcripción completa en el evento de salida.

## Atributos y eventos

Convención GenAI de OpenTelemetry vigente al 2026-10-20 (detalle y fuentes en la cabecera de `index.js`). Del proyecto: `team.job_id`, `team.input_id`, `team.step`, `team.cost_usd`, `team.provider`, `team.modality`, `team.input_bytes`, `team.output_bytes`, `team.output_chars`. El contenido de una llamada va en el evento `gen_ai.client.inference.operation.details`: `gen_ai.system_instructions`, `gen_ai.input.messages`, `gen_ai.output.messages`, `team.request.schema` y, en transcripción, `team.response.segments`.

`gen_ai.usage.input_tokens` incluye lo leído y lo escrito en la caché, como fija la convención. Los proveedores del proyecto informan `input_tokens` sin caché; la suma la hace `recordGenAiCall`. `llm_calls.input_tokens` es ese total y `llm_calls.cached_tokens` la parte leída.

El costo sale de `pricing.js` para los modelos con precio documentado en el repositorio (Haiku 5.5 y Whisper turbo de Groq). Un modelo sin precio queda con `cost_usd` en `NULL`.

## Medición

Sobrecarga por llamada y duración de cada tajada de escritura: cabecera de `overhead.bench.mjs` (se vuelve a medir con `node src/telemetry/overhead.bench.mjs`).
