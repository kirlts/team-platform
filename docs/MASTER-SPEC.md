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
| **Propuesta** | El resultado del análisis: N mensajes, cada uno en su área y redactado según la plantilla de esa área, con sus destinatarios y adjuntos. | Editable por el emisor; se publica al confirmar (UD-003). |
| **Mensaje** | Una comunicación de una persona hacia el equipo o hacia un miembro. Siempre espera respuesta. | Estados: `abierto` (sin respuesta), `respondido` (con respuesta, no cerrado), `cerrado` (con o sin respuesta). Sólo un miembro distinto del emisor responde; cualquier miembro cierra o reabre. |
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

Idempotencia en el sentido de las plantillas de trabajo. Una plantilla aplicada a un input produce mensajes de la misma forma, con los mismos campos y la misma completitud. No importa quién lo mande, cuándo ni por qué canal. Esa constancia la dan la plantilla (método y formato de salida) y el esquema estricto que el sistema valida, no una semilla del modelo. La prosa de un mensaje puede variar de una corrida a otra y eso no es un defecto. Un mismo input no crea un segundo trabajo ni una segunda propuesta: devuelve la que ya existe. Es el mismo input si coinciden el texto normalizado, los adjuntos por hash, los enlaces y el emisor. El emisor entra en el hash porque la propuesta es privada de quien la envía hasta que la publica. Dos personas que mandan el mismo texto tienen cada una su input. DT-001 anota que esa razón no está escrita en una decisión.

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
4. El input pasa a `proposed`. En Inicio aparece la propuesta editable: área, cada mensaje, sus destinatarios, sus adjuntos. La persona corrige lo que quiera y aprieta Enviar. `POST /api/inputs/:id/publish` crea los mensajes en estado `abierto`.
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
| Video | Binario `ffmpeg` estático y mínimo por `spawn`, 8.1.3 en configuración LGPL con 22 decodificadores (H.264, HEVC, VP8, VP9, AV1 por dav1d, AAC, ALAC, Opus, Vorbis, FLAC, MP3, PCM) (`fluent-ffmpeg` está archivado desde 2025-05-22 y el WASM no corre en Node): pista de audio a transcripción; un fotograma por segundo deduplicado por dHash de 64 bits a distancia 6, tope de 48 fotogramas de 720 px; el umbral de cambio de escena queda apagado (en una grabación de pantalla sintética `scene>0,2` cubrió 8 de 16 pantallas; 1 fps más dHash dejó 18 fotogramas y cubrió 16 de 16; informe 06) | Sin un tercer proveedor; costo del mismo orden que el video nativo de Gemini (0,0019 USD por minuto contra 0,001 a 0,005), que queda como alternativa configurable porque pierde el muestreo determinista y la vista auditable. |
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

Desarrollo del panel: Vite 8, Tailwind 4.3 con `@tailwindcss/vite` (MIT), TypeScript 7, Vitest 5, jsdom y `@testing-library/react` (MIT), Playwright y TypeScript (Apache-2.0).

**Dos límites de licencia que quedan a la vista.** Primero, `sharp` trae `libvips` como binarios opcionales por plataforma, con licencia LGPL-3.0-or-later. Se enlaza de forma dinámica y se sustituye con otro `libvips`. HP-011 lo exceptúa por nombre. Segundo, la imagen incluye el binario `ffmpeg` del repositorio de Alpine, con la licencia de ese paquete. Se invoca como proceso externo y no se enlaza. El informe 06 anota que el `ffmpeg` estático es GPL-3.0-or-later. La decisión de conservarlos o cambiar de biblioteca queda en DT-002.

---

## §4. Restricciones (límites inviolables)

> Estas restricciones mandan sobre cualquier otra decisión. Cada una tiene su prohibición en la batería o su candado en el código.

1. **Ningún dato del equipo sale del contenedor** salvo hacia los proveedores de modelo configurados y, si el operador lo configura, hacia un colector OTLP. Todo lo que pasa por un modelo se mide con OpenTelemetry y se guarda (UD-014). Hay un span por trabajo, por paso, por llamada a proveedor y por uso de herramienta. Llevan las convenciones `gen_ai.*`, el contenido completo de entrada y salida, tokens, costo y duración. Un exportador propio los guarda en SQLite y `llm_calls` es una vista sobre esos spans. Vale también para el navegador: el panel no se conecta a ningún otro dominio (CSP `connect-src 'self'`, `img-src 'self' blob: data:`), lo que excluye cualquier telemetría de una librería.
2. **Ningún `if`, expresión regular ni lista de palabras sobre texto humano decide área, destinatario ni estado** (§1.2). El modelo entrega campos; el sistema valida la forma.
3. **Un trabajo nunca depende del navegador.** Sobrevive al cierre de la pestaña y al reinicio del proceso. Al arrancar, el worker retoma los trabajos con arriendo vencido (UD-003, UD-010).
4. **Nada llega al equipo sin que el emisor confirme** la propuesta (UD-003). Las conexiones futuras que publiquen directo lo harán por una perilla propia, apagada por omisión.
5. **Un contenedor y un volumen bastan para correr.** Ningún componente obligatorio fuera de la imagen; los proveedores de modelo son externos y configurables.
6. **Ninguna credencial en el repositorio ni en la base.** Variables de entorno o archivo fuera del repositorio. HP-007 comprueba que ninguna columna guarde una llave; `.gitignore` excluye `.env` y `scripts/llave.mjs` guarda las llaves locales en `~/.config/team-platform/env`. El gancho de pre-commit que escanea secretos todavía no existe (DT-004).
7. **Código y comentarios en inglés.** Interfaz, mensajes a la persona, plantillas iniciales y documentación van en español. UD-015 reemplaza a UD-005 en los comentarios. Sin esquema mezclado.
8. **Sólo un miembro distinto del emisor responde un mensaje; cualquier miembro lo cierra o reabre.** Lo hace cumplir la API, no el panel.
9. **Todo número que gobierna la operación nace declarado**: tamaño máximo de adjunto, fotogramas por video, páginas por llamada, reintentos, arriendo de un trabajo. Sale de una medición citada o de una perilla de configuración con su valor por omisión justificado, nunca de «parece razonable».
10. **Licencias en dos capas** (UD-004, UD-020). Lo que se enlaza con el código (el repositorio y toda dependencia de npm) lleva licencia permisiva compatible con MIT. Lo que la imagen ejecuta como programa aparte o carga como biblioteca sin modificar (`ffmpeg`, `libvips` de `sharp`) puede ser LGPL, nunca GPL, y cada uno figura en `NOTICE` dentro de la imagen con su versión, su licencia y la dirección de su código fuente. Una prueba de la batería lo hace cumplir leyendo `package.json` y el `NOTICE`.
11. **La API es la única puerta.** El panel no lee la base ni el volumen. Lo que el panel puede hacer, un sistema externo lo puede hacer con el mismo contrato (UD-010). El contrato se publica generado desde los esquemas de las rutas (`GET /api/openapi.json`, OpenAPI 3.1) y ninguna ruta queda sin esquema de respuesta. Un frontend distinto (otro dominio, otro framework, otros componentes y tipografías) reimplementa sólo las vistas. `CORS_ORIGINS` y `COOKIE_MODE=cross-origin` son las dos perillas que lo permiten desde otro origen.

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

