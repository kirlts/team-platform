# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- El hilo dice cuándo Claude empieza a trabajar y cuándo espera (UD-303). Al arrancar la sesión el sistema escribe «Claude empezó a trabajar» con la hora; si el trabajo queda en espera escribe una sola fila «En espera: N trabajos de Claude delante» con el tope que lo retiene, y al empezar pasa a «Estuvo en espera N min». El log del trabajador deja de imprimir `[object Object]`: trae el paso y, como datos, `defer_code` y `reason`. Mientras el anfitrión responde 75, los demás trabajos del ciclo no corren ningún guion de máquina (el gcloud de cada espera llevó la máquina de producción a carga 14,9). Medición de por qué esperan en `docs/investigaciones/mediciones/2026-10-25-por-que-esperan-los-trabajos.md`.
- La reserva de cada sesión sale del percentil 90 del costo medido de los trabajos de su modelo, no de 10 USD fijos (UD-305): con 40 USD de presupuesto caben decenas de sesiones, no cuatro. `EXECUTE_SESSION_RESERVE_USD` manda si se declara; sin datos, `EXECUTE_SESSION_RESERVE_FALLBACK_USD` (10).
- Ningún número elegido limita cuántas sesiones de Claude corren a la vez (UD-304). Se quitan `EXECUTE_MAX_MACHINES` y `EXECUTE_CONCURRENCY`; un trabajo `execute` ya no ocupa un lugar de `QUEUE_CONCURRENCY`. Detiene un trabajo nuevo el presupuesto diario y, si el anfitrión responde 75, la capacidad: el hilo dice «la cuota de Google admite N máquinas».
- Una idea se muestra y no se publica sola (UD-306). El analizador juzga por mensaje la Guardia «nada cambia de forma permanente sin el visto de una persona cuando lo pedido es explorar una idea» (`idea_guard`, con su razón y la estimación `idea` como contexto); si aplica, la sesión construye y muestra, el hilo recibe «Lista para ver» con «Publicar» y no hay entrega hasta que una persona publica. Sin umbral ni perilla. Migración `0037`.
- Una prueba que cae no es un final (UD-298). La verificación fallida vuelve a Claude después de cada falla, sea la prueba del cambio o ajena, mientras alcance el presupuesto diario; `EXECUTE_DELIVER_RETRIES` queda como tope opcional. La respuesta final se publica sólo cuando la entrega se confirmó y dice «En producción desde HH:MM <zona>»; antes hay avisos («Construido; entregando a producción.») y ninguna promesa. Sin presupuesto, «No quedó en producción: <motivo>». Un cambio que toca una pantalla (`touches_screen`) sin captura ni video lo dice en la respuesta con el motivo y no cierra solo. La sesión trata de tú salvo que el perfil de la persona diga otra cosa.
- El hilo muestra todas las respuestas, una entrega fallida lo dice cada vez y una rama que ya está en producción cuenta como entregada (UD-296, mensaje 117). El hilo ya no oculta un aviso que un reintento reemplazó. Cada entrega que falla deja una respuesta con el nombre de la prueba que cayó, también la pasada que vuelve a Claude y el fallo repetido. `deliver` corre `EXECUTE_DELIVER_CHECK_COMMAND` antes de la orden de entrega y, si responde que la rama ya está en producción, la marca lograda y publica la respuesta final sin desplegar.
- Avisos de progreso en el hilo mientras Claude trabaja (UD-293): cada plantilla lleva `progress_interval_min` (0 apaga, 20 por omisión); el trabajador escribe un aviso con minutos, turnos, herramientas, último paso y último commit, y el hilo lo dibuja como fila discreta. Migración 0035.
- Un envío se descompone en tantos mensajes como pedidos traiga, aunque vengan en una sola oración dictada (UD-294). Un paso de corte antes de clasificar parte la unidad donde el modelo cita el inicio de cada pedido; un mensaje lleva los adjuntos de sus unidades. Banco de 12 envíos en `bench/envios/` dentro de la batería, con la medición de Haiku 5.5 y Sonnet 5.5 en `docs/investigaciones/mediciones/2026-10-25-un-envio-varios-mensajes.md`.
- Modelo por área y evaluación del mensaje (UD-295): cada área elige su modelo ligero (Haiku 5.5) y su modelo mayor (Sonnet 5.5) de una lista cerrada y escribe sus Guardias; el analizador devuelve por mensaje lo que se espera de Claude, las Guardias que toca y estimaciones de 0 a 1 con su razón; el sistema elige el modelo con esas estimaciones y los límites derivados del banco `bench/model-limits.mjs`, pone a una persona junto a Claude cuando una Guardia de persona se toca, y escala a Sonnet por falla medida. Cada trabajo se juzga con el IMK 4.0 y el juicio, el modelo y el costo se ven en la ficha. Sesión ligera con prompt mínimo, herramientas acotadas, mapa corto del repositorio y ganchos (`team map`, `team guard`, `Stop`). `PUT /api/messages/:id/assessment`, migración `0034`.
- Plantillas de un área como lista (UD-297): las N plantillas son filas alineadas (nombre, campos, salidas y avisos de progreso, con «Eliminar» a la derecha), todas a la vista; cada una se abre en una ventana con su descripción completa, campos, salidas e instrucciones. «Obligatorio» es una insignia. Los modelos «Ligero» y «Mayor» del área sólo los ve y los cambia el Editor; `PATCH /areas/:id` con un modelo responde 403 a un miembro.
- El rol Editor da un solo privilegio: cambiar los textos configurados (UD-287, enmienda UD-007, UD-024, UD-251, UD-252, UD-258, UD-281). Reprocesar, borrar y restaurar contenido ajeno, vaciar, purgar la cola, auditoría, telemetría, proveedores, conexiones y miembros pasan a cualquier persona activa del equipo (`requireRole('person')`); `GET /health` muestra el detalle a una persona del equipo. Configuración, Conexiones y Equipo ya no se ocultan al miembro, y los rótulos dejan de nombrar al Editor donde no aplica.
- Equipo rehecho: filas de alto parejo con nombre, correo y extracto del perfil en una línea; el perfil entero se abre en una ventana sin mover la lista; el rol sólo se marca cuando es Editor y se cambia desde «Acciones»; en teléfono cada miembro es una tarjeta. El Editor redacta el perfil de cualquier miembro (UD-288, enmienda UD-023 y UD-281).
- Una mención a Claude que llega mientras trabaja le llega a esa misma sesión en su siguiente paso (UD-285): gancho `PostToolBatch` con `team mentions`, `POST /api/jobs/:id/mentions/take`, texto, adjuntos y notas de voz transcritas; no abre otro trabajo y el hilo muestra que la recibió.
- «Reintentar» en el aviso de una sesión de Claude que falló (UD-282): `POST /api/messages/:id/replies/:replyId/retry` lanza otra vez el mismo trabajo (mismo mensaje, mención o reenvío, adjuntos y notas de voz), audita quién lo hizo y no duplica. El servidor marca `retryable` en el aviso sólo cuando hay algo reintentable y el tope de gasto de hoy no se agotó. Migración `0028_reply_failed_job`.
- El Editor edita el perfil de un agente, en Equipo y con `PATCH /members/:id` (UD-281, enmienda UD-023). Una pregunta de decisión se lee en una línea bajo el resumen; fuentes, recomendación y costo de equivocarse van al detalle plegado.
- La revisión de un cambio retenido se hace respondiendo en el hilo, no con botones (UD-280, enmienda UD-275): la ficha muestra «Cambio listo para revisar»; Claude, mencionado, recibe el estado y la respuesta, y el campo `review` (`approve`, `discard`, `iterate`, `none`) decide lo que el sistema ejecuta, sólo para un Editor en entregar y descartar.
- Menciones en las respuestas (UD-278): «@» elige miembros, avisa, asigna e invoca a un agente con el hilo completo y sus adjuntos; el hilo siempre recibe una respuesta.
- Responder hablando (UD-279): el audio y el video de una respuesta se transcriben, la mención espera el texto, y el autor edita adjuntos y menciones de su respuesta.

