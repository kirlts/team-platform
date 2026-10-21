# TODO: team-platform v0.1.0

> Trazabilidad directa: cada tarea referencia checks de `VERIFICATION.md`, con el formato `[ACTOR.CAT.NN.VER]`.
>
> Las marcas de tiempo de las tareas cerradas son la hora del commit que entregó cada ítem. Se verificaron contra el código y las pruebas el 2026-10-20: 387 del servidor, 56 del banco y 21 del panel, todas en verde.

## Leyenda de símbolos Kairós

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

### [TASK-001] Inicializar el eje documental Kairós

> Ref: MASTER-SPEC §1

**Checks cubiertos:** Gobernanza transversal

- [x] `docs/` desde las plantillas, REPOMAP, `.gitignore` con el bloque Kairós `2026-10-20 21:05:00`
- [x] Decisiones UD-001 a UD-010 con las palabras de Martín `2026-10-20 22:10:00`
- [x] Investigación del motor de análisis y adjuntos en `docs/investigaciones/` `2026-10-20 21:50:00`
- [x] MASTER-SPEC §1 a §8, RULES, LICENSE MIT `2026-10-20 22:30:00`
- [x] Cruzar los informes 02, 03, 04, 06 y 07 con el MASTER-SPEC `2026-10-20 22:05:00`
- [x] Cruzar el informe 05 (extracción de documentos) con el MASTER-SPEC `2026-10-20 22:40:00`

### [TASK-002] Revisión humana del MASTER-SPEC

> Ref: MASTER-SPEC §1 a §7

**Checks cubiertos:** Gobernanza transversal `[Requiere validación humana]`

- [ ] Martín confirma o corrige §1 (vector, vocabulario, lo que NO es)
- [ ] Martín confirma o corrige §3 (valores por omisión por modalidad) y §5
- [ ] Martín confirma o corrige las desviaciones anotadas en MASTER-SPEC §1.3, §3.1, §4.6, §7.1 y §7.5 (DT-001 a 005)

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

**Checks cubiertos:** `[DEV.IN.04.LLM]`

- [x] RULES regla 1, MASTER-SPEC §4.7 y UD-015 `2026-10-20 23:27:31`
- [x] UD-005 anotada como reemplazada en los comentarios, TEST.md HP-008 y DT-009 `2026-10-20 23:40:00`
- [x] Traducir comentarios, nombres y descripciones de pruebas, mensajes de aserción y de registro, y prompts de `src/`, `panel/`, `bench/` y `scripts/` `2026-10-21 15:35:00`
- [x] HP-008 falla también ante comentarios y mensajes de aserción en español y cubre `src/`, `panel/`, `bench/`, `scripts/` y `.githooks/` (`[DEV.IN.04.LLM]`) `2026-10-21 15:35:00`
- [x] [TASK-004]; 2026-10-21 15:35:00 [🤖 Verified by tool]

---

## [EPIC-002] Núcleo: esquema, API y cola

> Ref: MASTER-SPEC §7.1, §7.2, §7.3, §7.10, §7.10 bis

### [TASK-005] Esquema SQLite, migraciones y siembra

> Ref: MASTER-SPEC §7.2

**Checks cubiertos:** `[DEV.IN.03.LLM]`

- [x] Conexión `node:sqlite` con WAL, `busy_timeout` y `synchronous=FULL`; exige Node 24.15 y SQLite 3.51.3 `2026-10-20 22:19:19`
- [x] Migración `0001_initial.sql` y ejecutor con `PRAGMA user_version`, respaldo previo y numeración contigua `2026-10-20 22:19:19`
- [x] Siembra de las cinco áreas y primer Editor desde `ADMIN_EMAIL` `2026-10-20 22:19:19`
- [x] Pruebas de la base (`src/db/db.test.js`) `2026-10-20 22:30:04`
- [x] [TASK-005]; 2026-10-20 22:30:04 [🤖 Verified by tool]

### [TASK-006] Cola de trabajos y worker

> Ref: MASTER-SPEC §7.3

**Checks cubiertos:** `[SYS.RS.01.LLM]`