---

## §6. Interfaz y experiencia

**Atmósfera de referencia:** Y2K futurista (UD-013). Vidrio translúcido con reflejos, cromo y metal líquido, degradados iridiscentes, formas redondeadas, azul eléctrico sobre plata con acentos lima y lila. La tipografía es de la época, con licencia libre y empaquetada. Es un producto de 2026 que cita el 2000, con referencias fechadas y tokens en `panel/DISENO.md`. Nada muy loco. Manda la jerarquía visual (escala de tamaños, alineación a grilla, formas con intención, espacio negativo activo, distribución asimétrica donde corresponde) y una identidad reconocible. Los valores que delatan diseño generado por IA están prohibidos. En lo funcional, un programa de gestión estándar, no una web que conversa. Rótulos de una a tres palabras como sustantivos («Mensajes», «Equipo»), sin texto de ayuda por omisión, sin segunda persona. Densidad de una bandeja de entrada de correo de escritorio: todo lo que se necesita ahora cabe sin desplazarse; lo demás nace plegado. La maqueta manda en la disposición: barra lateral a la izquierda, cabecera «[Nombre] TEAM» con campana y menú, contenido a la derecha.

**Edición y alto (UD-017):** todo texto editable se edita en el lugar (clic entra, clic afuera o Enter guarda, Escape cancela), con deshacer y rehacer visibles y por teclado, sin historial de versiones; cada vista cabe en una pantalla a 1440×900 y a 1280×720, con revelación progresiva (lo que se necesita ahora a la vista, lo demás plegado con su cuenta) y listas que paginan dentro del marco con un tamaño medido.

**Flujo principal de la persona:**

1. Entra. Ve Inicio: nombre del proyecto, fecha y hora, la barra «Nuevo mensaje» con clip (adjuntos), cámara (foto), micrófono (audio) y enviar.
2. Escribe, pega una captura o arrastra un docx, y envía. La barra se vacía. Debajo aparece la vista previa del input (texto y adjuntos con su miniatura). Al lado queda el bloque «Análisis», con una barra de progreso y la frase del paso en curso («leyendo el documento», «3 de 7 adjuntos»).
3. Al terminar, el bloque muestra los mensajes propuestos. Cada uno trae su área (insignia, cambiable), título, texto según la plantilla de esa área, destinatarios (chips, editables) y adjuntos (miniaturas, quitables). Edita lo que quiera. Aprieta Enviar.
4. Los mensajes aparecen en «Últimos mensajes». Quien los recibe los ve en su Inicio, filtrados para él por omisión. Cada tarjeta muestra la insignia del área, el emisor, la fecha y la miniatura del adjunto principal.
5. Responde desde la tarjeta o desde Mensajes. El hilo crece debajo del mensaje. Cualquiera cierra; el estado se ve como insignia, nunca como prosa.

**Vistas** (barra lateral, en este orden; `idea.md` y UD-006):

| Vista | Qué muestra | Quién |
|---|---|---|
| Inicio | Barra de envío, aviso «Para mí» con los pendientes por prioridad y por área, últimos mensajes (para mí por omisión) y últimas respuestas (que me involucran) siempre a la vista; los envíos (cola, original y análisis) tras un solo control con su estado, que abre la revisión en un diálogo (UD-028 a UD-030) | Todos |
| Mensajes | Todos los mensajes del equipo con filtros: para mí, para X, por área, por estado, respuestas; búsqueda | Todos |
| Áreas | Áreas con su conteo de abiertos y sus plantillas; edición en el lugar | Editor |
| Equipo | Miembros con su perfil; cada uno edita el suyo | Todos |
| Conexiones | API, MCP, correo, WhatsApp, GitHub Issues (UD-012). Apagada: visible como entrada deshabilitada con la razón | Editor |
| Configuración | Cuenta, tema claro u oscuro, proveedores de modelo (Editor) | Todos |

**Componentes de interfaz:**