### Changed
- Reconectar el flujo de eventos ya no recarga las listas a ciegas. `GET /events` abre cada conexión con un evento `replay` (`complete`, `from`, sin `id`); con `complete: true` el cliente no pide nada, y con `false` sólo lee de nuevo lo que la pantalla muestra (`refetchType: 'active'`). Medido el 2026-10-24: cada reconexión pedía las 7 listas de Inicio y sostenía la red ocupada varios segundos.

### Added
- Revisión de un cambio retenido sin salir de la plataforma (UD-275). La ficha del mensaje muestra «Revisión» con «Entregar», «Pedir cambios» y «Descartar»; `GET /api/messages/:id` suma `pending_delivery`, `POST /api/messages/:id/discard-delivery { reason }` descarta la rama (migración `0024_delivery_review`), la orden de entrega recibe `TEAM_REVIEWED_BY`, la respuesta retenida se escribe para un jefe de proyecto y adjunta las capturas y el video con el rótulo «Propuesta». `team walkthrough` graba el recorrido (WebM 1280x720 o 390x844, un rótulo «Paso N» y una captura por paso).
- Reenviar un mensaje a un miembro con motivo (UD-272). `POST /api/messages/:id/forward { member_id, comment }` suma al destinatario al mismo mensaje y deja en el hilo una respuesta `forward` (migración `0022_reply_forward`); con un agente encola su `execute`. La salida estructurada de un trabajo reenviado gana `mode` (`resolve` o `investigate`: sin entrega ni cierre) y `attachments` (PDF validados por forma en `$TEAM_ATTACHMENTS_DIR`). Una sesión que termina en `needs_decision` entrega análisis, recomendación y alternativas descartadas. El panel gana «Reenviar» en la ficha y la franja «Reenviado a …» en el hilo.
- Claude cierra el mensaje cuando corresponde (UD-271). La salida estructurada gana `close` y `close_reason`; el sistema cierra tras la respuesta final sólo con la entrega en código 0 (o `investigated` sin entrega), el «Después» de un «Antes» y sin respuesta de una persona en el hilo, nunca con `needs_decision`, `not_mine`, `blocked` ni entrega retenida, fallida o agotada. La respuesta agrega «Cerrado: <motivo>». Perilla `EXECUTE_AUTO_CLOSE` (omisión `on`).
- Capturas con datos de personas (UD-270). `EXECUTE_CAPTURES_UNMASKED=allowed` (o `1`; omisión `denied`) adjunta una captura con `masked: false` sin mirar la zona, en el trabajador y en `team reply` (`TEAM_CAPTURES_UNMASKED`).
- Traspaso a una persona (UD-269). `needs_decision`, `not_mine` (valor nuevo de `outcome`) y la entrega retenida dejan el mensaje `open` en la bandeja de quien decide en el área, sin el agente y con la respuesta de Claude como `clarification`. `needs_decision` exige `decision_check` (fuentes revisadas, recomendación, costo de equivocarse y pregunta) o el trabajo falla con `invalid_output`. El área gana `escalation_member_id` (primer Editor por omisión, editable en su vista) y la cifra de traspasos de 7 días. `GET /health` cuenta `handoffs.buried` y marca `degraded` si no es 0. Migración `0021_escalation_to_person`, que traspasa lo ya enterrado y lo audita. La plantilla `error-directo` contesta citando una decisión registrada en vez de devolverla.
- Capturas de la interfaz en las respuestas de la sesión (UD-268). `team reply --captures` sube la foto «Antes» en la primera respuesta, después de mirar; la salida estructurada acepta `captures` y la respuesta final adjunta «Antes» y «Después». Cada captura declara `path`, `alt`, `masked`, `place` y `as`; `masked: false` sólo se adjunta con la zona abierta (`EXECUTE_CAPTURES_OPEN_ZONE`). Perillas `EXECUTE_CAPTURES_MAX` y `EXECUTE_CAPTURES_OPEN_ZONE`; sin migración.
- La entrega a producción como trabajo aparte (UD-263). `EXECUTE_DELIVER_COMMAND` del anfitrión corre después de `execute`, sin IA. El autor recibe una sola respuesta final con «Ya está en producción». Una verificación fallida vuelve a `execute` una vez. Migración `0019_execute_deliver`, `POST /api/messages/:id/deliver`, fases `deliverVerify` y `deliverDeploy` en el panel. Sin la orden, nada cambia.
- Historial de ejecuciones del harness (UD-262): tabla `execute_runs` (migración `0018_execute_runs`) con retención de 365 días y `EXECUTE_MACHINE_COLLECT` para conservar la transcripción. Se consulta sin sesión con `scripts/tiempos.mjs`, por `GET /api/ops/execute-runs` y `/summary` y en «Ejecuciones» de la Cola. La sesión informa juez, entrega y espera con `team mark`.
- 2026-10-21, noche. Borrar lo que existe (UD-240): mensajes y respuestas en blando con `restore` (migración `0010_message_and_reply_deletion`), `DELETE /api/inputs/:id` con adjuntos, trabajos y propuesta (migración `0011_attachments_without_input`) y `DELETE /api/members/:id` con `purge`. En el panel, cada tarjeta, fila de Áreas y vista de un área lleva su ícono de borrar con Deshacer. La ficha y cada respuesta llevan «Borrar», el envío abierto de Inicio también, y Equipo, «Eliminar».
- Vaciar y sembrar datos de prueba (UD-240, UD-252): `POST /api/ops/reset` con `scope` `content` o `everything`, `POST /api/ops/seed`, `scripts/vaciar.mjs`, `scripts/sembrar.mjs` y el juego `ejemplos/` (`EXAMPLES_DIR`). Configuración, sección «Datos»: «Vaciar contenido», «Vaciar todo» y «Sembrar ejemplos».
- Lo borrado se lista y se restaura tras recargar (UD-250): `GET /api/messages?deleted=1`, «Borrados» en el filtro de Mensajes y «Borradas» en Áreas y en Plantillas, con «Restaurar».
- «Cola» y «Auditoría» en Configuración para el Editor, con traza por envío y la línea de resumen de la telemetría de interfaz; `GET /api/inputs?all=1` (UD-251).
- Equipo: «Contraseña» de otro miembro para el Editor (UD-252). La ficha del mensaje: «Adjunto» y «Quitar» para el emisor (H-3707).
- `GET /api/messages?involved=me`: los mensajes asignados a la persona o emitidos por ella una vez respondidos o cerrados, la regla de `/api/messages/summary`. Los enlaces de las marcas de la barra superior lo usan y llevan a una lista del tamaño de su cifra (H-2000).
- Barra superior de toda página con tres marcas de estado, abierto rojo, respondido amarillo y cerrado azul, cada una con su forma y su número. Al hacer clic abre un desplegable con esos mensajes y un enlace a Mensajes filtrado. En teléfono conserva las tres marcas (UD-100, UD-141).
- Barra lateral de 256 px, ocultable, sobre una grilla con la columna de contador de ancho fijo. Los contadores no llevan contenedor y toda fila responde al puntero y al foco (UD-047, UD-130). Prueba `panel/src/sidebar-alignment.browser.test.mjs` y regla de alineación en `ui-detectors.mjs`.
- Inicio con el compositor como protagonista, ancho que crece con la ventana y página que se desplaza con un envío abierto (UD-110). El envío se ve en un desplegable bajo la barra, con el original y el análisis (UD-046).
- Publicación automática al terminar el análisis. El autor edita su mensaje con control de versión y puede dejar un envío en borrador (UD-070, UD-071, UD-072). Ajuste «Publicación» en Configuración.
- Color por área, con migración `0008_area_color` (UD-045). Tarjetas de lista, ficha y respuesta con el estado en la línea de datos (UD-150, UD-151). La vista de un área no repite su chip (UD-160). El servidor doble lleva la marca «Servidor de ejemplo» (UD-180).
- Equipo: «Agregar miembro» para el Editor y perfil plegable con «Ver más». Entrada sin vía de contacto, por decisión (UD-170).
- El HEIC de iPhone se decodifica con el `ffmpeg` de la imagen (UD-040). La clasificación relee lo descartado y cada ventana ve las 40 unidades previas (UD-080).
- Las suites de navegador corren en Firefox con `BROWSER=firefox` (`panel/src/browser-support.mjs`, H-2500). Guardia de lenguaje `panel/src/ui-voice.test.ts` con sus patrones en `panel/src/ui-voice-patterns.mjs` (UD-050).
- Instalación: `IMAGE_TAG` para una segunda instancia, pregunta del puerto, respaldos legibles sólo por su dueño y restauración de adjuntos, medidos en el VPS (H-2600 a H-2606).
- Proveedores en Configuración (UD-120, UD-121): lista con estado y últimos 4 de la clave, alta, reemplazo con prueba previa, retiro con bloqueo por dependencia, cambio de función con reversión y diagnóstico con causa clasificada; claves cifradas en reposo y `scripts/rotate-secrets-key.mjs`.
- Configuración: editor de la descripción que crece con el texto (UD-123) y una línea de explicación bajo cada ajuste (UD-122).
- HP-015 y HP-018 por tipo de adjunto como pruebas con su ID; pruebas de `llm_calls` y de `GET /health` con el proveedor de respaldo (DT-003).
- HP-008 revisa también los mensajes de aserción y `.githooks/`.
- Galería de medios del panel (`MediaGallery`, UD-059) y `GET /api/attachments/:id/transcript`.
- Telemetría de la interfaz (UD-091): `POST /api/telemetry/ui`, `GET /api/telemetry/ui-summary`, `PATCH /api/settings/telemetry`, módulo `panel/src/lib/telemetry.ts`, interruptor en Configuración y `scripts/ui-report.mjs`.
- `panel/scripts/ui-detectors.mjs`: detectores de interfaz en navegador sobre todas las rutas, dos ventanas y dos temas.
- Jueces acotados en paralelo (UD-092): `scripts/juicios.mjs` y `docs/JUICIOS.md`.
- Investigaciones 09 (telemetría de la interfaz), 10 (evaluación con jueces acotados), 11 (gestión de proveedores y claves) y 12 (alineación y estados de la navegación).
- `scripts/vps-check.mjs`: comprobación de punta a punta de una instancia desplegada (página, salud, panel servido, inicio de sesión, un texto mixto y su propuesta), con `--last` para describir el último envío (H-89, H-56).
- `bench/run-private.mjs run --plan`: ensayo en seco de una corrida del banco privado; no llama a ningún proveedor, rechaza un modelo sin tarifa y un tope ya gastado.
- `GET /api/messages/summary`: lo que afecta a cada miembro por estado (abierto, respondido) y los mensajes de cada área por estado (UD-028, UD-041).
- Panel: los tres estados son la única categoría de un mensaje en la interfaz y el estado se deriva de las respuestas y del cierre. Los conteos por área llevan a Mensajes filtrado (UD-028, UD-041, UD-042).
- Panel: cada área abre su vista con sus mensajes, el filtro por estado y, plegadas, su descripción y sus plantillas (UD-041).
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
- Pruebas al 2026-10-21: 865 del servidor (6 omitidas por falta de llave, imagen o red), 74 del banco y 164 del panel en 29 archivos; prohibiciones HP-001 a HP-029 en `docs/TEST.md`.
- `README.md` para quien llega al repositorio público.

