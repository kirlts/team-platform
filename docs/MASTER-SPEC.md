# MASTER-SPEC: team-platform v0.1.0

> Una bandeja de entrada para equipos de 3 a 10 personas. Todo input (texto, capturas, video, audio, documentos, enlaces) se descompone en mensajes categorizados, asignados y rastreables.

Fuentes de este documento: `idea.md` (volcado de diseño de Martín, 2026-10-20) y `Plataforma Team.png` (maqueta dibujada antes del volcado; `idea.md` manda donde difieren). También `docs/USER-DECISIONS.md` (UD-001 a UD-015), los siete informes de `docs/investigaciones/` y las mediciones de `docs/investigaciones/mediciones/`. Cada hecho sobre un tercero lleva su fuente ahí; acá sólo se cita la conclusión. Donde el código y este documento difieren, el documento dice lo que el código hace y por qué. Lo que el código no justifica está en `docs/TECHNICAL-DEBT.md`.

---

## §1. Identidad del proyecto

**Propósito:** En los proyectos donde una persona es el desarrollador principal, la comunicación del equipo vive dispersa. Hay correos, capturas con audio en un grupo, videos narrados y documentos. Reportes de errores, requerimientos, retroalimentación e ideas se mezclan con conversación casual. team-platform centraliza esa comunicación sin obligar a nadie a cambiar su forma de comunicar. Cada miembro manda lo que tiene, como lo tiene. La plataforma lo convierte en el mínimo conjunto de mensajes accionables. Cada mensaje queda en su área, con su plantilla, su destinatario y los adjuntos que lo contextualizan.

**El vector de trascendencia** es la cualidad que todo lo demás sirve (Martín, 2026-10-20). Es la **velocidad de respuesta por input y la descomposición correcta.** Correcta quiere decir MECE. Mutuamente excluyente: ningún punto repartido en dos mensajes. Colectivamente exhaustiva: ningún punto del input que no esté en un mensaje. Cada decisión de este documento se puede leer como una respuesta a «¿esto hace que un input se descomponga mejor o más rápido?».

**Nombre:** team-platform

**Dominio:** Comunicación interna de equipos de software pequeños; triage asistido por modelos de lenguaje.

**Problema que resuelve:** Tres fricciones medibles en el equipo. Ordenar, categorizar y asignar el trabajo que llega. Responder a cada mensaje, petición, reporte o idea de forma individual y oportuna. Llevar trazabilidad de lo hecho. Hoy las tres se hacen a mano sobre un chat de grupo, o no se hacen.

**Beneficiario directo:** El equipo del proyecto, de 3 a 10 miembros con responsabilidades y dominios distintos. En primer lugar quien desarrolla, que es a quien más le llega.

**Beneficiario indirecto:** Quien instala team-platform dentro de un sitio propio para recibir lo que sus usuarios o clientes mandan (UD-002, UD-010). También cualquier sistema externo que hable con la API.

**Lo que NO es:** No es un chat: un mensaje espera una respuesta, no una conversación continua. No es un gestor de proyectos: sin tableros, sprints ni estimaciones. No es un rastreador de incidencias que reemplace a GitHub: los mensajes se cierran, no se versionan. En la fase inicial no manda nada hacia afuera (correo, WhatsApp, API, MCP). La vista Conexiones existe apagada hasta que se pruebe que la descomposición funciona bien, sin importar la procedencia y la forma del input (`idea.md`).

### 1.1 Vocabulario

| Término | Definición | Reglas |
|---|---|---|
| **Input** | Lo que una persona envía desde la barra de Inicio o, más adelante, por una conexión: texto y cero o más adjuntos (fotos, videos, audio, documentos, enlaces). | Un input se analiza una vez y produce una propuesta. |
| **Propuesta** | El resultado del análisis: N mensajes, cada uno en su área y redactado según la plantilla de esa área, con sus destinatarios y adjuntos. | Se publica sola al terminar el análisis, si es válida (UD-070, que enmienda UD-003); con la perilla `auto_publish` apagada espera la confirmación del emisor. |
| **Mensaje** | Una comunicación de una persona hacia el equipo o hacia un miembro. Siempre espera respuesta. | Estados, derivados de las respuestas y del cierre y nunca escritos a mano (UD-042): `abierto` (sin respuesta), `respondido` (con una respuesta o más, no cerrado, sea cual sea su contenido), `cerrado` (con o sin respuesta). Sólo un miembro distinto del emisor responde; cualquier miembro cierra o reabre. Sólo el emisor edita su mensaje, tampoco un Editor (UD-071); cada edición deja su historial y el mensaje muestra «editado» con la hora. |
| **Respuesta** | La contraparte del mensaje: respuesta directa, reporte de arreglo, pedido de aclaración. | Depende de un mensaje. |
| **Hilo** | Una respuesta seguida de más respuestas sobre el mismo mensaje. | Lineal, como los comentarios de un issue de GitHub. |
| **Área** | Categoría de un mensaje. Las áreas son mutuamente excluyentes y colectivamente exhaustivas para toda comunicación interna que busque respuesta. | Título y descripción. Las gestiona el Editor. Juego inicial: idea, error, nueva funcionalidad, retroalimentación, pregunta. |
| **Plantilla** | Archivo markdown que describe cómo analizar un input de su área y qué forma tiene cada mensaje de salida. | N plantillas por área, cada plantilla de una sola área. Nombre y descripción. Las gestiona el Editor. |
| **Miembro** | Persona del equipo, con nombre y un perfil: un par de párrafos en primera persona sobre qué hace, qué sabe, qué decide y cómo prefiere recibir las cosas (UD-023). | Edita sólo su propio perfil. Rol `member` o `editor` (UD-007). |
| **Trabajo** | Unidad de la cola: extraer un adjunto, analizar un input. | Sobrevive al navegador y al reinicio del proceso (UD-003, UD-010). |

### 1.2 El modelo lee y propone; el sistema valida y decide

El modelo de lenguaje ocupa el borde: convierte un input desordenado en una propuesta estructurada. Todo lo demás es sistema determinista. Define qué áreas existen y qué plantillas tiene cada una. Define quiénes son los miembros, qué adjuntos hay, qué estados puede tener un mensaje y quién puede responder. El modelo recibe eso como contexto y como esquema de salida. No se le enseñan reglas de negocio en prosa que el sistema pueda hacer cumplir solo.

De ahí sale la invariante que más se incumple sola, adoptada de un proyecto anterior del autor. **Ningún `if`, expresión regular ni lista de palabras sobre el texto de una persona decide un área, un destinatario ni un estado.** Lo interpreta el modelo. Lo entrega por campos del esquema. El sistema valida la forma del valor (el área existe, el miembro existe, el adjunto pertenece al input) y escribe el dato exacto.

### 1.3 Idempotencia

Idempotencia en el sentido de las plantillas de trabajo. Una plantilla aplicada a un input produce mensajes de la misma forma, con los mismos campos y la misma completitud. No importa quién lo mande, cuándo ni por qué canal. Esa constancia la dan la plantilla (método y formato de salida) y el esquema estricto que el sistema valida, no una semilla del modelo. La prosa de un mensaje puede variar de una corrida a otra y eso no es un defecto. Un mismo input no crea un segundo trabajo ni una segunda propuesta: devuelve la que ya existe. Es el mismo input si coinciden el texto normalizado, los adjuntos por hash, los enlaces y el emisor. El emisor entra en el hash porque la propuesta es privada de quien la envía hasta que la publica. Dos personas que mandan el mismo texto tienen cada una su input.

---

## §2. Arquitectura

**Tipo:** Cliente-servidor en un solo contenedor. La API es la única puerta (UD-010). El panel es un cliente estático servido por la misma API. Cualquier conexión futura o sistema externo entra por el mismo contrato.

**Diagrama de componentes:**

```
┌───────────────────────── contenedor team-platform ──────────────────────────┐
│                                                                              │
│  Panel (React, estático) ──────────HTTP/JSON + SSE──▶  API (Fastify)        │
│                                                          │                   │
│                                                          ├─ Identidad (local │ email+clave,
│                                                          │   o delegada)     │ UD-002
│                                                          ├─ Dominio          │ mensajes, áreas,
│                                                          │                   │ plantillas, equipo
│                                                          └─ Cola (SQLite)  ◀─┼── Worker
│                                                                              │   ├─ Extractores
│  SQLite (node:sqlite, WAL)  ◀──────────────────────────────────────────────  │   │  imagen, pdf, docx,
│  Volumen /data: base + adjuntos + plantillas                                 │   │  audio, video, enlace
│                                                                              │   └─ Analizador
└──────────────────────────────────────────────────────────────────────────────┘   ├─ api: bucle propio
                                                                                   └─ harness: claude -p
                 ▲ proveedores externos, configurables por modalidad (UD-001):
                 texto y visión · transcripción · (video: fotogramas propios + transcripción)
```

**Flujo principal de datos:**

1. La persona escribe en la barra de Inicio, adjunta lo que tenga y envía. `POST /api/inputs` guarda el input, cada adjunto en el volumen con su hash, calcula el hash del input y encola un trabajo `analyze`. Si el hash ya existe, devuelve lo que ya hay (§1.3). Respuesta inmediata con el id del input y el id del trabajo.
2. El worker toma el trabajo con arriendo. Por cada adjunto corre el extractor de su tipo (§7.4) y escribe el texto o la descripción obtenida en la fila del adjunto. Cada paso emite un evento de progreso (porcentaje y frase breve) en `job_events`; el panel los recibe por SSE (`GET /api/events`).
3. El analizador (§7.5) arma el paquete. Lo componen el texto del input y las extracciones de los adjuntos. Suma los títulos y descripciones de áreas y plantillas, y el equipo con el perfil completo de cada miembro. Numera las unidades del input. Primera llamada: reparte las unidades en grupos de un solo punto, cada grupo con su área y su plantilla. Segunda llamada, una por grupo y en paralelo, con el cuerpo de la plantilla del grupo. Devuelve los mensajes MECE del grupo, cada uno con título, campos de la plantilla, destinatarios propuestos y adjuntos que lo contextualizan. El sistema calcula solapes y huecos por conjuntos, valida cada campo contra la base y, si hay conflicto, hace un único pase de rescate.
4. Al terminar el análisis con una propuesta válida, el worker publica sus mensajes en la misma transacción que cierra el trabajo y deja el input en `published` (UD-070): los mensajes nacen `abiertos`, el evento `done` trae `input_status: published` y `message_ids`, y cada mensaje avisa al equipo. Nadie confirma nada. Una propuesta vacía o que no valida (un campo obligatorio sin llenar, un área borrada) no publica: el input queda `proposed` con `error_code: publish_blocked` y su motivo, visible para su emisor, que la corrige y la publica con `POST /api/inputs/:id/publish`. Un envío puede pedir quedarse en borrador con `auto_publish=false` (UD-072): así lo usa el guion de verificación del servidor. Un análisis fallido queda `failed`. La perilla `auto_publish` del Editor (`PATCH /api/settings/publication`, por omisión encendida) la apaga: vuelve la revisión previa, con la propuesta en `proposed` hasta que su emisor la publique. Publicar es idempotente: un input ya publicado no se publica otra vez, ni por reintento de la cola, ni por un trabajo repetido (409 `already_published`). Reprocesar un envío publicado es una orden del Editor, no un reintento (UD-258, §7.1).
4 bis. La bandeja de Inicio es el historial y el estado de los envíos propios: `GET /api/inputs?mine=1&order=desc` los lista todos (en cola, leyendo, analizando, propuesta, publicado con sus mensajes, fallido, cancelado), paginados. El emisor edita cada mensaje publicado con `PATCH /api/messages/:id` (UD-071).
5. Los destinatarios los ven en Inicio («últimos mensajes», filtrados para mí) y en Mensajes. Responden (`POST /api/messages/:id/replies`), con lo que el mensaje pasa a `respondido`; cualquiera lo cierra o reabre.

---

## §3. Stack técnico

Criterio: tecnologías que el autor ya probó en producción (Node, Fastify, React, Vite). Menos piezas de las que ese proyecto lleva, porque un equipo de 10 no las necesita (UD-010).

| Capa | Tecnología | Justificación |
| --- | --- | --- |
| Frontend | React 19.3 + Vite 8 + Tailwind 4.3 + TypeScript + TanStack Query 5 + React Router 8; componentes de shadcn/ui sobre Radix (paquete `radix-ui`) copiados al repositorio | Refine 5 quedó fuera (UD-011): sin paquete publicado desde el 2026-04-02, adaptador atado a React Router 7 y telemetría a un tercero por omisión. Lo que daba hecho (listas, filtros, formularios contra REST) cabe en un módulo propio de filtros a parámetros. Base de navegadores: Chrome 111, Safari 16.4, Firefox 128 (informe 07). |
| API | Node 24 + Fastify 5, validación de esquemas con Ajv | Fastify valida entrada y salida por esquema JSON, que es el mismo mecanismo con que se valida lo que devuelve el modelo. |
| Datos | SQLite por `node:sqlite` (release candidate desde Node 24.15; se exige Node ≥ 24.15 y SQLite ≥ 3.51.3 al arrancar), WAL, `busy_timeout` 5.000 ms, `synchronous=FULL`, `BEGIN IMMEDIATE` en toda transacción que lee y luego escribe | `idea.md` pide SQLite; `node:sqlite` evita compilar `better-sqlite3` en cada arquitectura. Sin `busy_timeout` un 16 % de las transacciones concurrentes fallaron en la medición del informe 03; con ambos, cero. Respaldo con `VACUUM INTO` y `rename` (123 ms con escritor activo), nunca `cp`. Un paso de inicialización único antes de la API y el worker fija WAL y aplica migraciones, porque dos arranques simultáneos chocan al fijar WAL. |
| Cola de trabajos | Tabla `jobs` propia con arriendo, latido, reintentos con retroceso, prioridad y barrera de intento, patrón de pg-boss | Ninguna librería MIT activa usa `node:sqlite` (informe 03); la lógica cabe en un módulo. Medido: dos procesos escritores, 13.768 reclamos, cero duplicados. |
| Progreso | SSE desde la API; cancelación por `POST` | Un solo sentido, reconexión automática del navegador; WebSocket sólo si hiciera falta control bidireccional. |
| Telemetría | `@opentelemetry/sdk-node` 0.300.0, `@opentelemetry/api` 1.10.0, `@opentelemetry/exporter-trace-otlp-http` 0.300.0, `@opentelemetry/sdk-trace` 3.0.0, `@opentelemetry/core` 3.0.0 y `@opentelemetry/resources` 3.0.0 (todos Apache-2.0, compatibles con MIT; versiones del 2026-10-20), con un exportador propio a SQLite | UD-014: es el estándar de la industria para medir llamadas a modelos y lo leen las herramientas que el equipo quiera conectar por OTLP. Sin `OTEL_EXPORTER_OTLP_ENDPOINT` no sale ninguna conexión. Sobrecarga medida: 22 µs por llamada en el camino de la llamada y de 0,19 a 0,39 ms de escritura diferida por span (`src/telemetry/overhead.bench.mjs`). |
| Adjuntos | Archivos en el volumen, nombrados por hash | Sin S3 ni MinIO: un equipo de 10 no los necesita; el adaptador de almacenamiento permite agregarlos. |
| Modelo: texto, visión y PDF | Contrato de proveedor por modalidad. Omisión: Anthropic `claude-haiku-5-5` con salida estructurada, prompt de sistema cacheado, esfuerzo `low` y pensamiento apagado tanto al clasificar como al descomponer (el banco mostró que conserva la cobertura y baja cada llamada de 6 a 12 s a 1 a 3 s; `docs/investigaciones/mediciones/2026-10-20-primera-corrida-real.md`); sin `temperature`, `top_p` ni `top_k` (el modelo los rechaza) | 0,10 USD entrada / 0,50 salida por MTok, lectura de caché 0,01; visión y PDF nativo de 600 páginas en el mismo proveedor. Alternativa y respaldo configurable: DeepSeek `deepseek-flash` (texto e imagen, sin PDF; esquema sólo por herramienta estricta en beta, o modo JSON validado con Ajv). Perillas y fuentes en el informe 02. |
| Modelo: transcripción | Groq `whisper-large-v3-turbo` por la API compatible con OpenAI. El audio va siempre como FLAC 16 kHz mono cortado por `ffmpeg`, nunca el archivo original | Ya en uso por el autor; 0,04 USD por hora de audio (UD-008). Alternativa: faster-whisper local. Enviar la nota original (Ogg Opus) se midió en tres notas reales: texto con 0,00 a 0,91 % de diferencia, pero 17 unidades en vez de 20 en una de ellas y 0,2 a 0,5 s de ganancia; se descartó (`docs/investigaciones/mediciones/2026-10-20-ffmpeg-minimo.md`). |
| Video | Binario `ffmpeg` estático y mínimo por `spawn`, 8.1.3 en configuración LGPL con 22 decodificadores (H.264, HEVC, VP8, VP9, AV1 por dav1d, AAC, ALAC, Opus, Vorbis, FLAC, MP3, PCM) y los filtros que componen y giran una foto HEIC (`xstack`, `transpose`, `hflip`, `vflip`; UD-040) (`fluent-ffmpeg` está archivado desde 2025-05-22 y el WASM no corre en Node): pista de audio a transcripción; un fotograma por segundo deduplicado por dHash de 64 bits a distancia 6, tope de 48 fotogramas de 720 px; el umbral de cambio de escena queda apagado (en una grabación de pantalla sintética `scene>0,2` cubrió 8 de 16 pantallas; 1 fps más dHash dejó 18 fotogramas y cubrió 16 de 16; informe 06) | Sin un tercer proveedor; costo del mismo orden que el video nativo de Gemini (0,0019 USD por minuto contra 0,001 a 0,005), que queda como alternativa configurable porque pierde el muestreo determinista y la vista auditable. |
| Extracción de documentos | Dentro del contenedor, en un hilo trabajador con `resourceLimits`: PDF digital con `@hyzyla/pdfium` (WASM, MIT, 14 MB; 29 a 67 ms por documento, 337 ms en 304 páginas, conteo de caracteres por página); DOCX, PPTX y XLSX con `officeparser` (MIT; 17 a 91 ms; listas anidadas, tablas, notas) | Medido en el informe 05 contra `markitdown-node` (63 % de cobertura en DOCX, medio segundo de importación), MarkItDown en Python (18 veces más lento, 583 MB más de imagen), Kreuzberg, `downmark` y `anymd`; MuPDF.js y `pandoc-wasm` quedan fuera por licencia (UD-009). Docling queda como reversión para tablas anidadas y OCR. |
| Analizador alternativo | `claude -p` por trabajo, sin `--bare`, desde un directorio de trabajo vacío propio | Reutiliza una suscripción de Claude Code ya pagada (UD-008). `--bare` exige `ANTHROPIC_API_KEY` y no lee OAuth [V 2026-10-20, documentación oficial]. |
| Identidad | Contrato de proveedor, sin librería de autenticación. Omisión: local, correo y contraseña con `crypto.argon2` de Node (Argon2id, sin compilación nativa) y sesión en tabla con ficha opaca y cookie `__Host-`. Delegada: cabecera firmada con HMAC, JWT verificado con `jose`, o redirección firmada con nonce | UD-002: «segura pero ligera» y reemplazable. Lucia está deprecada, Auth.js pasó a Better Auth y Better Auth impone sus tablas y suma diez avisos de seguridad en 2026 (informe 04). |
| Red | Tailscale opcional por fuera: `tailscale serve` da TLS y restringe a la tailnet | La aplicación no sabe de Tailscale; en un VPS público el TLS lo pone el proxy del anfitrión. |
| Empaquetado | Una imagen Docker multi-etapa sobre `alpine:3.24` con el binario de `node` de la imagen oficial y `ffmpeg` y `ffprobe` compilados en una etapa propia del `Dockerfile` (estáticos, LGPL, 8,5 y 8,3 MB; con el `ffmpeg` completo de Alpine la imagen medía 466 MB y ahora mide 306 MB, medido el 2026-10-20 en `docs/investigaciones/mediciones/2026-10-20-ffmpeg-minimo.md`), `NOTICE` en `/usr/share/licenses/`, un `compose.yml` con un servicio y un volumen publicado sólo en `127.0.0.1`; `scripts/install.sh` y `scripts/backup.sh` | «Mínimos componentes»; instalar en un proyecto existente es agregar un servicio al compose del proyecto. |
| Pruebas | Node test runner (`node --test`) sobre una base SQLite efímera para el servidor y el banco; Vitest con jsdom para `panel/src/lib`; Playwright sólo para las capturas del panel y el humo de `src/testing/smoke-panel.mjs`; `fast-check` 4.10.2 (MIT, con `pure-rand` 8.4.2, MIT) para las propiedades y `@readme/openapi-parser` 9.1.0 (MIT; trae `@readme/better-ajv-errors` y `@humanwhocodes/momoa`, Apache-2.0, compatibles con MIT) para validar el OpenAPI generado, ambas sólo como dependencias de desarrollo, fuera de la imagen (2026-10-20, registry de npm; la otra opción viva, `@apidevtools/swagger-parser` 13.1.0, MIT, se publicó el 2026-09-20 y la de `@readme` el 2026-10-06) | Sin framework extra para el servidor. Estrategia y prohibiciones en `docs/TEST.md`. |

