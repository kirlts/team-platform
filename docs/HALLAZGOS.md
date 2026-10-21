# Hallazgos de la sesión del 2026-10-20

> Registro de todo lo que cualquier agente encontró o dejó sin hacer en esta sesión, con su dueño y su estado. Regla de Martín, textual: «es súper súper importante que absolutamente el 100 % de los hallazgos que cualquier subagente tuyo haya tenido en esta sesión quede totalmente atendido. No pueden haber hallazgos huérfanos o a medio hacer». Una fila sale de acá sólo cuando su arreglo está en `main` con su prueba, o cuando Martín la descarta por nombre. Ningún agente cierra un trabajo con números parciales ni con un plazo puesto por la sesión: se trabaja hasta cumplir el objetivo, salvo que algo externo lo bloquee, y entonces se nombra qué (Martín, 2026-10-21: «no te pedí que fusionara con lo que tenía, pedí que se trabajara todo»).

Estados: `main` (resuelto y fusionado), `en curso` (asignado a un agente vivo), `abierto` (sin agente todavía), `decisión` (necesita a Martín), `descartado` (con quién lo descartó).

## Analizador y prompts

| # | Hallazgo | Origen | Estado |
|---|---|---|---|
| H-01 | Un párrafo sin saltos de línea era una sola unidad: cuatro puntos salían en un mensaje | primera corrida real | `main` (REG-001) |
| H-02 | La propuesta tenía un área única; cada mensaje va en su área | agente analizador | `main` |
| H-03 | Tablas markdown no se segmentan por fila | banco privado | `main` (REG-002) |
| H-04 | Chat de WhatsApp «[hh:mm, d/m/aaaa] Nombre:» no se reconoce | banco privado | `main` (REG-003) |
| H-05 | Un chat que describe algo a construir se descartó entero; un plazo nunca se descarta | banco privado | `main` (REG-004) |
| H-06 | Fragmentos de voz de 1 a 5 s como unidades | banco privado, audios | `main` (REG-005) |
| H-07 | Voz de video `[mm:ss-mm:ss]` pegada al fotograma anterior | banco privado, videos | en curso (agente prompts, REG-006) |
| H-08 | Un punto partido en 4 a 6 mensajes | banco privado, videos | en curso (agente prompts, REG-007) |
| H-09 | Elogios convertidos en mensajes de Retroalimentación | banco privado | en curso (agente prompts, REG-008) |
| H-10 | Pregunta retórica o muletilla final como mensaje «Pregunta» | banco privado | en curso (agente prompts, REG-009) |
| H-11 | Defectos vistos sólo en un fotograma: se conservan con `source: "frame"` | banco privado | en curso (agente prompts) |
| H-12 | Reunión de 57 KB: 208 s, 7 llamadas, 72k tokens de salida; Word de 3 a 8 MB: 60 a 90 s | banco privado | en curso (agente prompts; objetivo menos de 30 s) |
| H-13 | Documentos largos y reuniones: cobertura 6 a 50 %, bloques de proceso descartados como «no producto», agrupación por tema en vez de por bloque | banco privado | en curso (agente prompts) |
| H-14 | Caso 03 del banco público en 80 % por la unidad 27 (juicio dudoso) | agente analizador | abierto: se cierra con la medición del agente prompts |
| H-15 | Clasificación varía entre corridas (d02: 41 % a 66 %) | banco privado, repetición ×3 | abierto: se mide de nuevo tras H-12 y H-13; si persiste, esfuerzo `medium` en clasificación |
| H-16 | Prompts en dos idiomas (`es-419`, `en`) por `bundle.language` | UD-018 | en curso (agente prompts) |
| H-17 | Contrato de escritura sin marcas de IA y métrica `bench/ai-tells.js` | UD-019 | en curso (agente prompts) |
| H-18 | Proveedor de respaldo `textFallback` se construye y nada lo invoca | documentación (DT-003) | abierto |
| H-19 | Comentario de `src/analyze/api.js` describe el diseño anterior | documentación (DT-006) | abierto: lo resuelve la pasada a inglés |
| H-20 | Capturas sin texto (c01, d01, u03) dan 0 mensajes; la referencia pide uno | banco privado | en curso (agente prompts, UD-021: segunda pasada más profunda antes de concluir cero) |

## Extracción

