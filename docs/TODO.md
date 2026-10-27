# TODO: team-platform v0.1.0

> Trazabilidad directa: cada tarea referencia las prohibiciones HP-001 a HP-029 de `docs/TEST.md`: `VERIFICATION.md` no se deriva (H-45).
>
> Las marcas de tiempo de las tareas cerradas son la hora del commit que entregó cada ítem. Se verificaron contra el código y las pruebas el 2026-10-21: 865 del servidor en verde (`npm test`, 6 omitidas por falta de llave, imagen o red), 74 del banco (`node --test bench/`) y 164 del panel (`vitest run`, 29 archivos).

## Leyenda de símbolos

| Símbolo | Significado |
|---|---|
| 🤖 | Check verificable por IA o herramienta automática |
| 🧑 | Check que requiere verificación humana |
| 🤖🧑 | Check pre-verificable por IA, validación final humana |
| ⏳ | En curso |
| 🔲 | Pendiente |
| 🚨 | Bloqueo crítico |

---

## [EPIC-001] Eje documental y diseño

> Ref: MASTER-SPEC §1 a §8

### [TASK-001] Inicializar el eje documental

> Ref: MASTER-SPEC §1

**Checks cubiertos:** Gobernanza transversal

- [x] `docs/` desde las plantillas, REPOMAP, `.gitignore` con el bloque de gobierno `2026-10-20 21:05:00`
- [x] Decisiones UD-001 a UD-010 con las palabras de Martín `2026-10-20 22:10:00`
- [x] Investigación del motor de análisis y adjuntos en `docs/investigaciones/` `2026-10-20 21:50:00`
- [x] MASTER-SPEC §1 a §8, RULES, LICENSE MIT `2026-10-20 22:30:00`
- [x] Cruzar los informes 02, 03, 04, 06 y 07 con el MASTER-SPEC `2026-10-20 22:05:00`
- [x] Cruzar el informe 05 (extracción de documentos) con el MASTER-SPEC `2026-10-20 22:40:00`

### [TASK-002] Revisión humana del MASTER-SPEC

> Ref: MASTER-SPEC §1 a §7

**Checks cubiertos:** Gobernanza transversal `[Requiere validación humana]`

- [ ] Martín confirma o corrige §1 (vector, vocabulario, lo que NO es). **Límite externo, decisión del dueño.** Falta su confirmación escrita; ninguna prueba la reemplaza. La destraba Martín. Comando para leerlo: `awk '/^## §1\./,/^## §2\./' docs/MASTER-SPEC.md`; su respuesta en una línea se registra en `docs/USER-DECISIONS.md` con sus palabras
- [ ] Martín confirma o corrige §3 (valores por omisión por modalidad) y §5. **Límite externo, decisión del dueño.** Misma salida que §1. Comando: `awk '/^## §3\./,/^## §4\./;/^## §5\./,/^## §6\./' docs/MASTER-SPEC.md`
- [x] Las desviaciones de MASTER-SPEC §1.3, §3.1, §4.6, §7.1 y §7.5 (DT-001 a 005) no existen ya, así que no queda nada que confirmar: DT-001 la descartó Martín («te lo estabas tomando demasiado literal», H-68, `docs/USER-DECISIONS.md` UD-020); DT-002 la cerró UD-020 (`src/static.test.js` «HP-011 · every production dependency has a license compatible with MIT»); DT-003 con `src/analyze/telemetry.test.js`; DT-004 con `src/install-script.test.js` «H-42»; DT-005 con `src/size-limits.test.js` «the upload cap of a document is the extractor cap (DT-005)». Cierre en `c0b378b9` y `docs/CHANGELOG.md`; las cuatro pruebas se corrieron el 2026-10-26: 30 de 30 `2026-10-26`

### [TASK-003] Sincronizar el eje documental con el código

> Ref: MASTER-SPEC §1 a §8

**Checks cubiertos:** Gobernanza transversal

