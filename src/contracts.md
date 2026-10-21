# Contratos del núcleo

Lo que el núcleo (`src/server.js`, `src/worker.js`, `src/db`, `src/queue`, `src/api`, `src/events`, `src/identity`, `src/domain`) espera de los demás módulos y lo que ofrece a sus clientes. Los números y sus fuentes están en `src/config.js` y en `.env.example`.

## 1. Módulos que el núcleo carga

Se importan por ruta (`ANALYZE_MODULE`, `EXTRACT_MODULE`, `PROVIDERS_MODULE`). Si un archivo no existe el servidor arranca igual y el trabajo que lo necesite falla con `error_code: module_unavailable`.

| Módulo | Firma | Lo que el núcleo hace con el resultado |
|---|---|---|
| `src/extract/index.js` | `extract(attachment, { providers, onProgress, signal }) → { text, meta }`. `attachment = { id, input_id, kind, name, mime, size, sha256, path }`; `path` es absoluta (para `link`, la URL). `onProgress(percent, phrase)` con `percent` de 0 a 100 del paso del adjunto. No recibe la configuración de la aplicación. | Guarda `text` y `meta` en la fila del adjunto. |
| `src/extract/index.js` | `estimateAudioSeconds(attachment, { signal }) → segundos`, `createAudioBudget() → { check(seconds, at), record(seconds, at) }` | Antes de extraer audio o video: `check`; sin cupo el trabajo se aplaza `waitMs` sin gastar el intento (`phrase: «Esperando cupo de transcripción»`); con cupo, `record`. Un `waitMs` infinito falla con `audio_budget_exceeded`. |
| `src/analyze/index.js` | `analyze(bundle, { providers, analyzer, onProgress, signal }) → { status, proposal, units, calls, stats }`. `onProgress({ percent, phrase })`. `bundle = { text, attachments:[{id,kind,name,extracted}], areas:[{id,title,description,position}], templates:[{id,area_id,name,description,body_markdown}], members:[{id,name,profile}], project:{name,description} }`, con `profile` como el texto libre completo del miembro (UD-023, sin recortes) y sólo áreas y plantillas vigentes. | `status: 'ok'`: guarda la propuesta (`proposal.messages[]` con `area_id` y `template_id` por mensaje, `discarded`) y `units`. `refusal`, `max_tokens` o `invalid`: el input falla sin reintento, con `error_code` igual al estado. Una propuesta con `area_id` y `template_id` en la raíz se normaliza a uno por mensaje. |
| `src/analyze/index.js` | `warmTemplate({ providers, config, templateMarkdown })`, `resolveConfig()` | El núcleo la llama al guardar una plantilla (evento `template.saved`), sin esperas por reloj. |
| `src/analyze/seed.js` | `loadSeed(dir) → { areas, templates }` | Siembra de instalación (`templates/areas.json` y los archivos que enumera). |
| `src/analyze/templates.js`, `errors.js` | `parseTemplate(markdown)`, `compileFieldsSchema(fields, { validation: true })` | Una sola definición de plantilla válida: el núcleo la usa al guardar una plantilla (422 si no cumple) y al validar `fields` de cada mensaje al publicar. |
| `src/providers/index.js` | `createProviders(env) → { text, vision, speech, textFallback, describe() }` | Se arma con el entorno más lo guardado en Configuración (`TEXT_*`, `VISION_*`, `SPEECH_*`) y se reconstruye cuando eso cambia. `describe()` alimenta `GET /settings/providers` y `GET /health`. Nunca se expone una llave. |

**Errores y reintentos.** Un error con `retryable === false` falla el trabajo de inmediato. El núcleo lo asigna a los `ExtractError` salvo `link_timeout` y `link_fetch_failed`, y a los errores del analizador y de proveedores con `code` en `input`, `template`, `harness_unavailable`, `config`, `refusal`, `max_tokens`, `invalid_output`, `unsupported`. El resto se reintenta con retroceso exponencial y jitter hasta `QUEUE_MAX_ATTEMPTS`. Las llamadas a modelos que un trabajo alcanzó a hacer quedan trazadas aunque el trabajo falle. El `code` del error llega al cliente en `error_code` (`GET /inputs/:id` y evento `done`).

**Llamadas a modelos.** Cada proveedor abre su propio span con los atributos `gen_ai.*` (UD-014); el núcleo no guarda nada aparte. `llm_calls` es una vista sobre `spans` (`0002_telemetry.sql`, copia de `src/telemetry/migration.sql`).

## 2. Telemetría (UD-014)

Se usa `src/telemetry/` tal cual (`src/domain/tracing.js` reexporta lo que usan el worker y la API). `initTelemetry({ db, serviceVersion })` corre tras migrar y antes de la API y del worker, en el servidor y en el worker aparte; `shutdown()` vacía los lotes al apagar. Cada intento de un trabajo de la cola es la raíz de su propio árbol: `withSpan('job', { 'team.job_id', 'team.input_id', 'team.step': 'job', 'team.job_kind', 'team.attempt' })` con el resultado en `team.outcome` (`done`, `requeued`, `failed`, `deferred`, `released`, `lost`) y `error.type` si falló. Publicar, cerrar y reabrir abren `input.publish`, `message.close` y `message.reopen`. `GET /api/jobs/:id/trace` (editor) devuelve `traceOfJob` tras vaciar la cola de exportación; 404 si el trabajo no dejó spans. La retención de spans (`pruneSpans`) va con la de los trabajos y los eventos (`RETENTION_DAYS`).