| Componente | Función | Archivo |
| --- | --- | --- |
| `Sidebar` | Navegación, usuario, conteo de abiertos por área | `panel/src/components/Sidebar.tsx` |
| `NotifyBadge`, `ToneMark` | Insignia grande y marca de prioridad: fondo del color de la prioridad más alta presente (rojo, amarillo, azul), con forma, palabra y número (UD-029). La prioridad se decide en `panel/src/lib/priority.ts` | `panel/src/components/NotifyBadge.tsx` |
| `ComposeBar` | Barra de nuevo mensaje con adjuntos, cámara, micrófono, enviar | `panel/src/components/ComposeBar.tsx` |
| `InputPreview` | Texto y adjuntos del input enviado | `panel/src/components/InputPreview.tsx` |
| `AnalysisPanel` | Progreso por SSE, propuesta editable con área por mensaje, Enviar | `panel/src/components/AnalysisPanel.tsx` |
| `MessageCard` | Área, emisor, fecha, texto, adjunto principal, estado, acciones | `panel/src/components/MessageCard.tsx` |
| `ReplyThread` | Hilo lineal de respuestas con formulario al pie | `panel/src/components/ReplyThread.tsx` |
| `MessagesList` | Lista con filtros y búsqueda | `panel/src/pages/Messages.tsx` |
| `AreasEditor` | Áreas y plantillas, edición en el lugar | `panel/src/pages/Areas.tsx` |
| `Team` | Miembros, edición de lo propio | `panel/src/pages/Team.tsx` |
| `Settings` | Cuenta, tema, proveedores | `panel/src/pages/Settings.tsx` |
| `MessageDetail` | Un mensaje con su hilo y sus acciones | `panel/src/pages/MessageDetail.tsx` |
| `Login` | Inicio de sesión local | `panel/src/pages/Login.tsx` |
| `Header` | Cabecera «[Nombre] TEAM», campana de avisos y menú de la cuenta | `panel/src/components/Header.tsx` |
| `FilterBar` | Filtros de Mensajes como chips en la URL | `panel/src/components/FilterBar.tsx` |
| `EditableText`, `EditableTags`, `MemberPicker` | Edición en el lugar de texto, dominios y destinatarios | `panel/src/components/` |
| `MediaGallery`, `MediaGalleryDialog`, `MediaOpener`, `AttachmentStrip` | Visor y carrusel de adjuntos, reutilizado en la ficha, las respuestas, la lista, Inicio y la propuesta (UD-040) | `panel/src/components/MediaGallery.tsx` |
| `StatusBadge`, `Thumb`, `Avatar` | Estado como insignia, miniatura de adjunto, iniciales | `panel/src/components/` |
| `Atmosphere`, `icons` | Fondo de la piel Y2K y juego propio de íconos | `panel/src/components/` |
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

POST   /api/inputs                multipart: text, files[], links[] → { input_id, job_id, status, duplicate, restarted }
                                  202 si el análisis queda en cola; 200 si el mismo contenido del mismo emisor ya existía (§1.3)
GET    /api/inputs?status=        los inputs propios
GET    /api/inputs/:id            input propio: adjuntos, estado, unidades y propuesta si existe
POST   /api/inputs/:id/publish    propuesta editada → mensajes creados
POST   /api/inputs/:id/cancel     también un análisis fallido
POST   /api/inputs/:id/restore    deshace el descarte: vuelve a propuesta (con sus ediciones) o a fallido; no reanaliza
POST   /api/inputs/:id/reprocess  (Editor) vuelve a encolar el análisis conservando las extracciones

GET    /api/events                SSE por miembro (§7.10); ?job_id= lo acota a un trabajo

GET    /api/messages?for=me|id&area=&status=&q=&replies=1
GET    /api/messages/summary      lo que afecta a quien tiene la sesión por prioridad (`mine`: red, yellow, blue, total) y los abiertos por área (`areas`: open, mine_open) (UD-028)
GET    /api/messages/:id          mensaje, hilo, adjuntos
GET    /api/attachments/:id/transcript  texto extraído de un audio o video (UD-040)
POST   /api/messages/:id/replies  { body, kind: answer|fix|clarification }   (403 si quien responde es el emisor)
POST   /api/messages/:id/close · POST /api/messages/:id/reopen

GET    /api/areas                 áreas con conteos y plantillas sin cuerpo   (?include_deleted=true: Editor)
POST   /api/areas · PATCH /api/areas/:id · DELETE /api/areas/:id?confirm=true · POST /api/areas/:id/restore      (Editor)
GET    /api/areas/:id/templates   plantillas con el archivo completo          (Editor)
POST   /api/areas/:id/templates · PATCH /api/areas/:id/templates/:templateId
DELETE /api/areas/:id/templates/:templateId?confirm=true · POST /api/templates/:id/restore                        (Editor)

GET    /api/members
POST   /api/members               alta de un miembro                          (Editor)
PATCH  /api/members/me            perfil, idioma y contraseña propios (`profile`: texto, tope en `members.profileMaxLength`)
PATCH  /api/members/:id                                                        (Editor)

GET    /api/settings/providers · PATCH /api/settings/providers                (Editor; nunca devuelve una llave)
GET    /api/settings/project         { name, description } (cualquier miembro)
PATCH  /api/settings/project         descripción del proyecto en markdown: JSON { description } o multipart con `file` (.md) (Editor; tope PROJECT_DESCRIPTION_MAX_CHARS, 413 al superarlo; bitácora `settings.project.update`)
GET    /api/attachments/:id       archivo, con control de acceso y Range

GET    /api/jobs?state=           la cola de trabajos                         (Editor)
DELETE /api/jobs?state=&confirm=true   purga los terminados                   (Editor)
GET    /api/jobs/:id/trace        árbol de spans de un trabajo                (Editor)
GET    /api/audit                 bitácora: quién creó, publicó, cerró, reabrió o editó, y cuándo   (Editor)
GET    /api/health · GET /health  público; el detalle de base, cola y proveedores, sólo al Editor
GET    /api/openapi.json          contrato OpenAPI 3.1
```

Un Miembro lee las áreas (con sus plantillas sin cuerpo) porque necesita nombrarlas y cambiarlas en la propuesta de su input (§6, paso 3). Escribirlas, leer el cuerpo de una plantilla y ver los proveedores son del Editor (HP-015).

**Dependencias:** `fastify`, `@fastify/multipart`, `@fastify/cookie`, `@fastify/static`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/swagger`, `@fastify/sse`, `ajv`.

### 7.2 Dominio y esquema (`src/db/`)

**Propósito:** Las tablas son la especificación. Identificadores en inglés (UD-005, UD-015). Las marcas de tiempo son enteros en milisegundos Unix (UTC) y la API las expone en ISO 8601; los spans van en nanosegundos.

