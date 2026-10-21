# VERIFICATION: team-platform v0.1.0

> Verdad canónica de las promesas verificables del proyecto y de dónde se verifica cada una.
> Derivada de las prohibiciones HP-001 a HP-029 de `docs/TEST.md` y de las decisiones de `docs/USER-DECISIONS.md`.

## Leyenda de símbolos Kairós

| Símbolo | Significado |
|---|---|
| 🤖 `.LLM` | Verificable por IA o herramienta automática |
| 🧑 `.HUM` | Requiere verificación humana |
| 🤖🧑 `.MIX` | Pre-verificable por IA, validación final humana |
| ✅ | Implementado y verificado |
| 🔲 | Pendiente |

Cada marca ✅ cita el archivo de prueba y el nombre de la prueba. `src/verification.test.js` falla si alguno ya no existe.

---

## Quien contribuye (DEV)

### Integridad

🤖 `[DEV.IN.01.LLM]` Se escribe en `src/analyze/`, `src/domain/`, `src/api/`, `src/identity/`, `src/queue/` o `src/events/` un `if`, una expresión regular o una lista de palabras sobre texto humano → la prueba estática falla. *(HP-003, §4.2, §1.2)*
✅ Implemented (🤖 Verified by `src/static.test.js` «HP-003 · no code decides with the text a person writes (§1.2, §4.2)»; `src/static-analyzer.test.js` «HP-003: no file of src/analyze/ outside the explained allowlist matches human text», «HP-003: every allowlist entry is still used, so the list cannot go stale»; 2026-10-21 15:30)
> `units.js` y `validate.js` están en una lista de excepciones con su razón.

🤖 `[DEV.IN.02.LLM]` Un archivo distinto de `src/domain/proposals.js` inserta en `messages` → la prueba estática falla. *(HP-005, §4.4, UD-003)*
✅ Implemented (🤖 Verified by `src/static.test.js` «HP-005 · messages are only born from publishing a confirmed proposal (§4.4, UD-003)»; 2026-10-21 15:30)

🤖 `[DEV.IN.03.LLM]` Una columna del esquema guarda una llave, o un archivo versionado contiene una credencial → fallan la prueba del esquema y el escáner, y el gancho de pre-commit rechaza el commit. *(HP-007, §4.6)*
✅ Implemented (🤖 Verified by `src/static.test.js` «HP-007 · no schema column stores a key or a secret in plain text (§4.6)»; `src/secrets.test.js` «HP-007: the scanner recognizes the keys the project handles and ignores empty variables», «HP-007: no tracked file of the repository contains a credential», «HP-007: the pre-commit hook refuses a commit with a credential and accepts one without»; 2026-10-21 15:30)
> Cada clon activa el gancho una vez con `git config core.hooksPath .githooks`.

🤖 `[DEV.IN.04.LLM]` Un identificador, un comentario, un nombre de prueba, un mensaje de aserción o de registro en español, o un texto visible del panel en inglés → la prueba estática falla. *(HP-008, §4.7, UD-015)*
✅ Implemented (🤖 Verified by `src/static.test.js` «HP-008 · code identifiers are in English (UD-005, §4.7)», «HP-008 · code comments are written in English (UD-015, §4.7)», «HP-008 · test names and log messages are written in English (UD-015, §4.7)», «HP-008 · assertion messages are written in English (UD-015, §4.7)», «HP-008 · visible panel text is written in Spanish (UD-015, §4.7)», «HP-008 · the language detectors flag what they must and nothing else»; 2026-10-21 15:30)
> Alcance de los detectores: `src/`, `panel/src`, `panel/scripts`, `bench/`, `scripts/`, `.githooks/`, `Dockerfile`, `compose.yml` y `.env.example`. La salida por consola de los guiones de operación queda en español.

🤖 `[DEV.IN.05.LLM]` Un literal numérico que gobierna la operación, sin su fuente en un comentario de la misma línea → la prueba estática falla. *(HP-010, §4.9)*
✅ Implemented (🤖 Verified by `src/numbers-declared.test.js` «HP-010: every reviewed numeric literal in src/ cites its source (section 4.9)», «HP-010: the criterion detects a number without source and accepts the ones that cite one»; 2026-10-21 15:30)