### 3.1 Dependencias

Toda dependencia es compatible con MIT (§4.10, HP-011 lo comprueba contra `package-lock.json`). Las versiones del servidor están fijadas con exactitud salvo `ajv` y `js-yaml`; las del panel llevan rango `^` y el `package-lock.json` del panel las fija.

**Servidor** (`package.json`, dependencias de producción):

| Paquete | Versión | Licencia | Para qué |
|---|---|---|---|
| `fastify` | 5.12.7 | MIT | Servidor HTTP con validación de entrada y salida por esquema JSON |
| `@fastify/cookie` | 11.1.3 | MIT | Cookie de sesión |
| `@fastify/cors` | 11.3.1 | MIT | Orígenes cruzados, sólo los de `CORS_ORIGINS` |
| `@fastify/multipart` | 10.1.4 | MIT | Subida de adjuntos con topes por tipo |
| `@fastify/rate-limit` | 11.2.1 | MIT | Límite de intentos de inicio de sesión por IP |
| `@fastify/sse` | 0.6.1 | MIT | Flujo de eventos del servidor con reposición por `Last-Event-ID` |
| `@fastify/static` | 10.1.6 | MIT | Sirve el panel compilado |
| `@fastify/swagger` | 9.9.2 | MIT | Genera el contrato OpenAPI 3.1 desde los esquemas de las rutas |
| `ajv` | ^8.20.0 | MIT | Valida la salida del modelo, los campos de plantilla y la propuesta |
| `jose` | 6.2.13 | MIT | JWT y JWKS de la identidad delegada |
| `js-yaml` | ^5.5.0 | MIT | Encabezado de las plantillas |
| `pino` | 10.4.0 | MIT | Registro en JSON por la salida estándar |
| `undici` | 8.12.3 | MIT | Descarga de enlaces con resolución de nombres filtrada |
| `linkedom` | 0.18.13 | ISC | DOM mínimo para extraer el contenido de un enlace |
| `@mozilla/readability` | 0.6.0 | Apache-2.0 | Contenido principal de una página |
| `turndown` | 7.2.4 | MIT | HTML a markdown |
| `@hyzyla/pdfium` | 3.0.0 | MIT | Texto de PDF por página (WASM) |
| `officeparser` | 8.2.0 | MIT | Texto de DOCX, PPTX y XLSX |
| `pdf-lib` | 1.17.1 | MIT | Partir un PDF para enviar al proveedor sólo las páginas escaneadas |
| `sharp` | 0.35.5 | Apache-2.0 | Redimensionar y convertir imágenes, fotogramas y dHash |
| `@opentelemetry/api` | 1.10.0 | Apache-2.0 | API de trazas que usa todo el código instrumentado |
| `@opentelemetry/sdk-node` | 0.300.0 | Apache-2.0 | SDK de trazas |
| `@opentelemetry/sdk-trace` | 3.0.0 | Apache-2.0 | Procesador de lotes de spans |
| `@opentelemetry/core` | 3.0.0 | Apache-2.0 | Resultado de exportación del exportador propio a SQLite |
| `@opentelemetry/resources` | 3.0.0 | Apache-2.0 | Recurso del servicio (nombre y versión) |
| `@opentelemetry/exporter-trace-otlp-http` | 0.300.0 | Apache-2.0 | Salida opcional por OTLP si el operador configura un colector |

Desarrollo del servidor: `docx` 9.13.0 y `fflate` 0.8.3 (MIT) arman los archivos de prueba. El banco tiene su propio `package.json`, fuera de la imagen: `promptfoo` 0.124.1 (MIT).

**Panel** (`panel/package.json`, dependencias de producción; el panel compilado no lleva ninguna en tiempo de ejecución más allá del paquete único):

| Paquete | Versión | Licencia | Para qué |
|---|---|---|---|
| `react`, `react-dom` | ^19.3.1 | MIT | Interfaz |
| `react-router` | ^8.5.0 | MIT | Rutas del cliente |
| `@tanstack/react-query` | ^5.104.5 | MIT | Consultas a la API, caché e invalidación |
| `radix-ui` | ^1.8.1 | MIT | Primitivas accesibles de los componentes de shadcn/ui |
| `clsx`, `tailwind-merge` | ^2.1.1, ^3.7.0 | MIT | Composición de clases de los componentes |

Desarrollo del cliente (`packages/client/package.json`, fuera de la imagen): `openapi-typescript` 7.13.0 (MIT) genera los tipos del contrato; TypeScript 5.9.3 (Apache-2.0, lo exige `openapi-typescript`), Vitest 5, jsdom y `@testing-library/react` (MIT) lo prueban. No lleva dependencias de ejecución; `react` y `@tanstack/react-query` son pares opcionales de la entrada `react`.

Desarrollo del panel: Vite 8, Tailwind 4.3 con `@tailwindcss/vite` (MIT), TypeScript 7, Vitest 5, jsdom y `@testing-library/react` (MIT), Playwright y TypeScript (Apache-2.0).

**Dos límites de licencia que quedan a la vista.** Primero, `sharp` trae `libvips` como binarios opcionales por plataforma, con licencia LGPL-3.0-or-later. Se enlaza de forma dinámica y se sustituye con otro `libvips`. HP-011 lo exceptúa por nombre. Segundo, la imagen incluye el binario `ffmpeg` del repositorio de Alpine, con la licencia de ese paquete. Se invoca como proceso externo y no se enlaza. El informe 06 anota que el `ffmpeg` estático es GPL-3.0-or-later. UD-020 fija la regla: LGPL admitida en los binarios de la imagen, nunca GPL.

---

## §4. Restricciones (límites inviolables)

> Estas restricciones mandan sobre cualquier otra decisión. Cada una tiene su prohibición en la batería o su candado en el código.

1. **Ningún dato del equipo sale del contenedor** salvo hacia los proveedores de modelo configurados y, si el operador lo configura, hacia un colector OTLP. Todo lo que pasa por un modelo se mide con OpenTelemetry y se guarda (UD-014). Hay un span por trabajo, por paso, por llamada a proveedor y por uso de herramienta. Llevan las convenciones `gen_ai.*`, el contenido completo de entrada y salida, tokens, costo y duración. Un exportador propio los guarda en SQLite y `llm_calls` es una vista sobre esos spans. Vale también para el navegador: el panel no se conecta a ningún otro dominio (CSP `connect-src 'self'`, `img-src 'self' blob: data:`), lo que excluye cualquier telemetría de una librería.
2. **Ningún `if`, expresión regular ni lista de palabras sobre texto humano decide área, destinatario ni estado** (§1.2). El modelo entrega campos; el sistema valida la forma.
3. **Un trabajo nunca depende del navegador.** Sobrevive al cierre de la pestaña y al reinicio del proceso. Al arrancar, el worker retoma los trabajos con arriendo vencido (UD-003, UD-010).
4. **Una propuesta válida llega al equipo sola; una inválida no llega** (UD-070, que enmienda UD-003). La confirmación manual queda detrás de la perilla `auto_publish`. Los mensajes sólo nacen de publicar una propuesta validada, por un único camino (HP-005).
5. **Un contenedor y un volumen bastan para correr.** Ningún componente obligatorio fuera de la imagen; los proveedores de modelo son externos y configurables.
6. **Ninguna credencial en el repositorio ni en la base.** Variables de entorno o archivo fuera del repositorio. HP-007 comprueba que ninguna columna guarde una llave; `.gitignore` excluye `.env` y `scripts/llave.mjs` guarda las llaves locales en `~/.config/team-platform/env`. El gancho `.githooks/pre-commit` escanea los archivos preparados y rechaza el commit con una credencial; `scripts/install.sh` lo activa con `git config core.hooksPath .githooks`.
7. **Código y comentarios en inglés.** Interfaz, mensajes a la persona, plantillas iniciales y documentación van en español. UD-015 reemplaza a UD-005 en los comentarios. Sin esquema mezclado.
8. **Sólo un miembro distinto del emisor responde un mensaje; cualquier miembro lo cierra o reabre.** Lo hace cumplir la API, no el panel.
9. **Todo número que gobierna la operación nace declarado**: tamaño máximo de adjunto, fotogramas por video, páginas por llamada, reintentos, arriendo de un trabajo. Sale de una medición citada o de una perilla de configuración con su valor por omisión justificado, nunca de «parece razonable».
10. **Licencias en dos capas** (UD-004, UD-020). Lo que se enlaza con el código (el repositorio y toda dependencia de npm) lleva licencia permisiva compatible con MIT. Lo que la imagen ejecuta como programa aparte o carga como biblioteca sin modificar (`ffmpeg`, `libvips` de `sharp`) puede ser LGPL, nunca GPL, y cada uno figura en `NOTICE` dentro de la imagen con su versión, su licencia y la dirección de su código fuente. Una prueba de la batería lo hace cumplir leyendo `package.json` y el `NOTICE`.
11. **La API es la única puerta.** El panel no lee la base ni el volumen. Lo que el panel puede hacer, un sistema externo lo puede hacer con el mismo contrato (UD-010). El contrato se publica generado desde los esquemas de las rutas (`GET /api/openapi.json`, OpenAPI 3.1) y ninguna ruta queda sin esquema de respuesta. Un frontend distinto (otro dominio, otro framework, otros componentes y tipografías) reimplementa sólo las vistas. `CORS_ORIGINS` y `COOKIE_MODE=cross-origin` son las dos perillas que lo permiten desde otro origen. El panel propio también se monta bajo una ruta de otro sitio (H-3721): `BASE_PATH` fija dónde se sirven el panel y sus activos, `API_PREFIX` dónde vive la API, y el servidor escribe los dos valores en el `index.html` que entrega (`<meta name="team-base-path">` y `<meta name="team-api-base">`), así que una misma compilación sirve cualquier ruta. `/health` responde además en la raíz y el contrato queda en `${API_PREFIX}/openapi.json`. `CSP_CONNECT_SRC` y `FRAME_ANCESTORS` abren la CSP a un anfitrión en otro origen o en un iframe; `SSO_RETURN_PATH` fija adónde vuelve el inicio de sesión delegado; `THEME_CSS` agrega la hoja de tokens del anfitrión.

    **Cliente del contrato (A6).** `packages/client/` (`@team-platform/client`, ESM, sin dependencias de ejecución) contiene lo que el panel hace al llamar a la API, para que otra interfaz no lo copie: una función tipada por operación (`createTeamClient({ baseUrl, apiPrefix, headers, fetch, cookieMode })`), las claves de caché y la tabla de invalidaciones, la versión al editar con un reintento ante 409 `edit_conflict`, los formularios multipart y la subida con progreso, el borrado múltiple y su restauración, el envío en nombre de otro miembro (`as_member_id`), el flujo de eventos detrás de una fábrica de `EventSource` y el error `TeamApiError { status, code, message, details }`. El subpaquete `@team-platform/client/react` agrega los hooks de TanStack Query. El panel lo usa con un alias de Vite y de TypeScript hacia las fuentes (`panel/src/lib/client.ts` crea su instancia); `panel/src/lib/queries.ts` ya no existe. Los tipos salen de `packages/client/openapi.json`, el contrato que sirve el servidor de pruebas, con `npm run gen:client` (`openapi-typescript`); `src/client-contract.test.js` falla si una ruta, un esquema o un código de error del servidor cambia y los archivos no se regeneran, y `packages/client/test/contract.test.ts` falla si una operación del contrato no está llamada por el cliente ni declarada como no llamada.
---

## §5. Compromisos acordados

> Decisiones donde una cualidad se sacrificó a favor de otra, con la razón explícita.

| Compromiso | A favor de | En contra de | Justificación |
| --- | --- | --- | --- |
| SQLite en vez de Postgres | Un contenedor, instalación trivial, respaldo de un archivo | Concurrencia de escritura alta, varias réplicas | Equipos de 3 a 10. El adaptador de base permite Postgres si un equipo lo supera (UD-010). |
| Confirmación del emisor en vez de publicación automática | Que nada mal categorizado llegue al equipo | Un paso más por input | UD-003. La maqueta ya lo dibuja. |
| Extraer a texto antes del modelo, en vez de PDF nativo siempre | Velocidad y costo; proveedores sin PDF | Figuras y layout de un PDF | UD-009. El PDF nativo queda disponible cuando el extractor devuelve poco texto (escaneado). |
| Haiku 5.5 por omisión, no DeepSeek | Un solo proveedor para texto, imagen y PDF; más barato por llamada en lista | Pesos abiertos | Investigación §3. DeepSeek queda a un cambio de configuración. |
| Cola propia en vez de librería | Sin dependencia frágil; lógica corta y medible | Reescribir reintentos y arriendo | Investigación §4. |
| Harness sin `--bare` para la suscripción | Reutilizar la cuenta de Claude Code ya pagada | 27k a 31k tokens de sistema por trabajo y arranque de proceso | UD-008. Se mide con `--output-format json`; el bucle propio sigue siendo la omisión. |
| Fotogramas propios + transcripción en vez de video nativo | Sin tercer proveedor | Menor fidelidad temporal que Gemini nativo | UD-008 («lo que salga más fácil»). Gemini queda configurable. |
| Panel estático servido por la API, sin Caddy | Un proceso | Sin TLS propio | `tailscale serve` o el proxy del anfitrión lo dan. |
| Compilación del panel con base relativa y base escrita por el servidor | Una imagen sirve `/`, `/team-a/` o `/team-b/` sin recompilar | El `index.html` se reescribe en cada petición (dos reemplazos sobre 646 bytes) | H-3721. La otra vía era una compilación por ruta, que obliga a construir la imagen por instalación. |
| Tema del anfitrión por hoja aparte (`THEME_CSS`) | Otro sitio cambia color, tipografía y radio sin recompilar | Sólo tokens; la estructura de las vistas no cambia | H-3721. Cambiar las vistas es reimplementarlas contra la API (§4.11). |

---

## §6. Interfaz y experiencia

**Atmósfera de referencia:** Y2K futurista (UD-013). Vidrio translúcido con reflejos, cromo y metal líquido, degradados iridiscentes, formas redondeadas, azul eléctrico sobre plata con acentos lima y lila. La tipografía es de la época, con licencia libre y empaquetada. Es un producto de 2026 que cita el 2000, con referencias fechadas y tokens en `panel/DISENO.md`. Nada muy loco. Manda la jerarquía visual (escala de tamaños, alineación a grilla, formas con intención, espacio negativo activo, distribución asimétrica donde corresponde) y una identidad reconocible. Los valores que delatan diseño generado por IA están prohibidos. En lo funcional, un programa de gestión estándar, no una web que conversa. Rótulos de una a tres palabras como sustantivos («Mensajes», «Equipo»), sin texto de ayuda por omisión y sin segunda persona. La única excepción es Configuración: cada ajuste lleva una línea impersonal de hasta 90 caracteres bajo su rótulo (`SettingHint`, UD-122). Densidad de una bandeja de entrada de correo de escritorio: todo lo que se necesita ahora cabe sin desplazarse; lo demás nace plegado. La maqueta manda en la disposición. Barra lateral de 256 px a la izquierda (UD-047). Cabecera «[Nombre] TEAM» con las tres marcas de estado y la campana. Contenido a la derecha.

**Edición y alto (UD-017):** todo texto editable se edita en el lugar (clic entra, clic afuera o Enter guarda, Escape cancela), con deshacer y rehacer visibles y por teclado, sin historial de versiones; cada vista cabe en una pantalla a 1440×900 y a 1280×720, con revelación progresiva (lo que se necesita ahora a la vista, lo demás plegado con su cuenta) y listas que paginan dentro del marco con un tamaño medido. Dos enmiendas. Con un envío abierto, Inicio puede desplazar la página; nunca lo hace una caja interna con scroll propio, salvo el texto largo de un original (UD-110). Configuración se desplaza como página y su texto largo crece con el contenido (UD-123).

**Flujo principal de la persona:**

1. Entra. Ve Inicio: el nombre del proyecto con la fecha, el compositor «Nuevo mensaje» y el desplegable de envíos (UD-046). El compositor es centrado, de bordes redondeados y con aire alrededor (UD-110), con clip (adjuntos), cámara (foto), micrófono (audio) y enviar. En todas las páginas, la barra superior muestra tres marcas con su número: abierto (rojo), respondido (amarillo) y cerrado (azul) (UD-100).
2. Escribe, pega una captura o arrastra un docx, y envía. La barra se vacía. Debajo se abre el desplegable (UD-046): a la izquierda el original (texto y adjuntos con su galería), a la derecha el bloque «Análisis», con una barra de progreso y la frase del paso en curso («leyendo el documento», «3 de 7 adjuntos»).
3. Al terminar, los mensajes ya están publicados (UD-070): no hay botón Enviar. Cada uno trae su área (insignia, cambiable), título, texto según la plantilla de esa área, destinatarios (chips, editables) y adjuntos (miniaturas, quitables), y su emisor lo edita en el lugar cuando quiera (UD-071).
4. Los mensajes aparecen en «Últimos mensajes». Quien los recibe los ve en su Inicio, filtrados para él por omisión, y cuentan en la marca de la barra superior que corresponde a su estado. El clic en una marca abre un desplegable anclado a ella con esos mensajes (título, área, quién, hora) y un enlace a Mensajes ya filtrado. El desplegable no tapa la página. Cada tarjeta muestra la insignia del área, el emisor, la fecha y la miniatura del adjunto principal.
5. Responde desde la tarjeta o desde Mensajes. El hilo crece debajo del mensaje. Cualquiera cierra; el estado se ve como insignia, nunca como prosa.

**Vistas** (barra lateral, en este orden; `idea.md` y UD-006):

| Vista | Qué muestra | Quién |
|---|---|---|
| Inicio | De arriba abajo (UD-046): nombre del proyecto y fecha (los estados pendientes viven en la barra superior, UD-100); «Nuevo mensaje» con la barra de texto; el desplegable en línea que se abre solo al enviar y muestra el original a la izquierda y el análisis a la derecha, con los mensajes ya publicados y editables por su autor (UD-070, UD-071); el análisis abre con la cuenta de mensajes («4 mensajes», y la de cada área con su chip si hay varias) y lista cada mensaje plegado en una fila de una línea (número, chip, título con puntos suspensivos, destinatarios), que un clic abre en el lugar con su texto, campos y acciones y otro clic pliega; todas empiezan plegadas (UD-257), y el selector de los envíos propios con su estado, con «Borrar» (el envío; sus mensajes quedan) y «Borrar todo» (el envío con sus mensajes) en el envío abierto, sin confirmación (UD-240, UD-253); «Últimos mensajes» y «Últimas respuestas» en dos columnas del mismo ancho y el mismo alto, que sigue al contenido de la más larga hasta el espacio disponible y entonces pagina; sin mensajes cada caja mide su encabezado y la línea vacía; en teléfono van una debajo de la otra (UD-253, H-3718) | Todos |
| Mensajes | Todos los mensajes del equipo como tarjetas (UD-150): línea de área, título y extracto de una línea cada uno, cortados con puntos suspensivos (UD-241), una línea de datos con el estado (forma, color y palabra) y la columna de acciones: el ícono de borrar (emisor o Editor, con Deshacer; UD-240), «Responder» y «Cerrar». Las filas que la persona puede borrar llevan una casilla; al marcar, una barra sobre la lista muestra «N marcados», «Marcar todos», «Cancelar» y «Borrar», que borra de una vez sin confirmación con Deshacer para todos; Escape desmarca (UD-253, H-3715). Filtros en la URL: para mí, para X, por área, por estado, respuestas, «Borrados» (UD-250: la tarjeta de un borrado lleva «Restaurar» y no enlaza a la ficha); búsqueda. La ficha agrega «Reenviar» (UD-272: una ventana con el miembro, todos los activos menos quien reenvía, y el «Motivo» obligatorio, con el botón apagado diciendo qué falta; en el hilo el reenvío es una franja «Reenviado a <nombre>» con el motivo debajo, no una respuesta), «Borrar» con Deshacer, el hilo (el texto de cada respuesta dibuja Markdown básico; las imágenes adjuntas se ven abiertas al ancho de la respuesta con su rótulo «Antes» o «Después», lado a lado en escritorio, y un clic las amplía; todas las respuestas una debajo de otra en orden, unidas por una línea vertical; pasadas cinco se ven la primera y las tres últimas y un control «N respuestas más» abre las ocultas; la última lleva más realce; el formulario va debajo y la persona responde sin elegir un tipo) con «Borrar respuesta» en cada respuesta propia (o en todas, para el Editor) y la edición en el lugar del texto de una respuesta por su autor, con «editada» junto a la hora y Deshacer (UD-253, H-3714), la galería de adjuntos (el emisor agrega con «Adjunto» y quita con «Quitar» el medio visible, con Deshacer al quitar) y el cierre con «Reabrir» | Todos |
| Áreas | Lista de áreas en filas de grilla: nombre, conteos de abiertos y respondidos en una columna fija a la derecha del nombre, color editable, «N plantillas» como enlace a `/areas/:id#plantillas` (UD-252), el ícono de borrar con Deshacer (UD-240), una casilla para borrar varias de una vez (UD-253) y descripción debajo. «Área» crea una; «Borradas», a su lado, agrega las borradas bajo las vigentes, apagadas, sin contadores y con «Restaurar» (UD-250). Cada área abre su vista (`/areas/:id`): sus mensajes primero, sin repetir el chip del área (UD-160), con el filtro por los tres estados y su conteo en la URL, «Borrar área» con Deshacer, la descripción plegada y las plantillas en un plegable abierto por omisión con «Borradas» dentro y casillas para borrar varias, con edición en el lugar (UD-041, UD-252). Sin mensajes dice «Sin mensajes en esta área» | Editor |
| Equipo | Miembros con su perfil, que se lee entero con «Ver más». Cada uno edita el suyo. El Editor usa «Agregar miembro», cambia nombre, correo y rol de los demás, desactiva o reactiva con Deshacer, y elimina a un miembro con un clic (UD-240, UD-253): «Eliminar» lo borra con todo su historial, sin confirmación, y el aviso da las cifras («Envíos 3 · Mensajes 5 · Respuestas 2»); quien quiera conservar el historial usa «Desactivar». Nadie se elimina a sí mismo. «Contraseña», en la fila de cada otro miembro y sólo para el Editor, abre en la misma fila un campo con «Guardar» y «Cancelar»; no aparece con identidad externa (UD-252) | Todos |
| Conexiones | API, MCP, correo, WhatsApp, GitHub Issues (UD-012). Ninguna existe todavía: se lista una vez, por nombre y sin estado por fila (UD-037; el título ya no lleva la razón, enmienda del 2026-10-21), con una sola entrada en la barra lateral | Editor |
| Configuración | Dos columnas que se desplazan como página (UD-123). Cuenta (nombre, correo, rol, idioma, contraseña), tema claro, oscuro o del sistema, descripción del proyecto en un editor que crece con el texto, y para el Editor «Publicación» (automática o manual, UD-070), «Telemetría de uso» (UD-091) y «Proveedores»: funciones con su proveedor y modelo, y conexiones con el estado y los últimos 4 caracteres de su clave, alta, reemplazo, retiro y diagnóstico (UD-120, UD-121). Cada ajuste lleva su `SettingHint`. Para el Editor, al final, «Datos» (UD-240, UD-252), «Cola» y «Auditoría» (UD-251). «Datos»: «Vaciar contenido» (`scope=content`), «Vaciar todo» (`scope=everything`), ambos con un clic, sin confirmación (UD-253), y las cifras de lo borrado, y «Sembrar ejemplos», que muestra «N envíos». «Cola»: conteo de trabajos por estado, «Purgar» con elección del estado, con un clic (UD-253), y la tabla de envíos de todos (`GET /api/inputs?all=1`) con emisor, estado, cuándo y segundos de análisis; cada fila con «Reprocesar», «Borrar» y «Traza» (árbol de spans con duración, tokens y costo, o «Sin traza»). «Auditoría»: lista inversa de `GET /api/audit` con filtro por acción. Junto al interruptor de «Telemetría de uso», con éste encendido, una línea de cifras de `GET /api/telemetry/ui-summary` | Todos |