```
members              id, email (único sin distinguir mayúsculas), name, role(member|editor), profile (texto libre, UD-023; reemplaza a responsibilities y domains), created_at
credentials          member_id, password_hash, updated_at, failed_count, next_attempt_at        (proveedor local; espera exponencial por cuenta)
sessions             id (SHA-256 de la ficha), member_id, created_at, last_seen_at, expires_at
identity_links       provider, external_id, member_id, created_at                               (identidad delegada)
sso_nonces           nonce, created_at, used_at                                                 (modo sso-redirect; uso único)
areas                id, title (único entre las vigentes), description, position, deleted_at
templates            id, area_id, name (único dentro del área entre las vigentes), description, body_markdown (archivo completo con su encabezado), updated_at, deleted_at
inputs               id, author_id, text, content_hash UNIQUE (incluye al emisor), status(queued|extracting|analyzing|proposed|published|failed|cancelled), error, error_code, created_at, updated_at
attachments          id, input_id, kind(image|video|audio|document|link), name, path (sha256 en el volumen; la URL si es un enlace), mime, size, sha256, extracted_text, extracted_at, extract_meta_json
proposals            input_id (PK), payload_json ({ messages:[{ area_id, template_id, … }], discarded }), units_json, created_at
messages             id, input_id, area_id, template_id, author_id, title, body, fields_json, status(open|answered|closed), created_at, closed_at
message_assignees    message_id, member_id
message_attachments  message_id, attachment_id, position (el primero es el adjunto principal de la tarjeta)
replies              id, message_id, author_id, body, kind(answer|fix|clarification), created_at
jobs                 id, kind(extract|analyze), input_id, payload_json, status(queued|running|done|failed|cancelled), priority, attempts, max_attempts, run_at, lease_until, worker_id, last_error, created_at, finished_at
                     índice (status, priority DESC, run_at, id): reclamo en 23 µs (informe 03)
job_events           seq, job_id, kind(progress|done|message), member_id (destinatario; NULL = todo el equipo), percent, phrase, data_json, at     retención 7 días
settings             key, value_json, updated_at                                                (proveedor y modelo por ranura; nunca una llave)
audit_log            id, at, member_id, action, entity, entity_id, detail_json
spans                trace_id, span_id, parent_id, name, kind, start_ns, end_ns, status, status_message, attributes_json, events_json; job_id y operation generadas      (migración 0002)
llm_calls            VISTA sobre los spans de llamada a un modelo: id, job_id, provider, model, modality, input_tokens, output_tokens, cached_tokens, cost_usd, duration_ms, at, trace_id, status, error_type, step
```

Áreas y plantillas se borran en blando (`deleted_at`) y se restauran: los mensajes que las referencian no se pierden. Los estados de un mensaje se muestran en la interfaz como «abierto», «respondido» y «cerrado» (§1.1). Cada propuesta lleva el área y la plantilla en cada mensaje, no en la raíz (§7.5). No guarda un id de llamada a modelo: las llamadas son spans, enlazados al trabajo por `team.job_id` (§7.10 bis).

**Dependencias:** `node:sqlite`. Las migraciones son archivos SQL numerados en `src/db/migrations/` (`0001_initial.sql` y `0002_telemetry.sql`, copia de `src/telemetry/migration.sql`). Sólo avanzan. Un ejecutor propio las aplica dentro de una transacción, lleva la cuenta en `PRAGMA user_version` y corre en el paso de inicialización único (§3). El ejecutor exige numeración contigua y se niega a arrancar si la base es más nueva que el último archivo. Antes de migrar una base existente deja un respaldo consistente.

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

### 7.4 Extractores (`src/extract/`)

**Propósito:** Convertir cada adjunto en texto o descripción antes del analizador, de forma determinista y medida.

| Tipo | Extractor | Salida |
|---|---|---|
| imagen | proveedor de visión: «describe todo lo que sea accionable para un equipo de software, textual». lado largo máximo de 2.576 px (informe 06). HEIC de iPhone se rechaza con `image_heic_unsupported` y un motivo legible (`sharp` con sus binarios precompilados no lo decodifica; la conversión no está implementada) | texto |
| documento (pdf, docx, pptx, xlsx, txt, md) | `@hyzyla/pdfium` para PDF y `officeparser` para Office (informe 05); una página con menos de 30 caracteres sin espacios cuenta como escaneada (las escaneadas medidas dieron 0; la digital más pobre, 146) y sólo esas páginas van al proveedor en modo nativo, partiendo el PDF con `pdf-lib`; tope de 270.000 caracteres extraídos (100 páginas por 2.700) y de 100 páginas por llamada nativa | markdown o texto por página |
| audio | FLAC 16 kHz mono (1,83 MB por minuto; Opus a 32 kbps, 0,21 MB por minuto, queda como opción tras medir la tasa de error en español); trozos de 600 s con 5 s de solapamiento para el tope de 25 MB de Groq, fusionados por marca de tiempo; `verbose_json`, segmentos, `language=es`, `prompt` sólo de vocabulario. La cola lleva un presupuesto de audio de 7.200 s por hora (límite del plan de Groq: seis videos de 20 minutos por hora para todo el equipo) | texto con marcas de tiempo `mm:ss`, una línea por frase: los segmentos consecutivos se unen mientras el anterior no cierre oración (`.?!…`) y la pausa sea menor a 0,5 s, sin cruzar un trozo y con tope de 40 palabras (medición `2026-10-20-unidades-de-audio.md`) |
| video | `ffmpeg`: pista de audio → extractor de audio; un fotograma por segundo → dHash 64 bits, distancia 6 → a lo sumo 48 fotogramas de 720 px (JPEG calidad 4, 1.456 tokens y 60 KB cada uno, 69.888 tokens en total, bajo el escalón de precio de 100.000) elegidos por orden de cambio y reordenados en el tiempo → proveedor de visión en una sola llamada; transcripción (ya unida en frases) y fotogramas se intercalan por orden cronológico con su marca `mm:ss`. Tope 20 minutos y 2 GB | transcripción + descripción por fotograma, en una línea de tiempo |
| enlace | `undici` con `lookup` filtrado y revisión de IP literales (nada a redes privadas ni a `localhost`), `redirect: 'manual'` revalidando cada salto hasta 5, tope de 5 MiB en el flujo y 15 s; contenido principal con `@mozilla/readability` sobre `linkedom` (24 a 98 ms; `jsdom` duplica el tiempo) | markdown |