🤖 `[DEV.IN.06.LLM]` Una dependencia de producción con licencia incompatible con MIT, sin justificación en `NOTICE`, o un `ffmpeg` construido con GPL → la prueba falla. *(HP-011, §4.10, UD-004, UD-020)*
✅ Implemented (🤖 Verified by `src/static.test.js` «HP-011 · every production dependency has a license compatible with MIT (§4.10, UD-004)», «HP-011 · the @img/sharp-libvips-* exception is justified in NOTICE, with the lockfile version», «HP-011 · NOTICE names ffmpeg with the version and the checksum the Dockerfile pins, and is up to date», «HP-011 · ffmpeg is built without GPL: no --enable-gpl, --enable-nonfree, --enable-version3 or x264/x265»; 2026-10-21 15:30)

🤖 `[DEV.IN.07.LLM]` Una ruta sin esquema de respuesta, o un documento OpenAPI inválido → las pruebas del contrato fallan. *(HP-012, §4.11)*
✅ Implemented (🤖 Verified by `src/openapi-valid.test.js` «HP-012: the document at GET /api/openapi.json is valid OpenAPI 3.1 (section 4.11)», «HP-012: every route registered in the API appears in the contract», «HP-012: every operation has a response schema for 2xx and for 4xx (section 4.11)», «HP-012: the validator rejects a broken document and the response rule sees an operation without schema»; `src/api/contract.test.js` «no route is left without a response schema»; 2026-10-21 15:30)

🤖 `[DEV.IN.08.LLM]` `compose.yml` declara más de un servicio → la prueba estática falla. *(HP-006, §4.5)*
✅ Implemented (🤖 Verified by `src/static.test.js` «HP-006 · one container and one volume are enough: compose.yml declares a single service (§4.5)»; 2026-10-21 15:30)

🤖 `[DEV.IN.09.LLM]` Un código de error que el servidor puede enviar sin su línea `error.<código>` o `analysis.error.<código>` en los dos catálogos → la prueba falla. *(HP-021, UD-018, H-44)*
✅ Implemented (🤖 Verified by `src/error-codes.test.js` «the scan finds the codes it is supposed to find»; `panel/src/lib/error-text.test.tsx` «translates the code of a rejected provider in both languages, never the server sentence»; 2026-10-21 15:30)

## Servidor (SYS)

### Disponibilidad

🤖 `[SYS.AV.01.LLM]` `GET /health` sin sesión → informa solo `status` y `version`; para el Editor agrega base, cola, trabajador y los proveedores por ranura, entre ellos `text_fallback`, sin llaves. *(DT-003, §7.1)*
✅ Implemented (🤖 Verified by `src/api/api.test.js` «/health answers at the root and under /api, without a session», «/health reports the text fallback provider to the editor and keeps it from anonymous probes (DT-003)»; `src/api/contract.test.js` «/health: the basics are public; the detail of database, queue and providers belongs to the editor; 503 if the database is not migrated»; 2026-10-21 15:30)

### Funcionalidad

🤖 `[SYS.FN.01.LLM]` Una propuesta válida al terminar el análisis → se publica sola en la misma transacción que cierra el trabajo, con sus avisos al equipo y el evento `done` con `input_status` y `message_ids`; la perilla `auto_publish` solo la cambia el Editor. *(HP-022, UD-070)*
✅ Implemented (🤖 Verified by `src/api/auto-publish.test.js` «UD-070 · the default is automatic publication and a valid proposal is published with no confirmation», «UD-070 · the publication notices reach the team and the job reports published with the message ids», «UD-070 · the Editor knob auto_publish returns to the review: the proposal waits as proposed until its sender publishes it»; 2026-10-21 15:30)

🤖 `[SYS.FN.02.LLM]` Cambiar los destinatarios de un mensaje → avisa solo a los nuevos y nunca al emisor; los adjuntos se eligen entre los del envío de origen; la bandeja lista todos los estados de los envíos propios con paginación. *(HP-026, UD-070, UD-071)*
✅ Implemented (🤖 Verified by `src/api/message-author-edit.test.js` «UD-071 · changing the recipients notifies only the new ones, with a directed notice, and not the sender», «UD-071 · attachments are chosen only among those of the message»; `src/api/auto-publish.test.js` «UD-070 · the tray is the history: every state of one»; 2026-10-21 15:30)