**Componentes de interfaz:**

| Componente | Función | Archivo |
| --- | --- | --- |
| `Sidebar` | Navegación de 256 px, ocultable (UD-047), sobre una grilla de dos columnas por fila: el enlace y una columna de contador de ancho fijo (`--sidebar-count-col`) que termina en el mismo borde derecho y el mismo centro vertical en toda fila. Inicio, Mensajes, Áreas con cada área y su contador de abiertos, Equipo, Conexiones, Configuración y salida. Sin contenedor en los contadores; hover y foco iluminan la fila entera (UD-130) | `panel/src/components/Sidebar.tsx` |
| `NotifyBadge`, `StateMark`, `StateIcon` | Marca de estado: abierto rojo, respondido amarillo, cerrado azul, con forma, palabra y número. Es el mismo componente en la barra superior (sólo forma, color y número, con la palabra como nombre accesible, UD-100), en la barra lateral y en las tarjetas. El estado más alto se decide en `panel/src/lib/states.ts` y los conteos por área en `panel/src/lib/pending.ts` | `panel/src/components/NotifyBadge.tsx` |
| `ComposeBar` | Barra de nuevo mensaje con adjuntos, cámara, micrófono, enviar | `panel/src/components/ComposeBar.tsx` |
| `SendDrawer`, `InputPreview`, `PublishedPane` | Desplegable bajo la barra: original editable con su galería, análisis publicado y editable en el lugar, selector de envíos (UD-046) | `panel/src/components/SendDrawer.tsx` |
| `AreaChip`, `AreaColorPicker`, `lib/area-color.ts` | Chip de área, selector de un color y derivación del color secundario en OKLCH (UD-045) | `panel/src/components/AreaChip.tsx` |
| `AnalysisPanel` | Progreso por SSE, propuesta editable con área por mensaje, Enviar | `panel/src/components/AnalysisPanel.tsx` |
| `MessageTally`, `MessageFoldRow` | Cuenta de mensajes de un envío y fila plegada de cada uno, en la propuesta y en el envío publicado (UD-257) | `panel/src/components/MessageFold.tsx` |
| `MessageCard` | Tarjeta de alto fijo (UD-150, UD-241): título y extracto de una línea con puntos suspensivos y el texto entero como tooltip, una línea con el estado y el área, quién y cuándo, miniatura del adjunto principal y la columna de acciones con el ícono de borrar (UD-240). Un mensaje borrado lleva «Restaurar» en lugar de las acciones (UD-250). `hideArea` quita el chip en la vista de un área (UD-160) | `panel/src/components/MessageCard.tsx` |
| `ReplyThread` | Hilo lineal de respuestas con línea de tiempo, plegado del medio y formulario al pie | `panel/src/components/ReplyThread.tsx` |
| `MessagesList` | Lista con filtros y búsqueda | `panel/src/pages/Messages.tsx` |
| `AreasEditor` | Áreas y plantillas, edición en el lugar | `panel/src/pages/Areas.tsx` |
| `Team` | Miembros, perfil plegable, edición de lo propio, altas del Editor, «Eliminar» y «Contraseña» de otro miembro (UD-240, UD-252) | `panel/src/pages/Team.tsx` |
| `Page`, `FitList`, `FoldedText` | Marco de una vista sobre la grilla de 12 columnas, lista que pagina con un tamaño medido (UD-017) y texto largo plegado a su primer párrafo con «Ver más» | `panel/src/components/` |
| `Settings`, `SettingHint`, `ProjectEditor`, `PublicationSetting`, `UiTelemetrySetting` | Cuenta, tema, descripción del proyecto, publicación y telemetría, con su línea de explicación (tope de 90 caracteres en `ui-voice.test.ts`) | `panel/src/pages/Settings.tsx` |
| `ProviderSettings`, `ProviderConnections`, `ProviderKeyForm`, `ProviderRemoval`, `ProviderCheck`, `AddConnection` | Sección Proveedores: función, proveedor y modelo con prueba previa y reversión; conexiones con estado, últimos 4 de la clave, alta, reemplazo, retiro con bloqueo por dependencia y diagnóstico con causa clasificada y lista de modelos. La clave se borra del campo antes de salir la petición | `panel/src/components/Provider*.tsx`, `AddConnection.tsx` |
| `MessageDetail` | Un mensaje con su hilo y sus acciones: «Borrar» con Deshacer y, para el emisor, «Adjunto» y «Quitar» (UD-240, H-3707) | `panel/src/pages/MessageDetail.tsx` |
| `Login` | Inicio de sesión local | `panel/src/pages/Login.tsx` |
| `Header`, `StatusBar` | Cabecera «[Nombre] TEAM» de toda página: botón del panel lateral, las tres marcas de estado con su desplegable anclado (UD-100; Enter abre, Escape cierra y devuelve el foco, flechas recorren) y la campana, que sólo cuenta novedades. En teléfono las tres marcas se conservan, más angostas (UD-141). Sin cuadros por área ni palabra visible de estado | `panel/src/components/Header.tsx`, `StatusBar.tsx` |
| `FilterBar` | Filtros de Mensajes como chips en la URL | `panel/src/components/FilterBar.tsx` |
| `EditableText`, `EditableTags`, `MemberPicker` | Edición en el lugar de texto, dominios y destinatarios | `panel/src/components/` |
| `MediaGallery`, `MediaGalleryDialog`, `MediaOpener`, `AttachmentStrip` | Galería de medios: visor grande con tira de miniaturas, flechas, «2 de 5», teclado y deslizamiento en teléfono; tamaños `inline`, `compact` y `dialog`. Se reutiliza en la ficha, las respuestas, la lista, el original del desplegable de Inicio y la propuesta (UD-059) | `panel/src/components/MediaGallery.tsx` |
| `StatusBadge`, `Thumb`, `Avatar`, `SimulatedMark` | Estado como insignia, miniatura de adjunto, iniciales y marca «Servidor de ejemplo» con borde discontinuo cuando la propuesta viene del servidor doble (UD-180) | `panel/src/components/` |
| `Atmosphere`, `icons` | Fondo de la piel Y2K y juego propio de íconos | `panel/src/components/` |
| `Tray` | Selector de envíos dentro del desplegable de Inicio, con «Envío N», hora y estado (UD-025) | `panel/src/components/Tray.tsx` |
| `SelectionBar` | Barra de las filas marcadas: «N marcados», «Marcar todos», «Cancelar» y «Borrar», sin confirmación y con Deshacer (UD-253) | `panel/src/components/SelectionBar.tsx`, `panel/src/lib/selection.tsx` |
| `NoticeHost` | El aviso: centrado, se va solo (5 s, 8 s con Deshacer o enlace; se pausa con el puntero o el foco), sin botón de cerrar, Escape lo cierra; uno nuevo reemplaza al anterior (UD-253, H-3717) | `panel/src/components/NoticeHost.tsx`, `panel/src/lib/notices.tsx` |
| `DeleteSend` | «Borrar» y «Borrar todo» de un envío, sin confirmación (UD-253); se usa en el desplegable de Inicio y en la tabla «Cola» (UD-240) | `panel/src/components/DeleteSend.tsx` |
| `ShowDeleted` | Interruptor de una palabra que agrega lo borrado a una lista: «Borradas» en Áreas y en plantillas (UD-250) | `panel/src/components/ShowDeleted.tsx` |
| `DataReset` | Sección «Datos» de Configuración: vaciar contenido, vaciar todo y sembrar ejemplos (UD-240, UD-252) | `panel/src/components/DataReset.tsx` |
| `QueuePanel`, `TraceTree`, `PageControls` | Sección «Cola»: trabajos por estado, «Purgar», envíos de todos con «Reprocesar», «Borrar» y «Traza», y paginado (UD-251) | `panel/src/components/` |
| `AuditLog`, `UiSummaryLine` | Sección «Auditoría» con filtro por acción, y línea de resumen de la telemetría de interfaz (UD-251) | `panel/src/components/` |
| `ui/*` | Componentes de shadcn/ui sobre Radix: botón, diálogo, menú, popover, tooltip, insignia, campo | `panel/src/components/ui/` |

---

## §7. Especificación de módulos

### 7.1 API (`src/api/`)

**Propósito:** La única puerta (§4.11). Fastify 5 con esquema JSON de entrada y de salida en cada ruta. El contrato OpenAPI 3.1 sale de esos esquemas (`GET /api/openapi.json`, sin sesión) y una prueba falla si una ruta queda sin esquema de respuesta (HP-012). Todo cuelga de `/api` (`API_PREFIX`); `/health` además responde en la raíz para el sondeo de Docker. Las convenciones están en `src/contracts.md` §3. Los ids viajan como texto. Toda lista es `{ items, page, limit, total }` con tope de 100. Toda operación destructiva exige `?confirm=true`. Los cuerpos de error son `{ code, message }` en español, la unicidad responde 409 y las peticiones no seguras con sesión llevan la cabecera `X-Team-Request`.

**Interfaz** (el rol mínimo va entre paréntesis; sin marca, Miembro):

```
POST   /api/auth/login            { email, password } → sesión               (pública; proveedor local)
POST   /api/auth/logout                                                       (pública)
POST   /api/auth/dev-login        { email } → sesión                         (sólo con NODE_ENV=development)
GET    /api/auth/sso/start · /api/auth/sso/callback                           (sólo identidad delegada, modo sso-redirect)
GET    /api/me                    la persona con sesión y project_name

POST   /api/inputs                multipart: text, files[], links[], auto_publish, as_member_id (o JSON { text, links, auto_publish, as_member_id }) → { input_id, job_id, status, duplicate, restarted }; `as_member_id` envía en nombre de otro miembro persona activo (UD-255): el input y sus mensajes son de ese autor, `sent_by_id` guarda al de la sesión y la auditoría `input.create` lo registra como quien actuó; agente 400 `cannot_send_as_agent`, inexistente o desactivado 400 `send_as_invalid`
                                  `auto_publish=false`: este envío no se publica solo, queda `proposed` (UD-072; otro valor, 400 `auto_publish_invalid`)
                                  202 si el análisis queda en cola; 200 si el mismo contenido del mismo emisor ya existía (§1.3)
GET    /api/inputs?status=&mine=1&order=   los inputs propios, todos los estados, paginados; un publicado trae `messages` (UD-070)
GET    /api/inputs?all=1          (Editor) los envíos de todos, con `author_name`, paginados como los propios; un miembro recibe 403 (UD-251)
GET    /api/inputs/:id            input propio: adjuntos, estado, unidades y propuesta si existe
PATCH  /api/inputs/:id            { text } su emisor cambia el texto de un envío `proposed` o `failed` y lo vuelve a analizar; 409 `not_editable` o `duplicate_input`
PATCH  /api/inputs/:id/proposal   guarda la propuesta editada como borrador (su emisor, mientras esté `proposed`)
POST   /api/inputs/:id/publish    publica a mano la propuesta (la perilla `auto_publish` apagada, o `publish_blocked`) → mensajes creados
POST   /api/inputs/:id/cancel     también un análisis fallido
POST   /api/inputs/:id/restore    deshace el descarte: vuelve a propuesta (con sus ediciones) o a fallido; no reanaliza
DELETE /api/inputs/:id?confirm=true&with_messages=  borra el envío de verdad (su emisor o el Editor; UD-240): adjuntos, trabajos (cancela los que corren), eventos y propuesta → { input_id, deleted: { attachments, jobs, messages }, freed_bytes }
                                  sus mensajes publicados quedan con sus archivos (`input_id` nulo); con `with_messages=true` también se borran, con sus respuestas; sin restauración
POST   /api/inputs/:id/reprocess  vuelve a encolar el análisis conservando las extracciones: su emisor lo hace sobre un envío con propuesta, fallido o cancelado, el Editor sobre cualquiera. Un envío publicado sólo lo reprocesa un Editor (UD-258; 403 `forbidden` para su emisor): sus mensajes vivos pasan a la papelera con sus respuestas (borrado suave, restaurables, UD-240), la propuesta se descarta y el envío vuelve a `queued`, sin confirmación (UD-253); responde 202 con `set_aside: { messages, replies }`. Un envío en vuelo es 409 `not_reprocessable`

GET    /api/events                SSE por miembro (§7.10); ?job_id= lo acota a un trabajo

GET    /api/messages?for=me|id&involved=me&area=&status=&q=&replies=1&deleted=1   `deleted=1` lista sólo los borrados, los más recientes primero (UD-250): quien los escribió ve los suyos y un Editor todos; cada uno trae `deleted_at` y se restaura con `POST /api/messages/:id/restore`
GET    /api/messages/summary      lo que afecta a quien tiene la sesión por estado (`mine`: open, answered, total) y los mensajes de cada área por estado (`areas`: open, answered, closed, mine_open) (UD-028, UD-041)
GET    /api/messages/:id          mensaje, hilo, adjuntos y `sent_by_id` (UD-255; nulo si lo envió su autor); un borrado responde 404 (?include_deleted=true: Editor)
DELETE /api/messages/:id?confirm=true   borra en blando un mensaje publicado (su emisor o un Editor; otro, 403 `not_message_author`) · POST /api/messages/:id/restore lo devuelve (UD-240)
POST   /api/messages/delete?confirm=true  { ids }   borra en blando varios mensajes en una transacción, todos o ninguno (UD-253): 403 `not_message_author` con `ids` si alguno no es de quien pide y no es Editor; 404 con `ids` si alguno no existe o ya está borrado; hasta `list.pageMax` ids (100); una fila `message.delete` por mensaje · POST /api/messages/restore { ids } los devuelve igual (409 `not_deleted` con `ids` si alguno no está borrado)
DELETE /api/messages/:id/replies/:replyId?confirm=true   borra en blando una respuesta (su autor o un Editor; otro, 403 `not_reply_author`) y recalcula el estado del mensaje · POST /api/replies/:id/restore la devuelve (UD-240)
PATCH  /api/messages/:id/replies/:replyId  { body, version } el autor edita el texto de su respuesta; otro miembro, también el Editor, 403 `not_reply_author`; versión vencida 409 `edit_conflict`; borrada 404; vacía sin adjuntos 400 `reply_empty`; los adjuntos no cambian; bitácora `reply.edit` (UD-253)
GET    /api/attachments/:id/transcript  texto extraído de un audio o video (UD-059)
POST   /api/messages/:id/replies  { body, kind: answer|fix|clarification }   (el tipo `forward` sólo lo escribe `POST /api/messages/:id/forward`; 403 si quien responde es el emisor). El panel siempre envía `answer`, sin selector; `clarification` es la pregunta que un agente deja al traspasar a una persona (UD-269) y el panel la rotula «Pregunta»; `fix` queda en la API
PATCH  /api/messages/:id          { version, …campos } el emisor edita su mensaje; otro miembro, también el Editor, 403 `not_message_author`; versión vencida 409 `edit_conflict` (UD-071)
POST   /api/messages/:id/attachments  multipart { version, files[], links[] } agrega adjuntos a un mensaje propio (UD-071)
POST   /api/messages/:id/close · POST /api/messages/:id/reopen
POST   /api/messages/:id/forward  { member_id, comment } reenvía el mensaje a un miembro activo distinto de quien reenvía, persona o agente, con el motivo obligatorio (UD-272): el mismo mensaje suma al destinatario y el hilo gana una respuesta `forward` (`forwarded_to`, `body` el motivo); un respondido vuelve a `open`; con un agente se encola su `execute`. 400 `forward_comment_required`, `forward_to_self`, `assignee_inactive`; 404; 409 `message_closed`, `execute_busy`; auditoría `message.forward`

GET    /api/areas                 áreas con conteos y plantillas sin cuerpo   (?include_deleted=true: Editor)
POST   /api/areas · PATCH /api/areas/:id · DELETE /api/areas/:id?confirm=true · POST /api/areas/:id/restore      (Editor)
GET    /api/areas/:id/templates   plantillas con el archivo completo          (Editor)
POST   /api/areas/:id/templates · PATCH /api/areas/:id/templates/:templateId
DELETE /api/areas/:id/templates/:templateId?confirm=true · POST /api/templates/:id/restore                        (Editor)

GET    /api/members
POST   /api/members               alta de un miembro                          (Editor)
PATCH  /api/members/me            perfil, idioma y contraseña propios (`profile`: texto, tope en `members.profileMaxLength`)
PATCH  /api/members/:id            nombre, correo, rol, contraseña y `active`; `profile` responde 400 `validation` (UD-023)   (Editor)
DELETE /api/members/:id?confirm=true[&purge=true]   elimina de verdad (UD-240): sin historial, la fila con credenciales, sesiones e identidades; con historial 409 `member_has_history` con `{ inputs, messages, replies }`, y con `purge=true` también sus envíos, mensajes (con las respuestas de otros), respuestas (el mensaje ajeno vuelve a `open` si no quedan y no está cerrado), ediciones y asignaciones, y libera los archivos sin referencia → 200 `{ member_id, deleted }`; 409 `cannot_delete_self`, 409 `last_editor`; bitácora `member.delete`   (Editor)

GET    /api/settings/providers · PATCH /api/settings/providers                (Editor; nunca devuelve una llave; PATCH prueba antes de guardar, 422 `provider_check_failed`; UD-120)
POST   /api/settings/providers/:slot/check                                    diagnóstico de una función (Editor)
GET    /api/settings/connections · POST /api/settings/connections             proveedores con estado, últimos 4 de la clave y funciones que la usan; alta con prueba previa (Editor; UD-120)
PUT    /api/settings/connections/:name/key · DELETE …/key                     reemplazo con prueba previa; retiro (409 `provider_in_use` con `used_by`, 409 `key_from_environment`)
DELETE /api/settings/connections/:name · POST …/check                         eliminar un proveedor propio; diagnóstico con duración, causa y lista de modelos
GET    /api/settings/publication · PATCH /api/settings/publication   { auto_publish } (lee cualquier miembro, escribe el Editor; UD-070)
GET    /api/settings/project         { name, description, max_chars, name_max_chars } (cualquier miembro)
PATCH  /api/settings/project         JSON { name?, description? } o multipart con `file` (.md) para la descripción (Editor; topes PROJECT_NAME_MAX_CHARS y PROJECT_DESCRIPTION_MAX_CHARS, 413 al superarlos; un nombre vacío vuelve a PROJECT_NAME; bitácora `settings.project.update`; H-3722)
GET    /api/settings/analysis · PATCH /api/settings/analysis   { framing: { "es-419"?, en? } } encuadre del analizador por idioma: texto vigente, omisión y `custom` (Editor; tope ANALYSIS_FRAMING_MAX_CHARS por idioma, 413; vacío vuelve a la omisión; bitácora `settings.analysis.framing`; H-3722)
GET    /api/attachments/:id       archivo, con control de acceso y Range

GET    /api/jobs?state=           la cola de trabajos                         (Editor)
DELETE /api/jobs?state=&confirm=true   purga los terminados                   (Editor)
POST   /api/ops/seed?confirm=true  envía en proceso el juego de `ejemplos/` (Editor; UD-252): un envío por archivo o subcarpeta, a nombre de quien pide, por el análisis real; responde 202 `{ created, existing }`; costo real del juego completo, unos 0,01 USD con Claude Haiku 5.5; bitácora `data.seed`; Configuración, Datos, «Sembrar ejemplos»
POST   /api/ops/reset?confirm=true  { scope: content|everything } vacía los datos de prueba (Editor; UD-240). `content`: envíos, adjuntos, trabajos, propuestas, mensajes, respuestas y telemetría, y los archivos del volumen sin referencia; `everything`: además los otros miembros, y áreas y plantillas vuelven al juego inicial de `templates/`. Una transacción; bitácora `data.reset` con las cifras; responde las cifras por tabla y los bytes liberados. Por línea de comandos: `scripts/vaciar.mjs`; siembra de prueba por la API: `scripts/sembrar.mjs`
GET    /api/jobs/:id/trace        árbol de spans de un trabajo                (Editor)
POST   /api/telemetry/ui          lote de eventos de interfaz (cualquier miembro, cabecera X-Team-Request; 204)
GET    /api/telemetry/ui-summary?days=   percentiles por tarea y pantalla, tasas de error y abandono, peores recorridos   (Editor)
PATCH  /api/settings/telemetry    { ui_enabled }: interruptor de la telemetría de interfaz (Editor)
GET    /api/audit                 bitácora: quién creó, publicó, cerró, reabrió o editó, y cuándo   (Editor)
GET    /api/health · GET /health  público; el detalle de base, cola y proveedores, sólo al Editor
GET    /api/openapi.json          contrato OpenAPI 3.1
```