- [x] MASTER-SPEC §2, §3, §6 y §7 reescritos desde `src/`, `panel/`, `bench/`, `Dockerfile` y `compose.yml` `2026-10-20 23:40:00`
- [x] Dependencias de producción de `package.json` y `panel/package.json` con licencia y justificación (MASTER-SPEC §3.1) `2026-10-20 23:40:00`
- [x] Rutas de `GET /api/openapi.json` en §7.1 y migraciones 0001 y 0002 en §7.2 `2026-10-20 23:40:00`
- [x] TEST.md con el estado de cada prohibición y las métricas reales `2026-10-20 23:40:00`
- [x] TECHNICAL-DEBT.md con las desviaciones que el código no justifica (DT-001 a DT-010) `2026-10-20 23:40:00`
- [x] REPOMAP, README, CHANGELOG y este archivo `2026-10-20 23:40:00`
- [x] [TASK-003]; 2026-10-20 23:40:00 [🤖 Verified by tool]

### [TASK-004] Aplicar UD-015 (código y comentarios en inglés)

> Ref: MASTER-SPEC §4.7, UD-015, DT-009

**Checks cubiertos:** HP-008

- [x] RULES regla 1, MASTER-SPEC §4.7 y UD-015 `2026-10-20 23:27:31`
- [x] UD-005 anotada como reemplazada en los comentarios, TEST.md HP-008 y DT-009 `2026-10-20 23:40:00`
- [x] Traducir comentarios, nombres y descripciones de pruebas, mensajes de aserción y de registro, y prompts de `src/`, `panel/`, `bench/` y `scripts/` `2026-10-21 15:24:00`
- [x] HP-008 falla también ante comentarios y mensajes de aserción en español y cubre `src/`, `panel/`, `bench/`, `scripts/` y `.githooks/`  `2026-10-21 15:24:00`
- [x] [TASK-004]; 2026-10-21 15:24:00 [🤖 Verified by tool]

---

## [EPIC-002] Núcleo: esquema, API y cola

> Ref: MASTER-SPEC §7.1, §7.2, §7.3, §7.10, §7.10 bis

### [TASK-005] Esquema SQLite, migraciones y siembra

> Ref: MASTER-SPEC §7.2

**Checks cubiertos:** HP-007

- [x] Conexión `node:sqlite` con WAL, `busy_timeout` y `synchronous=FULL`; exige Node 24.15 y SQLite 3.51.3 `2026-10-20 22:19:19`
- [x] Migración `0001_initial.sql` y ejecutor con `PRAGMA user_version`, respaldo previo y numeración contigua `2026-10-20 22:19:19`
- [x] Siembra de las cinco áreas y primer Editor desde `ADMIN_EMAIL` `2026-10-20 22:19:19`
- [x] Pruebas de la base (`src/db/db.test.js`) `2026-10-20 22:30:04`
- [x] Migración 0010: `deleted_at` en `messages` y `replies` (UD-240) `2026-10-21 21:25:09`
- [x] Migración 0011: `attachments.input_id` admite nulo para borrar un envío sin perder los adjuntos de sus mensajes (UD-240, H-3702) `2026-10-21 21:26:29`
- [x] [TASK-005]; 2026-10-20 22:30:04 [🤖 Verified by tool]

### [TASK-006] Cola de trabajos y worker

> Ref: MASTER-SPEC §7.3

**Checks cubiertos:** HP-004

- [x] Reclamo atómico con arriendo, latido, reintentos con retroceso y jitter, barrera de intento `2026-10-20 22:19:19`
- [x] Worker en el mismo proceso o aparte (`WORKER_MODE`), presupuesto de audio y aplazamiento sin gastar intento `2026-10-20 22:28:28`
- [x] Pruebas de cola y de dos procesos reclamando sin duplicados `2026-10-20 22:40:26`
- [x] Apagado ordenado con SIGTERM en menos de 10 s `2026-10-20 23:03:03`
- [x] HP-004: el trabajo sobrevive a SIGKILL `2026-10-20 23:16:33`
- [x] [TASK-006]; 2026-10-20 23:16:33 [🤖 Verified by tool]

### [TASK-007] API, convenciones y contrato OpenAPI

> Ref: MASTER-SPEC §7.1, §4.11

**Checks cubiertos:** HP-005, HP-009, HP-012, HP-013, HP-014