🤖 `[SYS.FN.03.LLM]` Un envío con `auto_publish=false` (multipart o JSON) → nunca se publica solo y puede cancelarse sin que llegue un mensaje; otro valor es 400 y no guarda nada. *(HP-027, UD-072)*
✅ Implemented (🤖 Verified by `src/api/auto-publish.test.js` «UD-072 · a send with auto_publish=false (multipart or JSON) waits as proposed even with the knob on, and can be cancelled without publishing», «UD-072 · an auto_publish value that is not true or false is a 400 and stores nothing»; `src/vps-check.test.js` «the check passes against a local server, prints no password and cancels its test input; with a wrong password it fails»; 2026-10-21 15:30)

### Corrección

🤖 `[SYS.CR.01.LLM]` Cada llamada a un proveedor de modelo → deja una fila en `llm_calls` con proveedor, modelo, modalidad, tokens y costo; un análisis sin filas falla. Tras un respaldo, la fila lleva el proveedor que respondió. *(HP-002, §4.1, DT-003)*
✅ Implemented (🤖 Verified by `src/telemetry-integration.test.js` «a job leaves its span tree: job, analyze and the model call, with tokens and cost (HP-002)»; `src/telemetry/telemetry.test.js` «HP-002: the llm_calls view returns the MASTER-SPEC §7.2 columns»; `src/analyze/telemetry.test.js` «fallback (DT-003): llm_calls records the provider that answered each call and the failed call of the primary»; 2026-10-21 15:30)

🤖 `[SYS.CR.02.LLM]` El emisor responde su propio mensaje → 403; cualquier miembro cierra y reabre un mensaje. *(HP-009, §4.8, §1.1)*
✅ Implemented (🤖 Verified by `src/api/api.test.js` «full flow: submit, analyze, edit, publish, reply, close and reopen», «reopening a message without replies returns it to open»; 2026-10-21 15:30)

🤖 `[SYS.CR.03.LLM]` Tras cualquier secuencia de operaciones → el estado de cada mensaje se deriva de sus respuestas y de su cierre y nunca se escribe a mano. *(UD-042, UD-041)*
✅ Implemented (🤖 Verified by `src/api/message-state-derivation.test.js` «UD-042 · the state of every message is derived from its replies and its closing mark after any sequence of operations», «UD-042 · the check detects a message whose state contradicts its replies»; 2026-10-21 15:30)

🤖 `[SYS.CR.04.LLM]` `GET /messages/summary` → cada mensaje cae en un solo estado, uno cerrado no cuenta y los abiertos se cuentan por área. *(UD-028)*
✅ Implemented (🤖 Verified by `src/api/api.test.js` «UD-028 · GET /messages/summary: each message falls into a single state (open or answered), a closed one does not count and open ones are counted per area»; 2026-10-21 15:30)

### Integridad

🤖 `[SYS.IN.01.LLM]` Un flujo completo con un adjunto de cada tipo sale a un host distinto de loopback, del proveedor configurado o del colector OTLP → la guardia de red lo rechaza y la prueba falla. Sin `OTEL_EXPORTER_OTLP_ENDPOINT` no sale ninguna conexión. *(HP-001, §4.1)*
✅ Implemented (🤖 Verified by `src/network-egress.test.js` «HP-001: the guard refuses and records a destination outside the allowed set, through every door», «HP-001: the allowed set is loopback, the configured providers and the OTLP collector only when it is defined», «HP-001: the modules that run in the document worker thread (not covered by the guard) import nothing that reaches the network», «HP-001: a complete flow with an attachment of every kind reaches only allowed destinations»; `src/telemetry/telemetry.test.js` «HP-001: without OTEL_EXPORTER_OTLP_ENDPOINT no connection goes out, neither on start, nor on measuring, nor on close»; `src/api/api.test.js` «static panel: assets with immutable cache, index.html without cache, JSON 404 under /api, SPA for the rest»; 2026-10-21 15:30)
> El hilo de extracción de documentos no lo ve la guardia: una prueba estática comprueba que sus módulos no importan nada de red.

