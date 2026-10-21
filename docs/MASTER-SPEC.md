# MASTER-SPEC: team-platform v0.1.0

> Una bandeja de entrada para equipos de 3 a 10 personas: cualquier input (texto, capturas, video, audio, documentos, enlaces) se descompone en mensajes categorizados, asignados y rastreables.

Fuentes de este documento: `idea.md` (volcado de diseño de Martín, 2026-10-20), `Plataforma Team.png` (maqueta dibujada antes del volcado; `idea.md` manda donde difieren), `docs/USER-DECISIONS.md` (UD-001 a UD-010) y `docs/investigaciones/01 - Motor de análisis y adjuntos.md`. Cada hecho sobre un tercero lleva su fuente ahí; acá sólo se cita la conclusión.

---

## §1. Identidad del proyecto

**Propósito:** En los proyectos donde una persona es el desarrollador principal, la comunicación del equipo vive dispersa: correos, capturas con audio en un grupo, videos narrados, documentos. Reportes de errores, requerimientos, retroalimentación e ideas se mezclan con conversación casual. team-platform centraliza esa comunicación sin obligar a nadie a cambiar su forma de comunicar: cada miembro manda lo que tiene, como lo tiene, y la plataforma lo convierte en el mínimo conjunto de mensajes accionables, cada uno en su área, con su plantilla, con su destinatario y con los adjuntos que lo contextualizan.

**El vector de trascendencia**, la cualidad que todo lo demás sirve (Martín, 2026-10-20): **velocidad de respuesta por input y descomposición correcta.** Correcta quiere decir MECE: mutuamente excluyente (ningún punto repartido en dos mensajes) y colectivamente exhaustiva (ningún punto del input que no esté en un mensaje). Cada decisión de este documento se puede leer como una respuesta a «¿esto hace que un input se descomponga mejor o más rápido?».

**Nombre:** team-platform

**Dominio:** Comunicación interna de equipos de software pequeños; triage asistido por modelos de lenguaje.

**Problema que resuelve:** Tres fricciones medibles en el equipo: ordenar, categorizar y asignar el trabajo que llega; responder a cada mensaje, petición, reporte o idea de forma individual y oportuna; y llevar trazabilidad de lo hecho. Hoy las tres se hacen a mano sobre un chat de grupo, o no se hacen.

**Beneficiario directo:** El equipo del proyecto, de 3 a 10 miembros con responsabilidades y dominios distintos. En primer lugar quien desarrolla, que es a quien más le llega.

**Beneficiario indirecto:** Quien instala team-platform dentro de un sitio propio para recibir lo que sus usuarios o clientes mandan (UD-002, UD-010), y cualquier sistema externo que hable con la API.

**Lo que NO es:** No es un chat: un mensaje espera una respuesta, no una conversación continua. No es un gestor de proyectos: sin tableros, sprints ni estimaciones. No es un rastreador de incidencias que reemplace a GitHub: los mensajes se cierran, no se versionan. En la fase inicial no manda nada hacia afuera (correo, WhatsApp, API, MCP): la vista Conexiones existe apagada hasta que se pruebe que la descomposición funciona bien sin importar la procedencia y la forma del input (`idea.md`).

### 1.1 Vocabulario

| Término | Definición | Reglas |
|---|---|---|
| **Input** | Lo que una persona envía desde la barra de Inicio o, más adelante, por una conexión: texto y cero o más adjuntos (fotos, videos, audio, documentos, enlaces). | Un input se analiza una vez y produce una propuesta. |
| **Propuesta** | El resultado del análisis: área detectada, plantilla elegida y N mensajes redactados según la plantilla, cada uno con sus destinatarios y adjuntos. | Editable por el emisor; se publica al confirmar (UD-003). |
| **Mensaje** | Una comunicación de una persona hacia el equipo o hacia un miembro. Siempre espera respuesta. | Estados: `abierto` (sin respuesta), `respondido` (con respuesta, no cerrado), `cerrado` (con o sin respuesta). Sólo un miembro distinto del emisor responde; cualquier miembro cierra o reabre. |
| **Respuesta** | La contraparte del mensaje: respuesta directa, reporte de arreglo, pedido de aclaración. | Depende de un mensaje. |
| **Hilo** | Una respuesta seguida de más respuestas sobre el mismo mensaje. | Lineal, como los comentarios de un issue de GitHub. |
| **Área** | Categoría de un mensaje. Las áreas son mutuamente excluyentes y colectivamente exhaustivas para toda comunicación interna que busque respuesta. | Título y descripción. Las gestiona el Editor. Juego inicial: idea, error, nueva funcionalidad, retroalimentación, pregunta. |
| **Plantilla** | Archivo markdown que describe cómo analizar un input de su área y qué forma tiene cada mensaje de salida. | N plantillas por área, cada plantilla de una sola área. Nombre y descripción. Las gestiona el Editor. |
| **Miembro** | Persona del equipo, con nombre, descripción breve de responsabilidades y dominios. | Edita sólo su propia descripción y dominios. Rol `member` o `editor` (UD-007). |
| **Trabajo** | Unidad de la cola: extraer un adjunto, analizar un input. | Sobrevive al navegador y al reinicio del proceso (UD-003, UD-010). |