- [x] Rutas de inputs, mensajes, áreas, plantillas, miembros, configuración y adjuntos `2026-10-20 22:28:28`
- [x] OpenAPI 3.1 generado de los esquemas, CORS y cookie de origen cruzado `2026-10-20 22:45:35`
- [x] Forma plana de mensajes, ids como texto, paginación uniforme y borrado en blando `2026-10-20 22:56:09`
- [x] Pruebas del contrato y del flujo completo de la API `2026-10-20 23:03:03`
- [x] Borrar y restaurar mensajes y respuestas en blando (UD-240, H-3700, H-3701; `src/api/message-deletion.test.js`) `2026-10-21 21:25:09`
- [x] `DELETE /inputs/:id` con adjuntos, trabajos y propuesta (UD-240, H-3702; `src/api/input-deletion.test.js`) `2026-10-21 21:26:29`
- [x] `DELETE /members/:id` con `purge` (UD-240, H-3703; `src/api/member-deletion.test.js`) `2026-10-21 21:24:31`
- [x] `GET /messages?deleted=1` para listar lo borrado (UD-250, H-3706; `src/api/restore-deleted.test.js`) `2026-10-21 22:38:20`
- [x] [TASK-007]; 2026-10-20 23:03:03 [🤖 Verified by tool]

### [TASK-008] Flujo de eventos SSE

> Ref: MASTER-SPEC §7.10

**Checks cubiertos:** HP-017

- [x] Un flujo por miembro con reposición por `Last-Event-ID`, `?job_id=` y latido `2026-10-20 22:28:28`
- [x] Pruebas de reposición sin repetidos ni huecos y de cierre con flujo abierto `2026-10-20 22:58:21`
- [x] [TASK-008]; 2026-10-20 22:58:21 [🤖 Verified by tool]

### [TASK-009] Operación del Editor

> Ref: MASTER-SPEC §7.1

**Checks cubiertos:** HP-015

- [x] `GET /api/jobs`, `DELETE /api/jobs`, `GET /api/jobs/:id/trace`, `GET /api/audit`, `POST /api/inputs/:id/reprocess` y detalle de `/health` `2026-10-20 22:52:04`
- [x] Pruebas de la operación del Editor `2026-10-20 23:03:03`
- [x] HP-015 como prueba con su ID (DT-007) `2026-10-21 15:24:00`
- [x] `POST /ops/reset` y `scripts/vaciar.mjs` (UD-240, H-3704; `src/api/data-reset.test.js`, `scripts/vaciar.test.mjs`) `2026-10-21 21:24:55`
- [x] `scripts/sembrar.mjs` con el juego de `ejemplos/` (UD-240, H-3704; `scripts/sembrar.test.mjs`) `2026-10-21 21:31:19`
- [x] `GET /inputs?all=1` para el Editor (UD-251, H-3709; `src/api/queue-admin.test.js`) `2026-10-21 22:38:29`
- [x] `POST /ops/seed` y `src/domain/seed-examples.js` compartido con `scripts/sembrar.mjs` (UD-252, H-3711; `src/api/admin-controls.test.js`) `2026-10-21 22:38:49`
- [x] [TASK-009]; 2026-10-21 15:24:00 [🤖 Verified by tool]

### [TASK-010] Telemetría con OpenTelemetry (UD-014)

> Ref: MASTER-SPEC §7.10 bis, UD-014

**Checks cubiertos:** HP-001, HP-002

- [x] `src/telemetry/`: spans en SQLite por un exportador propio, vista `llm_calls`, OTLP opcional `2026-10-20 23:03:18`
- [x] Instrumentación de proveedores, extractores, cola y publicación `2026-10-20 23:07:27`
- [x] Medición de sobrecarga y README del módulo `2026-10-20 23:10:57`
- [x] Spans del analizador: `analyze`, `classify`, `decompose`, `rescue`, `validate` y `harness` `2026-10-20 23:20:10`
- [x] [TASK-010]; 2026-10-20 23:20:10 [🤖 Verified by tool]

### [TASK-011] Prohibiciones estáticas del núcleo

> Ref: MASTER-SPEC §4

**Checks cubiertos:** HP-003, HP-007, HP-010, HP-011

- [x] HP-003, HP-005, HP-006, HP-007, HP-008 y HP-011 en `src/static.test.js` `2026-10-20 23:12:20`
- [x] HP-003 sobre `src/analyze/` (DT-007) `2026-10-20 23:47:49`
- [x] HP-010: un literal numérico fuera de `src/config.js` sin su fuente falla (DT-007) `2026-10-20 23:47:49`
- [x] Gancho de pre-commit que escanea credenciales (DT-004) `2026-10-20 23:47:49`

---

## [EPIC-003] Extractores

> Ref: MASTER-SPEC §7.4, UD-009

### [TASK-012] Extractores por tipo de adjunto