**Interfaz:** `extract(attachment, { providers, onProgress, signal }) → { text, meta }`. `meta` siempre trae `kind`, `warnings` y `elapsedMs`; `meta.calls` lista las llamadas a proveedores. Un fallo es un `ExtractError` con código estable y motivo en español (`document_too_large`, `video_too_long`, `image_heic_unsupported`, `link_blocked`, …). Sólo `link_timeout` y `link_fetch_failed` se reintentan. El resto es una propiedad del adjunto y falla de inmediato. Cada extractor es un archivo; registrar uno nuevo es agregarlo al mapa por tipo. `createAudioBudget()` lleva el presupuesto de audio por hora y la cola aplaza el trabajo sin gastar intento cuando no hay cupo.

Los topes de tamaño por tipo se aplican en dos lugares: al subir (`src/config.js`, antes de encolar, 413) y al extraer (`src/extract/config.js`). La duración de un video (20 minutos) sólo se conoce al extraer, así que ese rechazo llega como fallo del trabajo con su código. El tope de un documento es 25 MiB al subir y 24 MiB al extraer (DT-005).

### 7.5 Analizador (`src/analyze/`)

**Propósito:** La mecánica central: de un input extraído a una propuesta MECE. Un contrato y dos implementaciones (UD-008).

**Interfaz:**

```
analyze(bundle, { providers, onProgress, config, analyzer }) → AnalyzeResult
bundle = { text, attachments:[{id, kind, name, extracted}], areas:[{id,title,description,position}],
           templates:[{id,area_id,name,description,body_markdown}], members:[{id,name,profile}], project:{name,description} }  -- project.description (UD-024) va en el sistema cacheado de las dos llamadas, tras el catálogo y la plantilla; profile: el texto completo, sin recortes (UD-023)
AnalyzeResult = { status:'ok', proposal, units, calls, stats }
              | { status:'refusal' | 'max_tokens' | 'invalid', step, errors, …, units, calls, stats }
Proposal = { messages:[{ area_id, template_id, title, body, fields, assignee_ids, attachment_ids, unit_ids }], discarded:[{ unit_ids, reason }] }
```

Un rechazo del proveedor, un corte por `max_tokens` y una salida inválida o con conflicto MECE tras el único reintento son estados del resultado, no excepciones. El trabajo del input falla sin reintento con ese `error_code` (`src/contracts.md` §1). `calls` trae una entrada por llamada al modelo (paso, proveedor, modelo, tokens, duración, resultado).

**`api` (omisión):** variante A de la investigación, dos llamadas con salida estructurada.

1. **Numerar.** `units.js` parte el texto extraído en unidades por su estructura, nunca por su significado (§4.2). Una unidad es una oración de un párrafo (`Intl.Segmenter`, locale `es`, con una lista de abreviaturas que ICU corta por error). También es unidad un elemento de una enumeración en línea, una viñeta o un tramo entre puntos y coma. Lo es además una línea de la descripción de una imagen o un fotograma. Una enumeración en línea es «1) … 2) …» o «a) … b) …», y sólo cuenta si empieza en 1 o en «a» y sube de a uno. En un chat cada línea es un párrafo. Una transcripción de audio o video no baja a oración: cada segmento con su marca `mm:ss` es una unidad. El entero de la unidad es lo que se cita; el rótulo (`p3.s2`) queda en `units[].label`. Antes de bajar a oración, un mensaje de chat de cuatro puntos era una sola unidad y salía como un solo mensaje (REG-001).
2. **Clasificar** (esfuerzo `low`, pensamiento apagado). Con los títulos y descripciones de áreas y plantillas, reparte las unidades en grupos `{ unit_ids, area_id, template_id }` de un solo punto cada uno. Lo que no pide ni informa nada va en `discarded`. Un mismo input trae un error, una idea y una pregunta y cada mensaje va en su área (`idea.md`). `area_id` y `template_id` son `enum` de los ids existentes. `unit_ids` va primero en el esquema, para que el modelo ancle el grupo a su evidencia antes de decidir la categoría. Si el input supera el umbral de partición se clasifica por trozos estructurales y los grupos se unen.
3. **Descomponer** (esfuerzo `low`, pensamiento apagado), una llamada por grupo y en paralelo, con el cuerpo de la plantilla del grupo. Devuelve los mensajes del grupo, cada uno con `unit_ids`, título, campos de la plantilla, cuerpo, destinatarios y adjuntos. Su esquema no tiene `discarded`. El único lugar donde se descarta es la clasificación, porque sin pensamiento el modelo usaba `discarded` para datos que ya había pasado al cuerpo del mensaje. Un grupo que vuelve sin mensajes cuenta como salida inválida y se reintenta una vez.
4. **Rescatar.** Con las unidades de cada grupo, el sistema calcula por aritmética de conjuntos dos cosas. Un solape es una unidad en dos mensajes. Un hueco es una unidad en ninguno. No lee prosa. Si hay conflicto, un único pase de rescate sobre esas unidades; sin autoconsistencia por omisión (veinte muestras mejoran 0,4 %, informe 02).
5. **Reducir y validar.** Los grupos son disjuntos por unidad, así que la reducción es una concatenación determinista por `unit_ids`, sin llamada. La propuesta completa se valida otra vez sobre la unión de todos los grupos.

**Perillas** (`src/analyze/config.js`; cada una lleva su fuente en el código):