### 1.2 La tesis: el modelo lee y propone; el sistema valida y decide

El modelo de lenguaje ocupa el borde: convierte un input desordenado en una propuesta estructurada. Todo lo demás es sistema determinista: qué áreas existen, qué plantillas tiene cada una, quiénes son los miembros, qué adjuntos hay, qué estados puede tener un mensaje, quién puede responder. El modelo recibe eso como contexto y como esquema de salida; no se le enseñan reglas de negocio en prosa que el sistema pueda hacer cumplir solo.

De ahí sale la invariante que más se incumple sola, adoptada de un proyecto anterior del autor: **ningún `if`, expresión regular ni lista de palabras sobre el texto que escribe una persona decide un área, un destinatario ni un estado.** Lo interpreta el modelo y lo entrega por campos del esquema; el sistema valida la forma del valor (el área existe, el miembro existe, el adjunto pertenece al input) y escribe el dato exacto.

### 1.3 Idempotencia

Idempotencia en el sentido de las plantillas de trabajo: una plantilla aplicada a un input produce mensajes de la misma forma, con los mismos campos y la misma completitud, sin importar quién lo mande, cuándo, ni por qué canal. Esa constancia la da la plantilla (método y formato de salida) y el esquema estricto que el sistema valida, no una semilla del modelo; la prosa de un mensaje puede variar de una corrida a otra y eso no es un defecto. Y un mismo input (mismo texto normalizado, mismos adjuntos por hash) no crea un segundo trabajo ni una segunda propuesta: devuelve la que ya existe.

---

## §2. Arquitectura

**Tipo:** Cliente-servidor en un solo contenedor. La API es la única puerta (UD-010): el panel es un cliente estático servido por la misma API, y cualquier conexión futura o sistema externo entra por el mismo contrato.

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

1. La persona escribe en la barra de Inicio, adjunta lo que tenga y envía. `POST /inputs` guarda el input, cada adjunto en el volumen con su hash, calcula el hash del input y encola un trabajo `analyze`. Si el hash ya existe, devuelve lo que ya hay (§1.3). Respuesta inmediata con el id del input y el id del trabajo.
2. El worker toma el trabajo con arriendo. Por cada adjunto corre el extractor de su tipo (§7.4) y escribe el texto o la descripción obtenida en la fila del adjunto. Cada paso emite un evento de progreso (porcentaje y frase breve) en `job_events`; el panel los recibe por SSE (`GET /events`).
3. El analizador (§7.5) arma el paquete: texto del input, extracciones de los adjuntos, títulos y descripciones de todas las áreas y de todas las plantillas, equipo con responsabilidades y dominios. Primera llamada: área y plantilla. Segunda llamada, con el cuerpo de la plantilla elegida: la lista MECE de mensajes, cada uno con título, campos de la plantilla, destinatarios propuestos y adjuntos que lo contextualizan. El sistema valida cada campo contra la base.
4. El input pasa a `proposed`. En Inicio aparece la propuesta editable: área, cada mensaje, sus destinatarios, sus adjuntos. La persona corrige lo que quiera y aprieta Enviar. `POST /inputs/:id/publish` crea los mensajes en estado `abierto`.
5. Los destinatarios los ven en Inicio («últimos mensajes», filtrados para mí) y en Mensajes. Responden (`POST /messages/:id/replies`), con lo que el mensaje pasa a `respondido`; cualquiera lo cierra o reabre.

---

## §3. Stack técnico

Criterio: tecnologías que el autor ya probó en producción (Node, Fastify, React, Vite), y menos piezas de las que ese proyecto lleva, porque un equipo de 10 no las necesita (UD-010).