**Ajustes de la instalación** (tabla `settings`, clave y JSON; los escribe el Editor desde Configuración, no hay que tocar código ni reiniciar):

| Clave | Ruta | Omisión | Lo lee |
|---|---|---|---|
| `project_name` | `PATCH /api/settings/project` `{ name }` | `PROJECT_NAME` del entorno | `GET /api/me` (barra superior) y el analizador (`bundle.project.name`) |
| `project_description` | `PATCH /api/settings/project` `{ description }` | vacía | el analizador, en el sistema cacheado (UD-024) |
| `analysis.framing` | `PATCH /api/settings/analysis` | el párrafo de `src/analyze/prompts-es.js` y `prompts-en.js` | las instrucciones de sistema de clasificar, descomponer y el harness, en el idioma de la cuenta (§7.5) |
| `auto_publish` | `PATCH /api/settings/publication` | encendida | el worker al terminar el análisis (UD-070) |
| `telemetry.ui_enabled` | Configuración, Telemetría | encendida | `GET /api/me` (§7.10 ter) |
| proveedores y conexiones | `/api/settings/providers`, `/api/settings/connections` | el entorno | `src/providers/` (UD-120). Un proveedor compatible con OpenAI se da de alta con nombre, dirección base, clave y modelo, sin cambiar `src/domain/connections.js` |


**Quién puede qué sobre un mensaje** (UD-071):

| Acción | Emisor | Otro miembro | Editor que no lo emitió |
|---|---|---|---|
| Ver, filtrar y leer el hilo | sí | sí | sí |
| Editar (título, texto, campos, plantilla, área, destinatarios, adjuntos) | sí | 403 `not_message_author` | 403 `not_message_author` |
| Responder | no (403 `author_cannot_reply`), salvo la pregunta pendiente de un traspaso (UD-269) | sí | sí |
| Cerrar y reabrir | sí | sí | sí |
| Borrar y restaurar el mensaje (UD-240) | sí | 403 `not_message_author` | sí |
| Borrar y restaurar una respuesta (UD-240) | su autor | su autor; otro, 403 `not_reply_author` | sí |

Un input es siempre de su emisor: lo ve, lo cancela, lo restaura y lo edita sólo él (otro miembro recibe 404). Con «Enviar como» (UD-255) el emisor es el miembro elegido, no el de la sesión: las listas «mías», editar, cancelar y borrar siguen a ese autor; el panel arranca el desplegable en el miembro de la sesión y la ficha del mensaje muestra «enviado por» cuando son distintos. El Editor vuelve a encolar el análisis de cualquiera (`reprocess`), también el de un envío publicado, cuyos mensajes pasan a la papelera (UD-258), borra el envío de cualquiera (`DELETE /inputs/:id`, UD-240) y gobierna la perilla `auto_publish`. Borrar un envío es real y sin vuelta: el panel lo hace con un clic y el aviso lo informa (UD-253). Un adjunto que algún mensaje referencia no se borra con su envío, pierde el `input_id` (migración 0011: `attachments.input_id` admite nulo, `ON DELETE SET NULL`) y el mensaje lo sigue sirviendo a todo el equipo; el archivo del volumen se libera sólo cuando ninguna fila de `attachments` ni de `reply_attachments` lo nombra por `sha256` y ninguna subida en vuelo lo retiene (misma regla que `releaseBlobs`).

Un Miembro lee las áreas (con sus plantillas sin cuerpo) porque necesita nombrarlas y cambiarlas en la propuesta de su input (§6, paso 3). Escribirlas, leer el cuerpo de una plantilla y ver los proveedores son del Editor (HP-015).

**Dependencias:** `fastify`, `@fastify/multipart`, `@fastify/cookie`, `@fastify/static`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/swagger`, `@fastify/sse`, `ajv`.

### 7.2 Dominio y esquema (`src/db/`)

**Propósito:** Las tablas son la especificación. Identificadores en inglés (UD-005, UD-015). Las marcas de tiempo son enteros en milisegundos Unix (UTC) y la API las expone en ISO 8601; los spans van en nanosegundos.

```
members              id, email (único sin distinguir mayúsculas), name, role(member|editor), kind(person|agent; migración 0013, UD-254), profile (texto libre, UD-023; reemplaza a responsibilities y domains), created_at
members_agent_credentials  member_id (PK), sealed_value (AES-256-GCM con la bóveda), last4, created_at, rotated_at      (migración 0013; el secreto propio del agente)
credentials          member_id, password_hash, updated_at, failed_count, next_attempt_at        (proveedor local; espera exponencial por cuenta)
sessions             id (SHA-256 de la ficha), member_id, created_at, last_seen_at, expires_at
identity_links       provider, external_id, member_id, created_at                               (identidad delegada)
sso_nonces           nonce, created_at, used_at                                                 (modo sso-redirect; uso único)
areas                id, title (único entre las vigentes), description, position, color (migración 0008, UD-045), escalation_member_id (migración 0021, UD-269: quién decide en el área; NULL = el primer Editor activo), deleted_at
templates            id, area_id, name (único dentro del área entre las vigentes), description, body_markdown (archivo completo con su encabezado), updated_at, deleted_at
inputs               id, author_id, text, content_hash UNIQUE (incluye al emisor), status(queued|extracting|analyzing|proposed|published|failed|cancelled), error, error_code, keep_draft (0|1, UD-072), sent_by_member_id (migración 0014, UD-255: quien tenía la sesión al enviar en nombre del autor; NULL si es el autor), created_at, updated_at
  Transición de `inputs.status` (UD-258): `published → queued` sólo por `reprocessInput` del Editor, que en la misma transacción pone `deleted_at` a los mensajes vivos del envío (`messages.input_id`), borra la propuesta y escribe `input.reprocess` con `detail` { messages, replies, answered_or_closed, message_ids }: un mensaje que alguien ya cerró o respondió también se aparta. Las respuestas no cambian; vuelven con el mensaje (`restoreMessage`). El análisis nuevo publica mensajes nuevos con el mismo `input_id`.
attachments          id, input_id (nulo si el envío se borró y un mensaje conserva el adjunto; migración 0011), kind(image|video|audio|document|link), name, path (sha256 en el volumen; la URL si es un enlace), mime, size, sha256, extracted_text, extracted_at, extract_meta_json
proposals            input_id (PK), payload_json ({ messages:[{ area_id, template_id, … }], discarded }), units_json, created_at
messages             id, input_id, area_id, template_id, author_id, title, body, fields_json, status(open|answered|closed), created_at, updated_at, version (1 al publicar; +1 por edición), edited_at (NULL sin ediciones), closed_at, deleted_at (migración 0010, UD-240)
message_edits        id, message_id, member_id, at, version, fields_json (nombres de los campos que cambiaron, nunca sus valores)      (migración 0006)
message_assignees    message_id, member_id
message_attachments  message_id, attachment_id, position (el primero es el adjunto principal de la tarjeta)
replies              id, message_id, author_id, body, kind(answer|fix|clarification), created_at, deleted_at (migración 0010, UD-240), version (1 al responder; +1 por edición del autor), edited_at (NULL sin ediciones) (migración 0012, UD-253)
jobs                 id, kind(extract|analyze|execute), input_id, message_id (sólo `execute`; migración 0013), payload_json, status(queued|running|done|failed|cancelled), priority, attempts, max_attempts, run_at, lease_until, worker_id, last_error, created_at, finished_at
                     índice (status, priority DESC, run_at, id): reclamo en 23 µs (informe 03); índice (message_id)
                     marks_json (migración 0018): lo que la sesión informó con `team mark` en el intento en curso; se vacía al empezar cada intento
job_events           seq, job_id, kind(progress|done|message), member_id (destinatario; NULL = todo el equipo), percent, phrase, data_json, at     retención 7 días
settings             key, value_json, updated_at                                                (proveedor y modelo por ranura; nunca una llave)
provider_connections name, label, kind(anthropic|openai-compatible|groq-speech), custom, base_url, structured, sealed_value (AES-256-GCM), last4, key_updated_at, check_at, check_ok, check_cause, check_ms, created_at, updated_at      (migración 0009; la clave sólo sale sellada de la base y nunca por la API)
audit_log            id, at, member_id, action, entity, entity_id, detail_json
spans                trace_id, span_id, parent_id, name, kind, start_ns, end_ns, status, status_message, attributes_json, events_json; job_id y operation generadas      (migración 0002)
execute_runs         id, job_id, attempt (único con job_id), message_id, instance, trace_id, session_id, model, runner, machine, started_at, finished_at, tiempos en ms (queue_wait_ms, first_reply_ms, final_reply_ms, total_ms, create_ms, run_ms, destroy_ms, tools_ms, judge_ms, delivery_ms, wait_ms; NULL = desconocido), input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, turns, tool_count, subagent_count, outcome, error_code, delivered (0|1|NULL), delivery_held (0|1|NULL), transcript_ref, slowest_tools_json      (migración 0018, UD-262; sin claves foráneas; retención EXECUTE_RUNS_RETENTION_DAYS, 365)
llm_calls            VISTA sobre los spans de llamada a un modelo (`cost_usd` sale de `team.cost_usd`, estimado con `pricing.js`; NULL si el modelo no tiene precio, y el arranque avisa cuáles): id, job_id, provider, model, modality, input_tokens, output_tokens, cached_tokens, cost_usd, duration_ms, at, trace_id, status, error_type, step
```

Áreas y plantillas se borran en blando (`deleted_at`) y se restauran: los mensajes que las referencian no se pierden. Mensajes y respuestas también (UD-240): toda lectura ignora una fila con `deleted_at` (listas, conteos, búsqueda, hilo, resumen, acceso a adjuntos) y el estado del mensaje se recalcula con sus respuestas vigentes al borrar o restaurar una. Los estados de un mensaje se muestran en la interfaz como «abierto», «respondido» y «cerrado» (§1.1). Cada propuesta lleva el área y la plantilla en cada mensaje, no en la raíz (§7.5). No guarda un id de llamada a modelo: las llamadas son spans, enlazados al trabajo por `team.job_id` (§7.10 bis).

Un miembro `kind: agent` (UD-254, UD-255) es un integrante que trabaja mensajes con una sesión desatendida de Claude Code. Tiene perfil como cualquiera, nunca contraseña: `POST /members` con `kind: agent` y `password` responde 400 `agent_has_no_password`, y fijarle una contraseña después da 409 con el mismo código. Al crearlo, la respuesta trae `agent_secret` una sola vez. El secreto queda sellado en `members_agent_credentials`, no se guarda su hash porque la firma HMAC lo necesita en claro, y la API no lo vuelve a mostrar. El agente entra con la cabecera firmada `signed-header` (`X-Team-User`, `X-Team-Ts`, `X-Team-Sig`, HMAC-SHA256 de `ts.MÉTODO.ruta.correo`) con su secreto propio, sea cual sea `IDENTITY_PROVIDER`, y con la tolerancia de `DELEGATED_TS_TOLERANCE_SECONDS`.

**Dependencias:** `node:sqlite`. Las migraciones son archivos SQL numerados en `src/db/migrations/` (`0001_initial.sql` a `0013_execute_jobs_and_agent_members.sql`; `0002_telemetry.sql` es copia de `src/telemetry/migration.sql`). Sólo avanzan. Un ejecutor propio las aplica dentro de una transacción, lleva la cuenta en `PRAGMA user_version` y corre en el paso de inicialización único (§3). El ejecutor exige numeración contigua y se niega a arrancar si la base es más nueva que el último archivo. Antes de migrar una base existente deja un respaldo consistente.

### 7.3 Cola de trabajos (`src/queue/`)

**Propósito:** Desacoplar el procesamiento del navegador (UD-003) con el patrón de pg-boss sobre SQLite.

**Interfaz:**

```
enqueue(kind, payload, { priority, runAt })      → job_id
claim(workerId, leaseMs)                          → job | null
   BEGIN IMMEDIATE; UPDATE jobs SET status='running', worker_id=?, lease_until=?, attempts=attempts+1
   WHERE id = (SELECT id FROM <trabajos vencidos con su turno por persona> ORDER BY turn, priority DESC, run_at, id LIMIT 1)
   RETURNING *; COMMIT        (UPDATE … LIMIT 1 directo es error de sintaxis en SQLite)
heartbeat(jobId)                                  renueva el arriendo; progress(jobId, percent, phrase)
complete(jobId) · fail(jobId, error)              fail reencola con retroceso exponencial y jitter hasta max_attempts
recoverExpiredLeases()                            al arrancar y por ciclo
release(job)                                      devuelve el trabajo a la cola y reembolsa el intento (apagado)
defer(job, delayMs)                               aplaza sin gastar intento (presupuesto de audio)
cancel(jobId) · cancelForInput(inputId)           el dueño del trabajo lo nota por la barrera de intento
listJobs · purgeJobs · stats · sweepRetention     operación del editor y retención
```

Todo cambio de estado de un trabajo vale sólo si el trabajo sigue `running` con el mismo número de intento (barrera de intento). Un worker cuyo arriendo venció no cierra el intento de otro. `WORKER_MODE` elige `inline` (omisión: el worker corre en el mismo proceso que la API, un contenedor), `external` (segundo proceso de la misma imagen, `node src/worker.js`, tras `npm run db:init`) u `off`. Con proceso aparte, la API se entera de cambios por `PRAGMA data_version` (1,15 µs por consulta). Al apagar no se esperan los trabajos: se abortan, vuelven a la cola y el intento se reembolsa. La API cierra con `forceCloseConnections: true` porque un flujo SSE abierto cuelga `app.close()`. Perillas y fuentes en el informe 03: arriendo de 30 s con latido cada 10 s. `max_attempts` 3, y el reintento del SDK del proveedor en 0 si el banco muestra 429 en cadena, para que haya un solo punto de reintento. Retroceso desde 1 s hasta 60 s. Concurrencia 3, medida con ráfagas de 8 envíos contra Anthropic y Groq (`bench/burst.mjs`, `docs/investigaciones/mediciones/2026-10-21-concurrencia-de-la-cola.md`, UD-025). El reclamo reparte turnos por persona: los envíos de una persona se reclaman en el orden en que llegaron y las personas se turnan (los trabajos que ya corren de una persona cuentan como sus turnos usados). Duración máxima por trabajo de 900 s.

El trabajo `execute` (UD-254) lleva `message_id` en su columna y `{ message_id, member_id, requested_by }` (y `forward` cuando lo trajo un reenvío, UD-272) en `payload_json`. Se encola dentro de la transacción que publica o edita un mensaje, uno por cada agente activo entre sus destinatarios, y a mano con `POST /messages/:id/execute` (Editor; `member_id` opcional). Un mensaje no recibe un segundo trabajo para el mismo agente mientras haya uno en cola o corriendo (409 `execute_busy` por la vía manual). Aparece en la Cola junto a los demás. Su `max_attempts` es `EXECUTE_MAX_ATTEMPTS` (omisión 1, porque un segundo intento repite el gasto) y su duración máxima es `EXECUTE_TIMEOUT_MS` más tres veces `EXECUTE_KILL_GRACE_MS`, para que el ejecutor venza primero y alcance a destruir la máquina.

El trabajo `deliver` (UD-263) lleva `message_id` en su columna y `{ message_id, member_id, branch, round, output, execute_job_id, execute_attempt, requested_by, close_request, close_since }` en `payload_json`; `kind` admite `deliver` desde la migración 0019. Lo encola `execute` en la transacción que lo cierra, cuando termina con `outcome: done`, existe la rama y la instancia declara `EXECUTE_DELIVER_COMMAND`, y a mano `POST /messages/:id/deliver` (Editor). Un mensaje tiene una entrega en cola o corriendo a la vez (409 `deliver_busy` por la vía manual). Su `max_attempts` es `EXECUTE_DELIVER_MAX_ATTEMPTS` (omisión 2: la orden es idempotente y un trabajador caído la repite una vez) y su duración máxima es `EXECUTE_DELIVER_TIMEOUT_MS` más tres veces `EXECUTE_KILL_GRACE_MS`. Con código 75 se aplaza con `defer`, sin gastar intento. Aparece en la Cola junto a los demás, con `jobs.phase` en `deliverVerify` o `deliverDeploy` mientras corre.

### 7.4 Extractores (`src/extract/`)

**Propósito:** Convertir cada adjunto en texto o descripción antes del analizador, de forma determinista y medida.

| Tipo | Extractor | Salida |
|---|---|---|
| imagen | proveedor de visión: «describe todo lo que sea accionable para un equipo de software, textual». lado largo máximo de 2.576 px (informe 06). un HEIC o HEIF (foto de iPhone) se decodifica antes a JPEG con el `ffmpeg` de la imagen, imagen principal, teselas y rotación incluidas (UD-040), con un tope de 50 millones de píxeles leído de las cabeceras; uno dañado falla con `image_heic_unreadable` | texto |
| documento (pdf, docx, pptx, xlsx, txt, md) | `@hyzyla/pdfium` para PDF y `officeparser` para Office (informe 05); una página con menos de 30 caracteres sin espacios cuenta como escaneada (las escaneadas medidas dieron 0; la digital más pobre, 146) y sólo esas páginas van al proveedor en modo nativo, partiendo el PDF con `pdf-lib`; tope de 270.000 caracteres extraídos (100 páginas por 2.700) y de 100 páginas por llamada nativa | markdown o texto por página |
| audio | FLAC 16 kHz mono (1,83 MB por minuto; Opus a 32 kbps, 0,21 MB por minuto, queda como opción tras medir la tasa de error en español); trozos de 600 s con 5 s de solapamiento para el tope de 25 MB de Groq, fusionados por marca de tiempo; `verbose_json`, segmentos, `language=es`, `prompt` sólo de vocabulario. La cola lleva un presupuesto de audio de 7.200 s por hora (límite del plan de Groq: seis videos de 20 minutos por hora para todo el equipo) | texto con marcas de tiempo `mm:ss`, una línea por frase: los segmentos consecutivos se unen mientras el anterior no cierre oración (`.?!…`) y la pausa sea menor a 0,5 s, sin cruzar un trozo y con tope de 40 palabras (medición `2026-10-20-unidades-de-audio.md`) |
| video | `ffmpeg`: pista de audio → extractor de audio; un fotograma por segundo → dHash 64 bits, distancia 6 → a lo sumo 48 fotogramas de 720 px (JPEG calidad 4, 1.456 tokens y 60 KB cada uno, 69.888 tokens en total, bajo el escalón de precio de 100.000) elegidos por orden de cambio y reordenados en el tiempo → proveedor de visión en una sola llamada; los fotogramas que vuelven sin descripción se piden otra vez en una segunda llamada, y el que siga vacío se omite de la línea de tiempo (H-3713); transcripción (ya unida en frases) y fotogramas se intercalan por orden cronológico con su marca `mm:ss`. Tope 20 minutos y 2 GB | transcripción + descripción por fotograma, en una línea de tiempo |
| enlace | `undici` con `lookup` filtrado y revisión de IP literales (nada a redes privadas ni a `localhost`), `redirect: 'manual'` revalidando cada salto hasta 5, tope de 5 MiB en el flujo y 15 s; contenido principal con `@mozilla/readability` sobre `linkedom` (24 a 98 ms; `jsdom` duplica el tiempo) | markdown |

**Interfaz:** `extract(attachment, { providers, onProgress, signal }) → { text, meta }`. `meta` siempre trae `kind`, `warnings` y `elapsedMs`; `meta.calls` lista las llamadas a proveedores. Un fallo es un `ExtractError` con código estable y motivo en español (`document_too_large`, `video_too_long`, `image_heic_unreadable`, `link_blocked`, …). Se reintentan `link_timeout`, `link_fetch_failed`, `ffmpeg_killed` y `link_http_error` cuando el sitio contestó 408, 425, 429 o 5xx. El resto es una propiedad del adjunto y falla de inmediato. Cada extractor es un archivo; registrar uno nuevo es agregarlo al mapa por tipo. `createAudioBudget()` lleva el presupuesto de audio por hora y la cola aplaza el trabajo sin gastar intento cuando no hay cupo.

Los topes de tamaño por tipo se aplican en dos lugares: al subir (`src/config.js`, antes de encolar, 413) y al extraer (`src/extract/config.js`). La duración de un video (20 minutos) se comprueba al subir con `ffprobe`. Ambos rechazos llevan el código del extractor y no dejan filas, trabajo ni archivos. El tope de un documento es de 24 MiB en los dos lugares.

### 7.5 Analizador (`src/analyze/`)

**Propósito:** La mecánica central: de un input extraído a una propuesta MECE. Un contrato y dos implementaciones (UD-008).

**Interfaz:**

```
analyze(bundle, { providers, onProgress, config, analyzer }) → AnalyzeResult
bundle = { text, attachments:[{id, kind, name, extracted}], areas:[{id,title,description,position}],
           templates:[{id,area_id,name,description,body_markdown}], members:[{id,name,profile}], project:{name,description} }  -- project.description (UD-024) va en el sistema cacheado de las dos llamadas, tras el catálogo y la plantilla; profile: el texto completo, sin recortes (UD-023)