| Perilla | Omisión | Fuente |
|---|---|---|
| `classifyEffort`, `decomposeEffort` | `low` | Medición 2026-10-20 (`docs/investigaciones/mediciones/2026-10-20-primera-corrida-real.md`). El informe 02 fijaba `medium` para descomponer hasta que el banco mostrara que `low` conservaba la cobertura. Con la clasificación en un punto por grupo la conserva y baja cada llamada de 6 a 12 s a 1 a 3 s |
| `classifyThinking`, `decomposeThinking` | `disabled` | La misma medición. Con `low` y pensamiento adaptativo el caso de cuatro puntos tardaba de 5,9 a 9,1 s; con `low` sin pensamiento, de 3,3 a 3,6 s (cinco corridas de cinco con las cuatro áreas correctas) |
| `partitionConcurrency` | 16 | La misma medición, sobre el docx de 40 puntos (40 grupos): 4 a la vez, 26 s; 8, 16 s; 16, 10,5 s, sin errores 429. El límite de tasa de otra cuenta puede obligar a bajarlo |
| `maxTokens`, `maxTokensRetry` | 16.000 y 32.000 | Provisional (informe 02 §10.2); el corte reintenta una vez con el doble. El banco fija el p95 real |
| `invalidOutputRetries`, `rescuePasses` | 1 y 1 | Informe 02 §3.1 y §10.2 |
| `partitionThresholdTokens`, `charsPerToken` | 100.000 y 3 | Provisional: frontera de precio de Haiku 5.5 y estimación de tokens por carácter; el banco los calibra |
| `cacheTtl`, `minCacheableSystemTokens` | `5m` y 512 | Informe 02 §7. Un TTL de 1 hora si el acierto de caché medido es bajo |

Si el input supera el umbral de partición, se parte sólo por fronteras estructurales en trozos disjuntos por unidad. Los trozos se procesan en paralelo y la reducción es la misma concatenación. Un monólogo transcrito no se parte. El esquema de salida de cada plantilla se compila una vez. Se calienta por evento al guardar una plantilla (`warmTemplate`) o al cambiar el catálogo de áreas (`warmCatalog`). La gramática compilada se cachea 24 horas desde el último uso.

**`harness`:** el mismo bundle se escribe en un directorio de trabajo vacío y propio (`input.md`, `bundle.json`, `templates/<id>.md`); `claude -p --output-format json --json-schema <Proposal>` con sólo la herramienta de lectura; se lee `structured_output`, `usage` y `total_cost_usd`. Sin `--bare` para que use la suscripción [V]. Mismo validador de salida que `api`.

**Validación (sistema, no modelo), con una instancia propia de Ajv**, porque los esquemas de respuesta de Fastify convierten tipos y descartan propiedades (informe 03). Se comprueba que el área y la plantilla existen y se corresponden. Cada `assignee_id` debe ser un miembro y cada `attachment_id` debe pertenecer al input. Cada `unit_id` debe existir y cada unidad debe estar en un mensaje o en `discarded`. Cada campo obligatorio de la plantilla debe estar presente y ningún mensaje queda vacío. Una salida inválida reintenta una vez con el error como contexto; después el trabajo falla con el motivo visible. Un `refusal` no se reintenta igual y un corte por `max_tokens` reintenta una vez con el doble. El proveedor de respaldo (`TEXT_FALLBACK_*`) se construye y se informa en `GET /health`, pero ningún paso lo invoca todavía (DT-003).

**Spans.** Un span `analyze` por análisis (`team.analyzer`, `team.status`, `team.units`, `team.messages`) con hijos `classify` (`team.groups`), `decompose` por grupo (`team.group_index`, `team.area_id`, `team.template_id`, `team.units`), `rescue` (`team.overlaps`, `team.gaps`), `validate` (`team.valid`, `team.error_count`, `team.errors`) y, en el harness, `harness`. Las llamadas a proveedores cuelgan de esos spans (§7.10 bis).

**Medición vigente** (2026-10-20, Haiku 5.5, una cuenta y una máquina). El mensaje de chat de cuatro puntos sale en cuatro mensajes con su área en 3,3 a 3,6 s. En el banco de siete casos, seis tienen mediana de 3,0 a 7,4 s y el docx de 40 puntos 10,5 s. La cobertura es 100 % en seis casos y 90 % en el monólogo (`03-monologo-prueba`), que no alcanza MECE en ninguna repetición. Detalle y lo no resuelto en la medición citada.

### 7.6 Proveedores de modelo (`src/providers/`)

**Propósito:** Una ranura por modalidad, configurable (UD-001).

```
providers.text          .complete({ system, messages, schema, effort, maxTokens, cacheTtl, thinking }) → { json, usage, provider, model, duration_ms }
providers.textFallback  la misma firma; null si no se declara TEXT_FALLBACK_PROVIDER
providers.vision        .describe({ images[], prompt, schema })          → { json, usage }
providers.speech        .transcribe({ audioPath, language })             → { text, segments }
providers.describe()    estado de cada ranura para GET /settings/providers y GET /health, sin llaves
```

Implementaciones: `anthropic` (texto, visión y PDF), `openai-compatible`, `groq-speech` y `fake` (para pruebas y para el banco). `anthropic` usa Messages nativo por `fetch`, sin SDK, con caché del prompt de sistema y sin `temperature`, `top_p` ni `top_k`. `openai-compatible` trae preajustes de DeepSeek, Groq, OpenRouter y Gemini, con tres modos de salida estructurada: `json_schema`, `tool` y `json_object` validado con Ajv. Modelo por omisión: `claude-haiku-5-5` en texto y visión, `deepseek-flash` si se elige DeepSeek, `whisper-large-v3-turbo` en transcripción. La configuración vive en variables de entorno (`TEXT_*`, `VISION_*`, `SPEECH_*`, `TEXT_FALLBACK_*`; lo que falte en visión se hereda de texto). Se edita desde Configuración (Editor). La base guarda sólo el nombre del proveedor y el modelo, nunca la llave (§4.6). Cada llamada abre su propio span `gen_ai.*` (§7.10 bis).

### 7.7 Identidad (`src/identity/`)

**Propósito:** Un contrato con dos implementaciones (UD-002).

```
identify(request) → { member_id, role } | null
```

`local`: correo y contraseña. El hash es Argon2id de `crypto.argon2` (Node ≥ 24.7) con 19 MiB, 2 pasadas y 1 hilo, el mínimo de OWASP, 19 ms medidos. Si cambian los parámetros, se vuelve a hashear al iniciar sesión. La contraseña tiene de 15 a 128 caracteres, sin reglas de composición y con lista de bloqueo opcional. La ficha de sesión es opaca, de 32 bytes, y se guarda con SHA-256 en `sessions`. La cookie es `__Host-` `HttpOnly` `Secure` `SameSite=Lax`. Se regenera al iniciar sesión y al cambiar de rol. Vence a los 30 minutos de inactividad y a las 8 horas en términos absolutos.