| Capa | Tecnología | Justificación |
| --- | --- | --- |
| Frontend | React 19.3 + Vite 8 + Tailwind 4.3 + TanStack Query 5 + React Router 8; componentes de shadcn/ui sobre Radix copiados al repositorio | Refine 5 quedó fuera (UD-011): sin paquete publicado desde el 2026-04-02, adaptador atado a React Router 7 y telemetría a un tercero por omisión. Lo que daba hecho (listas, filtros, formularios contra REST) cabe en un módulo propio de filtros a parámetros. Base de navegadores: Chrome 111, Safari 16.4, Firefox 128 (informe 07). |
| API | Node 24 + Fastify 5, validación de esquemas con Ajv | Fastify valida entrada y salida por esquema JSON, que es el mismo mecanismo con que se valida lo que devuelve el modelo. |
| Datos | SQLite por `node:sqlite` (release candidate desde Node 24.15; se exige Node ≥ 24.15 y SQLite ≥ 3.51.3 al arrancar), WAL, `busy_timeout` 5.000 ms, `synchronous=FULL`, `BEGIN IMMEDIATE` en toda transacción que lee y luego escribe | `idea.md` pide SQLite; `node:sqlite` evita compilar `better-sqlite3` en cada arquitectura. Sin `busy_timeout` un 16 % de las transacciones concurrentes fallaron en la medición del informe 03; con ambos, cero. Respaldo con `VACUUM INTO` y `rename` (123 ms con escritor activo), nunca `cp`. Un paso de inicialización único antes de la API y el worker fija WAL y aplica migraciones, porque dos arranques simultáneos chocan al fijar WAL. |
| Cola de trabajos | Tabla `jobs` propia con arriendo, latido, reintentos con retroceso y prioridad, patrón de pg-boss | Ninguna librería MIT activa usa `node:sqlite` (informe 03); la lógica cabe en un módulo. Medido: dos procesos escritores, 13.768 reclamos, cero duplicados. |
| Progreso | SSE desde la API; cancelación por `POST` | Un solo sentido, reconexión automática del navegador; WebSocket sólo si hiciera falta control bidireccional. |
| Adjuntos | Archivos en el volumen, nombrados por hash | Sin S3 ni MinIO: un equipo de 10 no los necesita; el adaptador de almacenamiento permite agregarlos. |
| Modelo: texto, visión y PDF | Contrato de proveedor por modalidad. Omisión: Anthropic `claude-haiku-5-5` con salida estructurada, prompt de sistema cacheado, esfuerzo `low` para clasificar y `medium` para descomponer hasta que el banco muestre que `low` conserva la cobertura; sin `temperature`, `top_p` ni `top_k` (el modelo los rechaza) | 0,10 USD entrada / 0,50 salida por MTok, lectura de caché 0,01; visión y PDF nativo de 600 páginas en el mismo proveedor. Alternativa y respaldo configurable: DeepSeek `deepseek-flash` (texto e imagen, sin PDF; esquema sólo por herramienta estricta en beta, o modo JSON validado con Ajv). Perillas y fuentes en el informe 02. |
| Modelo: transcripción | Groq `whisper-large-v3-turbo` por la API compatible con OpenAI | Ya en uso por el autor; 0,04 USD por hora de audio (UD-008). Alternativa: faster-whisper local. |
| Video | Binario `ffmpeg` por `spawn` (`fluent-ffmpeg` está archivado desde 2025-05-22 y el WASM no corre en Node): pista de audio a transcripción; un fotograma por segundo deduplicado por dHash de 64 bits a distancia 6, tope de 48 fotogramas de 720 px; el umbral de cambio de escena queda apagado (en una grabación de pantalla sintética `scene>0,2` cubrió 8 de 16 pantallas; 1 fps más dHash dejó 18 fotogramas y cubrió 16 de 16; informe 06) | Sin un tercer proveedor; costo del mismo orden que el video nativo de Gemini (0,0019 USD por minuto contra 0,001 a 0,005), que queda como alternativa configurable porque pierde el muestreo determinista y la vista auditable. |
| Extracción de documentos | Dentro del contenedor, en un hilo trabajador con `resourceLimits`: PDF digital con `@hyzyla/pdfium` (WASM, MIT, 14 MB; 29 a 67 ms por documento, 337 ms en 304 páginas, conteo de caracteres por página); DOCX, PPTX y XLSX con `officeparser` (MIT; 17 a 91 ms; listas anidadas, tablas, notas) | Medido en el informe 05 contra `markitdown-node` (63 % de cobertura en DOCX, medio segundo de importación), MarkItDown en Python (18 veces más lento, 583 MB más de imagen), Kreuzberg, `downmark` y `anymd`; MuPDF.js y `pandoc-wasm` quedan fuera por licencia (UD-009). Docling queda como reversión para tablas anidadas y OCR. |
| Analizador alternativo | `claude -p` por trabajo, sin `--bare`, desde un directorio de trabajo vacío propio | Reutiliza una suscripción de Claude Code ya pagada (UD-008). `--bare` exige `ANTHROPIC_API_KEY` y no lee OAuth [V 2026-10-20, documentación oficial]. |
| Identidad | Contrato de proveedor, sin librería de autenticación. Omisión: local, correo y contraseña con `crypto.argon2` de Node (Argon2id, sin compilación nativa) y sesión en tabla con ficha opaca y cookie `__Host-`. Delegada: cabecera firmada con HMAC, JWT verificado con `jose`, o redirección firmada con nonce | UD-002: «segura pero ligera» y reemplazable. Lucia está deprecada, Auth.js pasó a Better Auth y Better Auth impone sus tablas y suma diez avisos de seguridad en 2026 (informe 04). |
| Red | Tailscale opcional por fuera: `tailscale serve` da TLS y restringe a la tailnet | La aplicación no sabe de Tailscale; en un VPS público el TLS lo pone el proxy del anfitrión. |
| Empaquetado | Una imagen Docker sobre `node:24-alpine` con `apk add ffmpeg` (426 MB medidos; `ffmpeg-static` 517 MB; `apt` en Debian 974 MB), un `compose.yml` con un servicio y un volumen | «Mínimos componentes»; instalar en un proyecto existente es agregar un servicio al compose del proyecto. |
| Pruebas | Node test runner (`node --test`) sobre una base SQLite efímera; Playwright para el panel | Sin framework extra para el servidor. |