AnalyzeResult = { status:'ok', proposal, units, calls, stats }
              | { status:'refusal' | 'max_tokens' | 'invalid', step, errors, …, units, calls, stats }
Proposal = { messages:[{ area_id, template_id, title, body, fields, assignee_ids, attachment_ids, unit_ids, observed?, source? }], discarded:[{ unit_ids, reason }] }
```

**Encuadre** (H-3722): las instrucciones de sistema de clasificar, descomponer y el harness abren con un párrafo que dice de quién es la bandeja y qué suele traer un input. Es el ajuste `analysis.framing`, un texto por idioma, porque cada juego de instrucciones está escrito en su idioma (UD-018). Sin texto guardado vale el de omisión de `prompts-es.js` o `prompts-en.js` («Esta es la bandeja de entrada de un equipo de software pequeño…»). Lo cambia el Editor en Configuración, «Encuadre del análisis», y rige desde el análisis siguiente. Prueba: `src/analyze/framing.test.js`.

Un rechazo del proveedor, un corte por `max_tokens` y una salida inválida o con conflicto MECE tras el único reintento son estados del resultado, no excepciones. El trabajo del input falla sin reintento con ese `error_code` (`src/contracts.md` §1). `calls` trae una entrada por llamada al modelo (paso, proveedor, modelo, tokens, duración, resultado).

**`api` (omisión):** variante A de la investigación, dos llamadas con salida estructurada.

1. **Numerar.** `units.js` parte el texto extraído en unidades por su estructura, nunca por su significado (§4.2). Una unidad es una oración de un párrafo (`Intl.Segmenter`, locale `es`, con una lista de abreviaturas que ICU corta por error). También es unidad un elemento de una enumeración en línea, una viñeta o un tramo entre puntos y coma. Lo es además una línea de la descripción de una imagen o un fotograma. Una enumeración en línea es «1) … 2) …» o «a) … b) …», y sólo cuenta si empieza en 1 o en «a» y sube de a uno. En un chat cada línea es un párrafo. Una transcripción de audio o video no baja a oración: cada segmento con su marca `mm:ss` es una unidad. El entero de la unidad es lo que se cita; el rótulo (`p3.s2`) queda en `units[].label`. Antes de bajar a oración, un mensaje de chat de cuatro puntos era una sola unidad y salía como un solo mensaje (REG-001). Cada unidad lleva su tipo, `voice`, `frame` o `text`, tomado de la fuente y de la etiqueta que escribe el extractor de video, nunca de lo dicho (H-3730).
2. **Clasificar** (esfuerzo `high`, razonamiento adaptativo; UD-260). Con los títulos y descripciones de áreas y plantillas, reparte las unidades en grupos `{ unit_ids, requests, recap_unit_ids, area_id, template_id }` de un solo pedido cada uno: `requests` lista los pedidos que el modelo ve en el grupo y la validación pide exactamente uno. Un pedido nace de la voz o del texto del autor. Cuando el autor habla o escribe, un grupo hecho sólo de fotogramas es un error de forma, y si el reintento no lo arregla va a `discarded`. Cada fotograma pasa al grupo del segmento de voz que suena en su minuto (H-3730). `split_at` declara las unidades de voz que empiezan con el final de la frase anterior: el sistema comprueba que las palabras estén en la unidad y las pasa a la unidad de voz previa, sin cambiar ids ni tiempos. Una unidad que sólo cierra pedidos ya dichos va en `recap_unit_ids` del grupo del pedido que cierra; un grupo hecho sólo de cierres se une a ese grupo (H-3731). Lo que no pide ni informa nada va en `discarded`. Un mismo input trae un error, una idea y una pregunta y cada mensaje va en su área (`idea.md`). `area_id` y `template_id` son `enum` de los ids existentes. `unit_ids` va primero en el esquema, para que el modelo ancle el grupo a su evidencia antes de decidir la categoría. Si el input supera el umbral de partición se clasifica por trozos estructurales y los grupos se unen.
3. **Descomponer** (esfuerzo `low`, pensamiento apagado), una llamada por grupo y en paralelo, con el cuerpo de la plantilla del grupo. Devuelve los mensajes del grupo, cada uno con `unit_ids`, título, campos de la plantilla, cuerpo, destinatarios y adjuntos. Su esquema no tiene `discarded`. Cada mensaje es un pedido: lo que un fotograma muestra y nadie dice va en `observed` («Observado, no dicho»), fuera del cuerpo, y `resumes_at` declara dónde vuelve la persona al mismo pedido. Las unidades de voz y texto de un mensaje forman un tramo o cada tramo siguiente está declarado; si el reintento no lo declara se conserva el borrador. Un mensaje hecho sólo de fotogramas, cuando el autor habla o escribe, se une al mensaje siguiente y su título pasa a `observed`. `source: "frame"` lo pone el sistema cuando todas las unidades del mensaje son de imagen o fotograma (UD-021). El único lugar donde se descarta es la clasificación, porque sin pensamiento el modelo usaba `discarded` para datos que ya había pasado al cuerpo del mensaje. Un grupo que vuelve sin mensajes cuenta como salida inválida y se reintenta una vez. **Una funcionalidad es un mensaje** (UD-274): los pasos, requisitos, criterios de aceptación o restricciones de una misma funcionalidad o de un mismo defecto van juntos en el cuerpo de un solo mensaje, con la lista numerada tal como la escribió la persona; sólo es mensaje aparte lo que se puede decidir, asignar o entregar por separado, y en la duda se publican menos mensajes. La clasificación, el chequeo de división y la descomposición lo dicen en sus instrucciones; el sistema no cuenta ni parte mensajes por el texto. Caso de regresión: `bench/cases/10-funcionalidad-en-pasos` (uno, a lo sumo tres).
4. **Rescatar.** Con las unidades de cada grupo, el sistema calcula por aritmética de conjuntos dos cosas. Un solape es una unidad en dos mensajes. Un hueco es una unidad en ninguno. No lee prosa. Si hay conflicto, un único pase de rescate sobre esas unidades; sin autoconsistencia por omisión (veinte muestras mejoran 0,4 %, informe 02).
5. **Reducir y validar.** Los grupos son disjuntos por unidad, así que la reducción es una concatenación determinista por `unit_ids`, sin llamada. La propuesta completa se valida otra vez sobre la unión de todos los grupos.

**Perillas** (`src/analyze/config.js`; cada una lleva su fuente en el código):

| Perilla | Omisión | Fuente |
|---|---|---|
| `classifyEffort` | `high` | UD-260 y medición 2026-10-22 (`docs/investigaciones/mediciones/2026-10-22-analisis-de-videos-2.md`): con esfuerzo alto y razonamiento, la clasificación de dos videos reales recoge los siete pedidos en tres corridas de tres; sin él, en dos de tres. Cuesta unos 40 s más por envío |
| `decomposeEffort` | `low` | Medición 2026-10-20 (`docs/investigaciones/mediciones/2026-10-20-primera-corrida-real.md`). El informe 02 fijaba `medium` para descomponer hasta que el banco mostrara que `low` conservaba la cobertura. Con la clasificación en un punto por grupo la conserva y baja cada llamada de 6 a 12 s a 1 a 3 s |
| `classifyThinking`, `decomposeThinking` | `disabled` | La misma medición. Con `low` y pensamiento adaptativo el caso de cuatro puntos tardaba de 5,9 a 9,1 s; con `low` sin pensamiento, de 3,3 a 3,6 s (cinco corridas de cinco con las cuatro áreas correctas) |
| `partitionConcurrency` | 16 | La misma medición, sobre el docx de 40 puntos (40 grupos): 4 a la vez, 26 s; 8, 16 s; 16, 10,5 s, sin errores 429. El límite de tasa de otra cuenta puede obligar a bajarlo |
| `maxTokens`, `maxTokensRetry` | 16.000 y 32.000 | Provisional (informe 02 §10.2); el corte reintenta una vez con el doble. El banco fija el p95 real |
| `invalidOutputRetries`, `rescuePasses` | 1 y 1 | Informe 02 §3.1 y §10.2 |
| `partitionThresholdTokens`, `charsPerToken` | 100.000 y 3 | Provisional: frontera de precio de Haiku 5.5 y estimación de tokens por carácter; el banco los calibra |
| `cacheTtl`, `minCacheableSystemTokens` | `5m` y 512 | Informe 02 §7. Medición 2026-10-23 (`docs/investigaciones/mediciones/2026-10-23-tokens-y-cache.md`): 1 hora conviene desde unos 0,6 envíos por hora sostenidos; los envíos medidos van separados por 1 a 3 horas, así que sigue en 5 minutos. Se cambia con `ANTHROPIC_CACHE_TTL` |

Si el input supera el umbral de partición, se parte sólo por fronteras estructurales en trozos disjuntos por unidad. Los trozos se procesan en paralelo y la reducción es la misma concatenación. Un monólogo transcrito no se parte. El esquema de salida de cada plantilla se compila una vez. Se calienta por evento al guardar una plantilla (`warmTemplate`) o al cambiar el catálogo de áreas (`warmCatalog`). La gramática compilada se cachea 24 horas desde el último uso.

**`harness`:** el mismo bundle se escribe en un directorio de trabajo vacío y propio (`input.md`, `bundle.json`, `templates/<id>.md`); `claude -p --output-format json --json-schema <Proposal>` con sólo la herramienta de lectura; se lee `structured_output`, `usage` y `total_cost_usd`. Sin `--bare` para que use la suscripción [V]. Mismo validador de salida que `api`. Medido el 2026-10-21 sobre `01-chat-grupo` con `claude` 2.1.284: 36,9 s (23,9 s de modelo), 6 turnos, cobertura 100 %, validador aceptó sin reintento; `api` tarda 4,4 s en el mismo caso (`docs/investigaciones/mediciones/2026-10-21-harness-real.md`). En el contenedor se instala con una imagen derivada y la credencial viaja en `CLAUDE_CODE_OAUTH_TOKEN` del `.env` (`docs/INSTALACION.md`). La repetibilidad entre corridas del harness no está medida.

**Validación (sistema, no modelo), con una instancia propia de Ajv**, porque los esquemas de respuesta de Fastify convierten tipos y descartan propiedades (informe 03). Se comprueba que el área y la plantilla existen y se corresponden. Cada `assignee_id` debe ser un miembro y cada `attachment_id` debe pertenecer al input. Cada `unit_id` debe existir y cada unidad debe estar en un mensaje o en `discarded`. Cada campo obligatorio de la plantilla debe estar presente y ningún mensaje queda vacío. Una salida inválida reintenta una vez con el error como contexto; después el trabajo falla con el motivo visible. Un `refusal` no se reintenta igual y un corte por `max_tokens` reintenta una vez con el doble. El proveedor de respaldo (`TEXT_FALLBACK_*`) se informa en `GET /health` y recibe una vez la llamada que el principal rechazó (`refusal`) o que falló por red o 5xx tras sus reintentos; `llm_calls` registra el proveedor que respondió.

**Spans.** Un span `analyze` por análisis (`team.analyzer`, `team.status`, `team.units`, `team.messages`) con hijos `classify` (`team.groups`), `decompose` por grupo (`team.group_index`, `team.area_id`, `team.template_id`, `team.units`), `rescue` (`team.overlaps`, `team.gaps`), `validate` (`team.valid`, `team.error_count`, `team.errors`) y, en el harness, `harness`. Las llamadas a proveedores cuelgan de esos spans (§7.10 bis).

**Medición vigente** (2026-10-20, Haiku 5.5, una cuenta y una máquina). El mensaje de chat de cuatro puntos sale en cuatro mensajes con su área en 3,3 a 3,6 s. En el banco de siete casos, seis tienen mediana de 3,0 a 7,4 s y el docx de 40 puntos 10,5 s. La cobertura es 100 % en seis casos y 90 % en el monólogo (`03-monologo-prueba`), que no alcanza MECE en ninguna repetición. Detalle y lo no resuelto en la medición citada.

#### Ejecución (`src/execute/`)

El trabajo `execute` (UD-254, UD-255, H-3724) corre una sesión desatendida de Claude Code que trabaja un mensaje asignado a un miembro agente. `EXECUTE_RUNNER` elige dónde corre:

| Valor | Dónde corre |
|---|---|
| `local` (omisión) | `claude -p` en esta máquina (`EXECUTE_CLAUDE_BIN`), en un worktree de `EXECUTE_REPO_DIR` con la rama `tp/<message_id>`, o en el directorio del trabajo si no hay repositorio |
| `machine` | Una máquina que el anfitrión crea por trabajo con tres órdenes de shell. Team Platform no conoce ningún proveedor de nube |

Las órdenes de `machine` llevan marcadores que el trabajador reemplaza por su valor entre comillas simples de shell:

| Variable | Marcadores | Qué hace |
|---|---|---|
| `EXECUTE_MACHINE_CREATE` | `{job_id}`, `{workdir}` | Crea la máquina y sale con 0. Su última línea de stdout es el nombre de la máquina, `{machine}`; vacía, `team-job-<job_id>` |
| `EXECUTE_MACHINE_RUN` | `{job_id}`, `{workdir}`, `{machine}` | Copia `{workdir}` a la máquina, corre ahí `bash run.sh` y devuelve su stdout, que es el NDJSON de la sesión |
| `EXECUTE_MACHINE_COLLECT` (opcional) | `{job_id}`, `{workdir}`, `{machine}` | Copia la transcripción de la sesión fuera de la máquina y escribe como última línea no vacía de stdout la ruta o la clave del objeto donde la dejó; esa línea queda en `execute_runs.transcript_ref`. Corre después de RUN y antes de DESTROY, también si la sesión falló o venció; no corre si CREATE falló ni si el trabajo se abortó. Un código distinto de 0 o sin salida deja la referencia vacía y no falla el trabajo. Sin la orden no pasa nada |
| `EXECUTE_MACHINE_DESTROY` | `{job_id}`, `{workdir}`, `{machine}` | Destruye la máquina. Corre siempre: al terminar bien, al fallar, al vencer `EXECUTE_TIMEOUT_MS`, al abortarse el trabajo y cuando CREATE falló a medias |

`{workdir}` contiene `run.sh` (la invocación), `env.sh` (modo 600; lleva el secreto del agente), `prompt.md` y `bin/team`. El plazo `EXECUTE_TIMEOUT_MS` cubre CREATE y RUN juntos. Al vencer, el trabajador manda SIGTERM al grupo de procesos que lanzó y SIGKILL tras `EXECUTE_KILL_GRACE_MS`; nunca señala a otro proceso. Con `EXECUTE_RUNNER=machine` la instancia no arranca si falta una de las tres órdenes.

La invocación:

```
claude -p --model <EXECUTE_MODEL> --effort <EXECUTE_EFFORT> --max-budget-usd <mín(EXECUTE_MAX_BUDGET_USD, saldo del día)> --max-turns <EXECUTE_MAX_TURNS>
  --permission-mode bypassPermissions --output-format stream-json --verbose --include-partial-messages
  --json-schema <esquema>
```

| Variable | Omisión |
|---|---|
| `EXECUTE_MODEL` | `claude-sonnet-5-5` |
| `EXECUTE_EFFORT` | `medium` |
| `EXECUTE_MAX_BUDGET_USD` | 10 |
| `EXECUTE_DAILY_BUDGET_USD` | 10 |
| `EXECUTE_MAX_MACHINES`, `EXECUTE_CAPACITY_WAIT_MS` | 0 (sin tope), 30000 | Máquinas vivas a la vez en este proceso y espera antes de buscar otra. Con `EXECUTE_MACHINE_CREATE` saliendo con 75 el trabajo espera sin gastar intento. 2026-10-22: una cuota de 8 núcleos hizo fallar 21 trabajos de 23 porque cada uno intentó su propia máquina |
| `EXECUTE_MACHINE_COST_USD` | 0 |
| `EXECUTE_MAX_TURNS` | 60 |
| `EXECUTE_MAX_SUBAGENTS` | 3 |
| `EXECUTE_TIMEOUT_MS` | 3.600.000 |
| `EXECUTE_RUNS_RETENTION_DAYS` | 365 |
| `EXECUTE_DELIVER_COMMAND` | vacía (sin entrega aparte) | Orden de shell del anfitrión que entrega la rama a producción (ver «La entrega aparte») |
| `EXECUTE_DELIVER_TIMEOUT_MS` | 900.000 | Plazo de la orden de entrega. Cortesía declarada: acota una verificación o un despliegue colgado |
| `EXECUTE_DELIVER_RETRIES` | 1 | Veces que una verificación fallida vuelve a Claude. Con 0, el primer fallo se informa |
| `EXECUTE_DELIVER_MAX_ATTEMPTS` | 2 | Intentos del trabajo `deliver`; el código 75 no gasta ninguno |

Tope diario de gasto (UD-256). Antes de correr, el trabajo suma el día: `jobs.cost_usd` de los trabajos `execute` que corrieron (el `total_cost_usd` de su línea `result`) más `EXECUTE_MACHINE_COST_USD` por cada uno con runner `machine`. El día es el día local del servidor, según `TZ` (UTC si no está fijada), y un trabajo cuenta en el día en que empezó. Saldo = `EXECUTE_DAILY_BUDGET_USD` − suma. Con saldo ≤ 0 el trabajo vuelve a la cola hasta la medianoche siguiente sin gastar su intento, con el paso `budgetWait` («En espera: tope diario de gasto»), y `claude` no se llama. Con saldo, `--max-budget-usd` es el menor entre `EXECUTE_MAX_BUDGET_USD` y el saldo, redondeado a centavos. El anfitrión fija `EXECUTE_MACHINE_COST_USD=0.07`.

**La entrega aparte (UD-263).** Con `EXECUTE_DELIVER_COMMAND` declarada, `execute` termina al empujar la rama `tp/<message_id>` y devolver su `summary` y su `outcome`. Si el resultado es `done` y la rama existe, no publica todavía la respuesta final: encola un trabajo `deliver` que lleva la salida de la sesión. La máquina ya está destruida cuando `deliver` corre. Ese trabajo ejecuta la orden en el host del trabajador, sin IA, y publica **una** respuesta final cuando termina. La rama existe si `EXECUTE_REPO_DIR` la tiene (localmente o en `origin`); sin `EXECUTE_REPO_DIR` la orden de entrega es la que la busca y avisa. El resultado `investigated`, `blocked` o `needs_decision` se responde desde `execute`, sin entrega. Sin `EXECUTE_DELIVER_COMMAND` todo ocurre como antes: `execute` publica su respuesta final y la sesión entrega por las reglas del anfitrión.

| Elemento de la orden | Contrato |
|---|---|
| Marcadores | `{message_id}`, `{job_id}`, `{branch}`, `{workdir}`, entre comillas simples de shell. `{workdir}` es un directorio vacío que se borra al terminar |
| Entorno | `TEAM_MESSAGE_ID`, `TEAM_JOB_ID`, `TEAM_BRANCH`, `TEAM_WORKDIR`, `TEAM_DELIVER_ROUND` (0 la primera vez), `TEAM_DELIVER_ATTEMPT` |
| Dónde corre | `/bin/sh -c` en el host del trabajador, con su directorio de trabajo. Sin IA y sin máquina |
| Código 0 | Quedó en producción. La última línea no vacía de stdout es la referencia (un commit, una URL o una etiqueta, hasta 500 caracteres) |
| Código 75 | No puede ahora. El trabajo espera `EXECUTE_CAPACITY_WAIT_MS` y vuelve a correr sin gastar intento |
| Código 76 | No se entrega sola: espera la revisión de una persona (UD-266). La última línea de stdout es el motivo. No se reintenta ni vuelve a Claude; el trabajo termina `done` con `delivered = 0` y `delivery_held = 1` |
| Otro código | Fallo. Su stdout y su stderr son el motivo (`jobs.last_error` y, para Claude, el final de la salida) |
| Plazo | `EXECUTE_DELIVER_TIMEOUT_MS`. SIGTERM al grupo de procesos que lanzó el trabajador y SIGKILL tras `EXECUTE_KILL_GRACE_MS`. Es un fallo que no vuelve a Claude |
| Fases | Las líneas `##team phase verify` y `##team phase deploy` de stdout mueven el progreso a `deliverVerify` (0 %) o `deliverDeploy` (50 %). Sin ellas queda en `deliverVerify` |
| Repetición | Debe poder correr dos veces sobre la misma rama |