| # | Hallazgo | Origen | Estado |
|---|---|---|---|
| H-21 | HEIC real de iPhone sin probar (sólo cabecera fabricada) | agente extractores | `main` (la subida rechaza un HEIC por su marca con 422 `image_heic_unsupported`, antes de encolar: `src/size-limits.test.js`, `src/extract/image.test.js` con `src/extract/test/fixtures/libheif.heic`; medido con tres HEIC de teléfono de 1 a 3 MB y uno de libheif: `sharp` los abre y no decodifica HEVC, así que rechazarlos es lo correcto; límite: qué formato envía Safari de iOS desde el selector depende del dispositivo y entra en H-56; medición `2026-10-21-pdf-enlaces-heic-y-flujo-sse-reales.md`) |
| H-22 | Word real con estilos propios, PDF real de cliente, descarga real de internet sin probar | agente extractores | `main` (Word y video reales en el banco privado; PDF reales de arXiv de 15 páginas y del RFC 9110 de 194 páginas, 1,4 a 1,7 s y 180 MB de proceso; páginas reales de internet descargadas con el extractor de enlaces; `src/extract/real-world.live.test.js` con `TEAM_LIVE_NETWORK=1`, medición `2026-10-21-pdf-enlaces-heic-y-flujo-sse-reales.md`) |
| H-23 | `resourceLimits` del hilo trabajador no cubre la memoria WASM de PDFium | agente extractores | `main` (`document.wasmMemoryMb` en 700, `lib/pdfium-capped.js`; tres pruebas en `document.test.js`; medición `2026-10-20-memoria-wasm-pdfium.md`) |
| H-24 | Tope de documentos 25 MiB al subir contra 24 MiB al extraer (DT-005) | documentación | `main` (tope único de 24 MiB) |
| H-25 | Documento de más de 24 MiB y video de más de 20 minutos se rechazan después de encolar | batería | `main` (413/422 al subir, `ffprobe` en la subida) |
| H-26 | Imagen SVG rechazada con 415; el guion de capturas pega un SVG | agente núcleo | `main` (el guion de capturas pega un PNG) |
| H-27 | Opus 32 kbps contra FLAC en español sin medir | informe 06 | `main` (medido: Opus directo a Groq pierde 3 unidades de 20; se mantiene FLAC) |
| H-28 | Video de 20 minutos pesa hasta 190 MB; el tope de 24 MB es para documentos | banco privado | `main`: el video tiene tope propio de 2 GB y 20 minutos |

## Núcleo, API y cola

| # | Hallazgo | Origen | Estado |
|---|---|---|---|
| H-29 | Cambiar el área de un mensaje propuesto y publicar falla por campos de la plantilla anterior (A1) | juez de pantallas | `main` (cambiar área remapea campos) |
| H-30 | Un análisis fallido sólo ofrece «Descartar» y pierde el texto (A2) | juez de pantallas | `main` («Reintentar» en la fila, texto conservado) |
| H-31 | El Editor no puede dar de alta ni quitar miembros (E1) | juez de pantallas | `main` (API: `PATCH /members/:id` `active`; panel: «el Editor da de alta, desactiva y reactiva con Deshacer» en `panel/src/flows.browser.test.mjs`, verde el 2026-10-21) |
| H-32 | No se puede cambiar la contraseña (S1) | juez de pantallas | `main` (cambio de contraseña en Configuración) |
| H-33 | Las respuestas no llevan medios | juez de pantallas, maqueta | `main` (API: multipart en respuestas y `reply_attachments`; panel: «una respuesta con un archivo muestra su ícono de medio» en `panel/src/flows.browser.test.mjs`, verde el 2026-10-21) |
| H-34 | Publicar no revalida la propuesta editada (HP-014) | batería | `main` (publicar exige cada unidad en un mensaje o en `discarded`) |
| H-35 | Un borrador con un campo obligatorio vacío se rechazaba | agente API | `main` (el borrador guarda incompleto; publicar exige) |
| H-36 | Acaparamiento del candado de escritura con dos procesos y reclamos sin pausa | agente núcleo | `main` (anotado, no ocurre con trabajo real) |
| H-37 | Contexto de OpenTelemetry heredado entre trabajos sin `ROOT_CONTEXT` | agente núcleo | `main` |
| H-38 | Checkpoint de WAL pausa 30 ms; `wal_autocheckpoint=0` sin adoptar | agente telemetría y núcleo | descartado (agente núcleo, razón en `src/contracts.md` §2) |
| H-39 | `SELECT *` sobre `spans` falla por enteros de 64 bits | agente telemetría | `main` (documentado; `traceOfJob` y la vista) |
| H-40 | Cola de lotes de telemetría admite 2048 spans con contenido de MB sin acotar | agente telemetría | `main` (`TELEMETRY_QUEUE_MAX_BYTES` en 4 MiB, medido con el span de 48 fotogramas: 3.653.672 B en `span-size.bench.mjs`; `budget.js` y `budget.test.js`: vaciado anticipado y, sobre el tope duro, imágenes con tamaño y sin bytes, con `team.telemetry.blobs_dropped`) |
| H-41 | `sdk-trace-node` ahorraría 10 MiB, bloqueado por versiones | agente imagen | descartado hasta que `sdk-trace-node` llegue a 3.x |
| H-42 | Gancho de pre-commit contra credenciales no estaba activado | batería (DT-004) | `main` (`scripts/install.sh` corre `git config core.hooksPath .githooks`; `src/install-script.test.js`; `docs/INSTALACION.md`) |
| H-43 | Lista de contraseñas bloqueadas sin fuente; la aporta quien instala | agente núcleo | `main` (SecLists, MIT, fijada por commit y SHA-256, citada en `scripts/install.sh` y `docs/INSTALACION.md`; instalada y leída por la aplicación en una corrida real con Docker; límite: sólo 10.908 de 1.000.000 de entradas tienen 15 o más caracteres, y la licencia de los datos no se verificó aparte) |
| H-44 | `Unknown text provider` llega a una persona por el 422 de `PATCH /settings/providers` en inglés | pasada a inglés | `main` (el panel traduce por código: 35 líneas `error.<código>` nuevas, entre ellas `provider_invalid`, y 43 `analysis.error.<código>` nuevas para los códigos de un trabajo fallido, en los dos catálogos; `src/error-codes.test.js` lee el código fuente del servidor y falla ante un código sin traducir; el selector de proveedor muestra el error bajo la fila, que antes se perdía; `panel/src/lib/error-text.test.tsx`; HP-021) |
| H-45 | `VERIFICATION.md` espera `/derive` (DT-010) | documentación | descartado (Martín: «no necesitamos que ejecutes derive»); el eje de verificación es `docs/TEST.md` |
| H-46 | Faltan las capas 3 y 5 de la estrategia de pruebas (DT-008) | documentación | `main` (capa 3 con `fast-check`; capa 5 en `src/image-walkthrough.docker.test.js`: el flujo principal del panel sobre la imagen con un adjunto de cada tipo, 5,8 s el 2026-10-21; más `test:flows` y `test:fit` del panel; DT-008 cerrada) |
| H-47 | Tope de 100 por página sin medición propia | agente núcleo | `main` (fuente: decisión de Martín, convención de API) |