> Ref: MASTER-SPEC §7.4

**Checks cubiertos:** HP-018

- [x] Imagen, documento (PDF, DOCX, PPTX, XLSX, texto), audio, video y enlace con guardia SSRF `2026-10-20 22:18:22`
- [x] Pruebas de cada extractor y del registro por tipo `2026-10-20 22:21:39`
- [x] Medición de tiempos por tipo en `docs/investigaciones/mediciones/2026-10-20-extractores.md` `2026-10-20 22:24:12`
- [x] Presupuesto de audio de 7.200 s por hora y troceado FLAC de 600 s con 5 s de solapamiento `2026-10-20 22:18:22`
- [x] Alinear el tope de documentos entre la subida y la extracción (DT-005) `2026-10-20 23:59:28`
- [x] Video: segunda llamada de visión para los fotogramas sin descripción y sin líneas vacías en la línea de tiempo (H-3713) `2026-10-21 22:50:52`

### [TASK-013] Mediciones pendientes de los extractores

> Ref: MASTER-SPEC §7.4, §7.11

**Checks cubiertos:** HP-018 `[Requiere validación humana]`

- [x] Una foto HEIC real de iPhone: se decodifica con el `ffmpeg` de la imagen (UD-040, H-21)
- [x] Latencia de Groq y Anthropic con archivos reales (`mediciones/2026-10-21-latencia-de-proveedores-por-tipo-de-archivo.md`); DeepSeek sin medir `2026-10-21`
- [x] Un Word con estilos propios, un PDF real de cliente y una grabación real de teléfono: los archivos ya están en `bench/private/`. Tres Word (hasta 57 encabezados, 143 viñetas, una tabla de 50 filas), dos PDF y dos notas de voz Opus de teléfono se extrajeron en 0,3 a 0,5 s los documentos, con el costo en 0 USD (`docs/investigaciones/mediciones/2026-10-26-archivos-reales-word-pdf-y-voz.md`, `25e92e6a`) `2026-10-26`
- [x] Descarga de enlaces contra internet real: tres páginas y dos PDF (`mediciones/2026-10-21-pdf-enlaces-heic-y-flujo-sse-reales.md`; se repite con `TEAM_LIVE_NETWORK=1 node --test src/extract/real-world.live.test.js`) `2026-10-21`
- [x] Descarga contra un servidor que entrega bytes lentamente: `src/extract/link.test.js` «a site that answers but delivers its bytes slowly is cut at the deadline and the connection is released»; con cabeceras al instante y un byte cada 50 ms corta en 403 ms con `link_timeout` y el servidor ve cerrarse el socket (`e8dac911`, 16 de 16 pruebas) `2026-10-26`
- [x] Opus contra FLAC: se mantiene FLAC (`mediciones/2026-10-20-ffmpeg-minimo.md`) `2026-10-20`
- [ ] Legibilidad de texto en fotogramas de 540, 720 y 1080 px. **Límite externo, presupuesto de API.** El instrumento ya existe (`bench/legibility.mjs`, `25e92e6a`): arma el fotograma con el filtro del extractor, tres imágenes, y su `--plan` corre sin llave. Falta una llave de visión con gasto autorizado (unos centavos de dólar). La destraba Martín. Comando: `node scripts/llave.mjs ANTHROPIC_API_KEY && node bench/legibility.mjs --budget 0.1`

---

## [EPIC-004] Analizador y proveedores

> Ref: MASTER-SPEC §7.5, §7.6, §7.9, UD-001, UD-008

### [TASK-014] Proveedores de modelo

> Ref: MASTER-SPEC §7.6

**Checks cubiertos:** HP-002

- [x] `anthropic`, `openai-compatible` (DeepSeek, Groq, OpenRouter, Gemini), `groq-speech` y `fake` `2026-10-20 22:17:46`
- [x] Configuración desde el entorno y desde Configuración (Editor), sin llaves en la base `2026-10-20 22:28:28`
- [x] Proveedor de texto de respaldo invocado ante un rechazo o un error de red o 5xx (DT-003) `2026-10-20 23:59:58`
- [x] `llm_calls` registra el proveedor que respondió y `GET /health` informa la ranura `text_fallback` (DT-003) `2026-10-21 15:24:00`
- [x] [TASK-014]; 2026-10-21 15:24:00 [🤖 Verified by tool]