- [x] Reclamo atómico con arriendo, latido, reintentos con retroceso y jitter, barrera de intento `2026-10-20 22:19:19`
- [x] Worker en el mismo proceso o aparte (`WORKER_MODE`), presupuesto de audio y aplazamiento sin gastar intento `2026-10-20 22:28:28`
- [x] Pruebas de cola y de dos procesos reclamando sin duplicados `2026-10-20 22:40:26`
- [x] Apagado ordenado con SIGTERM en menos de 10 s `2026-10-20 23:03:03`
- [x] `[SYS.RS.01.LLM]`: el trabajo sobrevive a SIGKILL `2026-10-20 23:16:33`
- [x] [TASK-006]; 2026-10-20 23:16:33 [🤖 Verified by tool]

### [TASK-007] API, convenciones y contrato OpenAPI

> Ref: MASTER-SPEC §7.1, §4.11

**Checks cubiertos:** `[DEV.IN.02.LLM]`, `[SYS.IN.02.LLM]`, `[SYS.CR.02.LLM]`, `[DEV.IN.07.LLM]`, `[SYS.IN.03.LLM]`, `[SYS.IN.04.LLM]`

- [x] Rutas de inputs, mensajes, áreas, plantillas, miembros, configuración y adjuntos `2026-10-20 22:28:28`
- [x] OpenAPI 3.1 generado de los esquemas, CORS y cookie de origen cruzado `2026-10-20 22:45:35`
- [x] Forma plana de mensajes, ids como texto, paginación uniforme y borrado en blando `2026-10-20 22:56:09`
- [x] Pruebas del contrato y del flujo completo de la API `2026-10-20 23:03:03`
- [x] [TASK-007]; 2026-10-20 23:03:03 [🤖 Verified by tool]

### [TASK-008] Flujo de eventos SSE

> Ref: MASTER-SPEC §7.10

**Checks cubiertos:** `[SYS.RS.02.LLM]`

- [x] Un flujo por miembro con reposición por `Last-Event-ID`, `?job_id=` y latido `2026-10-20 22:28:28`
- [x] Pruebas de reposición sin repetidos ni huecos y de cierre con flujo abierto `2026-10-20 22:58:21`
- [x] [TASK-008]; 2026-10-20 22:58:21 [🤖 Verified by tool]

### [TASK-009] Operación del Editor

> Ref: MASTER-SPEC §7.1

**Checks cubiertos:** `[MEM.IN.01.LLM]`

- [x] `GET /api/jobs`, `DELETE /api/jobs`, `GET /api/jobs/:id/trace`, `GET /api/audit`, `POST /api/inputs/:id/reprocess` y detalle de `/health` `2026-10-20 22:52:04`
- [x] Pruebas de la operación del Editor `2026-10-20 23:03:03`
- [x] HP-015 como prueba con su ID (`[MEM.IN.01.LLM]`, DT-007) `2026-10-21 15:35:00`
- [x] [TASK-009]; 2026-10-21 15:35:00 [🤖 Verified by tool]

### [TASK-010] Telemetría con OpenTelemetry (UD-014)

> Ref: MASTER-SPEC §7.10 bis, UD-014

**Checks cubiertos:** `[SYS.IN.01.LLM]`, `[SYS.CR.01.LLM]`

- [x] `src/telemetry/`: spans en SQLite por un exportador propio, vista `llm_calls`, OTLP opcional `2026-10-20 23:03:18`
- [x] Instrumentación de proveedores, extractores, cola y publicación `2026-10-20 23:07:27`
- [x] Medición de sobrecarga y README del módulo `2026-10-20 23:10:57`
- [x] Spans del analizador: `analyze`, `classify`, `decompose`, `rescue`, `validate` y `harness` `2026-10-20 23:20:10`
- [x] [TASK-010]; 2026-10-20 23:20:10 [🤖 Verified by tool]

### [TASK-011] Prohibiciones estáticas del núcleo

> Ref: MASTER-SPEC §4

**Checks cubiertos:** `[DEV.IN.01.LLM]`, `[DEV.IN.03.LLM]`, `[DEV.IN.05.LLM]`, `[DEV.IN.06.LLM]`

- [x] `[DEV.IN.01.LLM]`, `[DEV.IN.02.LLM]`, `[DEV.IN.08.LLM]`, `[DEV.IN.03.LLM]`, `[DEV.IN.04.LLM]` y `[DEV.IN.06.LLM]` en `src/static.test.js` `2026-10-20 23:12:20`
- [x] `[DEV.IN.01.LLM]` sobre `src/analyze/` (DT-007) `2026-10-20 23:47:49`
- [x] `[DEV.IN.05.LLM]`: un literal numérico fuera de `src/config.js` sin su fuente falla (DT-007) `2026-10-20 23:47:49`
- [x] Gancho de pre-commit que escanea credenciales (DT-004) `2026-10-20 23:47:49`