🤖 `[SYS.IN.02.LLM]` Un envío publicado por alguien que no es su emisor, o una propuesta inválida (vacía, campo obligatorio ausente) → no publica nada y la propuesta queda `proposed` con `publish_blocked`. Con `auto_publish` apagado nada llega sin la confirmación del emisor. *(HP-005, §4.4, UD-003, UD-070)*
✅ Implemented (🤖 Verified by `src/api/auto-publish.test.js` «UD-070 · an empty proposal publishes nothing and stays visible to its sender as proposed with publish_blocked», «UD-070 · a proposal that does not validate (required template field missing) is not published; the sender fixes and publishes it by hand», «UD-070 · the Editor knob auto_publish returns to the review: the proposal waits as proposed until its sender publishes it»; `src/api/editing.test.js` «UD-017 · HP-005 · another member, even an editor, cannot patch someone else»; 2026-10-21 15:30)

🤖 `[SYS.IN.03.LLM]` Dos envíos iguales del mismo emisor → devuelven el mismo id y no crean un segundo trabajo ni una segunda propuesta. *(HP-013, §1.3)*
✅ Implemented (🤖 Verified by `src/api/api.test.js` «the same content from the same sender returns what already exists; another sender has their own input»; 2026-10-21 15:30)

🤖 `[SYS.IN.04.LLM]` Publicar una propuesta con área inexistente, plantilla de otra área, miembro inexistente, adjunto ajeno o unidad fuera de todo mensaje y de `discarded` → 422 y no se publica nada. *(HP-014, §7.5)*
✅ Implemented (🤖 Verified by `src/api/api.test.js` «publishing validates the shape: area, template of that area, members, attachments and required fields»; `src/api/publish-units.test.js` «HP-014 · units split between two messages and a discarded group publish», «HP-014 · a unit left in no message and not in discarded is refused (422) and nothing is published», «HP-014 · deleting a message in the preview: its units must go to discarded, then it publishes», «HP-014 · a unit in two places or a unit the input does not have is refused (422)», «HP-014 · the saved draft is held to the same rule when published without a body, though saving it is not»; `src/analyze/validate.test.js` «flags units, members and attachments that do not exist»; 2026-10-21 15:30)

🤖 `[SYS.IN.05.LLM]` Una cookie de sesión sin `__Host-`, `HttpOnly`, `Secure` y `SameSite`, una ficha legible en la base, o un método no seguro sin la cabecera propia y sin `Sec-Fetch-Site` válido → se rechaza (403). *(HP-016, §7.7)*
✅ Implemented (🤖 Verified by `src/identity/identity.test.js` «successful login: __Host- cookie HttpOnly Secure SameSite=Lax, opaque token and only its hash in the database», «CSRF: Sec-Fetch-Site cross-site and same-site are rejected on unsafe methods; same-origin and none pass», «CSRF: without Sec-Fetch-Site, Origin is compared with the host; with neither, it passes (non-browser client)», «login CSRF: a POST /auth/login from another site is rejected»; `src/api/contract.test.js` «the panel sends X-Team-Request: an unsafe request with a cookie and without the header is 403»; 2026-10-21 15:30)

🤖 `[SYS.IN.06.LLM]` Un adjunto sobre el tope de su tipo → 413 `<tipo>_too_large` antes de encolar; un video de más de 20 minutos → 422 `video_too_long`; una foto HEIC se acepta por la marca del contenedor y una dañada falla al extraer con `image_heic_unreadable`. Ningún rechazo deja filas, trabajo ni archivos. *(HP-018, §7.4, UD-040)*
✅ Implemented (🤖 Verified by `src/size-limits.test.js` «HP-018: a file over the cap of its kind is refused at upload with 413 and leaves nothing behind», «HP-018: a document over 24 MiB is refused at upload with document_too_large, before anything is queued», «HP-018: the upload cap of a document is the extractor cap (DT-005), and each kind refuses with its own code», «HP-018: a video longer than 20 minutes is refused at upload with video_too_long, before anything is queued», «HP-018: a file that is not a readable video is not refused by the probe: the job reports it with its own code», «HP-018: each attachment type refuses with its own code one byte over its cap and accepts a file exactly at it», «H-21: a real HEIC photo is accepted at upload, judged by its brand and not by its name, and reaches the vision provider as JPEG», «H-21: a corrupt HEIC photo is accepted at upload and fails at extraction with image_heic_unreadable»; 2026-10-21 15:30)
> El video del tope mayor pasa por el límite del multipart y responde `file_too_large`.