La conexión de la base queda con `synchronous=FULL` y el autocheckpoint de WAL de SQLite (1.000 páginas). El informe de la telemetría midió que cada checkpoint automático pausa el bucle unos 30 ms y que `wal_autocheckpoint=0` con un checkpoint propio lo baja a 1,4 ms (`src/telemetry/README.md`); no se adopta porque 30 ms cada ~4 MB de WAL no están en el camino crítico de un input (los pasos duran segundos) y un checkpoint propio agrega un temporizador que, si falla, deja crecer el WAL sin tope.

## 3. Lo que el núcleo ofrece

**Proceso.** Lee `DATA_DIR` (omisión `/data`), `DB_PATH` (omisión `$DATA_DIR/team.db`), `HOST` y `PORT`. Adjuntos en `$DATA_DIR/attachments`, copia de las plantillas editadas en `$DATA_DIR/templates`. `GET /health` responde 200 sólo con la base migrada y 503 si no. SIGTERM: deja de reclamar, cierra los flujos SSE, aborta los trabajos en curso y los devuelve a la cola con el intento reembolsado, cierra la API y la base (medido bajo 1 s, plazo de Docker 10 s). Registros en JSON a stdout (pino); cada línea del worker lleva `job_id` e `input_id`.

**API.** Todo bajo `/api` (más `/health` en la raíz). El contrato OpenAPI 3.1 sale de los esquemas de las rutas: `GET /api/openapi.json`. Convenciones:

- Todo id viaja como texto en las respuestas, incluido el SSE. En las entradas se acepta texto o entero; un id inválido es 400.
- Todo POST y PATCH con cuerpo rechaza propiedades desconocidas. 401 sin sesión, 403 sin rol, 409 por unicidad (correo de miembro, título de área vigente, nombre de plantilla dentro de un área).
- Toda lista es `{ items, page, limit, total }`, con `?page=&limit=` y tope de 100. Las áreas y las plantillas de un área son listas acotadas y devuelven un arreglo.
- Toda operación destructiva exige `?confirm=true`. Áreas y plantillas se borran en blando (`deleted_at`) y se restauran con `POST /areas/:id/restore` y `POST /templates/:id/restore`; los mensajes que las referencian no se pierden.
- Cuerpos de errores: `{ code, message, ...extra }`, mensajes en español.
- Los mensajes salen planos (`area_id`, `author_id`, `assignee_ids`, `reply_count`, `last_reply`); los nombres se resuelven con `GET /members` y `GET /areas`. Un miembro trae `profile` (texto libre, UD-023). `GET /me` trae `project_name`. `GET /inputs/:id` trae `units: [{ id, text }]` y la propuesta con ids de texto.
- Publicar (`POST /inputs/:id/publish`) acepta la propuesta tal como la entrega `GET /inputs/:id` (`messages`, `discarded`, `unit_ids`). Un `template_id` null usa la primera plantilla vigente del área del mensaje.
- Una petición no segura con la cookie de sesión exige `X-Team-Request` (el panel manda `panel`).
- Los adjuntos de imagen admitidos son raster (png, jpeg, webp, gif, heic, heif, avif). SVG se rechaza con 415 porque puede llevar scripts.

**Eventos.** `GET /api/events`, un flujo por miembro. Eventos `progress` (`job_id`, `input_id`, `percent`, `phrase`, `at`), `done` (`job_id`, `input_id`, `done: true`, más `status`, `error`, `error_code`) y `message` (`message_id`, `title`, `author_id`, `at`, uno por mensaje publicado). `id` es `job_events.seq`; `Last-Event-ID` repone sin repetidos ni huecos. `?job_id=` acota a un trabajo y responde 204 si ya terminó y no hay nada que reponer.

**Origen cruzado.** `CORS_ORIGINS` (lista de orígenes; vacía = mismo origen, sin CORS) con `credentials: true`. `COOKIE_MODE=cross-origin` pone `SameSite=None; Secure` y el gancho CSRF acepta sólo `Origin` listado. Con `same-origin` (omisión) la cookie es `__Host-` con `SameSite=Lax`.

**Operación del editor.** `GET /jobs?state=` y `DELETE /jobs?state=&confirm=true` (sólo terminados), `POST /inputs/:id/reprocess`, `GET /audit`, `GET /health` con detalle de base, cola y proveedores, `GET /jobs/:id/trace`.

**Desarrollo.** `POST /api/auth/dev-login` existe sólo con `NODE_ENV=development`.

## 4. Pruebas

`npm test` corre todo con `node --test` sobre una base SQLite efímera. `node src/testing/smoke-panel.mjs` levanta el servidor con el panel compilado y recorre el flujo principal en un navegador sin ventana.