El CSRF se defiende por `Sec-Fetch-Site` y `Origin` en un gancho `onRequest`. El panel manda además la cabecera `X-Team-Request` en toda petición no segura con sesión. El límite por IP usa `@fastify/rate-limit` y el de cada cuenta una espera exponencial. `trustProxy` lleva una lista de IP, nunca `true`.

`delegated` tiene cuatro modos bajo el mismo contrato. `signed-header` es un HMAC con marca de tiempo y tolerancia de 5 minutos, patrón de Stripe, con dos secretos durante la rotación. `jwt` usa `jose` contra JWKS o un secreto compartido. `sso-redirect` usa un nonce de uso único, patrón DiscourseConnect. `trusted-header` sólo vale si la conexión viene de una dirección de confianza; es lo que entrega `tailscale serve` en `Tailscale-User-Login`.

Ningún modo da de alta miembros: el correo tiene que existir en `members` (UD-007) y el rol sale de la base, no del proveedor. El primer Editor nace de `ADMIN_EMAIL` sólo si la base no tiene miembros. Con `NODE_ENV=development` existe `POST /api/auth/dev-login`, sin contraseña. Si la aplicación vive dentro de otro sitio, se monta bajo el mismo origen por proxy inverso. Un frontend en otro origen usa `CORS_ORIGINS` y `COOKIE_MODE=cross-origin` (§4.11). Los roles `member` y `editor` son un enumerado con `CHECK`. Un gancho `requireRole` por ruta deniega por omisión, y el servidor no arranca si una ruta no declara su política. Perillas y fuentes en el informe 04.

### 7.8 Panel (`panel/`)

**Propósito:** Cliente estático React contra `/api`. No sabe de la base ni del volumen (§4.11). Se compila con Vite en la primera etapa del `Dockerfile` y lo sirve `@fastify/static` desde la misma imagen. Los activos llevan hash y son inmutables, `index.html` va sin caché, un activo ausente da 404 y bajo `/api` el 404 es JSON. Sin panel compilado la API arranca igual. En desarrollo, Vite hace proxy de `/api` hacia `PANEL_API` o hacia `panel/dev-server.mjs`, un servidor doble en memoria que no entra a la imagen. Panel y API comparten origen, así que la cookie de sesión y `EventSource` no necesitan CORS.

Rutas: Inicio, Mensajes, detalle de un mensaje, Áreas (con área seleccionada), Equipo y Configuración. Cuando `GET /me` responde 401 se muestra el inicio de sesión.

Entrada multimodal:

- Arrastrar y pegar capturas.
- Cámara del teléfono por `<input capture>`.
- Audio con `MediaRecorder`, que prueba `audio/webm;codecs=opus`, `audio/webm` y `audio/mp4` y lee `recorder.mimeType` (Safari anterior a 18.4 sólo graba MP4).
- Subida multipart con `XMLHttpRequest` para tener progreso, con reintento que reenvía el archivo.

Los límites iniciales son imagen 7 MB, audio 25 MB, documento 25 MB y video 2 GB, declarados en `src/config.js` (informe 07).

Mensajes es una lista de `MessageCard`. Los filtros viven en la URL como chips de propiedad, operador y valor (`panel/src/lib/filters.ts`; patrón de Linear, Plane y Front). No hay tabla virtualizada hasta que haya cientos de filas. Los componentes de shadcn/ui están copiados a `panel/src/components/ui/`, sobre Radix (38 KB comprimidos menos que Base UI, medido en el informe 07). Las tipografías van empaquetadas (Orbitron y Source Sans 3, OFL-1.1), con tema claro y oscuro. La base de navegadores es Chrome 111, Safari 16.4 y Firefox 128. El paquete único mide 506 kB (156 kB comprimidos, medido el 2026-10-20).

`panel/DISENO.md` guarda las referencias y los tokens de la piel Y2K (UD-013). `npm run contraste` mide el contraste de cada par de texto. `npm run capturas` recorre cada vista a 1440x900 y 390x844 con Chromium sin ventana.

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
---
## Método
Cómo leer el input para esta área: qué cuenta como un error distinto, cómo separar dos errores
que comparten una captura, qué va en cada campo.