🤖 `[SYS.IN.07.LLM]` Publicar de nuevo un envío publicado, reprocesarlo, reintentar el trabajo de análisis o publicar dos veces a la vez → los mensajes se crean una sola vez (409 o sin escritura). *(HP-023, UD-070, §1.3)*
✅ Implemented (🤖 Verified by `src/api/auto-publish.test.js` «UD-070 · publishing never duplicates: a published input is a 409 to publish, a 409 to reprocess (sender and Editor) and a duplicate when sent again», «UD-070 · a second analysis job for an already published input (queue retry, stray job) writes nothing», «UD-070 · two simultaneous manual publications of one proposal create the messages once»; 2026-10-21 15:30)

🤖 `[SYS.IN.08.LLM]` Otro miembro o el Editor edita un mensaje ajeno, con un id distinto, un campo parcial, un campo no editable o sin `version` → 403 `not_message_author` y no cambia nada. *(HP-024, UD-071)*
✅ Implemented (🤖 Verified by `src/api/message-author-edit.test.js` «UD-071 · nobody else edits a message: another member and the Editor get 403 not_message_author and nothing changes», «UD-071 · tricks fail: another id, a nonexistent one, a missing version, and fields that are not editable»; `src/api/editing.test.js` «UD-071 · only the sender edits a message: another member and an editor get 403 and nothing changes»; 2026-10-21 15:30)

🤖 `[SYS.IN.09.LLM]` Dos ediciones simultáneas con la misma versión → una gana y la otra es 409 `edit_conflict` con la versión vigente; una versión vencida no escribe; un PATCH sin cambios no sube la versión. *(HP-025, UD-071)*
✅ Implemented (🤖 Verified by `src/api/message-author-edit.test.js` «UD-071 · two simultaneous patches with the same version: exactly one wins, the other is a 409, and the history has one row», «UD-071 · a stale version is a 409 edit_conflict with the current version and writes nothing», «UD-071 · the sender edits everything about their message and each edit leaves its history, its version and «edited»», «UD-071 · a patch that changes nothing leaves the message, its version and its history as they were»; 2026-10-21 15:30)

🤖 `[SYS.IN.10.LLM]` Una subida rechazada (versión vencida, mensaje cerrado, valor inválido) → no deja archivos en el volumen y no borra uno que una fila usa o que otra subida en curso usará. *(HP-028, UD-072, H-1804)*
✅ Implemented (🤖 Verified by `src/api/auto-publish.test.js` «UD-072 · a refused upload deletes what it wrote: stale version, closed message, and never a file a row still uses», «UD-072 · two uploads of the same file in flight: the one that fails does not take the blob from the one that succeeds»; 2026-10-21 15:30)

🤖 `[SYS.IN.11.LLM]` Un evento de telemetría de la interfaz con un campo fuera del esquema o con texto libre → se rechaza; tras usar el sistema con nombres y textos, ningún span de la interfaz los contiene. *(HP-029, UD-091)*
✅ Implemented (🤖 Verified by `src/api/ui-telemetry.test.js` «privacy: after using the system with names and texts, no span of the interface holds any of them», «the shape is validated strictly: nothing but the declared fields, with the declared types»; `panel/src/lib/telemetry.test.ts` «every event carries only numbers and the closed vocabulary»; 2026-10-21 15:30)
> El recorrido en navegador (`npm run test:telemetry` en `panel/`) no se ejecutó en esta verificación.

🤖 `[SYS.IN.12.LLM]` Un proveedor delegado entrega un rol → el rol sale de la base y no del proveedor. *(UD-007)*
✅ Implemented (🤖 Verified by `src/identity/identity.test.js` «delegated: the role comes from the database and not from the provider (UD-007)»; 2026-10-21 15:30)

### Resiliencia

🤖 `[SYS.RS.01.LLM]` Se mata el proceso a mitad de un análisis → al arrancar el arriendo vence y el trabajo se retoma y termina. *(HP-004, §4.3)*
✅ Implemented (🤖 Verified by `src/api/contract.test.js` «HP-004 · a job survives the abrupt death of the process: on restart the lease expires and it is resumed»; `src/worker.test.js` «a worker that dies holding a claimed job: the lease expires and another one recovers it»; 2026-10-21 15:30)

