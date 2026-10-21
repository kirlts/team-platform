# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `GET /api/messages/summary`: lo que afecta a cada miembro por prioridad (rojo, amarillo, azul) y los mensajes abiertos por área (UD-028).
- Panel: insignia grande en la pestaña Mensajes y en la campana, con el fondo de la prioridad más alta presente; pendientes por área clicables hacia Mensajes filtrado (UD-028, UD-029).
- Eje documental Kairós: MASTER-SPEC v0.1.0, RULES, REPOMAP, USER-DECISIONS (UD-001 a UD-015), TEST, TECHNICAL-DEBT y TODO con ocho épicos.
- Investigaciones fechadas 2026-10-20 (siete informes) y dos mediciones: extractores y primera corrida real del analizador.
- Licencia MIT; `idea.md` y la maqueta `Plataforma Team.png` como fuentes de diseño.
- Base SQLite con `node:sqlite` en WAL, migraciones `0001_initial` y `0002_telemetry`, siembra de las cinco áreas y primer Editor desde `ADMIN_EMAIL`.
- Cola de trabajos con arriendo, latido, reintentos con retroceso, barrera de intento y presupuesto de audio por hora.
- Worker en el mismo proceso o aparte (`WORKER_MODE`), con apagado ordenado y retoma de trabajos tras una muerte brusca.
- API Fastify bajo `/api` con contrato OpenAPI 3.1 generado, paginación uniforme, borrado en blando con `?confirm=true`, bitácora y CORS opcional.
- Rutas del Editor: `/api/jobs`, `/api/jobs/:id/trace`, `/api/audit`, `/api/inputs/:id/reprocess`, restauración de áreas y plantillas, y alta de miembros.
- `POST /api/auth/dev-login`, sólo con `NODE_ENV=development`.
- Flujo SSE por miembro con reposición por `Last-Event-ID` y eventos `progress`, `done` y `message`.
- Identidad local con Argon2id, sesión opaca, CSRF y límite de intentos; identidad delegada en cuatro modos (`signed-header`, `jwt`, `sso-redirect`, `trusted-header`).
- Extractores de imagen, documento, audio, video y enlace con guardia SSRF y tope de duración y tamaño.
- Proveedores de modelo `anthropic`, `openai-compatible`, `groq-speech` y `fake`, con configuración desde el entorno y desde Configuración.
- Analizador `api`: unidades por oración, clasificación en grupos por área y plantilla, descomposición por grupo, rescate, partición y validación con Ajv.
- Analizador `harness` sobre `claude -p`, con el mismo validador.
- Código, comentarios, nombres de pruebas y registros en inglés (UD-015), con HP-008 como prueba estática; el texto visible del panel sigue en español.
- Prompts del analizador en dos juegos completos, español latinoamericano neutro (`es-419`, por omisión) e inglés, elegidos por `bundle.language` (UD-018), con contrato de redacción sin marcas de IA (UD-019) y su medición en `bench/ai-tells.js`.
- Segunda lectura del analizador cuando la primera no da grupos, con nueva descripción de las imágenes sueltas y origen `source: "frame"` (UD-021).
- Reintento único en `textFallback` ante un rechazo o una falla HTTP reintentable del proveedor de texto.
- Marcas de tiempo con rango (`[mm:ss-mm:ss]`, `h:mm:ss`) como límite de unidad; caso 08 del banco (reunión de diez minutos).
- Plantillas iniciales de Idea, Error, Nueva funcionalidad, Retroalimentación y Pregunta en `templates/`.
- Telemetría con OpenTelemetry (UD-014): spans en SQLite por un exportador propio, vista `llm_calls`, árbol por trabajo y OTLP opcional.
- Panel React: Inicio, Mensajes, detalle, Áreas, Equipo y Configuración, con piel Y2K futurista (UD-013), filtros en la URL y capturas programáticas.
- Empaquetado: `Dockerfile` multi-etapa, `compose.yml` de un servicio, `compose.override.example.yml`, `scripts/install.sh`, `scripts/backup.sh` y `docs/INSTALACION.md`.
- Banco de referencia en `bench/`: siete casos, puntaje por conjuntos sobre `unit_ids`, corredor `run.mjs` y promptfoo.
- `scripts/llave.mjs` para guardar una llave de proveedor fuera del repositorio y `scripts/analizar.mjs` para analizar un texto desde la terminal.
- Pruebas: 387 del servidor, 56 del banco y 21 del panel; prohibiciones HP-001 a HP-008 y HP-011 en la batería.
- `README.md` para quien llega al repositorio público.

### Changed
- Panel: Inicio muestra los últimos mensajes y las últimas respuestas como bloque principal y pliega la cola de envíos, el original y el análisis tras un solo control; el texto del análisis se dibuja a 17 px (UD-030).
- UD-015: el código y sus comentarios pasan al inglés; la interfaz, los mensajes a la persona, las plantillas y la documentación siguen en español. Reemplaza a UD-005 en los comentarios.
- El analizador clasifica y descompone con esfuerzo `low` y pensamiento apagado. El límite de llamadas a la vez sube a 16 (medición del 2026-10-20).
- `llm_calls` deja de ser tabla y pasa a ser una vista sobre `spans`.
- MASTER-SPEC §2, §3, §6 y §7 describen el código real; §3.1 lista las dependencias con su licencia.

### Fixed
- Audio y video: los segmentos de Groq se unen en líneas del tamaño de una oración (`audio.pauseSeconds`, `audio.maxUnitWords`); una nota de 107 s pasa de 46 unidades a 9 (REG-005).

<!--
INPUT FORMAT:

## [X.Y.Z] - YYYY-MM-DD

### Added
- Description of the added functionality.

### Changed
- Description of what changed.

### Fixed
- Description of the fixed bug.

### Removed
- Description of what was removed.

RULES:
- The AI adds entries to [Unreleased] upon completing work.
- When performing a release, [Unreleased] is moved to a numbered version.
- Each entry describes WHAT changed, not HOW.
-->