---

## §4. Restricciones (límites inviolables)

> Estas restricciones mandan sobre cualquier otra decisión. Cada una tiene su prohibición en la batería o su candado en el código.

1. **Ningún dato del equipo sale del contenedor** salvo hacia los proveedores de modelo configurados, y cada envío queda registrado en `llm_calls` con proveedor, modelo, modalidad, tokens y costo. Vale también para el navegador: el panel no se conecta a ningún otro dominio (CSP `connect-src 'self'`, `img-src 'self' blob: data:`), lo que excluye cualquier telemetría de una librería.
2. **Ningún `if`, expresión regular ni lista de palabras sobre texto humano decide área, destinatario ni estado** (§1.2). El modelo entrega campos; el sistema valida la forma.
3. **Un trabajo nunca depende del navegador.** Sobrevive al cierre de la pestaña y al reinicio del proceso; al arrancar, el worker retoma los trabajos con arriendo vencido (UD-003, UD-010).
4. **Nada llega al equipo sin que el emisor confirme** la propuesta (UD-003). Las conexiones futuras que publiquen directo lo harán por una perilla propia, apagada por omisión.
5. **Un contenedor y un volumen bastan para correr.** Ningún componente obligatorio fuera de la imagen; los proveedores de modelo son externos y configurables.
6. **Ninguna credencial en el repositorio ni en la base.** Variables de entorno o archivo fuera del repositorio; un gancho de pre-commit lo impide.
7. **Código en inglés; comentarios, documentación y textos de interfaz en español** (UD-005). Sin esquema mezclado.
8. **Sólo un miembro distinto del emisor responde un mensaje; cualquier miembro lo cierra o reabre.** Lo hace cumplir la API, no el panel.
9. **Todo número que gobierna la operación nace declarado**: tamaño máximo de adjunto, fotogramas por video, páginas por llamada, reintentos, arriendo de un trabajo. Sale de una medición citada o de una perilla de configuración con su valor por omisión justificado, nunca de «parece razonable».
10. **Toda dependencia es compatible con MIT** (UD-004).
11. **La API es la única puerta.** El panel no lee la base ni el volumen; lo que el panel puede hacer, un sistema externo lo puede hacer con el mismo contrato (UD-010).

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

**Atmósfera de referencia:** Y2K futurista (UD-013): vidrio translúcido con reflejos, cromo y metal líquido, degradados iridiscentes, formas redondeadas, azul eléctrico sobre plata con acentos lima y lila, tipografía de la época con licencia libre y empaquetada; un producto de 2026 que cita el 2000, con referencias fechadas y tokens en `panel/DISENO.md`. En lo funcional, un programa de gestión estándar, no una web que conversa. Rótulos de una a tres palabras como sustantivos («Mensajes», «Equipo»), sin texto de ayuda por omisión, sin segunda persona. Densidad de una bandeja de entrada de correo de escritorio: todo lo que se necesita ahora cabe sin desplazarse; lo demás nace plegado. La maqueta manda en la disposición: barra lateral a la izquierda, cabecera «[Nombre] TEAM» con campana y menú, contenido a la derecha.

**Flujo principal de la persona:**

1. Entra. Ve Inicio: nombre del proyecto, fecha y hora, la barra «Nuevo mensaje» con clip (adjuntos), cámara (foto), micrófono (audio) y enviar.
2. Escribe, pega una captura o arrastra un docx, y envía. La barra se vacía; debajo aparece la vista previa del input (texto y adjuntos con su miniatura) y, al lado, el bloque «Análisis» con una barra de progreso y la frase del paso en curso («leyendo el documento», «3 de 7 adjuntos»).
3. Al terminar, el bloque muestra el área detectada y los mensajes propuestos: cada uno con título, texto según la plantilla, destinatarios (chips, editables) y adjuntos (miniaturas, quitables). Edita lo que quiera. Aprieta Enviar.
4. Los mensajes aparecen en «Últimos mensajes». Quien los recibe los ve en su Inicio, filtrados para él por omisión, con la insignia del área, el emisor, la fecha y la miniatura del adjunto principal.
5. Responde desde la tarjeta o desde Mensajes. El hilo crece debajo del mensaje. Cualquiera cierra; el estado se ve como insignia, nunca como prosa.

**Vistas** (barra lateral, en este orden; `idea.md` y UD-006):

| Vista | Qué muestra | Quién |
|---|---|---|
| Inicio | Barra de envío, vista previa, análisis, últimos mensajes (para mí por omisión), últimas respuestas (que me involucran) | Todos |
| Mensajes | Todos los mensajes del equipo con filtros: para mí, para X, por área, por estado, respuestas; búsqueda | Todos |
| Áreas | Áreas con su conteo de abiertos y sus plantillas; edición en el lugar | Editor |
| Equipo | Miembros con responsabilidades y dominios; cada uno edita lo suyo | Todos |
| Conexiones | API, MCP, correo, WhatsApp, GitHub Issues (UD-012). Apagada: visible como entrada deshabilitada con la razón | Editor |
| Configuración | Cuenta, tema claro u oscuro, proveedores de modelo (Editor) | Todos |