🤖 `[SYS.RS.02.LLM]` Un cliente SSE se reconecta con `Last-Event-ID` → recibe lo posterior sin repetidos ni huecos. *(HP-017, §7.10)*
✅ Implemented (🤖 Verified by `src/events/events.test.js` «Last-Event-ID replays what came after without repeating or leaving gaps», «subscribing before replaying: with events being published during the connection, each stream is contiguous and has no repeats»; 2026-10-21 15:30)

## Miembro (MEM)

### Funcionalidad

🤖 `[MEM.FN.01.LLM]` Un miembro cambia su idioma con `PATCH /members/me` → cambia solo el suyo, con `es-419` por omisión; otro valor es 400 y no guarda nada; un envío no trae idioma propio. *(UD-018)*
✅ Implemented (🤖 Verified by `src/api/language.test.js` «UD-018 · the default language is es-419 in the account and in GET /me, and POST /members does not change it», «UD-018 · a member changes their own language through PATCH /members/me, and only theirs», «UD-018 · any other language is 400 with a stable code and a Spanish message; nothing is stored», «UD-018 · POST /inputs has no per-send language: an output_language field is ignored and the author language rules»; 2026-10-21 15:30)

🤖 `[MEM.FN.02.LLM]` La migración del perfil → junta «responsabilidades» y «dominios» en prosa y borra las dos columnas. *(UD-023)*
✅ Implemented (🤖 Verified by `src/db/db.test.js` «the profile migration merges responsibilities and domains into prose and drops the two columns (UD-023)»; 2026-10-21 15:30)

### Integridad

🤖 `[MEM.IN.01.LLM]` Un miembro lee las áreas sin el cuerpo de las plantillas; escribe áreas o plantillas, lee una plantilla completa o lee o cambia los proveedores → 403. *(HP-015, UD-007)*
✅ Implemented (🤖 Verified by `src/api/api.test.js` «HP-015: a member reads the areas without the template bodies and gets 403 on writing them, on reading a full template and on the providers»; `src/identity/identity.test.js` «every protected route answers 401 without a session, and editor routes 403 to a member»; 2026-10-21 15:30)

## Editor (EDI)

### Funcionalidad