Entorno de la orden. Además de `TEAM_JOB_ID`, `TEAM_MESSAGE_ID`, `TEAM_BRANCH`, `TEAM_WORKDIR`, `TEAM_DELIVER_ROUND` y `TEAM_DELIVER_ATTEMPT`, lleva `TEAM_OUTPUT_JSON`: la salida estructurada de la sesión sin `summary`, en JSON compacto. La plataforma no conoce zonas; el anfitrión decide con esos campos (UD-266). Con el código 76 la respuesta al autor es el `summary`, un párrafo llano («El cambio está listo y espera la revisión de una persona antes de entrar a producción: <motivo>. Queda guardado en la rama.») y `outcome: needs_decision`.

Respuestas al autor. En verde, la respuesta final es el `summary` de la sesión con «Ya está en producción.» al final de su último párrafo. Debajo va el resto de la salida estructurada, con la referencia bajo «Entrega». Si la verificación falla (código distinto de 0 y de 75) y quedan vueltas de `EXECUTE_DELIVER_RETRIES`, se encola un `execute` nuevo. Su prompt lleva el bloque `delivery_failure` con el final de la salida (6.000 caracteres). Esa pasada continúa desde la rama y no envía primera respuesta. Si termina en `done`, encola otra entrega. Si la entrega falla otra vez, venció el plazo o la lanzó un Editor a mano, la respuesta final es el aviso llano. Dice que no pasó la verificación (o que no terminó a tiempo) y en qué rama queda guardado el trabajo. Lleva `outcome: blocked`. La salida de la orden no se muestra al autor.

La fila de `execute_runs` de la ejecución que entregó recibe `deliver_job_id`, `delivered`, `delivery_ms`, `delivery_ref` (migración 0019) y `delivery_held` (migración 0020: 1 con el código 76, con `delivered = 0`; `GET /ops/execute-runs/summary` cuenta `delivery.held` aparte de `delivered` y de los fallos, y `known` no lo incluye) y `final_reply_ms` medido hasta la respuesta de la entrega. El span `execute.deliver` lleva `team.branch`, `team.exit_code`, `team.delivery_ms` y `team.delivery_ref`. `GET /messages/:id/timing` muestra la entrega en curso como la fase del mensaje y, al terminar, como la fase `deliver`. `team mark delivery` sigue valiendo para las instancias sin entrega aparte.

El esquema es `compileOutputSchema` de la plantilla del mensaje (§7.9, H-3723), con `outcome` y `summary` obligatorios. Sin bloque `output`, el esquema exige sólo `summary`. La salida se valida después con el esquema de validación de A4 (`validation: true`). Una plantilla cuya salida no compila falla el trabajo con `template`.

El prompt va por stdin. Sus bloques con nombre:

| Bloque | Contenido |
|---|---|
| `project_description` | Descripción del proyecto |
| `your_profile` | Perfil del agente |
| `sender` | Nombre y perfil de quien envió |
| `message` | Id, área, título, cuerpo y campos del mensaje |
| `template` | La plantilla completa |
| `host_instructions` | El archivo de `EXECUTE_HOST_INSTRUCTIONS`, si está declarado |

Siguen las reglas de trabajo. La sesión paraleliza lo independiente con hasta `EXECUTE_MAX_SUBAGENTS` subagentes a la vez. Trabaja en la rama `tp/<message_id>` y nunca empuja a `main`. Corre las verificaciones del repositorio. Con `EXECUTE_DELIVER_COMMAND` termina al empujar la rama. El prompt agrega la sección «Delivery» después del bloque `host_instructions`, con precedencia sobre él. Esa sección dice que la entrega la hace el sistema y que la sesión no despliega ni espera un despliegue. El texto de `EXECUTE_HOST_INSTRUCTIONS` sigue siendo del anfitrión. Envía dos respuestas: la primera al empezar, con `team reply`. La final es `summary` de la salida estructurada: un par de párrafos sin jerga, dirigidos a quien envió y en su idioma. Después va la salida de `team --help` y, al final, el bloque `host_instructions`, que prima sobre las reglas anteriores. `EXECUTE_HOST_INSTRUCTIONS` es la ruta a un archivo `.md` del anfitrión con sus reglas. Se lee en cada trabajo. Un archivo ausente o ilegible falla el trabajo con `host_instructions_missing`.

La sesión tiene `team` (`scripts/team.mjs`) en su PATH, autenticado como el agente con `TEAM_URL`, `TEAM_AGENT_EMAIL` y `TEAM_AGENT_SECRET`. Sus órdenes son `show`, `reply`, `progress`, `mark`, `timing` y `close`.

Cada línea NDJSON se traduce en progreso (§7.10). La línea `result` cierra el trabajo:

| `result` | Efecto |
|---|---|
| `structured_output` válido contra el esquema, sin entrega aparte | La respuesta final del agente en el hilo: `summary` y debajo el resto de la salida, cada campo con el rótulo de la plantilla y `outcome` como «Resultado». El trabajo queda `done` |
| `structured_output` válido con `outcome: done` y `EXECUTE_DELIVER_COMMAND` declarada | El trabajo queda `done`, no se publica la respuesta y se encola `deliver` con la salida |
| `outcome: needs_decision` o `not_mine` (válidos), o entrega retenida | Traspaso a una persona (UD-269, abajo): la respuesta queda como `clarification` y el mensaje pasa `open` a quien decide en el área |
| `needs_decision` sin `decision_check` válido | `failed` con `invalid_output`; no llega a ninguna persona |
| Sin `structured_output`, o inválido | `failed` con `invalid_output` y el motivo |
| `is_error` | `failed` con `execute_error` |
| Sin línea `result` | `failed` con `execute_no_result` |
| Plazo vencido | `failed` con `execute_timeout` |

El span `execute` de la traza del trabajo lleva `team.session_id`, `team.cost_usd` (el `total_cost_usd` de la sesión), `team.turns`, `team.runner`, `team.model`, `team.machine` y `team.machine_destroyed`, más la llamada `gen_ai.*` con el uso de tokens.

**Capturas** (UD-268, `src/execute/captures.js`, `checkCaptures` en `scripts/team.mjs`). Cada captura es `{ path, alt, masked, place, as }`. `path` es un archivo dentro de `$TEAM_CAPTURES_DIR` (el directorio `captures/` del trabajo); `alt` es una línea; `masked` dice si la herramienta ocultó los datos; `place` es la ruta o el menú de la vista; `as` es la clínica y el rol con que se miró. La primera respuesta la publica la sesión con `team reply --captures <lista|archivo> [--zone <zona>]` (multipart a `POST /messages/:id/replies`, después de mirar; los archivos son los «Antes»). La respuesta final sale de la salida estructurada, que acepta el campo opcional `captures`. Ese campo no entra en el texto de la respuesta ni en `TEAM_OUTPUT_JSON`. El trabajador valida y guarda los archivos en el volumen antes de borrar el directorio del trabajo. La respuesta final (o la de la entrega) adjunta los «Antes» de la última respuesta de la sesión que los trae, sin copiarlos, y los «Después», con una línea `**Después**: <alt>. <place>, <as>.` por captura. El adjunto se llama «Antes - <alt>» o «Después - <alt>» (`Before` y `After` en inglés). Validación: PNG, JPEG o WebP por sus primeros bytes; ruta real dentro del directorio; tamaño hasta `UPLOAD_MAX_IMAGE_BYTES`; hasta `EXECUTE_CAPTURES_MAX` por respuesta (3); campos completos. `masked: false` exige que la zona declarada sea `EXECUTE_CAPTURES_OPEN_ZONE` (`ninguna`): la zona es el campo `zone` de la salida o `--zone`, y sin zona se trata como sensible. Con `EXECUTE_CAPTURES_UNMASKED=allowed` (o `1`; omisión `denied`, UD-270) esa exigencia no se aplica: el anfitrión acepta capturas con datos de personas y `masked` se declara y se muestra tal cual. Una captura que no cumple se omite con el evento `captures.rejected` (`team.capture_index`, `team.capture_reason`: `invalid`, `unmasked_sensitive`, `missing`, `outside`, `too_large`, `not_image`, `too_many`, `not_stored`) en el span `execute`, o con un aviso en stderr de `team reply`; la respuesta sale igual. La plataforma no lee imágenes. Con `machine`, `EXECUTE_MACHINE_COLLECT` copia `captures/` a `{workdir}/captures`. Variables que recibe la sesión: `TEAM_CAPTURES_DIR`, `TEAM_CAPTURES_MAX`, `TEAM_CAPTURES_MAX_BYTES`, `TEAM_CAPTURES_OPEN_ZONE`, `TEAM_CAPTURES_UNMASKED` (`allowed` o `denied`) y `TEAM_LANGUAGE`.

**Traspaso a una persona (UD-269, `src/domain/escalation.js`, `src/execute/decision-check.js`).** Con `outcome` `needs_decision` o `not_mine` (el contrato gana este segundo valor), o con la entrega retenida por el código 76, `handOffToPerson` hace en una transacción: publica la respuesta del agente con el tipo `clarification` (no existe `question`), quita al agente de los asignados, asigna a `deciderOf(área)`, deja el mensaje `open`, escribe `message.escalate` en la auditoría (`to`, `source`: `execute` o `deliver`) y avisa a la persona. `deciderOf` devuelve `areas.escalation_member_id` si es una persona activa; si no, el primer Editor activo; si no, el emisor si es una persona activa; si no, nadie (la respuesta se publica igual y el invariante lo muestra). Si quien decide es el autor, puede responder esa pregunta: `holdsPendingQuestion` (asignado y última respuesta viva `clarification` de un agente) levanta `author_cannot_reply` sólo para ese caso. La decisión sale del campo `outcome` o del código 76, nunca del texto. `investigated` sigue como respuesta sin traspaso. `blocked` pasa a una persona desde el 2026-10-23: una sesión que dice que no puede seguir tiene un destrabe que sólo una persona da, y como respuesta asignada al agente no llegó a nadie.

**Cierre por Claude (UD-271, `src/execute/auto-close.js`).** La salida estructurada acepta `close` (booleano) y `close_reason` (una línea en el idioma de respuesta), ambos opcionales y fuera del texto de la respuesta y de `TEAM_OUTPUT_JSON`. El sistema cierra el mensaje sólo si se cumplen las tres: 1) lo pedido quedó hecho y comprobado, es decir la entrega terminó con código 0 (la respuesta final de `deliver`) o el `outcome` es `investigated` sin entrega; 2) el modelo puso `close: true` con un `close_reason` no vacío, lo que dice que no le deja nada al emisor (ninguna pregunta abierta, decisión pendiente ni advertencia que pida una elección; en la duda, falso); 3) si la primera respuesta llevó una captura «Antes», la respuesta final lleva al menos un «Después». Nunca cierra con `needs_decision`, `not_mine` ni `blocked`, con la entrega retenida (76), fallida o agotada, con el mensaje editado durante la corrida ni si una persona respondió en el hilo después de la primera respuesta del agente en la corrida (`close_since` viaja en la carga de `deliver` y de la segunda pasada). Las condiciones 1 y 3 y las exclusiones las hace cumplir el sistema: si el modelo pide cerrar y no se cumplen, el mensaje queda como siempre. Al cerrar, en la misma transacción que publica la respuesta final, se llama `closeMessage` (la función de `POST /messages/:id/close`, con `message.close` en la auditoría y el miembro agente como autor) y la respuesta termina con una línea «Cerrado: <close_reason>» («Closed: …» en inglés). La perilla del anfitrión `EXECUTE_AUTO_CLOSE` (`on` por omisión; `off` o `0`) la apaga: sin ella no cierra nunca y la gramática de `--json-schema` no ofrece los campos.

**Revisión de una entrega retenida (UD-275, `src/domain/delivery-review.js`, `scripts/walkthrough.mjs`).** Una entrega que sale con 76 deja `execute_runs.delivery_held = 1` y su motivo en `delivery_hold_reason`. `GET /messages/:id` expone `pending_delivery { branch, held_reason, job_id, agent_id, delivering_job_id }` mientras esa sea la última corrida con resultado del mensaje, no esté descartada y ninguna sesión `execute` esté en cola o corriendo; `delivering_job_id` es la entrega `deliver` en cola o corriendo (el panel muestra su avance con el flujo de eventos). `POST /messages/:id/deliver` (Editor) la entrega: la orden recibe `TEAM_REVIEWED_BY` con el miembro que la lanzó y no retiene de nuevo (un 76 con revisión es una falla de la orden). `POST /messages/:id/discard-delivery { reason }` (Editor, motivo obligatorio) marca `delivery_discarded_at` y `delivery_discarded_by`, deja la respuesta «Descartado por <persona>: <motivo>» en el hilo, mantiene el mensaje `open` y se audita como `message.delivery_discard`; `POST /deliver` responde 409 `delivery_discarded` hasta que una corrida nueva deje otro resultado. La respuesta retenida adjunta las capturas de la salida con el rótulo `Propuesta` (`Proposal`), y puede incluir un video (WebM o MP4 por sus primeros bytes, hasta `UPLOAD_MAX_VIDEO_BYTES`, uno por respuesta y fuera del tope de `EXECUTE_CAPTURES_MAX`; adjunto de tipo `video`). `team walkthrough --url --steps --place --as [--profile desktop|phone|both]` graba el recorrido en la sesión con el navegador del anfitrión: video WebM VP8 de 1280x720 o 390x844 (el tamaño del viewport), un rótulo fijo «Paso N · …» y el elemento tocado marcado antes de cada paso, `steps.json` con el segundo de cada paso y `captures.json` con la lista para la salida estructurada. Sin navegador lo dice en una línea y siguen las capturas.

**Reenvío (UD-272, `src/domain/forward.js`, `src/execute/documents.js`).** `POST /api/messages/:id/forward` suma al destinatario a los asignados del mismo mensaje y deja la respuesta `forward` en el hilo (migración `0022_reply_forward`). Con un agente, encola su `execute` con `forward: { reply_id, by }` en `payload_json`; el trabajo lee esa respuesta (sólo si sigue en el hilo, es para ese agente y no está borrada) y el prompt agrega el bloque `forwarded` (quién y el motivo) entre `message` y `job`. La parte estable del prompt gana la sección «Forwarded messages»; la gramática de `--json-schema` de un trabajo reenviado ofrece `mode` (`resolve` o `investigate`, lo decide el modelo desde el motivo) y `attachments` (`[{ path, name }]`), y la validación los acepta siempre. Con `mode: investigate` el sistema no encola `deliver` aunque haya rama y `outcome: done`, y no cierra el mensaje aunque la sesión pida `close`; ambas cosas las hace cumplir `handler.js`, no el texto. La respuesta final queda como `answer` en el mismo hilo, con el análisis, la recomendación y las alternativas descartadas en el `summary`, y el mensaje queda `answered`, sin cerrar. Los documentos: la sesión escribe PDF en `$TEAM_ATTACHMENTS_DIR` (el directorio `attachments/` del trabajo, creado junto a `captures/`), y el trabajador, con el directorio vivo, acepta cada uno si la ruta queda dentro, los primeros bytes son `%PDF-`, pesa hasta el menor entre `UPLOAD_MAX_DOCUMENT_BYTES` y el tope del extractor de documentos, y no pasa de `UPLOAD_MAX_FILES`. Se guardan en el volumen y se adjuntan a la respuesta final (también la de `deliver`, por `payload.documents`); cada uno que no cumple se omite y la respuesta lleva una línea «No se adjuntó «<nombre>»: <motivo>». Sin reenvío la gramática no ofrece `mode` ni `attachments`. Además, la instrucción de `needs_decision` pide avanzar en lo investigativo antes de entregar a la persona: el `summary` lleva lo encontrado, una recomendación concreta y las alternativas descartadas con su porqué.

**Fallos del trabajo desatendido (2026-10-23, `src/execute/handler.js`, `deliver.js`, `src/queue/index.js`, `src/worker.js`).** Ningún mensaje queda sin respuesta ni sin una persona que lo vea. Un fallo por infraestructura (la máquina no se crea, la sesión muere sin línea `result`, el servicio del modelo contesta 429 o 5xx, el arriendo vence) se reintenta una vez aunque `max_attempts` sea 1 (`INFRA_ATTEMPTS`), esperando `EXECUTE_INFRA_RETRY_WAIT_MS`; el segundo fallo pasa el mensaje a `deciderOf` con `handOffToPerson` y el motivo en palabras llanas. El tope de gasto, el máximo de pasos, la salida que no cumple el formato, el plazo vencido y un agente que no puede empezar pasan a una persona sin segundo intento. Si el binario `claude` rechaza `--append-system-prompt-file` (EXECUTE_STABLE_AS_SYSTEM encendida antes que la imagen que lo soporta), el intento siguiente envía el prompt entero. La cola avisa `leaseFailed` desde la reclamación, el arranque y el barrido; el barrido de `src/worker.js` entrega otra vez al manejador cualquier trabajo fallado cuyo mensaje sigue asignado sólo al agente (`unseenFailures`), y `buriedHandoffs` lo cuenta como `job_failed` en `/health`.

`needs_decision` exige `decision_check`: `searched` (lista de fuentes con ruta o identificador, al menos una), `why_not_covered`, `recommendation` (una opción), `if_wrong` y `question` (una línea), todos no vacíos. La gramática de `--json-schema` lo lleva como propiedad opcional; la salida se valida después (`decisionCheckProblem`) y, sin el bloque válido, el trabajo falla con `invalid_output` y nadie lo recibe. La respuesta lleva el `summary`, luego «Pregunta», «Recomendación» y «Si la respuesta es la equivocada», y las fuentes bajo «Revisado». El prompt dice a la sesión que, si el pedido no le corresponde según su perfil y la plantilla, termina de inmediato en `not_mine` sin enviar «Recibido», y que antes de `needs_decision` o `not_mine` descarta en orden: decisión registrada, cobertura por perfil, reglas o plantilla, intención dicha en el mensaje, vía técnica sin persona, error barato y reversible. Agrega 765 caracteres a la parte estable (3.827 a 4.592, 2026-10-23, plantilla vacía).

**Invariante de traspaso.** `buriedHandoffs(db)` lista los mensajes no cerrados ni borrados cuyo último resultado del agente (la última fila de `execute_runs` con `outcome` que no sea `failed` ni `aborted`) es `needs_decision`, `not_mine` o `delivery_held = 1`, sin ninguna persona asignada y sin trabajo `execute` o `deliver` en cola o en curso. `GET /health` responde `status: degraded` si hay alguno y el Editor ve `handoffs: { buried, messages }`. Debe ser 0. La migración 0021 traspasa lo que ya estaba así. `GET /areas` muestra `escalation_member_id` (el efectivo, como texto) y `handoffs` (traspasos de los últimos 7 días por persona, de la auditoría); `PATCH /areas/:id` acepta `escalation_member_id` (persona activa, o `null`).

### 7.6 Proveedores de modelo (`src/providers/`)

**Propósito:** Una ranura por modalidad, configurable (UD-001).

```
providers.text          .complete({ system, messages, schema, effort, maxTokens, cacheTtl, thinking }) → { json, usage, provider, model, duration_ms }
providers.textFallback  la misma firma; null si no se declara TEXT_FALLBACK_PROVIDER
providers.vision        .describe({ images[], prompt, schema })          → { json, usage }
providers.speech        .transcribe({ audioPath, language })             → { text, segments }
providers.describe()    estado de cada ranura para GET /settings/providers y GET /health, sin llaves
probeConnection(spec)   llamada mínima: { ok, cause, status, duration_ms, models }; causas: invalid_key, no_quota, model_not_found, no_network, rate_limited, timeout, bad_address, provider_error, unknown
```