**Componentes de interfaz:**

| Componente | Función | Archivo |
| --- | --- | --- |
| `Sidebar` | Navegación, usuario, conteo de abiertos por área | `panel/src/components/Sidebar.tsx` |
| `ComposeBar` | Barra de nuevo mensaje con adjuntos, cámara, micrófono, enviar | `panel/src/components/ComposeBar.tsx` |
| `InputPreview` | Texto y adjuntos del input enviado | `panel/src/components/InputPreview.tsx` |
| `AnalysisPanel` | Progreso por SSE, área detectada, propuesta editable, Enviar | `panel/src/components/AnalysisPanel.tsx` |
| `MessageCard` | Área, emisor, fecha, texto, adjunto principal, estado, acciones | `panel/src/components/MessageCard.tsx` |
| `ReplyThread` | Hilo lineal de respuestas con formulario al pie | `panel/src/components/ReplyThread.tsx` |
| `MessagesList` | Lista con filtros y búsqueda | `panel/src/pages/Messages.tsx` |
| `AreasEditor` | Áreas y plantillas, edición en el lugar | `panel/src/pages/Areas.tsx` |
| `Team` | Miembros, edición de lo propio | `panel/src/pages/Team.tsx` |
| `Settings` | Cuenta, tema, proveedores | `panel/src/pages/Settings.tsx` |

---

## §7. Especificación de módulos

### 7.1 API (`src/api/`)

**Propósito:** La única puerta (§4.11). Fastify con esquemas JSON de entrada y salida en cada ruta.

**Interfaz:**

```
POST   /auth/login                 { email, password } → sesión          (proveedor local)
POST   /auth/logout
GET    /me

POST   /inputs                     multipart: text, files[], links[] → { input_id, job_id }   (idempotente por hash)
GET    /inputs/:id                 input, adjuntos, estado, propuesta si existe
POST   /inputs/:id/publish         propuesta editada → mensajes creados
POST   /inputs/:id/cancel

GET    /events                    SSE por miembro: progreso { job_id, percent, phrase, at } … { job_id, done } y mensajes nuevos

GET    /messages?for=me|member_id&area=&status=&q=&replies=1
GET    /messages/:id               mensaje, hilo, adjuntos
POST   /messages/:id/replies       { body, kind }            (403 si el autor es el emisor)
POST   /messages/:id/close · /reopen

GET    /areas · POST /areas · PATCH /areas/:id            (editor)
GET    /areas/:id/templates · POST · PATCH · DELETE       (editor)

GET    /members · PATCH /members/me · PATCH /members/:id  (editor para :id)
GET    /settings/providers · PATCH                        (editor)
GET    /attachments/:id            archivo, con control de acceso
GET    /health
```

**Dependencias:** `fastify`, `@fastify/multipart`, `@fastify/cookie`, `@fastify/static`, `ajv`.

### 7.2 Dominio y esquema (`src/db/`)

**Propósito:** Las tablas son la especificación. Identificadores en inglés (UD-005).

```
members          id, email, name, role(member|editor), responsibilities, domains, created_at
credentials      member_id, password_hash, updated_at                       (proveedor local)
sessions         id, member_id, expires_at
areas            id, title, description, position
templates        id, area_id, name, description, body_markdown, updated_at
inputs           id, author_id, text, content_hash UNIQUE, status(queued|extracting|analyzing|proposed|published|failed|cancelled), created_at
attachments      id, input_id, kind(image|video|audio|document|link), path, mime, size, sha256, extracted_text, extracted_at
proposals        input_id, area_id, template_id, payload_json, model_call_id, created_at
messages         id, input_id, area_id, template_id, author_id, title, body, fields_json, status(open|answered|closed), created_at, closed_at
message_assignees  message_id, member_id
message_attachments message_id, attachment_id
replies          id, message_id, author_id, body, kind, created_at
jobs             id, kind(extract|analyze), payload_json, status(queued|running|done|failed|cancelled), priority, attempts, max_attempts, run_at, lease_until, worker_id, last_error, created_at
                 índice (status, priority DESC, run_at, id): reclamo en 23 µs (informe 03)
job_events       job_id, seq, percent, phrase, at                      retención 7 días, igual que los trabajos terminados
llm_calls        id, job_id, provider, model, modality, input_tokens, output_tokens, cached_tokens, cost_usd, duration_ms, at
```

**Dependencias:** `node:sqlite`. Migraciones como archivos SQL numerados, sólo hacia adelante, aplicadas por un ejecutor propio que lleva la cuenta en `PRAGMA user_version` dentro de una transacción, en el paso de inicialización único (§3).

### 7.3 Cola de trabajos (`src/queue/`)

**Propósito:** Desacoplar el procesamiento del navegador (UD-003) con el patrón de pg-boss sobre SQLite.