### [TASK-015] Analizador `api`

> Ref: MASTER-SPEC §7.5

**Checks cubiertos:** HP-003, HP-014

- [x] Numeración de unidades, clasificación, descomposición MECE, rescate, partición y validación con Ajv `2026-10-20 22:27:02`
- [x] Cada mensaje con su área y plantilla; clasificación en grupos y descomposición por grupo `2026-10-20 22:33:22`
- [x] Unidades por oración, enumeraciones en línea y pensamiento por llamada `2026-10-20 22:41:22`
- [x] Descomposición sin descartes y reintento de un grupo vacío `2026-10-20 23:01:23`
- [x] Esfuerzo `low` sin pensamiento y concurrencia 16 por omisión, con la medición citada `2026-10-20 23:10:55`
- [x] Medir las variantes B (una sola llamada) y C (descomposición especulativa) en el banco: se mantiene A (`mediciones/2026-10-21-variantes-b-y-c-del-analizador.md`) `2026-10-21`
- [x] `charsPerToken` calibrado con el banco: 57 corridas de Haiku 5.5, pendiente 1,333 y R² 0,9962 entre los tokens reales y la estimación; el modelo cuenta 2,25 caracteres por token y no 3. `src/analyze/config.js` queda con 2,25 y su fuente; 407 pruebas de `src/analyze` y `src/providers` pasan (`docs/investigaciones/mediciones/2026-10-26-calibracion-de-tokens.md`, `bench/calibrate.mjs`, `25e92e6a`) `2026-10-26`
- [ ] Calibrar el p95 de `maxTokens` y `partitionThresholdTokens`. **Límite externo, presupuesto de API.** Las corridas existentes descomponían con esfuerzo medio y razonamiento (p95 14.519, 2 de 143 llamadas en el tope); el ajuste de hoy no tiene corridas, y la entrada más larga medida ocupa 26.700 tokens contra un umbral de 100.000. La destraba Martín con gasto autorizado (unos 3 USD). Comando: `node bench/run-private.mjs run --repeat 3 --budget 3 && node bench/calibrate.mjs bench/results/private-<fecha>.json`; la partición con texto real, con `--case u12-reunion-parte-1 --case u13-reunion-parte-2 --config '{"partitionThresholdTokens":8000}'`

### [TASK-016] Analizador `harness`

> Ref: MASTER-SPEC §7.5, UD-008

**Checks cubiertos:** HP-014

- [x] `claude -p` sin `--bare` desde un directorio propio, con el mismo validador y pruebas con un ejecutable de mentira `2026-10-20 22:27:44`
- [x] Medir en el banco el costo y el tiempo del harness frente a `api` con una suscripción real: `01-chat-grupo` en 36,9 s (`api`: 4,4 s), cobertura 100 %, validador aceptó sin reintento `2026-10-21 22:00:23`. Detalle en `docs/investigaciones/mediciones/2026-10-21-harness-real.md`; instalación en `docs/INSTALACION.md`

### [TASK-017] Plantillas iniciales

> Ref: MASTER-SPEC §7.9

**Checks cubiertos:** HP-013

- [x] Cinco áreas y cinco plantillas en `templates/`, con siembra desde `loadSeed` `2026-10-20 22:27:02`
- [x] Retroalimentación: una confirmación sin comentarios no es un mensaje `2026-10-20 23:13:47`
- [x] Calentamiento de la gramática por evento al guardar una plantilla `2026-10-20 22:33:33`

---

## [EPIC-005] Panel

> Ref: MASTER-SPEC §6, §7.8, UD-006, UD-011, UD-013

### [TASK-018] Panel React contra la API

> Ref: MASTER-SPEC §7.8

**Checks cubiertos:** HP-001, HP-017