### Changed
- Inicio (UD-110, enmienda 2026-10-24): título, barra de texto y las dos listas comparten el ancho de la página (72 rem como máximo, centrada); 40 px entre secciones desde 800 px de alto; el título de cada lista es un rótulo de sección sobre su caja; las dos cajas miden lo mismo. Se retira `--container-compose`.
- Velocidad del panel (2026-10-24, banco `bench/panel-speed.mjs`, cifras crudas en `bench/results/2026-10-24-panel-*.json`). El servidor comprime con Brotli o gzip lo que arma en memoria (JSON de la API, índice y tema; perilla `COMPRESSION_MIN_BYTES`) y `npm run build` del panel deja `.br` y `.gz` junto a cada archivo de `assets/`, que se sirven tal cual. El tema responde 304 con ETag. El índice pide `/me` mientras baja el paquete. La barra de estado lee las listas de sus menús al acercarse a la marca y no en cada carga de página. El historial y la bandeja de Inicio piden `compact=1` (sin `units` ni `proposal`; el detalle `GET /api/inputs/:id` las trae). La miniatura de un video del servidor ya no lo descarga. La tarjeta de un mensaje lee el mensaje y las plantillas de su área al acercarse el puntero.
- Pantallas del panel (entrada, Inicio, Mensajes, Áreas, Plantillas, Equipo, Configuración, Conexiones): una acción principal por pantalla, las poco usadas en menús con nombre, nada que dependa de pasar el puntero, estados en píldoras tintadas, errores bajo su campo y textos más cortos. Botones de 32, 40 y 48 px y 44 px al tacto. El tema del anfitrión gana variables para jerarquía, formas, campos y botones (tabla de §7.8).
- En la ficha de un mensaje, las imágenes de una respuesta se ven abiertas al ancho de la respuesta, con su rótulo corto («Antes», «Después») y sin el nombre del archivo, lado a lado en escritorio; un clic las amplía. El texto de las respuestas dibuja Markdown básico (negrita, listas y enlaces) y conserva sus saltos de línea. La descripción del mensaje se alinea a la izquierda y el hilo gana ancho: la columna de respuestas pasa de 1/2 a 3/5 de la pantalla.
- Las respuestas de un mensaje se ven como un hilo: todas una debajo de otra en orden, con una línea vertical y el avatar a la izquierda, sin paginar; pasadas cinco, la primera y las tres últimas con un control «N respuestas más» para abrir las ocultas; la última con más realce; el formulario debajo. Se quita el selector de tipo del formulario (la persona siempre responde con `answer`); la API conserva `kind`, y la pregunta de un traspaso a una persona (`clarification` de un agente) se rotula «Pregunta» en el hilo.
- 2026-10-21, noche. Tarjetas de lista de alto fijo: título y extracto de una línea con puntos suspensivos (UD-241, enmienda a UD-016). El texto entero va en el tooltip.
- El plegable de plantillas de la vista de un área abre por omisión y Áreas enlaza a él con «N plantillas» (UD-252).
- `scripts/vps-check.mjs` borra su envío de prueba en lugar de cancelarlo (UD-253).
- `docs/TECHNICAL-DEBT.md` conserva solo DT-007 (HP-019 y HP-020). Quedaron cerradas DT-003 (proveedor de respaldo invocado), DT-004 (gancho de pre-commit), DT-005 (tope de documentos), DT-006 (cabecera de `src/analyze/api.js`), DT-008 (capas 3 y 5), DT-009 (inglés en comentarios, nombres, aserciones y registros). DT-010 queda descartada por el dueño (H-45).
- `docs/TEST.md` numera HP-029 la prohibición de privacidad de la telemetría de la interfaz, que repetía HP-022.
- Panel: el texto del análisis se dibuja a 17 px (UD-030). La franja «Para mí» y «Por área» de Inicio sale y pasa a la barra superior (UD-100).
- UD-015: el código y sus comentarios pasan al inglés; la interfaz, los mensajes a la persona, las plantillas y la documentación siguen en español. Reemplaza a UD-005 en los comentarios.
- El analizador clasifica y descompone con esfuerzo `low` y pensamiento apagado. El límite de llamadas a la vez sube a 16 (medición del 2026-10-20).
- `llm_calls` deja de ser tabla y pasa a ser una vista sobre `spans`.
- MASTER-SPEC §2, §3, §6 y §7 describen el código real; §3.1 lista las dependencias con su licencia.