**Interfaz:**

```
enqueue(kind, payload, { priority, runAt })      → job_id
claim(workerId, leaseMs)                          → job | null
   BEGIN IMMEDIATE; UPDATE jobs SET status='running', worker_id=?, lease_until=?, attempts=attempts+1
   WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_at<=? ORDER BY priority DESC, run_at, id LIMIT 1)
   RETURNING *; COMMIT        (UPDATE … LIMIT 1 directo es error de sintaxis en SQLite)
heartbeat(jobId)                                  renueva el arriendo; progress(jobId, percent, phrase)
complete(jobId) · fail(jobId, error)              fail reencola con retroceso exponencial y jitter hasta max_attempts
recoverExpiredLeases()                            al arrancar y por ciclo
```

El worker corre en el mismo proceso que la API por omisión (un contenedor) y puede correr como segundo proceso de la misma imagen (`node src/worker.js`); con proceso aparte, la API se entera de cambios por `PRAGMA data_version` (1,15 µs por consulta). Al apagar no se esperan los trabajos: se abortan, vuelven a la cola y el intento se reembolsa; la API cierra con `forceCloseConnections: true` porque un flujo SSE abierto cuelga `app.close()`. Perillas y fuentes en el informe 03: arriendo 30 s con latido cada 10 s; `max_attempts` 3 (y el reintento del SDK del proveedor en 0 si el banco muestra 429 en cadena, para que haya un solo punto de reintento); retroceso desde 1 s hasta 60 s; concurrencia 1 hasta que el banco §7.11 la suba (es la única perilla cuyo valor es convención y no medición); duración máxima por trabajo 900 s.

### 7.4 Extractores (`src/extract/`)

**Propósito:** Convertir cada adjunto en texto o descripción antes del analizador, de forma determinista y medida.

| Tipo | Extractor | Salida |
|---|---|---|
| imagen | proveedor de visión: «describe todo lo que sea accionable para un equipo de software, textual». HEIC de iPhone se convierte antes o se rechaza con motivo (`sharp` no lo lee) | texto |
| documento (pdf, docx, pptx, xlsx, txt, md) | `@hyzyla/pdfium` para PDF y `officeparser` para Office (informe 05); una página con menos de 30 caracteres sin espacios cuenta como escaneada (las escaneadas medidas dieron 0; la digital más pobre, 146) y sólo esas páginas van al proveedor en modo nativo, partiendo el PDF con `pdf-lib`; tope de 270.000 caracteres extraídos (100 páginas por 2.700) y de 100 páginas por llamada nativa | markdown o texto por página |
| audio | FLAC 16 kHz mono (1,83 MB por minuto; Opus a 32 kbps, 0,21 MB por minuto, queda como opción tras medir la tasa de error en español); trozos de 600 s con 5 s de solapamiento para el tope de 25 MB de Groq, fusionados por marca de tiempo; `verbose_json`, segmentos, `language=es`, `prompt` sólo de vocabulario. La cola lleva un presupuesto de audio de 7.200 s por hora (límite del plan de Groq: seis videos de 20 minutos por hora para todo el equipo) | texto con marcas de tiempo `mm:ss` por segmento |
| video | `ffmpeg`: pista de audio → extractor de audio; un fotograma por segundo → dHash 64 bits, distancia 6 → a lo sumo 48 fotogramas de 720 px (JPEG calidad 4, 1.456 tokens y 60 KB cada uno, 69.888 tokens en total, bajo el escalón de precio de 100.000) elegidos por orden de cambio y reordenados en el tiempo → proveedor de visión en una sola llamada; transcripción y fotogramas se intercalan por orden cronológico con su marca `mm:ss`. Tope 20 minutos y 2 GB | transcripción + descripción por fotograma, en una línea de tiempo |
| enlace | `undici` con `lookup` filtrado y revisión de IP literales (nada a redes privadas ni a `localhost`), `redirect: 'manual'` revalidando cada salto hasta 5, tope de 5 MiB en el flujo y 15 s; contenido principal con `@mozilla/readability` sobre `linkedom` (24 a 98 ms; `jsdom` duplica el tiempo) | markdown |

**Interfaz:** `extract(attachment, { onProgress }) → { text, meta }`. Cada extractor es un archivo; registrar uno nuevo es agregarlo al mapa por tipo.

### 7.5 Analizador (`src/analyze/`)

**Propósito:** La mecánica central: de un input extraído a una propuesta MECE. Un contrato y dos implementaciones (UD-008).

**Interfaz:**

```
analyze(bundle, { onProgress }) → Proposal
bundle = { text, attachments:[{id, kind, extracted}], areas:[{id,title,description}],
           templates:[{id,area_id,name,description}], members:[{id,name,responsibilities,domains}] }
Proposal = { area_id, template_id, messages:[{ title, body, fields, assignee_ids, attachment_ids }] }
```