- [x] Esqueleto con Vite, TanStack Query, React Router, filtros en la URL y flujo de eventos `2026-10-20 22:15:35`
- [x] Servidor doble de desarrollo, subida con progreso, grabación de audio y consultas `2026-10-20 22:18:10`
- [x] Vistas Inicio, Mensajes, detalle, Áreas, Equipo y Configuración `2026-10-20 22:24:07`
- [x] Propuesta con área por mensaje `2026-10-20 22:30:03`
- [x] Humo del panel compilado contra la API real `2026-10-20 23:06:03`
- [x] Borrar una plantilla manda `confirm=true` `2026-10-20 23:18:19`
- [x] 21 pruebas de `panel/src/lib` `2026-10-20 23:33:05`
- [x] Borrar en la ficha del mensaje y en cada respuesta, con Deshacer (UD-240) `2026-10-21 21:27:25`
- [x] Equipo: «Eliminar» con las cifras del historial (UD-240, H-3703) `2026-10-21 21:29:02`
- [x] «Borrar» en el desplegable de envíos de Inicio (UD-240, H-3702) `2026-10-21 21:31:21`
- [x] Configuración, «Datos»: «Vaciar contenido» y «Vaciar todo» (UD-240, H-3704) `2026-10-21 21:33:51`
- [x] Tarjetas de alto fijo con extracto de una línea (UD-241, H-3705) `2026-10-21 21:40:03`
- [x] Ícono de borrar en cada tarjeta, fila de Áreas y vista de un área; título de una línea (UD-240, UD-241) `2026-10-21 22:36:24`
- [x] «Borradas» y «Borrados» con «Restaurar» en Áreas, plantillas y Mensajes (UD-250, H-3706) `2026-10-21 22:39:54`
- [x] «Adjunto» y «Quitar» en la ficha del mensaje (H-3707) `2026-10-21 22:41:02`
- [x] «Cola» y «Auditoría» en Configuración (UD-251, H-3708) `2026-10-21 22:41:59`
- [x] «Contraseña» de otro miembro en Equipo, «Sembrar ejemplos» en Datos y plantillas abiertas con enlace desde Áreas (UD-252, H-3710 a H-3712) `2026-10-21 22:43:47`
- [x] Retirar «Descartados» de Inicio (UD-253) `2026-10-21 23:11:06`
- [x] Conexiones sin la razón bajo el título (UD-037 enmendada) `2026-10-21 23:12:59`

### [TASK-019] Piel Y2K futurista

> Ref: MASTER-SPEC §6, UD-013

**Checks cubiertos:** HP-020 `[Requiere validación humana]`

- [x] Tokens, vidrio y cromo, fuentes OFL empaquetadas y `panel/DISENO.md` con referencias fechadas `2026-10-20 22:38:40`
- [x] Medición de contraste de cada par de texto y de peso del paquete `2026-10-20 22:43:30`
- [ ] Martín mira las capturas de cada vista y confirma o corrige la jerarquía visual (HP-020). **Límite externo, decisión del dueño** (la validación final es humana; el veredicto de juez por vista es la pieza D3 del plan). La destraba Martín. Comando: `cd panel && npm run build && npm run capturas`, y abrir `panel/capturas/`
- [x] Firefox sobre `npm run test:fit` y `npm run test:flows` con `BROWSER=firefox` (H-2500, Playwright trae Firefox 157, no 128) `2026-10-21`
- [ ] Safari 16.4. **Límite externo, decisión del dueño** (UD-039: «no lo vamos a usar todavía»; se prueba cuando haya usuarios con iPhone en el panel). Falta un Safari 16.4, es decir macOS 13.3 o iOS 16.4: el WebKit de Playwright no lo reproduce y no arranca en este equipo (`ldd` de `WebKitWebProcess` no encuentra `libicudata.so.74`, `libjpeg.so.8` ni `libbacktrace.so.0`; es una compilación de Ubuntu). La destraba Martín. Comando con el aparato: el de H-56 (abajo); para las pantallas, en un Ubuntu con `npx playwright install-deps webkit`: `cd panel && BROWSER=webkit npm run test:fit`, que da WebKit de Playwright y no 16.4
- [ ] Probar la grabación de audio en un iPhone (Safari anterior a 18.4 sólo graba MP4). **Límite externo, aparato.** Falta un iPhone con la app de Tailscale en la misma tailnet. Lo destraba Martín con el aparato en la mano (H-56, UD-039). Comandos de `docs/HALLAZGOS.md` («Filas bloqueadas por causa externa»): imprimir el código QR de la dirección con `. ~/.config/team-platform/vps-admin && ~/.cache/claude-tmp/hv/bin/python -c "import qrcode,sys;q=qrcode.QRCode(border=1);q.add_data(sys.argv[1]);q.print_ascii(invert=True)" "$URL"`, grabar 5 s y enviar, y después `node scripts/vps-check.mjs --last`, que debe decir `OK Último envío: estado proposed, adjuntos: audio`. `src/vps-check.test.js`: 2 pasan, 0 fallan `2026-10-26`