---

## [EPIC-003] Extractores

> Ref: MASTER-SPEC §7.4, UD-009

### [TASK-012] Extractores por tipo de adjunto

> Ref: MASTER-SPEC §7.4

**Checks cubiertos:** `[SYS.IN.06.LLM]`

- [x] Imagen, documento (PDF, DOCX, PPTX, XLSX, texto), audio, video y enlace con guardia SSRF `2026-10-20 22:18:22`
- [x] Pruebas de cada extractor y del registro por tipo `2026-10-20 22:21:39`
- [x] Medición de tiempos por tipo en `docs/investigaciones/mediciones/2026-10-20-extractores.md` `2026-10-20 22:24:12`
- [x] Presupuesto de audio de 7.200 s por hora y troceado FLAC de 600 s con 5 s de solapamiento `2026-10-20 22:18:22`
- [x] Alinear el tope de documentos entre la subida y la extracción (DT-005) `2026-10-20 23:59:28`

### [TASK-013] Mediciones pendientes de los extractores

> Ref: MASTER-SPEC §7.4, §7.11

**Checks cubiertos:** `[SYS.IN.06.LLM]` `[Requiere validación humana]`

- [x] Una foto HEIC real de iPhone: se decodifica con el `ffmpeg` de la imagen (UD-040, H-21)
- [ ] Latencia de Groq, Anthropic y DeepSeek con archivos reales (la medición del 2026-10-20 usó dobles de latencia cero)
- [ ] Un Word con estilos propios, un PDF real de cliente y una grabación real de teléfono
- [ ] Descarga de enlaces contra internet real y contra servidores que entregan bytes lentamente
- [ ] Opus contra FLAC en español y legibilidad de texto en fotogramas de 540, 720 y 1080 px

---

## [EPIC-004] Analizador y proveedores

> Ref: MASTER-SPEC §7.5, §7.6, §7.9, UD-001, UD-008

### [TASK-014] Proveedores de modelo

> Ref: MASTER-SPEC §7.6

**Checks cubiertos:** `[SYS.CR.01.LLM]`, `[ANA.RS.01.LLM]`, `[SYS.AV.01.LLM]`

- [x] `anthropic`, `openai-compatible` (DeepSeek, Groq, OpenRouter, Gemini), `groq-speech` y `fake` `2026-10-20 22:17:46`
- [x] Configuración desde el entorno y desde Configuración (Editor), sin llaves en la base `2026-10-20 22:28:28`
- [x] Proveedor de texto de respaldo invocado ante un rechazo o un error de red o 5xx (DT-003) `2026-10-20 23:59:58`
- [x] `llm_calls` registra el proveedor que respondió y `GET /health` informa la ranura `text_fallback` (`[ANA.RS.01.LLM]`, `[SYS.CR.01.LLM]`, `[SYS.AV.01.LLM]`) `2026-10-21 15:35:00`
- [x] [TASK-014]; 2026-10-21 15:35:00 [🤖 Verified by tool]

### [TASK-015] Analizador `api`

> Ref: MASTER-SPEC §7.5

**Checks cubiertos:** `[DEV.IN.01.LLM]`, `[SYS.IN.04.LLM]`, `[ANA.CR.01.LLM]`, `[ANA.CR.02.LLM]`, `[ANA.CR.03.LLM]`, `[ANA.CR.04.LLM]`, `[ANA.CR.05.LLM]`, `[ANA.CR.06.LLM]`, `[ANA.CR.07.LLM]`

- [x] Numeración de unidades, clasificación, descomposición MECE, rescate, partición y validación con Ajv `2026-10-20 22:27:02`
- [x] Cada mensaje con su área y plantilla; clasificación en grupos y descomposición por grupo `2026-10-20 22:33:22`
- [x] Unidades por oración, enumeraciones en línea y pensamiento por llamada `2026-10-20 22:41:22`
- [x] Descomposición sin descartes y reintento de un grupo vacío `2026-10-20 23:01:23`
- [x] Esfuerzo `low` sin pensamiento y concurrencia 16 por omisión, con la medición citada `2026-10-20 23:10:55`
- [ ] Medir las variantes B (una sola llamada) y C (clasificar dentro de la descomposición) en el banco
- [ ] Calibrar con el banco `partitionThresholdTokens`, `charsPerToken` y el p95 de `maxTokens` (hoy provisionales)