Claves de API desde Configuración (UD-120, UD-121): se guardan cifradas con AES-256-GCM (`src/domain/vault.js`) en `provider_connections` (migración 0009), con el nombre del proveedor como dato autenticado adicional. La clave maestra es `SECRETS_KEY` (64 hex o base64 de 32 bytes) o `<DATA_DIR>/secrets.key`, creada con modo 600 en el primer arranque. Una clave guardada prevalece sobre la variable de entorno, que sigue siendo el valor de arranque. Ninguna ruta devuelve una clave (sólo los últimos 4 caracteres); no se registra en logs, spans, telemetría, errores ni auditoría (`src/api/secrets-never-leak.test.js`). Rotación: con el servidor detenido, `node scripts/rotate-secrets-key.mjs` re-sella todo y deja `secrets.key.prev`. Respaldar la base sin respaldar la clave maestra deja las claves ilegibles; el panel las marca «fallando» y pide ingresarlas de nuevo.

```
```

Implementaciones: `anthropic` (texto, visión y PDF), `openai-compatible`, `groq-speech` y `fake` (para pruebas y para el banco). `anthropic` usa Messages nativo por `fetch`, sin SDK, con caché del prompt de sistema y sin `temperature`, `top_p` ni `top_k`. `openai-compatible` trae preajustes de DeepSeek, Groq, OpenRouter y Gemini, con tres modos de salida estructurada: `json_schema`, `tool` y `json_object` validado con Ajv. Modelo por omisión: `claude-haiku-5-5` en texto y visión, `deepseek-flash` si se elige DeepSeek, `whisper-large-v3-turbo` en transcripción. La configuración vive en variables de entorno (`TEXT_*`, `VISION_*`, `SPEECH_*`, `TEXT_FALLBACK_*`; lo que falte en visión se hereda de texto). Se edita desde Configuración (Editor). La base guarda sólo el nombre del proveedor y el modelo, nunca la llave (§4.6). Cada llamada abre su propio span `gen_ai.*` (§7.10 bis). Las llamadas paralelas con el mismo prefijo (modelo, sistema, formato de salida, esfuerzo) las ordena `cache-warmup.js`: la primera va en flujo y las demás salen al llegar su `message_start`, para leer el caché en vez de escribirlo otra vez (medición 2026-10-23; `ANTHROPIC_CACHE_WARMUP=off` lo apaga).

### 7.7 Identidad (`src/identity/`)

**Propósito:** Un contrato con dos implementaciones (UD-002).

```
identify(request) → { member_id, role } | null
```

`local`: correo y contraseña. El hash es Argon2id de `crypto.argon2` (Node ≥ 24.7) con 19 MiB, 2 pasadas y 1 hilo, el mínimo de OWASP, 19 ms medidos. Si cambian los parámetros, se vuelve a hashear al iniciar sesión. La contraseña tiene de 15 a 128 caracteres, sin reglas de composición y con lista de bloqueo opcional. La ficha de sesión es opaca, de 32 bytes, y se guarda con SHA-256 en `sessions`. La cookie es `__Host-` `HttpOnly` `Secure` `SameSite=Lax`. Se regenera al iniciar sesión y al cambiar de rol. Vence a los 30 minutos de inactividad y a las 8 horas en términos absolutos.

El CSRF se defiende por `Sec-Fetch-Site` y `Origin` en un gancho `onRequest`. El panel manda además la cabecera `X-Team-Request` en toda petición no segura con sesión. El límite por IP usa `@fastify/rate-limit` y el de cada cuenta una espera exponencial. `trustProxy` lleva una lista de IP, nunca `true`.

`delegated` tiene cuatro modos bajo el mismo contrato. `signed-header` es un HMAC con marca de tiempo y tolerancia de 5 minutos, patrón de Stripe, con dos secretos durante la rotación. `jwt` usa `jose` contra JWKS o un secreto compartido. `sso-redirect` usa un nonce de uso único, patrón DiscourseConnect. `trusted-header` sólo vale si la conexión viene de una dirección de confianza; es lo que entrega `tailscale serve` en `Tailscale-User-Login`.

`IDENTITY_PROVIDER` acepta una fuente o una lista en orden: `local`, `delegated` (el modo de `DELEGATED_MODE`), `signed-header`, `jwt`, `sso-redirect` y `trusted-header`. Con `jwt,signed-header` las personas entran con el JWT del anfitrión y un miembro agente con la firma. Las fuentes por cabecera se prueban en el orden de la lista y gana la primera que identifica la petición. Después se lee la cookie propia. Sin credencial válida, 401.

Alta de miembros (H-3720). Con `IDENTITY_PROVISION=closed`, la omisión, el correo tiene que existir en `members` o la respuesta es 403 `member_not_registered`, y el rol sale de la base (UD-007). Con `IDENTITY_PROVISION=host` un correo desconocido se da de alta al primer ingreso (UD-254 enmienda UD-007). Lleva el nombre y el rol que declara el anfitrión, o `member`. El rol viaja en el claim `JWT_ROLE_CLAIM` (`role`), en la cabecera firmada `X-Team-Role` o en `role` del payload del SSO. El nombre viaja en `JWT_NAME_CLAIM` (`name`), en `X-Team-Name` (UTF-8 con codificación porcentual), en `name` del SSO o en `TRUSTED_NAME_HEADER`. Con `X-Team-Role` o `X-Team-Name` la firma cubre además `\n<rol>\n<nombre>`. Un rol declarado se aplica en cada ingreso y queda gobernado por el anfitrión (fila `host-role` en `identity_links`). Si el Editor local lo cambia, recibe 409 `role_managed_externally`, como con la contraseña. Un rol distinto de `member` y `editor` cuenta como no declarado.

Sesión propia tras el anfitrión. Cuando una fuente por cabecera identifica una petición de navegador (trae `Sec-Fetch-Site`), el servidor emite su propia cookie de sesión en la tabla `sessions`. Vence con el `exp` del JWT si lo trae, o a las 8 horas, y se renueva con cada token válido. `EventSource` no manda cabeceras: `GET /api/events` funciona con esa cookie. Un cliente que no es navegador no recibe cookie, para no dejar una sesión por petición. `GET /me` informa `provider` (las fuentes), `source` (`session` o la fuente que identificó esta petición), `role_managed_externally` y `logout_url`.

Cookie compartida con el anfitrión. Con `COOKIE_DOMAIN` (por ejemplo `.ejemplo.cl`) la cookie de sesión lleva `Domain` y por eso pierde el prefijo `__Host-`. Se llama `COOKIE_NAME` (`team_session`) y es `Secure`, `HttpOnly` y `SameSite=Lax`. Un anfitrión que ya tiene sesión comparte la identidad sin SSO nuevo. Firma un JWT RS256 con su llave, publica el JWKS y elige una de dos vías. Una es poner el JWT en una cookie de su dominio, que Team Platform lee por su nombre (`JWT_COOKIE_NAME`). La otra es mandar `Authorization: Bearer <jwt>`. Esa cookie es una credencial ambiental: una petición no segura con ella exige `X-Team-Request`, como la de sesión.

Cierre de sesión (UD-190). `POST /api/auth/logout` existe con toda fuente: borra la sesión propia en el servidor y la cookie. Con `LOGOUT_URL` responde 200 `{ logout_url }` y el panel navega a la salida del anfitrión; sin ella, 204. El panel dibuja «Cerrar sesión» con `local`, con `sso-redirect` o con `LOGOUT_URL`. Con sólo fuentes por cabecera, el anfitrión vuelve a identificar a la persona en la petición siguiente.

El primer Editor nace de `ADMIN_EMAIL` sólo si la base no tiene miembros. Con `NODE_ENV=development` existe `POST /api/auth/dev-login`, sin contraseña. Si la aplicación vive dentro de otro sitio, se monta bajo el mismo origen por proxy inverso. Un frontend en otro origen usa `CORS_ORIGINS` y `COOKIE_MODE=cross-origin` (§4.11). Los roles `member` y `editor` son un enumerado con `CHECK`. Un gancho `requireRole` por ruta deniega por omisión, y el servidor no arranca si una ruta no declara su política. Perillas y fuentes en el informe 04.

### 7.8 Panel (`panel/`)

**Propósito:** Cliente estático React contra `/api`. No sabe de la base ni del volumen (§4.11). Se compila con Vite en la primera etapa del `Dockerfile` y lo sirve `@fastify/static` desde la misma imagen. Los activos llevan hash y son inmutables, `index.html` va sin caché, un activo ausente da 404 y bajo `/api` el 404 es JSON. Sin panel compilado la API arranca igual. En desarrollo, Vite hace proxy de `/api` hacia `PANEL_API` o hacia `panel/dev-server.mjs`, un servidor doble en memoria que no entra a la imagen. Panel y API comparten origen, así que la cookie de sesión y `EventSource` no necesitan CORS.

Rutas: Inicio, Mensajes, detalle de un mensaje, Áreas (con área seleccionada), Equipo y Configuración. Cuando `GET /me` responde 401 se muestra el inicio de sesión.

Entrada multimodal:

- Arrastrar y pegar capturas.
- Cámara del teléfono por `<input capture>`.
- Audio con `MediaRecorder`, que prueba `audio/webm;codecs=opus`, `audio/webm` y `audio/mp4` y lee `recorder.mimeType` (Safari anterior a 18.4 sólo graba MP4).
- Subida multipart con `XMLHttpRequest` para tener progreso, con reintento que reenvía el archivo.

Los límites iniciales son imagen 7 MB, audio 25 MB, documento 25 MB y video 2 GB, declarados en `src/config.js` (informe 07).

Mensajes es una lista de `MessageCard`. Los filtros viven en la URL como chips de propiedad, operador y valor (`panel/src/lib/filters.ts`; patrón de Linear, Plane y Front). No hay tabla virtualizada hasta que haya cientos de filas. Los componentes de shadcn/ui están copiados a `panel/src/components/ui/`, sobre Radix (38 KB comprimidos menos que Base UI, medido en el informe 07). Las tipografías van empaquetadas (Orbitron y Source Sans 3, OFL-1.1), con tema claro y oscuro. La base de navegadores es Chrome 111, Safari 16.4 y Firefox 128. El paquete único mide 720 kB (213 kB comprimidos, medido el 2026-10-21 con `vite build`).

Contrato del tema (`THEME_CSS`, H-3721). La hoja del anfitrión se carga después de `panel/src/styles.css` y redefine estas variables. Las de color se declaran en `:root[data-theme='light']` y `:root[data-theme='dark']`, porque el panel las fija con esos selectores. Las demás, en `:root`.

| Familia | Variables |
|---|---|
| Fondo y superficies | `--color-bg`, `--color-surface`, `--color-raised`, `--color-hover`, `--color-line`, `--color-line-strong`, `--color-edge`, `--color-selected` |
| Texto | `--color-fg`, `--color-muted`, `--color-faint` |
| Acento | `--color-accent`, `--color-accent-hover`, `--color-accent-deep`, `--color-accent-fg`, `--color-accent-soft` |
| Peligro | `--color-danger`, `--color-danger-soft` |
| Estados | `--color-state-{open,answered,closed}-{bg,fg,edge}`, `--color-{open,answered,closed}-led`, `--color-{open,answered,closed}-{bg,fg}` |
| Vidrio y fondo animado | `--color-glass`, `--color-glass-strong`, `--color-glass-edge`, `--color-glass-line`, `--color-sky-{a,b,c}`, `--color-glow-{1,2,3}`, `--color-orbit`, `--color-chrome-{1,2,3,4}` |
| Botón gel e IA | `--color-gel-top`, `--color-gel-bottom`, `--color-gel-fg`, `--color-ai-bg`, `--color-ai-edge`, `--color-ai-fg`, `--color-aqua`, `--color-lime`, `--color-lilac` |
| Sombras | `--shadow-glass`, `--shadow-pop`, `--shadow-gel`, `--shadow-well` |
| Tipografía | `--font-sans`, `--font-display`, `--font-mono` |
| Radio | `--radius-sm`, `--radius-md`, `--radius-lg` |
| Acabado del botón primario | `--btn-gloss`, `--btn-border`, `--btn-text-shadow` |
| Acabado del avatar y la marca | `--orb-gloss`, `--orb-glow`, `--orb-ink`, `--orb-text-shadow`, `--orb-shadow` |
| Acabado de la barra superior | `--chrome-border`, `--chrome-shadow` |
| Opción elegida de un selector | `--selected-bg`, `--selected-border`, `--selected-ink`, `--selected-shadow`, `--segmented-track` |
| Borde de estado de la tarjeta | `--card-edge-width` |

Acabado de los controles (H-3732). Las variables de las cinco filas nuevas se declaran en `:root`, fuera de los selectores de tema, y valen para los dos temas. `panel/src/styles.css` las declara con `:where(:root)`, de especificidad cero, de modo que cualquier regla del anfitrión las vence. Con los valores por omisión el panel queda como antes del cambio (comparado por captura a 1440x900 y 390x844, en claro y oscuro).

| Variable | Qué gobierna | Valor por omisión |
|---|---|---|
| `--btn-gloss` | Capa de brillo sobre la mitad superior de `.btn-gel`; `none` la quita | `linear-gradient(180deg, oklch(1 0 0 / 0.22), oklch(1 0 0 / 0) 50%)` |
| `--btn-border` | Color del borde de `.btn-gel` | `oklch(0.3 0.1 255 / 0.55)`; en oscuro `oklch(0.85 0.1 240 / 0.6)` |
| `--btn-text-shadow` | Sombra de la letra de `.btn-gel` | `0 1px 0 oklch(0.2 0.1 260 / 0.35)`; en oscuro `none` |
| `--orb-gloss` | Brillo radial blanco de `.orb` (avatares y marca); `none` lo quita | `radial-gradient(circle at 32% 26%, oklch(1 0 0 / 0.95) 0 11%, oklch(1 0 0 / 0) 34%)` |
| `--orb-glow` | Resplandor aqua de la base de `.orb`; `none` lo quita | `radial-gradient(circle at 50% 120%, var(--color-aqua), transparent 62%)` |
| `--orb-ink` | Color de las iniciales del avatar | `oklch(0.99 0 0)` |
| `--orb-text-shadow` | Sombra de las iniciales | `0 1px 1px oklch(0.2 0.1 260 / 0.55)` |
| `--orb-shadow` | Sombra del avatar | `inset 0 -2px 3px oklch(0.2 0.1 260 / 0.35), 0 1px 2px oklch(0.3 0.12 255 / 0.45)` |
| `--chrome-border` | Color de la línea inferior de `.chrome-bar` | `var(--color-line-strong)` |
| `--chrome-shadow` | Sombra bajo `.chrome-bar` | `0 8px 20px -12px oklch(0.35 0.14 255 / 0.5)` |
| `--selected-bg` | Fondo de la opción elegida de `Segmented` y `StateTabs` (clase `opt-on`) | `var(--color-selected)` |
| `--selected-border` | Borde de esa opción | `var(--color-accent)` |
| `--selected-ink` | Color de la letra de esa opción | `var(--color-fg)` |
| `--selected-shadow` | Sombra de esa opción | `none` |
| `--segmented-track` | Fondo de la pista que contiene las opciones (clase `opt-track`) | `var(--color-raised)` |
| `--card-edge-width` | Ancho del borde izquierdo de color por estado de `MessageCard`; `0px` lo quita | `3px` |
| `--h1-size`, `--h1-weight` | Tamaño y peso del título de pantalla | `clamp(1.3rem, 1.1rem + 0.9vw, 1.65rem)` y `700` |
| `--h2-size`, `--h2-weight`, `--h2-tracking`, `--h2-transform`, `--h2-ink` | Título de caja (`h2`) | `0.8rem`, `700`, `0.08em`, `uppercase`, `inherit` |
| `--wordmark-size`, `--wordmark-weight`, `--wordmark-tracking`, `--wordmark-transform`, `--wordmark-font` | Marca de la barra y de la entrada | `var(--text-sm)`, `600`, `0.1em`, `uppercase`, `var(--font-display)` |
| `--leaf-radius` | Esquina de las cajas (`.leaf`, `.area-box`, `.ai-surface`) | `3px 10px 3px 10px` |
| `--radius-field`, `--radius-option` | Esquina de un campo y de una opción de menú | `var(--radius-md)` y `var(--radius-sm)` |
| `--nav-bar-width`, `--nav-active-ink` | Barra al costado y tinta de la fila abierta de la navegación | `4px` y `inherit` |
| `--ai-edge-width` | Ancho del borde izquierdo de las superficies del modelo y del análisis | `3px` |
| `--field-bg`, `--field-border`, `--field-border-focus` | Relleno y borde de un campo, en reposo y con foco | `var(--color-raised)`, `var(--color-edge)`, `var(--color-accent)` |
| `--color-gel-hover-top`, `--color-gel-hover-bottom`, `--btn-hover-filter` | Color del botón principal al pasar el puntero, o el aclarado por omisión | el color en reposo y `brightness(1.08) saturate(1.1)` |
| `--orb-top`, `--orb-bottom` | Colores del avatar, separados del botón principal | los del botón principal |
| `--btn2-bg`, `--btn2-border`, `--btn2-shadow`, `--btn2-hover-bg`, `--btn2-hover-border`, `--btn2-hover-ink` | Botón secundario | vidrio con borde de control |
| `--btn-danger-bg`, `--btn-danger-border`, `--btn-danger-hover-bg`, `--btn-danger-hover-border` | Botón destructivo | vidrio con borde de control; rojo suave al pasar |
| `--meter-fill`, `--meter-sheen` | Relleno y destello de la barra de progreso | degradado aqua a azul y brillo blanco |
| `--glass-line-width`, `--focus-width`, `--touch-min` | Línea de la caja de vidrio, anillo de foco y alto mínimo al tacto | `1px`, `3px` y `44px` |
| `--prose-align` | Alineación del texto corrido ancho (`.prose-block`): `justify` o `left` | `justify` |
| `--label-weight`, `--label-tracking` | Peso e interletrado del rótulo pequeño en mayúsculas (`.rotulo`, sobre una foto o un valor) | `700` y `0.08em` |

La prueba `panel/src/theme.browser.test.mjs` (registrada en `test:flows`) comprueba, en los dos temas, que cada variable existe con su valor por omisión y que una hoja del anfitrión que las redefine cambia el botón, el avatar, la barra, el selector, su pista y el borde de la tarjeta.

Una tipografía del anfitrión entra con su `@font-face` en la misma hoja y con un origen que admita `font-src 'self'`, es decir, servida bajo el mismo sitio.

`panel/DISENO.md` guarda las referencias y los tokens de la piel Y2K (UD-013), entre ellos `--duration-hover` y `--sidebar-count-col` (UD-130). Las rutas son `/`, `/messages`, `/messages/:id`, `/areas`, `/areas/:id`, `/team`, `/connections` y `/settings`; las del Editor se ocultan a los miembros. La barra superior pide `GET /api/messages/summary` y la lista de cada estado a `GET /api/messages`; la barra lateral reutiliza el resumen para los contadores por área. Configuración llama a `/api/settings/connections` (§7.1) y nunca recibe una clave, sólo sus últimos 4 caracteres.

Herramientas del panel:

| Orden | Qué hace |
|---|---|
| `npm test` | Vitest: catálogos es-419 y en con las mismas claves, guardia de lenguaje (`ui-voice.test.ts`), escala tipográfica, sin truncado y componentes |
| `npm run contraste` | Contraste de cada par de texto en los dos temas |
| `npm run capturas`, `capturas:vistas` | Capturas de cada vista a 1440x900 y 390x844 con Chromium sin ventana |
| `npm run test:fit`, `test:flows`, `test:gallery`, `test:sidebar`, `test:telemetry` | Suites en navegador sin ventana. Con `BROWSER=firefox` corren en Firefox (`panel/src/browser-support.mjs`, H-2500); sin esa variable, en Chromium |
| `npm run ui-detectors` | `panel/scripts/ui-detectors.mjs`: detectores de interfaz sobre todas las rutas, dos ventanas y dos temas (UD-090); informa, no falla |

### 7.9 Plantillas (`templates/` y tabla `templates`)

**Propósito:** La metodología de análisis y el formato de salida de cada área, en markdown editable por el Editor.

```markdown
---
name: Reporte de error
description: Algo que antes funcionaba o debería funcionar y no lo hace.
fields:
  - { name: steps,    label: Pasos para reproducir, required: true }
  - { name: expected, label: Qué se esperaba,        required: true }
  - { name: actual,   label: Qué pasó,               required: true }
  - { name: where,    label: Dónde (pantalla, URL),  required: false }
output:
  - { name: cause,  label: Causa, type: text, required: true }
  - { name: branch, label: Rama,  type: text, required: false }
  - { name: files,  label: Archivos tocados, type: list, required: false }
---
## Método
Cómo leer el input para esta área: qué cuenta como un error distinto, cómo separar dos errores
que comparten una captura, qué va en cada campo.

## Formato de salida
Un mensaje por error. Título: verbo en infinitivo y lugar.

## Salida
Causa: la que se midió, con el archivo o el dato que la muestra.
```