**`api` (omisión):** dos llamadas con salida estructurada (variante A; las variantes B, una sola llamada, y C, clasificar dentro de la descomposición, se miden en el banco antes de fijar la elección). (1) Clasificar: área y plantilla, con la lista de títulos y descripciones; esfuerzo `low`. (2) Descomponer: con el cuerpo de la plantilla elegida, la lista MECE de mensajes; esfuerzo `medium` hasta que el banco diga otra cosa. Prompt de sistema cacheado (mínimo cacheable 512 tokens; TTL 5 minutos, 1 hora si el acierto medido es bajo).

MECE por construcción, no por confianza: antes de la segunda llamada el sistema numera las unidades del input extraído (párrafos, viñetas, segmentos de transcripción con marca de tiempo, fotogramas) y el esquema exige que cada mensaje cite sus `unit_ids` y que lo no accionable vaya en `discarded`. Con eso el sistema calcula solapes (una unidad en dos mensajes) y huecos (una unidad en ninguno) por aritmética de conjuntos, sin leer prosa. Si hay conflicto, un único pase de rescate sobre esas unidades; sin autoconsistencia por omisión (veinte muestras mejoran 0,4 %, informe 02). Si el input supera el umbral de partición (provisional: 100.000 tokens de entrada, frontera de precio del modelo; el banco lo fija), se parte sólo por fronteras estructurales en trozos disjuntos por unidad, se descompone en paralelo y la reducción es determinista por `unit_ids`; un monólogo transcrito no se parte. El esquema de salida de cada plantilla se compila una vez y se calienta por evento al guardar la plantilla (la gramática compilada se cachea 24 horas desde el último uso). Cada llamada queda en `llm_calls`.

**`harness`:** el mismo bundle se escribe en un directorio de trabajo vacío y propio; `claude -p --output-format json --json-schema <Proposal>` con el prompt y las herramientas de lectura permitidas; se lee `structured_output`, `usage` y `total_cost_usd`. Sin `--bare` para que use la suscripción [V]. Mismo validador de salida que `api`.

**Validación (sistema, no modelo), con una instancia propia de Ajv** (los esquemas de respuesta de Fastify convierten tipos y descartan propiedades, informe 03): área y plantilla existen y se corresponden; cada `assignee_id` es un miembro; cada `attachment_id` pertenece al input; cada `unit_id` existe y cada unidad está en un mensaje o en `discarded`; cada campo obligatorio de la plantilla está presente; ningún mensaje vacío. Una salida inválida reintenta una vez con el error como contexto; después, el trabajo falla con el motivo visible. Un `refusal` del proveedor y un corte por `max_tokens` son estados propios del trabajo: el rechazo no se reintenta igual (se ofrece el proveedor de respaldo); el corte reintenta una vez con el doble de `max_tokens` (provisional: 16.000 y 32.000; el banco fija el p95 real).

### 7.6 Proveedores de modelo (`src/providers/`)

**Propósito:** Una ranura por modalidad, configurable (UD-001).

```
providers.text    .complete({ system, messages, schema, effort }) → { json, usage }
providers.vision  .describe({ images[], prompt, schema })          → { json, usage }
providers.speech  .transcribe({ audioPath, language })             → { text, segments }
```

Implementaciones iniciales: `anthropic` (texto, visión, PDF; Messages nativo con caché), `openai-compatible` (DeepSeek, Groq, OpenRouter, Gemini por su endpoint compatible), `groq-speech`. La configuración vive en variables de entorno y se edita desde Configuración (Editor); la base guarda sólo el nombre del proveedor y el modelo, nunca la llave (§4.6).

### 7.7 Identidad (`src/identity/`)

**Propósito:** Un contrato con dos implementaciones (UD-002).

```
identify(request) → { member_id, role } | null
```

`local`: correo y contraseña con `crypto.argon2` (Node ≥ 24.7; Argon2id, 19 MiB, 2 pasadas, 1 hilo, el mínimo de OWASP, 19 ms medidos; se vuelve a hashear al iniciar sesión si cambian los parámetros); contraseña de 15 a 128 caracteres sin reglas de composición; ficha de sesión opaca de 32 bytes guardada con SHA-256 en `sessions`, cookie `__Host-` `HttpOnly` `Secure` `SameSite=Lax`, regenerada al iniciar sesión y al cambiar de rol; CSRF por `Sec-Fetch-Site` y `Origin` en un gancho `onRequest`; límite por IP con `@fastify/rate-limit` y por cuenta con espera exponencial; `trustProxy` con lista de IP, nunca `true`. `delegated`, tres modos bajo el mismo contrato: `signed-header` (HMAC con marca de tiempo y tolerancia de 5 minutos, patrón de Stripe), `jwt` (`jose` contra JWKS o secreto compartido) y `sso-redirect` (nonce de uso único, patrón DiscourseConnect); más `trusted-header` opcional sólo si el puerto es inalcanzable salvo por el proxy (es lo que entrega `tailscale serve` en `Tailscale-User-Login`). Ningún modo da de alta miembros: el correo tiene que existir en `members` (UD-007). Cuando la aplicación vive dentro de otro sitio se monta bajo el mismo origen por proxy inverso; en iframe, cookie `Partitioned`. Roles `member` y `editor` como enumerado con `CHECK` y un gancho `requireRole` por ruta que deniega por omisión. Perillas y fuentes en el informe 04.