### [TASK-016] Analizador `harness`

> Ref: MASTER-SPEC §7.5, UD-008

**Checks cubiertos:** `[SYS.IN.04.LLM]`

- [x] `claude -p` sin `--bare` desde un directorio propio, con el mismo validador y pruebas con un ejecutable de mentira `2026-10-20 22:27:44`
- [ ] Medir en el banco el costo y el tiempo del harness frente a `api` con una suscripción real

### [TASK-017] Plantillas iniciales

> Ref: MASTER-SPEC §7.9

**Checks cubiertos:** `[SYS.IN.03.LLM]`

- [x] Cinco áreas y cinco plantillas en `templates/`, con siembra desde `loadSeed` `2026-10-20 22:27:02`
- [x] Retroalimentación: una confirmación sin comentarios no es un mensaje `2026-10-20 23:13:47`
- [x] Calentamiento de la gramática por evento al guardar una plantilla `2026-10-20 22:33:33`

---

## [EPIC-005] Panel

> Ref: MASTER-SPEC §6, §7.8, UD-006, UD-011, UD-013

### [TASK-018] Panel React contra la API

> Ref: MASTER-SPEC §7.8

**Checks cubiertos:** `[SYS.IN.01.LLM]`, `[SYS.RS.02.LLM]`, `[PAN.FN.01.LLM]`, `[PAN.CR.02.LLM]`, `[PAN.CR.03.LLM]`, `[PAN.CR.04.LLM]`, `[PAN.CR.05.LLM]`

- [x] Esqueleto con Vite, TanStack Query, React Router, filtros en la URL y flujo de eventos `2026-10-20 22:15:35`
- [x] Servidor doble de desarrollo, subida con progreso, grabación de audio y consultas `2026-10-20 22:18:10`
- [x] Vistas Inicio, Mensajes, detalle, Áreas, Equipo y Configuración `2026-10-20 22:24:07`
- [x] Propuesta con área por mensaje `2026-10-20 22:30:03`
- [x] Humo del panel compilado contra la API real `2026-10-20 23:06:03`
- [x] Borrar una plantilla manda `confirm=true` `2026-10-20 23:18:19`
- [x] 21 pruebas de `panel/src/lib` `2026-10-20 23:33:05`

### [TASK-019] Piel Y2K futurista

> Ref: MASTER-SPEC §6, UD-013

**Checks cubiertos:** `[PAN.CR.01.HUM]` `[Requiere validación humana]`

- [x] Tokens, vidrio y cromo, fuentes OFL empaquetadas y `panel/DISENO.md` con referencias fechadas `2026-10-20 22:38:40`
- [x] Medición de contraste de cada par de texto y de peso del paquete `2026-10-20 22:43:30`
- [ ] Martín mira las capturas de cada vista y confirma o corrige la jerarquía visual (`[PAN.CR.01.HUM]`)
- [ ] Probar en Safari 16.4 y en Firefox 128, la base de navegadores de §3
- [ ] Probar la grabación de audio en un iPhone (Safari anterior a 18.4 sólo graba MP4)

---

## [EPIC-006] Identidad

> Ref: MASTER-SPEC §7.7, UD-002, UD-007

### [TASK-020] Identidad local y delegada

> Ref: MASTER-SPEC §7.7

**Checks cubiertos:** `[MEM.IN.01.LLM]`, `[SYS.IN.05.LLM]`, `[SYS.IN.12.LLM]`, `[MEM.FN.01.LLM]`

- [x] Local: Argon2id, sesión opaca, cookie `__Host-`, CSRF, límite por IP y espera por cuenta `2026-10-20 22:28:28`
- [x] Delegada: `signed-header`, `jwt` (secreto y JWKS), `sso-redirect` y `trusted-header` `2026-10-20 22:28:28`
- [x] Pruebas de identidad, enfriamiento del JWKS y roles `2026-10-20 22:40:26`
- [x] Cookie de origen cruzado y `CORS_ORIGINS` `2026-10-20 22:45:35`
- [x] [TASK-020]; 2026-10-20 22:45:35 [🤖 Verified by tool]