🤖 `[EDI.FN.01.LLM]` Las cinco áreas iniciales traen un color distinto, un área nueva toma el siguiente de la paleta, solo el Editor lo cambia y un valor que no es `#rrggbb` se rechaza. *(UD-045)*
✅ Implemented (🤖 Verified by `src/api/area-color.test.js` «UD-045 · the five initial areas come with a different color each», «UD-045 · a new area without color gets the next one of the palette, and a different one from its neighbours», «UD-045 · only the editor changes the color, and a value that is not #rrggbb is refused», «UD-045 · the migration palette and the one that new areas take are the same eight colors»; 2026-10-21 15:30)

🤖 `[EDI.FN.02.LLM]` El Editor guarda la descripción del proyecto (texto o archivo `.md`) → queda en la bitácora, respeta el tope `PROJECT_DESCRIPTION_MAX_CHARS` y llega al analizador; un miembro solo la lee. *(UD-024)*
✅ Implemented (🤖 Verified by `src/api/project-settings.test.js` «GET /settings/project is readable by any member: project name and an empty description at the start», «PATCH /settings/project: editor only; the text is saved and recorded in the audit log», «the description cap is the PROJECT_DESCRIPTION_MAX_CHARS knob and applies to both the JSON and the file», «multipart: a .md file replaces the description; another format, an empty one or nothing at all is rejected»; 2026-10-21 15:30)

## Analizador (ANA)

### Corrección

🤖 `[ANA.CR.01.LLM]` Una primera lectura sin grupos → se lee de nuevo por secciones; una imagen sola se describe otra vez con más detalle y lo que sale se marca como inferido de la imagen. *(UD-021)*
✅ Implemented (🤖 Verified by `src/analyze/api.test.js` «a first reading with no groups is read again and the second one yields a message», «a first reading that finds something does not run a second one», «an image sent alone is described again in more detail, and what comes out of it is marked as inferred from the image»; 2026-10-21 15:30)

🤖 `[ANA.CR.02.LLM]` Un enlace o texto compartido sin pedido → produce un mensaje que resume lo compartido y nunca una propuesta vacía. *(UD-032, H-133)*
✅ Implemented (🤖 Verified by `src/analyze/regressions.test.js` «REG-010: a link or text shared with no request is a message and not an empty proposal (H-133, UD-032)»; 2026-10-21 15:30)

🤖 `[ANA.CR.03.LLM]` El prompt de descomposición, en los dos idiomas → lleva el contrato de redacción sin marcas de IA. *(UD-019)*
✅ Implemented (🤖 Verified by `src/analyze/prompts.test.js` «the decomposition of both sets carries the writing contract (UD-019)»; 2026-10-21 15:30)

🤖 `[ANA.CR.04.LLM]` El idioma de la cuenta → elige el juego de prompts y el idioma de salida; un idioma ausente o desconocido cae a `es-419`. *(UD-018)*
✅ Implemented (🤖 Verified by `src/analyze/prompts.test.js` «there are two languages, es-419 is the default, and an unknown or absent language falls back to it», «each set asks for its output in its own language and says so for the title, the body, the fields and the reasons»; 2026-10-21 15:30)

🤖 `[ANA.CR.05.LLM]` Los envíos recientes del mismo autor → llegan a la clasificación y a la descomposición, solo en el mensaje de usuario. *(UD-025)*
✅ Implemented (🤖 Verified by `src/analyze/prompts.test.js` «analyze() hands the recent inputs to the classification and the decomposition, in the user message only (UD-025)»; `src/domain/recent-inputs.test.js` «the analyzer receives bundle.recent_inputs with the earlier proposal of the same person»; 2026-10-21 15:30)

🤖 `[ANA.CR.06.LLM]` La clasificación de un insumo largo → relee lo descartado aparte y cada ventana ve las unidades que la preceden en solo lectura. *(UD-080, H-1900)*
✅ Implemented (🤖 Verified by `src/analyze/coverage.test.js` «the units set apart are read again alone, and the model groups what it finds», «each window after the first carries the units that precede it, read-only, and a window cites only its own units»; 2026-10-21 15:30)

🤖 `[ANA.CR.07.LLM]` Cada descripción de área inicial → es larga y detallada: qué es, casos típicos, bordes con el desempate hacia sus vecinas y qué no es. *(UD-031)*
✅ Implemented (🤖 Verified by `src/analyze/regressions.test.js` «each initial area description is long and detailed»; 2026-10-21 15:30)

🤖🧑 `[ANA.CR.08.MIX]` La descomposición de los siete casos del banco con el proveedor real → cubre el 100 % de las unidades y la mediana queda bajo el objetivo del vector. *(HP-019, §1, §7.11)*
🔲 Pending (pre-verified by `bench/run.test.js` «with perfect fake providers, the seven cases score MECE and classify correctly»; `bench/score.test.js` «exact decomposition: coverage 1, everything else at 0 and full classification», 2026-10-21 15:30)
> Con proveedores falsos el banco pasa. Con el proveedor real (`node bench/run.mjs --repeat 5`) la última corrida, del 2026-10-20, dio 6 de 7 casos con cobertura 100 % y el monólogo en 90 %.

### Resiliencia

🤖 `[ANA.RS.01.LLM]` El proveedor de texto rechaza (`refusal`) o falla con error de red o 5xx tras sus reintentos → la llamada se repite una vez en `textFallback` y queda en `calls` con `fallback: true`; sin respaldo, un rechazo es un estado y un fallo HTTP se propaga; un tiempo agotado o un error no reintentable no pasa al respaldo. *(DT-003, H-18, §7.5)*
✅ Implemented (🤖 Verified by `src/analyze/api.test.js` «a refusal in the classification is repeated once on the fallback, which is recorded in calls», «a retryable HTTP failure goes to the fallback as well», «without a fallback the behavior is the current one: a refusal is a state and an HTTP failure is thrown», «what the fallback does not cover is not repeated: a non-retryable HTTP failure and a timeout», «a refusal of the fallback itself comes back as the refusal state, with both calls recorded»; 2026-10-21 15:30)

## Panel (PAN)

### Funcionalidad

🤖 `[PAN.FN.01.LLM]` Los catálogos `es-419` y `en` → tienen las mismas claves y variables; ningún texto visible queda fuera de ellos. *(UD-018)*
✅ Implemented (🤖 Verified by `panel/src/i18n.test.ts` «have exactly the same keys», «every message uses the same variables in both languages», «no visible text outside the catalogues», «every file in src/ takes its texts from t()»; 2026-10-21 15:30)

### Corrección

🧑 `[PAN.CR.01.HUM]` Cada pantalla se mira en captura (1440 x 900 y 390 x 844) por alguien distinto de quien la escribió → coincide con lo que dice la especificación §6. *(HP-020, §6)*
🔲 Pending
> Se generan con `cd panel && npm run build && npm run capturas`. Sin revisor asignado.

🤖 `[PAN.CR.02.LLM]` Un texto truncado sin justificación en `panel/src/` → la prueba estática falla. *(UD-016)*
✅ Implemented (🤖 Verified by `panel/src/no-truncation.test.ts` «no file under src/ truncates text without a justification»; 2026-10-21 15:30)

🤖 `[PAN.CR.03.LLM]` Un texto de los catálogos en el patrón conversacional (segunda persona, pregunta, frase donde va un rótulo) → la guardia falla, en español, en inglés y en las frases de progreso del servidor. *(UD-050)*
✅ Implemented (🤖 Verified by `panel/src/ui-voice.test.ts` «Spanish catalogue: no text falls in the chatty pattern», «English catalogue: same rules, same register», «progress phrases of the server: same rules as a Spanish catalogue text», «every phrase of the server maps to a key of the catalogues, so the language of the account applies (H-1502)»; 2026-10-21 15:30)

🤖 `[PAN.CR.04.LLM]` Un estado de mensaje → se muestra con su palabra, su forma y su relleno: el relleno sólido es solo de la campana y el aviso lleva el estado más alto presente. *(UD-041, UD-036, UD-029)*
✅ Implemented (🤖 Verified by `panel/src/lib/states.test.tsx` «every badge and mark is quiet: the solid fill belongs to the bell alone (J2-B-03, J3-A-04, UD-036)», «the three states have three different words and three different shapes, and the word agrees with the count», «a lower state never wins over a higher one, whatever the counts»; 2026-10-21 15:30)

🤖 `[PAN.CR.05.LLM]` Un párrafo largo → se justifica sin guionizar, solo en bloques lo bastante anchos. *(UD-022, UD-034)*
✅ Implemented (🤖 Verified by `panel/src/prose-block.test.ts` «justifies, never hyphenates and balances the last lines», «aligns to the left by default and justifies only the blocks wide enough (J3-A-21)», «nothing else sets text-align: justify, and nothing turns hyphens on»; 2026-10-21 15:30)

## Operación (OPS)

### Disponibilidad

🤖 `[OPS.AV.01.LLM]` La imagen arranca con `--network none` y responde `/health`. *(HP-006, §4.5)*
🔲 Pending (pre-verified by `src/image.docker.test.js` «HP-006: the image starts with --network none and answers /health, and nothing outside is reachable», 2026-10-21 15:30)
> Corre a pedido con `npm run test:image` (construye la imagen); sin Docker se omite. Última corrida citada en TEST.md: 2026-10-20.

---

<!--
Taxonomy: [ACTOR.CATEGORY.NN.VER]
Actors: DEV (quien contribuye al código), SYS (servidor), MEM (miembro), EDI (Editor), ANA (analizador), PAN (panel), OPS (instalación y operación)
Categories: AV (Availability), FN (Functionality), CR (Correctness), IN (Integrity), RS (Resilience)
Verifier (VER): LLM (automatable), HUM (requires human), MIX (pre-verifiable + human)

Check format:
  🧑 `[ACTOR.CAT.NN.HUM]` Action → Result. *(Validated promise)*
  🤖 `[ACTOR.CAT.NN.LLM]` Action → Result. *(Validated promise)*
  🤖🧑 `[ACTOR.CAT.NN.MIX]` Action → Result. *(Validated promise)*

Implementation format (with mandatory timestamp):
  ✅ Implemented (🤖 Verified by [tool]; YYYY-MM-DD HH:MM)
  ✅ Implemented (🧑 Confirmed by user; YYYY-MM-DD HH:MM)
  ✅ Implemented (🤖🧑 Pre-verified by [tool], confirmed by user; YYYY-MM-DD HH:MM)
-->