## Formato de salida
Un mensaje por error. Título: verbo en infinitivo y lugar.
```

El frontmatter se convierte en el esquema JSON de `fields` que el analizador exige. `compileFieldsSchema` es la misma definición que valida una plantilla al guardarla (422 si no cumple) y los `fields` de cada mensaje al publicar. El cuerpo entra al prompt de la descomposición. `name` y `description` respetan los límites de la especificación Agent Skills (64 y 1.024 caracteres), porque la clasificación sólo ve esos dos campos de cada plantilla. El cuerpo se revela recién en la descomposición: la misma divulgación progresiva. El juego inicial vive en `templates/`: `areas.json` (cinco áreas: Idea, Error, Nueva funcionalidad, Retroalimentación, Pregunta, cada una con su archivo `idea.md`, `bug.md`, `feature.md`, `feedback.md`, `question.md`). Se siembra al instalar y se puede editar o borrar; cada plantilla editada se copia además a `$DATA_DIR/templates` para los respaldos, y la base manda.

### 7.10 Eventos y progreso (`src/events/`)

**Propósito:** Que la persona vea el trabajo avanzar sin sondeo.

El flujo SSE va con `@fastify/sse` (versión exacta) y repone desde `job_events` lo que ya pasó. El `id` de cada evento es `job_events.seq`, así que una pestaña que se reabre manda `Last-Event-ID` y no pierde el progreso. La reposición se midió en 35 ms, sin acumulación con `@fastify/compress` ni con el proxy de Vite (informe 07).

Los eventos son `progress` (`job_id`, `input_id`, `percent`, `phrase`, `at`), `done` (`job_id`, `input_id`, `status`, `error`, `error_code`) y `message` (un aviso por mensaje publicado). El progreso llega sólo al autor del input y los avisos de mensajes a todo el equipo. El flujo termina con un evento `done` y el cliente cierra. Si el trabajo ya terminó, la ruta responde 204, que es lo que fija el estándar para que el navegador deje de reconectar.

Hay un solo flujo SSE por miembro (`GET /api/events`), no uno por trabajo. Lleva los eventos de progreso con su `job_id` y los avisos de mensajes nuevos. HTTP/1.1 limita a seis las conexiones por dominio, compartidas entre pestañas (informes 03 y 07). El servidor suscribe antes de reponer, lo que dio cero repetidos y cero huecos al reconectar, y manda un latido cada 15 s. En el panel, un hook `useJobProgress` sobre `EventSource` guarda el progreso como estado efímero e invalida la consulta del input al `done`. Los extractores y el analizador emiten `progress(percent, phrase)` por paso real. El porcentaje sale de pasos completados sobre pasos totales, nunca de un reloj.

### 7.10 bis Telemetría (`src/telemetry/`)

**Propósito:** La trazabilidad que pide UD-014. Usa `@opentelemetry/sdk-node` con un exportador propio a la tabla `spans` y, opcional por `OTEL_EXPORTER_OTLP_ENDPOINT`, OTLP. `withSpan(name, attrs, fn)` lo usan la cola, los extractores, los proveedores y el analizador.

Los atributos de GenAI siguen la convención vigente al 2026-10-20 (repositorio `semantic-conventions-genai` de OpenTelemetry, estado «Development»):

- `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model` y `gen_ai.response.model`.
- `gen_ai.usage.input_tokens` (incluye la caché), `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens` y `gen_ai.usage.cache_write.input_tokens`.
- `gen_ai.response.finish_reasons`.
- Propios del proyecto: `team.job_id`, `team.input_id`, `team.step` y `team.cost_usd`.

El contenido de entrada y salida va siempre en un evento del span, `gen_ai.client.inference.operation.details`, con `gen_ai.input.messages`, `gen_ai.output.messages` y `gen_ai.system_instructions`, porque el volumen es del equipo. Los nombres anteriores (`gen_ai.system`, `gen_ai.content.prompt`, `gen_ai.content.completion`, `gen_ai.usage.cache_read_input_tokens`) ya no figuran en la convención y no se usan.

Cada intento de un trabajo es la raíz de su propio árbol (`job`, con `team.attempt` y `team.outcome`). Publicar, cerrar y reabrir abren `input.publish`, `message.close` y `message.reopen`. `GET /api/jobs/:id/trace` (Editor) devuelve el árbol de un trabajo, y de ahí el banco lee sus tiempos por paso. La retención es la de `job_events` (`RETENTION_DAYS`, 7). Las imágenes y fotogramas se guardan en base64 salvo con `TELEMETRY_INLINE_BLOBS=0`; el audio nunca se copia al span. `start_ns` y `end_ns` son enteros de 64 bits, así que leer `spans` con `SELECT *` falla: se piden con `CAST(… AS TEXT)` o se lee la vista `llm_calls`.

### 7.11 Banco de referencia y mediciones (`bench/`)

**Propósito:** Que el vector (§1) sea un número. El banco es un conjunto de inputs (captura de chat, docx con N puntos, transcripción de un monólogo, video corto) con su descomposición esperada. Esa referencia se audita contra las salidas de los modelos, porque una referencia escrita a mano omitió 227 intervalos en un estudio de 2026. Hoy los siete casos tienen textos inventados; los casos reales anonimizados siguen pendientes (EPIC-008).

El runner es promptfoo, con versión fijada en `package-lock.json` (MIT, corre en Node, `--repeat`, caché) y una aserción en JavaScript que importa `bench/score.js`. El puntaje usa aritmética de conjuntos sobre `unit_ids`: cobertura, repetición, mensajes de más, mensajes partidos y mensajes fusionados. También mide la exactitud de la clasificación por grupo, es decir, el área y la plantilla de cada unidad contra la esperada. Con grupos, un punto mandado a la plantilla equivocada ya no se corrige en la descomposición. La batería reporta además tiempo total por input, tiempo por paso, tokens y costo por llamada.

La misma medición corresponde a cada extractor candidato (UD-009), a video y audio. Quedan abiertas Opus contra FLAC en español, marcas de tiempo contra sin marcas y legibilidad de texto a 540, 720 y 1080 px. También una foto HEIC de iPhone y una grabación real de teléfono, en lugar de las sintéticas del informe 06 (EPIC-008). El banco se repite al cambiar de modelo y no sólo al editar una plantilla. Cambiar de modelo reasigna la etiqueta en casi la mitad de los casos de un estudio de 2026. Toda perilla de §4.9 cita una corrida de este banco.

**Estado.** Los siete casos de `bench/cases/` son `01-chat-grupo`, `02-docx-40-puntos`, `03-monologo-prueba`, `04-reporte-de-error`, `05-idea-suelta`, `06-mensaje-mezclado` y `07-video-de-pantalla`. Cada uno trae su `input.json` y su `expected.json` por mensaje. En la referencia, una lista de ids de área o de plantilla significa que cualquiera de ellos es correcto. `cases.test.js` falla si la numeración de unidades cambia y deja de coincidir con la referencia. `node bench/run.mjs` corre con proveedores reales o, con `--fake perfect|noisy`, sin red. Acepta `--repeat`, `--case`, `--analyzer` y `--config` (perillas del analizador). `npm run eval` dentro de `bench/` corre promptfoo sobre los mismos casos. `bench/private/` y `bench/results/` quedan fuera del repositorio, porque los casos con feedback real nunca se publican. La última medición con proveedor real es `docs/investigaciones/mediciones/2026-10-20-primera-corrida-real.md`.

---

## §8. Reglas operativas

> Cómo opera el agente de IA dentro de este repositorio.

**Ubicación de las reglas:** `docs/RULES.md`

**Alcance:** Todas las operaciones del agente sobre el repositorio: código, documentación, dependencias y despliegue.