---

## [EPIC-006] Identidad

> Ref: MASTER-SPEC §7.7, UD-002, UD-007

### [TASK-020] Identidad local y delegada

> Ref: MASTER-SPEC §7.7

**Checks cubiertos:** HP-015, HP-016

- [x] Local: Argon2id, sesión opaca, cookie `__Host-`, CSRF, límite por IP y espera por cuenta `2026-10-20 22:28:28`
- [x] Delegada: `signed-header`, `jwt` (secreto y JWKS), `sso-redirect` y `trusted-header` `2026-10-20 22:28:28`
- [x] Pruebas de identidad, enfriamiento del JWKS y roles `2026-10-20 22:40:26`
- [x] Cookie de origen cruzado y `CORS_ORIGINS` `2026-10-20 22:45:35`
- [x] [TASK-020]; 2026-10-20 22:45:35 [🤖 Verified by tool]

### [TASK-021] Identidad detrás de un proxy real

> Ref: MASTER-SPEC §7.7

**Checks cubiertos:** HP-016

- [x] `trusted-header` detrás de `tailscale serve` con una tailnet real `2026-10-21 18:10:00`
- [x] Inicio de sesión detrás de Caddy con TLS interno y la cookie `__Host-` (exige HTTPS), en un clon limpio instalado con `scripts/install.sh`: login 200 con `__Host-session; Secure; HttpOnly`, `/api/me` 200 con la cookie y 401 sin ella, flujo SSE `PASS first byte 12 ms, first heartbeat 15010 ms`; el guion repetible está en `docs/INSTALACION.md`, «Comprobar el proxy y la cookie sin dominio» (`ecfa2ff2`) `2026-10-26`
- [ ] Certificado de Let's Encrypt emitido por Caddy para un dominio propio. **Límite externo, dominio.** Falta un dominio con registro A hacia una IP pública y los puertos 80 y 443 abiertos; ninguna prueba local emite un certificado público. Lo destraba Martín con su dominio y un VPS. Comando: los de `docs/INSTALACION.md` §1 con su dominio, y después `curl -fsS https://<dominio>/health` y `TEAM_EMAIL=… TEAM_PASSWORD=… node scripts/check-sse.mjs https://<dominio>`
- [x] `sso-redirect` contra un sitio anfitrión que es otro servidor HTTP con su propio inicio de sesión y su cookie, y un navegador que sigue las redirecciones: inicio firmado, entrada del sitio, regreso firmado, respuesta de un solo uso, firma alterada, dirección de regreso no registrada y respuesta firmada por otro sitio (`src/identity/sso-host-site.test.js`, `1ddac504`; 68 pruebas de identidad pasan; con el secreto cambiado la prueba falla). Límite: el único sitio que firma la redirección es el de la prueba; el primer anfitrión entra por JWT y cabecera firmada `2026-10-26`

---

## [EPIC-007] Empaquetado e instalación

> Ref: MASTER-SPEC §3 (Empaquetado), §4.5

### [TASK-022] Imagen, compose y scripts

> Ref: MASTER-SPEC §3

**Checks cubiertos:** HP-006

- [x] `Dockerfile` multi-etapa, `compose.yml` de un servicio y `compose.override.example.yml` `2026-10-20 22:22:53`
- [x] `scripts/install.sh`, `scripts/backup.sh` y `docs/INSTALACION.md` `2026-10-20 22:26:19`
- [x] `scripts/llave.mjs` y `scripts/analizar.mjs` `2026-10-20 23:19:50`
- [x] `.env.example` versionado y una prueba que exige que nombre toda variable de `src/config.js` `2026-10-20 22:41:56`
- [x] [TASK-022]; 2026-10-20 23:19:50 [🤖 Verified by tool]

### [TASK-023] Instalación en un servidor real

> Ref: MASTER-SPEC §3, §4.5

**Checks cubiertos:** HP-006, HP-011 `[Requiere validación humana]`