### [TASK-021] Identidad detrás de un proxy real

> Ref: MASTER-SPEC §7.7

**Checks cubiertos:** `[SYS.IN.05.LLM]`

- [ ] `trusted-header` detrás de `tailscale serve` con una tailnet real
- [ ] Inicio de sesión con TLS real detrás de Caddy (la cookie `__Host-` exige HTTPS)
- [ ] `sso-redirect` con un sitio anfitrión real

---

## [EPIC-007] Empaquetado e instalación

> Ref: MASTER-SPEC §3 (Empaquetado), §4.5

### [TASK-022] Imagen, compose y scripts

> Ref: MASTER-SPEC §3

**Checks cubiertos:** `[DEV.IN.08.LLM]`, `[OPS.AV.01.LLM]`

- [x] `Dockerfile` multi-etapa, `compose.yml` de un servicio y `compose.override.example.yml` `2026-10-20 22:22:53`
- [x] `scripts/install.sh`, `scripts/backup.sh` y `docs/INSTALACION.md` `2026-10-20 22:26:19`
- [x] `scripts/llave.mjs` y `scripts/analizar.mjs` `2026-10-20 23:19:50`
- [x] `.env.example` versionado y una prueba que exige que nombre toda variable de `src/config.js` `2026-10-20 22:41:56`
- [x] [TASK-022]; 2026-10-20 23:19:50 [🤖 Verified by tool]

### [TASK-023] Instalación en un servidor real

> Ref: MASTER-SPEC §3, §4.5

**Checks cubiertos:** `[DEV.IN.08.LLM]`, `[OPS.AV.01.LLM]`, `[DEV.IN.06.LLM]` `[Requiere validación humana]`

- [ ] Instalar con `scripts/install.sh` en un VPS limpio y recorrer las tres formas de `docs/INSTALACION.md`
- [ ] Restaurar un respaldo siguiendo `docs/INSTALACION.md`
- [ ] Decidir sobre `libvips` (LGPL) y `ffmpeg` en la imagen (DT-002)

---

## [EPIC-008] Banco de referencia y mediciones

> Ref: MASTER-SPEC §7.11, §1.3, §4.9

### [TASK-024] Banco de referencia

> Ref: MASTER-SPEC §7.11

**Checks cubiertos:** `[ANA.CR.08.MIX]`

- [x] `bench/score.js` con aritmética de conjuntos sobre `unit_ids` y exactitud de la clasificación `2026-10-20 22:29:36`
- [x] Siete casos con su referencia, corredor `run.mjs`, proveedores falsos y aserción de promptfoo `2026-10-20 22:34:16`
- [x] Primera corrida real: 6 de 7 casos con cobertura 100 % y referencias corregidas `2026-10-20 23:17:52`
- [ ] Llevar `03-monologo-prueba` de 90 % a 100 % de cobertura (`[ANA.CR.08.MIX]`)
- [ ] Reemplazar los textos inventados por casos reales anonimizados en `bench/private/`
- [ ] Repetir el banco con DeepSeek como proveedor de respaldo y al cambiar de modelo

---

## Resumen de cobertura

| Épico | Tareas | Estado | 🤖 .LLM | 🧑 .HUM | 🤖🧑 .MIX | Total checks |
| --- | --- | --- | --- | --- | --- | --- |
| EPIC-001 | TASK-001 a 004 | ⏳ En curso | 1 | 0 | 0 | 1 |
| EPIC-002 | TASK-005 a 011 | ⏳ En curso | 15 | 0 | 0 | 15 |
| EPIC-003 | TASK-012 a 013 | ⏳ En curso | 1 | 0 | 0 | 1 |
| EPIC-004 | TASK-014 a 017 | ⏳ En curso | 9 | 0 | 0 | 9 |
| EPIC-005 | TASK-018 a 019 | ⏳ En curso | 5 | 1 | 0 | 6 |
| EPIC-006 | TASK-020 a 021 | ⏳ En curso | 3 | 0 | 0 | 3 |
| EPIC-007 | TASK-022 a 023 | ⏳ En curso | 2 | 0 | 0 | 2 |
| EPIC-008 | TASK-024 | ⏳ En curso | 0 | 0 | 1 | 1 |

Cada check se cuenta una vez, en el primer épico que lo cita; una tarea puede citar además otros que la tocan.