### Fixed
- El detalle de un fallo de la sesión (`execute_no_result`, `machine_create_failed`) guarda el final del stderr (las últimas líneas, hasta 600 caracteres) y no los primeros 300, donde el runner `machine` deja avisos de ssh y useradd.
- 2026-10-21, noche. Video: los fotogramas sin descripción se piden otra vez a visión. El que siga vacío no llega al análisis (H-3713, REG-010).
- Panel, ronda 5: el texto de «Entrar» se centra en su botón; «Desactivar» es un botón con contorno y la columna de acciones de Equipo tiene encabezado; los roles dicen lo que permiten en un texto emergente; el selector de Proveedor usa el chevron del panel como el de Idioma; «Funciones» y cada función se distinguen; la publicación automática dice qué publica; Conexiones explica cada fila en un texto emergente; el desplegable de envío dice «Enviando» para un texto sin adjuntos y en teléfono pliega el original cuando hay resultado (UD-220, H-3500 a H-3514).
- «Cerrar sesión» no se dibuja con un proveedor de identidad sin ruta de cierre (UD-190). Equipo, Configuración y la ficha del mensaje sin hallazgos de `ui-detectors`: objetivos de 24 px, campo a 17 px en teléfono, miniaturas sin relleno saturado (UD-191).
- Panel: en una ventana más baja que una fila de la lista, la fila ya no se dibuja sobre el paginador (H-96).
- Audio y video: los segmentos de Groq se unen en líneas del tamaño de una oración (`audio.pauseSeconds`, `audio.maxUnitWords`); una nota de 107 s pasa de 46 unidades a 9 (REG-005).

### Removed
- 2026-10-21, noche. La lista «Descartados» de Inicio (UD-253); `POST /api/inputs/:id/restore` se conserva. La razón bajo el título de Conexiones.

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