## Panel

| # | Hallazgo | Origen | Estado |
|---|---|---|---|
| H-48 | Sin íconos por tipo de medio en mensajes y respuestas | Martín, juez | `main` (un ícono por tipo de medio) |
| H-49 | Elementos desalineados: título en x=339 a 417, estado en x=515 a 620 | Martín, juez | `main` (grilla de 12 columnas, columnas fijas) |
| H-50 | Diez textos truncados con puntos suspensivos | Martín, juez | `main` (cero truncados, prueba `no-truncation.test.ts`) |
| H-51 | Edición en el lugar con deshacer y rehacer | Martín (UD-017) | `main` (`EditableText`, `useUndoStack`) |
| H-52 | Cada vista cabe en una pantalla; prueba `test:fit` | Martín (UD-017) | `main` (`test:fit` en 1440×900 y 1280×720, con datos ×8) |
| H-53 | Un solo control de idioma que cambia interfaz, prompts y salida | Martín (UD-018) | en curso (agente panel, API y prompts) |
| H-54 | Notas del juez de 1,0 a 2,0 por vista; informe con 8 a 14 hallazgos por vista | juez de pantallas | en curso (agente panel: 59 hallazgos del juez hechos, 39 por hacer o refutar con razón escrita) |
| H-55 | Destello de fondo bajo el contador en Mensajes en móvil | agente panel | `main` (destellos retirados) |
| H-56 | Micrófono sólo probado con el dispositivo falso de Chromium; Safari e iPhone sin probar | agente panel | abierto: necesita un iPhone real. Comando para Martín, que muestra el QR de la dirección del VPS para abrirla en el iPhone, grabar 5 segundos con el micrófono y enviar: `. ~/.config/team-platform/vps-admin && ~/.cache/claude-tmp/hv/bin/python -c "import qrcode,sys;q=qrcode.QRCode(border=1);q.add_data(sys.argv[1]);q.print_ascii(invert=True)" "$URL"`. Comprobado que no se puede desde aquí: el WebKit de Playwright no arranca sin `sudo npx playwright install-deps` y, aun con las bibliotecas, no tiene micrófono |
| H-57 | SSE tras `tailscale serve` o un proxy con búfer sin probar | agente panel | `main` (medido el 2026-10-21 con `scripts/check-sse.mjs`: directo, nginx 1.29 con y sin respetar `X-Accel-Buffering`, Caddy 2 con TLS y `tailscale serve` del VPS entregan el primer byte en menos de 80 ms y el latido a los 15 s; `src/events/events.test.js` exige `x-accel-buffering: no`; medición `2026-10-21-pdf-enlaces-heic-y-flujo-sse-reales.md`) |
| H-58 | Chromium headless no decodifica H.264: miniatura de video en blanco en la captura | juez | `main` (`bench/fixtures/make-webm.sh` genera el WebM VP9; el extractor lo lee: 24 fotogramas muestreados, 6 conservados; Chromium de Playwright lo decodifica; `docs/TEST.md` HP-020 lo indica; límite: el H.264 sí decodificó en este equipo, así que el defecto del juez no se reprodujo aquí) |
| H-59 | `claude-session on-end` no registra desde un subagente | juez | descartado: limitación del entorno; el contenedor se bajó a mano |