- [x] Las tres formas de `docs/INSTALACION.md`: forma 1 con Caddy y TLS interno, forma 2 con `compose.override.example.yml` y forma 3 con `tailscale serve` en el VPS (H-66, H-2600 a H-2606) `2026-10-21`
- [x] Instalar con `scripts/install.sh` en un clon limpio: construye, baja la lista de contraseñas bloqueadas, levanta y queda `healthy` en 33 s con las capas en caché (clon de `wt-d4-todo`, proyecto de compose propio, retirado al terminar). Antes, la instalación limpia con `docker-local` (`0f9a523b`) y la del segundo anfitrión con `fly-machines` (`8b0b53cd`) `2026-10-26`
- [ ] La misma instalación en un VPS limpio con dominio propio. **Límite externo, dominio y servidor.** Falta un VPS y un dominio con registro A hacia él; lo demás ya se probó arriba. Lo destraba Martín. Comando, en el VPS: `curl -fsSL https://get.docker.com | sh && git clone <URL-DEL-REPOSITORIO> /opt/team-platform && cd /opt/team-platform && scripts/install.sh`, y el Caddy de `docs/INSTALACION.md` §1
- [x] Restaurar un respaldo siguiendo `docs/INSTALACION.md` `2026-10-21 18:03:00`
- [x] `libvips` (LGPL) y `ffmpeg` en la imagen: UD-020, dos capas de licencia (DT-002 cerrada) `2026-10-20`

---

## [EPIC-008] Banco de referencia y mediciones

> Ref: MASTER-SPEC §7.11, §1.3, §4.9

### [TASK-024] Banco de referencia

> Ref: MASTER-SPEC §7.11

**Checks cubiertos:** HP-019

- [x] `bench/score.js` con aritmética de conjuntos sobre `unit_ids` y exactitud de la clasificación `2026-10-20 22:29:36`
- [x] Siete casos con su referencia, corredor `run.mjs`, proveedores falsos y aserción de promptfoo `2026-10-20 22:34:16`
- [x] Primera corrida real: 6 de 7 casos con cobertura 100 % y referencias corregidas `2026-10-20 23:17:52`
- [x] Llevar `03-monologo-prueba` de 90 % a 100 % de cobertura (HP-019): 98,8 % medio, 28 de 30 repeticiones al 100 % (`mediciones/2026-10-21-monologo-de-prueba.md`) `2026-10-21`
- [x] Casos reales en `bench/private/` (51 carpetas, ignoradas por git; `node bench/run-private.mjs list`) `2026-10-21`
- [ ] Repetir el banco con DeepSeek como proveedor de respaldo y al cambiar de modelo. **Límite externo, llave y tarifa.** Falta `DEEPSEEK_API_KEY` y su tarifa en `PRICES` de `bench/pricing.js`: las páginas de DeepSeek no traen precios (`api-docs.deepseek.com/quick_start/pricing` y `pricing-details-usd`, consultadas el 2026-10-26, devuelven los nombres `deepseek-flash` y `deepseek-v4-pro` sin cifras) y `run --plan` dice `deepseek-flash SIN TARIFA` y `Plan: NO ejecutable`. Lo destraba Martín con la llave y la tarifa de su consola. Comando: `node scripts/llave.mjs DEEPSEEK_API_KEY`, agregar la tarifa con fuente y fecha a `PRICES`, y `TEXT_PROVIDER=deepseek TEXT_MODEL=deepseek-flash node bench/run-private.mjs run --repeat 3 --budget 3` (H-1101)

---

## Resumen de cobertura

| Épico | Tareas | Estado | 🤖 .LLM | 🧑 .HUM | 🤖🧑 .MIX | Total checks |
| --- | --- | --- | --- | --- | --- | --- |
| EPIC-001 | TASK-001 a 004 | ⏳ En curso | 1 | 0 | 0 | 1 |
| EPIC-002 | TASK-005 a 011 | ⏳ En curso | 10 | 0 | 0 | 10 |
| EPIC-003 | TASK-012 a 013 | ⏳ En curso | 1 | 0 | 0 | 1 |
| EPIC-004 | TASK-014 a 017 | ⏳ En curso | 2 | 0 | 0 | 2 |
| EPIC-005 | TASK-018 a 019 | ⏳ En curso | 0 | 1 | 0 | 1 |
| EPIC-006 | TASK-020 a 021 | ⏳ En curso | 2 | 0 | 0 | 2 |
| EPIC-007 | TASK-022 a 023 | ⏳ En curso | 2 | 0 | 0 | 2 |
| EPIC-008 | TASK-024 | ⏳ En curso | 0 | 0 | 1 | 1 |

Cada prohibición se cuenta una vez, en el épico que la cierra; una tarea puede citar además otras que la tocan.