### 7.8 Panel (`panel/`)

**Propósito:** Cliente estático React contra `/api`. No sabe de la base ni del volumen (§4.11). Servido por `@fastify/static` desde la misma imagen: activos con hash e inmutables, `index.html` sin caché, 404 para un activo ausente y 404 JSON bajo `/api`; en desarrollo, Vite con proxy de `/api`. Panel y API comparten origen, así que la cookie de sesión y `EventSource` no necesitan CORS. Entrada multimodal: arrastrar y pegar capturas; cámara del teléfono por `<input capture>`; audio con `MediaRecorder` probando `audio/webm;codecs=opus`, `audio/webm` y `audio/mp4` y leyendo `recorder.mimeType` (Safari anterior a 18.4 sólo graba MP4); subida multipart con `XMLHttpRequest` para tener progreso (`fetch` no lo da de forma portable), reintento reenviando el archivo; límites declarados en `@fastify/multipart` (`fileSize`, `files`, `parts`) con valores iniciales imagen 7 MB, audio 25 MB, documento 25 MB, y video según el banco (informe 07). Mensajes es una lista de `MessageCard` con los filtros en la URL como chips de propiedad, operador y valor (patrón de Linear, Plane y Front); sin tabla virtualizada hasta que haya cientos de filas. Componentes de shadcn/ui copiados al repositorio, sobre Radix (38 KB comprimidos menos que Base UI, medido en el informe 07).

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

El frontmatter se convierte en el esquema JSON de `fields` que el analizador exige; el cuerpo entra al prompt de la segunda llamada. `name` y `description` respetan los límites de la especificación Agent Skills (64 y 1.024 caracteres), porque la primera llamada sólo ve esos dos campos de cada plantilla y el cuerpo se revela recién en la segunda: la misma divulgación progresiva. El juego inicial (idea, error, nueva funcionalidad, retroalimentación, pregunta) se siembra al instalar y se puede editar o borrar.

### 7.10 Eventos y progreso (`src/events/`)

**Propósito:** Que la persona vea el trabajo avanzar sin sondeo.

El flujo SSE va con `@fastify/sse` (versión exacta) y repone desde `job_events` lo que ya pasó: el `id` de cada evento es `job_events.seq`, así una pestaña que se reabre manda `Last-Event-ID` y no pierde el progreso (reposición medida en 35 ms; sin acumulación con `@fastify/compress` ni con el proxy de Vite; informe 07). El flujo termina con un evento `done` y el cliente cierra; si el trabajo ya terminó, la ruta responde 204, que es lo que el estándar fija para que el navegador deje de reconectar. En el panel, un hook `useJobProgress` sobre `EventSource` guarda el progreso como estado efímero e invalida la consulta del input al `done`. Un solo flujo SSE por miembro (`GET /events`), no uno por trabajo: lleva los eventos de progreso con su `job_id` y los avisos de mensajes nuevos, porque HTTP/1.1 limita a seis conexiones por dominio compartidas entre pestañas (informes 03 y 07). El servidor suscribe antes de reponer (cero repetidos y cero huecos medidos al reconectar) y manda un latido cada 15 s. Los extractores y el analizador emiten `progress(percent, phrase)` por paso real; el porcentaje sale de pasos completados sobre pasos totales, nunca de un reloj.

### 7.11 Banco de referencia y mediciones (`bench/`)

**Propósito:** Que el vector (§1) sea un número. Un conjunto de inputs reales anonimizados (captura de chat, docx con N puntos, transcripción de un monólogo, video corto) con su descomposición esperada, auditada contra las salidas de los modelos (una referencia escrita a mano omitió 227 intervalos en un estudio de 2026). El runner es promptfoo con versión fijada en `package-lock.json` (MIT, corre en Node, `--repeat`, caché) y una aserción en JavaScript que importa `bench/score.js`: puntaje por aritmética de conjuntos sobre `unit_ids` (cobertura, repetición, mensajes de más, mensajes partidos, mensajes fusionados). La batería reporta además tiempo total por input, tiempo por paso, tokens y costo por llamada. Lo mismo para cada extractor candidato (UD-009), y para video y audio: Opus contra FLAC en español, marcas de tiempo contra sin marcas, legibilidad de texto a 540, 720 y 1080 px, una foto HEIC de iPhone y una grabación real de teléfono en lugar de las sintéticas del informe 06. El banco se repite al cambiar de modelo, no sólo al editar una plantilla: cambiar de modelo reasigna la etiqueta en casi la mitad de los casos de un estudio de 2026. Toda perilla de §4.9 cita una corrida de este banco.

---

## §8. Reglas operativas

> Cómo opera el agente de IA dentro de este repositorio.

**Ubicación de las reglas:** `docs/RULES.md`

**Alcance:** Todas las operaciones del agente sobre el repositorio: código, documentación, dependencias y despliegue.