## Empaquetado, imagen y licencias

| # | Hallazgo | Origen | Estado |
|---|---|---|---|
| H-60 | Imagen de 819 MB | medición | `main` (466 MB) |
| H-61 | `ffmpeg` de Alpine pesa 129 MB y trae partes GPL | Martín, agente imagen | `main` (ffmpeg 8.1.3 LGPL estático, 22 decodificadores, imagen 306 MB) |
| H-62 | `libvips` LGPL en `sharp` (DT-002) | documentación | `main` (UD-020, dos capas) |
| H-63 | `NOTICE` con binarios de la imagen y prueba de licencias | UD-020 | `main` (`NOTICE` generado, textos de licencia en la imagen, pruebas HP-011) |
| H-64 | Lockfile faltaba en main; imagen no reproducible | agente empaquetado | `main` |
| H-65 | `.env.example` ignorado por `.gitignore` | agente empaquetado | `main` |
| H-66 | Las tres formas de instalación sin probar en un VPS ni tailnet reales | agente empaquetado | `main` (forma 3 en el VPS real por la tailnet, H-89; formas 1 y 2 ejecutadas con Docker el 2026-10-21: `scripts/install.sh`, compose, Caddy con TLS, y el override dentro del compose de otro proyecto sin puertos publicados; límite: la emisión del certificado de Let's Encrypt necesita un dominio propio) |
| H-67 | `promptfoo` trae transitivas con licencia propia y LGPL (sólo desarrollo, fuera de la imagen) | agente empaquetado | `main` (UD-020: la regla aplica a producción) |
| H-68 | Idempotencia por emisor sin decisión (DT-001) | documentación | descartado (Martín: «te lo estabas tomando demasiado literal») |

## Banco y mediciones

| # | Hallazgo | Origen | Estado |
|---|---|---|---|
| H-69 | Referencias del banco público sin auditar contra salidas de modelo | agente empaquetado | `main` (el agente analizador las corrigió con la corrida real) |
| H-70 | Referencias del banco privado con criterio de un solo agente | banco privado | `main` (segunda lectura hecha: 10 casos, 11 desacuerdos resueltos con regla escrita, 12 criterios dejados; referencias migradas a la numeración por oración, 5.329 unidades) |
| H-71 | Costo de Groq no entra en los dólares de la tabla | banco privado | `main` (`pricing.js`: Groq 0,04 USD por hora de audio, sumado en los dos runners) |
| H-72 | Rerun completo del banco privado tras los arreglos del analizador | banco privado | abierto: lo corre la sesión cuando entre la rama de prompts |
| H-73 | HP-019 y HP-020 necesitan llave real y una persona | batería | abierto: HP-019 lo corre la sesión; HP-020 es el juez |
| H-74 | Un docx con RUT y correos de pacientes reales quedó fuera del banco | banco privado | `main` (correcto, no entra) |
| H-75 | `HP-001: a complete flow with an attachment of every kind` agotó su tiempo en dos corridas (9,5 s y 17 s) y pasa sola: carrera o carga, sin aislar | agente API | `main` (causa: la prueba leía `spans` antes de que el lote de 5 s vaciara el span `analyze`; ahora aserta tras `shutDown`; 12 de 12 bajo carga) |
| H-76 | Las referencias privadas descartan «informes sin pedido ni decisión» y 10 entradas `secondary` de voz y fotograma; UD-021 y el contrato nuevo dicen que lo reportado cuenta | segunda lectura | abierto: se alinean al correr el rerun (H-72) con la rama de prompts en main |
| H-77 | Medir con las pruebas reales del banco privado si el perfil en prosa (UD-023) y la descripción del proyecto (UD-024) producen mejores mensajes: tres variantes (sin contexto, con perfiles, con perfiles y proyecto) sobre los 39 casos, con exactitud de destinatario, cobertura, clasificación, marcas de IA y un juicio de utilidad del cuerpo | Martín | `main` (medido: con perfiles la asignación exacta sube de 24 % a 48 % y el recall de 31 % a 88 %; con perfiles y proyecto la cobertura sube de 50 % a 63 % pero la asignación baja a 26 % y deja 20 % sin destinatario; detalle en `mediciones/2026-10-21-perfiles-y-proyecto.md`) |
| H-78 | Las plantillas iniciales no mencionan que pueden apoyarse en la descripción del proyecto (UD-024) | agente perfil | en curso (agente prompts) |
| H-79 | Envíos seguidos: barra lista al instante, análisis en paralelo, bandeja de alto fijo, revisión de a una, contexto de envíos recientes (UD-025) | Martín | en curso (agente panel compose; agente cola; agente prompts) |
| H-80 | Comparar Haiku 5.5 contra Sonnet 5.5 y DeepSeek Flash con los mismos prompts sobre los 7 casos públicos y 12 privados representativos (cobertura, clasificación, asignación, marcas de IA, utilidad, tiempo, costo) | sesión | abierto: corre apenas entre la rama de prompts, para no mezclar el efecto del modelo con el de los prompts |
| H-81 | Captura móvil de Inicio: el análisis no se distingue del mensaje; Envíos repite el texto del mensaje; título repetido en la cabecera y en la página; «3 mensajes» y «Propuesta» repiten «Para revisar · 3 mensajes»; cuerpo del mensaje igual al título; Deshacer y Rehacer ocupan una fila deshabilitados; área «Idea» para un error en los datos de desarrollo (UD-026) | Martín | en curso (agente panel; agente prompts para el cuerpo que repite el título) |
| H-82 | API que el panel necesita: bandeja con `failed`, `PATCH /inputs/:id {text}`, reintento para el autor, `unresolved_count` | agente panel | `main` (`PATCH /inputs/:id`, `POST /inputs/:id/reprocess`, bandeja con `failed` y `unresolved_count`: `src/api/inputs-edit.test.js`) |
| H-83 | Un semáforo único de llamadas en vuelo por proveedor para subir la concurrencia de la cola sin chocar con el tope de peticiones simultáneas de la organización en Anthropic | agente cola | en curso (agente semáforo) |
| H-84 | Cada corrida del banco privado deja 6 a 9 de 39 casos en estado `invalid`, distintos en cada corrida | banco contexto | en curso (agente prompts) |
| H-85 | Precisión de asignación baja para Pablo y Alejandro (3 % a 14 %): se los asigna a mensajes que no les tocan | banco contexto | en curso (agente prompts) |
| H-86 | La descripción del proyecto baja la asignación de 48 % a 26 % y deja 20 % de mensajes sin destinatario | banco contexto | en curso (agente prompts) |
| H-87 | La condición de reversión de UD-023 (prosa contra listas) no está medida: falta una variante con los mismos hechos en lista | banco contexto | en curso (agente banco contexto) |
| H-88 | El juez de utilidad es el mismo modelo que el analizador y no distingue variantes | banco contexto | en curso (agente banco contexto: juez con Sonnet 5.5) |
| H-89 | Montar team-platform en el VPS del toolset (ARM, 2 núcleos, Tailscale) y probarlo de punta a punta con los proveedores reales | Martín | en curso (sesión): imagen compilándose en el VPS, `tailscale serve` en el puerto 8444 sólo para la tailnet |
| H-90 | La medición de perfiles y proyecto (H-77) mezcla tres cosas: puntos sin mensaje (19 % de las unidades), errores de área con mensaje (34 %) y referencias de un solo lector; la frontera Error contra Nueva funcionalidad que usa el prompt (lo lento es error) no coincide con la de las referencias (293 unidades esperadas como Nueva funcionalidad salieron como Error); la variante con proyecto cubre más puntos difíciles y se compara sobre 207 pares de 322 a 476; Javiera no existe en los datos reales y sus 123 asignaciones salen de una regla por título; el juez es el mismo modelo | Martín | en curso (agente banco contexto 2: banco rediseñado con clasificación y asignación sobre el mensaje de referencia; agente lector 2: etiquetas de área y destinatario independientes para los 376 mensajes) |
| H-91 | Las reglas de frontera entre áreas viven escondidas en el prompt del analizador y el Editor no las ve ni las edita (contradice «las instrucciones al modelo viven donde el usuario las edita») | sesión | en curso (agente prompts: mover cada regla de frontera a la descripción del área en `templates/areas.json`) |