El frontmatter se convierte en el esquema JSON de `fields` que el analizador exige. `compileFieldsSchema` es la misma definición que valida una plantilla al guardarla (422 si no cumple) y los `fields` de cada mensaje al publicar. El cuerpo entra al prompt de la descomposición. `name` y `description` respetan los límites de la especificación Agent Skills (64 y 1.024 caracteres), porque la clasificación sólo ve esos dos campos de cada plantilla. El cuerpo se revela recién en la descomposición: la misma divulgación progresiva. El juego inicial vive en `templates/`: `areas.json` (cinco áreas: Idea, Error, Nueva funcionalidad, Retroalimentación, Pregunta, cada una con su archivo `idea.md`, `bug.md`, `feature.md`, `feedback.md`, `question.md`). Se siembra al instalar y se puede editar o borrar; cada plantilla editada se copia además a `$DATA_DIR/templates` para los respaldos, y la base manda.

**Salida declarada (UD-254, UD-255, H-3723).** El bloque `output` del frontmatter declara lo que el harness entrega cuando trabaja un mensaje de la plantilla. Cada entrada lleva `name` (identificador en minúsculas), `label` (rótulo, hasta 120 caracteres), `type` (`text`, `list` de textos, `number` o `boolean`; `text` por omisión), `required` y, sólo con `text`, `enum` (de 1 a 32 valores). Toda salida lleva además dos campos fijos, que la plantilla no declara ni redefine. `summary` es el par de párrafos para quien envió el mensaje, sin jerga y dirigidos a esa persona. `outcome` es uno de `done`, `investigated`, `blocked`, `needs_decision` o `not_mine`. `compileOutputSchema` (`src/analyze/templates.js`) compila el bloque a un esquema JSON con `additionalProperties: false`, que es el `--json-schema` exigido al harness; devuelve `null` si la plantilla no tiene bloque `output`. `validateOutput` (`src/analyze/validate.js`) valida una salida contra ese esquema. Un bloque que no compila, o con más de 24 entradas opcionales, se rechaza al guardar la plantilla con 422 y el motivo. Sólo el frontmatter define la salida. La sección «## Salida» del cuerpo trae instrucciones en prosa al harness y viaja con el cuerpo; `compileOutputSchema` no la lee. En el panel, «Salida» va bajo «Campos» en la fila de la plantilla y en «Campos e instrucciones». Se edita como los campos, con el tipo de cada entrada; «Resultado» y «Resumen» aparecen como fijos. Las cinco plantillas iniciales declaran su salida: Error `cause`, `fix`, `verification`, `branch`, `files`; Nueva funcionalidad `built`, `verification`, `branch`, `pending`; Retroalimentación `assessment`, `change`, `branch`; Idea `findings`, `recommendation`, `effort`; Pregunta `answer`, `sources`.

### 7.10 Eventos y progreso (`src/events/`)

**Propósito:** Que la persona vea el trabajo avanzar sin sondeo.

El flujo SSE va con `@fastify/sse` (versión exacta) y repone desde `job_events` lo que ya pasó. El `id` de cada evento es `job_events.seq`, así que una pestaña que se reabre manda `Last-Event-ID` y no pierde el progreso. La reposición se midió en 35 ms, sin acumulación con `@fastify/compress` ni con el proxy de Vite (informe 07). El primer evento de cada conexión es `replay` (`complete`, `from`; con nada que reponer lleva como `id` el último `seq` emitido, para que una pestaña quieta también reconecte con `Last-Event-ID`): `complete: true` dice que la reposición cubre todo lo que la pestaña se perdió, y entonces el panel no vuelve a pedir ninguna lista; `false` (sin `Last-Event-ID`, un id más viejo que la retención de siete días o uno que esta base no emitió) dice que no alcanza, y el panel vuelve a leer sólo lo que muestra la pantalla.

Los eventos son `progress` (`job_id`, `input_id`, `percent`, `code`, `vars`, `phrase`, `at`), `done` (`job_id`, `input_id`, `status`, `error`, `error_code`, y al terminar un análisis `input_status` `published|proposed` con `message_ids`) y `message` (un aviso por mensaje publicado al equipo, y un aviso dirigido con `reason: assigned` a quien una edición agrega como destinatario). El progreso llega sólo al autor del input y los avisos de mensajes a todo el equipo. El flujo termina con un evento `done` y el cliente cierra. Si el trabajo ya terminó, la ruta responde 204, que es lo que fija el estándar para que el navegador deje de reconectar.

Hay un solo flujo SSE por miembro (`GET /api/events`), no uno por trabajo. Lleva los eventos de progreso con su `job_id` y los avisos de mensajes nuevos. HTTP/1.1 limita a seis las conexiones por dominio, compartidas entre pestañas (informes 03 y 07). El servidor suscribe antes de reponer, lo que dio cero repetidos y cero huecos al reconectar, y manda un latido cada 15 s. En el panel, un hook `useJobProgress` sobre `EventSource` guarda el progreso como estado efímero e invalida la consulta del input al `done`. Los extractores y el analizador emiten `progress(percent, step(code, vars))` por paso real. El porcentaje sale de pasos completados sobre pasos totales, nunca de un reloj.

**Frases de progreso** (H-3722): el catálogo es `src/domain/progress-phrases.js`, una frase por `code` y por idioma (`es-419`, `en`), con variables numéricas como `{n}` y `{total}`. El servidor guarda en `job_events` el `code` y `vars` y escribe `phrase` en el idioma del autor del input. El panel traduce por `code` al idioma de quien mira (`panel/src/lib/progress-text.ts`) y muestra `phrase` tal cual si el `code` falta o no lo conoce. Una fila anterior a los códigos recupera el suyo con `codeOfPhrase`, que sólo reconoce textos del propio catálogo. Un idioma nuevo es una columna más del catálogo y del panel, sin tocar los emisores. Pruebas: `src/domain/progress-phrases.test.js` y `panel/src/lib/progress-text.test.ts`.

Un trabajo `execute` emite progreso desde el NDJSON de la sesión: la frase describe la herramienta en uso («Lectura: archivo», «Edición: archivo», «Orden: …», «Subagente: …») y el porcentaje es turnos usados sobre `EXECUTE_MAX_TURNS`. La sesión también informa sus hitos con `team progress <job_id> --percent N --phrase …` (`POST /jobs/:id/progress`, sólo el agente del trabajo; 99 como máximo, porque el 100 lo marca `done`). Un `execute` no tiene input: su `progress` lleva `message_id` y llega a todo el equipo, como el mensaje. El `done` de un `execute` lleva `message_id`, `reply_id`, `session_id` y `cost_usd`, o `error` y `error_code` si falló.

### 7.10 bis Telemetría (`src/telemetry/`)

**Propósito:** La trazabilidad que pide UD-014. Usa `@opentelemetry/sdk-node` con un exportador propio a la tabla `spans` y, opcional por `OTEL_EXPORTER_OTLP_ENDPOINT`, OTLP. `withSpan(name, attrs, fn)` lo usan la cola, los extractores, los proveedores y el analizador.

Los atributos de GenAI siguen la convención vigente al 2026-10-20 (repositorio `semantic-conventions-genai` de OpenTelemetry, estado «Development»):

- `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model` y `gen_ai.response.model`.
- `gen_ai.usage.input_tokens` (incluye la caché), `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens` y `gen_ai.usage.cache_write.input_tokens`.
- `gen_ai.response.finish_reasons`.
- Propios del proyecto: `team.job_id`, `team.input_id`, `team.step` y `team.cost_usd`.

El contenido de entrada y salida va siempre en un evento del span, `gen_ai.client.inference.operation.details`, con `gen_ai.input.messages`, `gen_ai.output.messages` y `gen_ai.system_instructions`, porque el volumen es del equipo. Los nombres anteriores (`gen_ai.system`, `gen_ai.content.prompt`, `gen_ai.content.completion`, `gen_ai.usage.cache_read_input_tokens`) ya no figuran en la convención y no se usan.

Una traza continua por mensaje (UD-261). El envío abre `input.submit` y guarda `trace_id` y `traceparent` (W3C) en `inputs`; el trabajo `analyze` continúa esa traza, la publicación abre `message.publish` por mensaje y guarda `trace_id` y `traceparent` en `messages`, y el trabajo `execute` continúa desde ahí. Los trabajos guardan `trace_id` y `traceparent` (migración 0017). Cada intento es un span `job` hijo de esa traza (`team.attempt`, `team.outcome`); sin contexto guardado sigue siendo la raíz de su propio árbol. Un reintento enlaza el intento anterior, y un trabajo nuevo del mismo mensaje o envío (reproceso, segunda asignación) enlaza el último trabajo anterior, con un span link (`team.link` = `previous_attempt` o `previous_job`; columna `spans.links_json`). `GET /api/messages/:id` devuelve `trace_id`.

Trabajo `execute`. Hijos del span `execute`: `execute.machine.create`, `execute.machine.run` y `execute.machine.destroy` (con el runner local, `execute.local.run`). Dentro de `run`, un span `execute.tool` por llamada a herramienta (`gen_ai.tool.name`, `team.tool.success`, `team.tool.summary`) y un `execute.subagent` por subagente (`gen_ai.agent.name`), con las herramientas de su subagente colgando de él. Se arman emparejando `tool_use` y `tool_result` del NDJSON `stream-json` por id; la duración es la que la sesión esperó. Cada mensaje del modelo deja un evento `execute.turn` en el span de `run` con tokens de entrada, salida y caché, y `team.turn.cost_usd` cuando el modelo tiene precio documentado (`pricing.js`: Haiku 5.5, Sonnet 5.5 y Whisper turbo de Groq). El span `job` lleva los eventos `reply.start` (primera respuesta de la sesión) y `reply.final` (respuesta de cierre) con `team.ms_since_job_start` y `team.ms_since_message`. `jobs.phase` dice el paso en curso (`create`, `run`, `collect`, `destroy`). Con `EXECUTE_MACHINE_COLLECT` hay además el span `execute.machine.collect`.

Contexto hacia la sesión. El entorno del harness lleva `TRACEPARENT` (el span `execute`). `EXECUTE_OTEL_ENV` (pares `CLAVE=valor` separados por espacios) se pasa tal cual a `claude -p` para su propia telemetría; se rechazan claves `TEAM_*` y `TRACEPARENT`. Las variables que Claude Code reconoce y su fuente están en [la medición](investigaciones/mediciones/2026-10-22-observabilidad-del-harness.md).

`GET /api/messages/:id/timing` (Miembro) devuelve `first_reply_ms`, `final_reply_ms`, `total_ms`, `queue_wait_ms`, las fases, las herramientas y subagentes del más lento al más rápido, el consumo por turno y el subárbol de spans (`tree`). `team timing <message_id>` lo imprime sin el árbol. El panel lo muestra en «Tiempos» de la ficha y en las ejecuciones en curso de la Cola. Publicar, cerrar y reabrir abren `input.publish`, `message.close` y `message.reopen`. `GET /api/jobs/:id/trace` (Editor) devuelve el árbol de un trabajo, y de ahí el banco lee sus tiempos por paso. La retención es la de `job_events` (`RETENTION_DAYS`, 7). Las imágenes y fotogramas se guardan en base64 salvo con `TELEMETRY_INLINE_BLOBS=0`; el audio nunca se copia al span. `start_ns` y `end_ns` son enteros de 64 bits, así que leer `spans` con `SELECT *` falla: se piden con `CAST(… AS TEXT)` o se lee la vista `llm_calls`.

Historial de ejecuciones (UD-262). El manejador escribe una fila en `execute_runs` al cerrar cada intento del trabajo `execute`, también si falla, vence o se aborta. Usa los datos que arma la observabilidad:

| Columnas | Origen |
|---|---|
| `trace_id`, `session_id`, `model`, `runner`, `machine` | El trabajo y la línea `init` de la sesión |
| `queue_wait_ms`, `first_reply_ms`, `final_reply_ms`, `total_ms` | Los mismos que `GET /api/messages/:id/timing`. La respuesta final y el total se completan en la transacción que cierra el trabajo |
| `create_ms`, `run_ms`, `destroy_ms` | Un tiempo por span de fase. Con el ejecutor local sólo `run_ms` |
| `tools_ms` | Tiempo con al menos una herramienta corriendo; las que se solapan cuentan una vez |
| `input_tokens` (incluye caché), `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd` | La línea `result` |
| `turns`, `tool_count`, `subagent_count` | Turnos de la sesión principal y llamadas del NDJSON |
| `outcome`, `error_code` | `outcome` de la salida estructurada; `failed` si el intento falló; `aborted` si se canceló o se apagó el servidor |
| `slowest_tools_json` | Las diez llamadas más lentas |

Un segundo intento escribe su propia fila (`UNIQUE (job_id, attempt)`). `instance` es `INSTANCE_NAME`, o el host de `PUBLIC_URL`, o `local`. Una copia restaurada en otra instancia conserva el nombre de la original, y la consulta muestra una instancia a la vez.

`judge_ms`, `delivery_ms`, `wait_ms` y `delivered` los informa la sesión con `team mark <judge|delivery|wait> --ms N [--ok true|false]` (`POST /api/jobs/:id/marks`, sólo el agente del trabajo y con el trabajo corriendo). Las marcas del mismo nombre se suman; `--ok` en `delivery` fija `delivered`. Sin marca la cifra queda `NULL`.

Transcripción. Con `EXECUTE_MACHINE_COLLECT` (§7.5) el ejecutor `machine` copia el archivo de sesión de Claude antes de destruir la máquina y la fila guarda la referencia en `transcript_ref`. La retención de las transcripciones la fija el anfitrión.

Retención propia: `EXECUTE_RUNS_RETENTION_DAYS` (365). La barrida de la cola borra las filas más viejas junto con la de `spans` (7 días) sin ligarlas. Vaciar los datos de prueba (§7.2) no toca esta tabla.

Consulta sin sesión. `scripts/tiempos.mjs`, incluido en la imagen, abre la base en solo lectura (`DB_PATH` o `DATA_DIR/team.db`) y no usa la API. Opciones: `--ultimos N`, `--mensaje ID`, `--desde AAAA-MM-DD`, `--hasta`, `--resumen`, `--instancia`, `--todas` y `--json`. El resumen da promedio, p50 y p95 (rango más cercano) por fase, costo medio y total. Da también la tasa de entrega entre las ejecuciones con dato. Suma la tasa de «ya resuelto» (`outcome = investigated` sobre todas las ejecuciones del período) y las diez herramientas más lentas. `GET /api/ops/execute-runs` (Editor; `since`, `until`, `message_id`, `outcome`, `instance`, `page`, `limit`) y `GET /api/ops/execute-runs/summary` devuelven lo mismo, con las fechas en ISO 8601. El panel muestra el resumen en «Ejecuciones», plegado, en la Cola.

### 7.10 ter Telemetría de la interfaz (`src/telemetry/ui*.js`, `panel/src/lib/telemetry.ts`)

**Propósito:** Datos de cómo se usa el panel para decidir qué mejorar (UD-090, UD-091). El panel mide con un módulo propio y envía JSON a `POST /api/telemetry/ui`; el servidor valida, convierte cada evento en un span `ui.<tipo>` y lo guarda en la tabla `spans` por el mismo exportador de §7.10 bis. Fuentes: informe 09.

**Eventos** (esquema en `src/telemetry/ui-spec.js`, publicado en OpenAPI): `navigation` (pantalla, origen, ms de pintado), `screen_usage` (permanencia, clics, desplazamientos y píxeles, teclas, punteros, clase de ventana), `task` (`send_publish`, `reply`, `close`; resultado `completed`, `abandoned` o `failed`; duración, clics, desplazamientos, teclas, pantallas y, en el envío, las etapas `stage_feedback_ms`, `stage_analysis_ms` y `stage_publish_ms`), `error` (clase, pantalla, estado HTTP y ruta como plantilla) y `vitals` (CLS, tareas largas, INP, LCP, tiempo hasta interactivo).

**Privacidad por construcción:** ningún campo admite texto libre. Cada cadena sale de una lista cerrada o de un patrón que no cabe prosa (sesión de 16 hexadecimales en memoria, nombre de componente en minúsculas y guiones, ruta con `:id`). No se guarda miembro, correo, contenido ni nombre de archivo. Sin cookies, almacenamiento local ni identificador entre visitas. La ventana viaja como clase (arista del punto de corte de Tailwind y alto en pasos de 100 px).

**Límites** (cada uno con fuente en `src/config.js`): cuerpo 64 KiB, 145 eventos por lote, 100 peticiones cada 10 s por dirección; el cliente descarta por encima de 10 eventos por segundo con ráfaga de 100.

**Tareas:** se infieren del tráfico de la API, sin leer contenido. El envío empieza en la interacción que lo pidió. El primer feedback visible es el primer pintado del elemento `data-ui-stage="progress"` (progreso de la subida o del análisis) y el análisis visible es el primer pintado de `data-ui-stage="analysis"`; el atributo no lleva contenido y sólo cuentan los elementos que no estaban al empezar el envío. Si el elemento nunca se pinta (un análisis que termina antes del primer pintado), la primera mutación del documento y el `done` del flujo SSE ocupan su lugar. El envío termina con la publicación automática (UD-070), que el panel reconoce por el `done` con `input_status` `published` o por el aviso `message` propio, o con `POST /inputs/:id/publish` en modo manual; responder y cerrar cuentan desde que se entra a la ficha. Un envío iniciado y no terminado cuando la página se descarta es un abandono.

**Envío al cliente:** al llenarse el lote, al terminar una tarea y al ocultarse la página, con `fetch` y `keepalive`. Un fallo se descarta sin reintento. El interruptor está en Configuración (Editor); `GET /api/me` lleva `ui_telemetry: { enabled, max_events }`.

**Lectura:** `GET /api/telemetry/ui-summary` y `scripts/ui-report.mjs` (tablas legibles, con `--db` sin servidor). Percentiles por rango más cercano; CLS, INP y LCP al percentil 75 con los umbrales de Core Web Vitals.

### 7.11 Banco de referencia y mediciones (`bench/`)

**Propósito:** Que el vector (§1) sea un número. El banco es un conjunto de inputs (captura de chat, docx con N puntos, transcripción de un monólogo, video corto) con su descomposición esperada. Esa referencia se audita contra las salidas de los modelos, porque una referencia escrita a mano omitió 227 intervalos en un estudio de 2026. Hoy los siete casos tienen textos inventados; los casos reales anonimizados siguen pendientes (EPIC-008).

El runner es promptfoo, con versión fijada en `package-lock.json` (MIT, corre en Node, `--repeat`, caché) y una aserción en JavaScript que importa `bench/score.js`. El puntaje usa aritmética de conjuntos sobre `unit_ids`: cobertura, repetición, mensajes de más, mensajes partidos y mensajes fusionados. También mide la exactitud de la clasificación por grupo, es decir, el área y la plantilla de cada unidad contra la esperada. Con grupos, un punto mandado a la plantilla equivocada ya no se corrige en la descomposición. La batería reporta además tiempo total por input, tiempo por paso, tokens y costo por llamada.

La misma medición corresponde a cada extractor candidato (UD-009), a video y audio. Quedan abiertas Opus contra FLAC en español, marcas de tiempo contra sin marcas y legibilidad de texto a 540, 720 y 1080 px. También una grabación real de teléfono, en lugar de las sintéticas del informe 06 (EPIC-008). La foto HEIC de iPhone ya se midió (UD-040). El banco se repite al cambiar de modelo y no sólo al editar una plantilla. Cambiar de modelo reasigna la etiqueta en casi la mitad de los casos de un estudio de 2026. Toda perilla de §4.9 cita una corrida de este banco.

**Estado.** Los siete casos de `bench/cases/` son `01-chat-grupo`, `02-docx-40-puntos`, `03-monologo-prueba`, `04-reporte-de-error`, `05-idea-suelta`, `06-mensaje-mezclado` y `07-video-de-pantalla`. Cada uno trae su `input.json` y su `expected.json` por mensaje. En la referencia, una lista de ids de área o de plantilla significa que cualquiera de ellos es correcto. `cases.test.js` falla si la numeración de unidades cambia y deja de coincidir con la referencia. `node bench/run.mjs` corre con proveedores reales o, con `--fake perfect|noisy`, sin red. Acepta `--repeat`, `--case`, `--analyzer` y `--config` (perillas del analizador). `npm run eval` dentro de `bench/` corre promptfoo sobre los mismos casos. `bench/private/` y `bench/results/` quedan fuera del repositorio, porque los casos con feedback real nunca se publican. La última medición con proveedor real es `docs/investigaciones/mediciones/2026-10-20-primera-corrida-real.md`.

---

## §8. Reglas operativas

> Cómo opera el agente de IA dentro de este repositorio.

**Ubicación de las reglas:** `docs/RULES.md`

**Alcance:** Todas las operaciones del agente sobre el repositorio: código, documentación, dependencias y despliegue.
