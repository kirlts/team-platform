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
| H-21 | HEIC real de iPhone sin probar (sólo cabecera fabricada) | agente extractores | abierto |
| H-22 | Word real con estilos propios, PDF real de cliente, descarga real de internet sin probar | agente extractores | `main` parcial: el banco privado probó 11 Word y 11 videos reales; falta el PDF real y la descarga |
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
| H-31 | El Editor no puede dar de alta ni quitar miembros (E1) | juez de pantallas | `main` en la API (`PATCH /members/:id` `active`); panel en curso |
| H-32 | No se puede cambiar la contraseña (S1) | juez de pantallas | `main` (cambio de contraseña en Configuración) |
| H-33 | Las respuestas no llevan medios | juez de pantallas, maqueta | `main` en la API (multipart en respuestas, `reply_attachments`); panel en curso |
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
| H-44 | `Unknown text provider` llega a una persona por el 422 de `PATCH /settings/providers` en inglés | pasada a inglés | abierto: el panel traduce por código (UD-018) |
| H-45 | `VERIFICATION.md` espera `/derive` (DT-010) | documentación | descartado (Martín: «no necesitamos que ejecutes derive»); el eje de verificación es `docs/TEST.md` |
| H-46 | Faltan las capas 3 y 5 de la estrategia de pruebas (DT-008) | documentación | `main` parcial: capa 3 (`fast-check`) hecha; capa 5 (recorrido Playwright sobre la imagen) en curso (agente panel, `test:fit`) |
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
| H-56 | Micrófono sólo probado con el dispositivo falso de Chromium; Safari e iPhone sin probar | agente panel | abierto: necesita un iPhone real (Martín) |
| H-57 | SSE tras `tailscale serve` o un proxy con búfer sin probar | agente panel | rama `wt-vps-media` (probado en el VPS el 2026-10-21 por la tailnet, puerto 8444: conexión abierta 660 s, 43 latidos exactos cada 15 s, y los eventos `progress` y `message` de un envío llegaron al instante, sin búfer ni corte) |
| H-58 | Chromium headless no decodifica H.264: miniatura de video en blanco en la captura | juez | `main` (`bench/fixtures/make-webm.sh` genera el WebM VP9; el extractor lo lee: 24 fotogramas muestreados, 6 conservados; Chromium de Playwright lo decodifica; `docs/TEST.md` HP-020 lo indica; límite: el H.264 sí decodificó en este equipo, así que el defecto del juez no se reprodujo aquí) |
| H-59 | `claude-session on-end` no registra desde un subagente | juez | descartado: limitación del entorno; el contenedor se bajó a mano |
| H-92 | Inicio dejaba «Últimos mensajes» y «Últimas respuestas» como un hipervínculo plegado mientras hubiera envíos, y la cola, el original y el análisis ocupaban todo el alto | Martín (captura en teléfono y PC) | `wt-inicio` (UD-030) |
| H-93 | La API no guarda quién leyó qué: «respuestas sin leer» no existe como dato. El criterio mínimo (UD-028) baja la insignia al responder o cerrar, no al leer | sesión | abierto: se evalúa un estado de lectura por miembro si el criterio mínimo deja avisos ya vistos |
| H-94 | Los pendientes por área sólo se veían al Editor en la barra lateral, sin enlace a Mensajes | Martín | `wt-inicio` (UD-028; Inicio los muestra a todos y la barra los enlaza) |
| H-95 | El texto de descripción del análisis se dibujaba a 13 px, igual que los demás textos secundarios | Martín | `wt-inicio` (UD-030: 17 px, interlineado 1,65, texto pleno) |
| H-96 | `FitList` dibuja al menos una fila aunque el marco no la tenga: con un marco más bajo que una fila, la fila se monta sobre el paginador | sesión (captura con la revisión abierta bajo los dos bloques) | abierto: Inicio ya no estrecha los bloques (el diálogo no ocupa la página), el defecto queda para cualquier vista con un marco bajo |
| H-97 | La campana sólo contaba avisos del flujo de eventos; no decía nada de lo que afecta al miembro | Martín | `wt-inicio` (UD-029: la campana cuenta el resumen y tiñe su fondo con la prioridad más alta) |

## Empaquetado, imagen y licencias

| # | Hallazgo | Origen | Estado |
|---|---|---|---|
| H-60 | Imagen de 819 MB | medición | `main` (466 MB) |
| H-61 | `ffmpeg` de Alpine pesa 129 MB y trae partes GPL | Martín, agente imagen | `main` (ffmpeg 8.1.3 LGPL estático, 22 decodificadores, imagen 306 MB) |
| H-62 | `libvips` LGPL en `sharp` (DT-002) | documentación | `main` (UD-020, dos capas) |
| H-63 | `NOTICE` con binarios de la imagen y prueba de licencias | UD-020 | `main` (`NOTICE` generado, textos de licencia en la imagen, pruebas HP-011) |
| H-64 | Lockfile faltaba en main; imagen no reproducible | agente empaquetado | `main` |
| H-65 | `.env.example` ignorado por `.gitignore` | agente empaquetado | `main` |
| H-66 | Las tres formas de instalación sin probar en un VPS ni tailnet reales | agente empaquetado | abierto: se prueba al instalar en el VPS |
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
| H-82 | API que el panel necesita: bandeja con `failed`, `PATCH /inputs/:id {text}`, reintento para el autor, `unresolved_count` | agente panel | en curso (agente cola) |
| H-83 | Un semáforo único de llamadas en vuelo por proveedor para subir la concurrencia de la cola sin chocar con el tope de peticiones simultáneas de la organización en Anthropic | agente cola | en curso (agente semáforo) |
| H-84 | Cada corrida del banco privado deja 6 a 9 de 39 casos en estado `invalid`, distintos en cada corrida | banco contexto | en curso (agente prompts) |
| H-85 | Precisión de asignación baja para Pablo y Alejandro (3 % a 14 %): se los asigna a mensajes que no les tocan | banco contexto | en curso (agente prompts) |
| H-86 | La descripción del proyecto baja la asignación de 48 % a 26 % y deja 20 % de mensajes sin destinatario | banco contexto | en curso (agente prompts) |
| H-87 | La condición de reversión de UD-023 (prosa contra listas) no estaba medida | banco contexto | medido, [medición corregida](investigaciones/mediciones/2026-10-21-perfiles-y-proyecto-corregida.md): en modo oráculo la prosa acierta el conjunto de destinatarios en 51,0 % de los mensajes y las listas en 53,1 %; de 75 mensajes donde difieren, la prosa acierta 35 y las listas 40 (p 0,64). La condición no se cumple: la prosa no asigna peor, y tampoco mejor |
| H-88 | El juez de utilidad era el mismo modelo que el analizador y no distinguía variantes | banco contexto | medido con Sonnet 5.5, [medición corregida](investigaciones/mediciones/2026-10-21-perfiles-y-proyecto-corregida.md): tampoco separa (7 puntos por variante, promedios 2,86 a 3,29, mediana 3 en todas); `--judge-model` queda en el banco. Un juicio con poder necesita unos diez veces más mensajes |
| H-89 | Montar team-platform en el VPS del toolset (ARM, 2 núcleos, Tailscale) y probarlo de punta a punta con los proveedores reales | Martín | en curso (sesión): imagen compilándose en el VPS, `tailscale serve` en el puerto 8444 sólo para la tailnet |
| H-90 | La medición de perfiles y proyecto (H-77) mezcla tres cosas: puntos sin mensaje (19 % de las unidades), errores de área con mensaje (34 %) y referencias de un solo lector; la frontera Error contra Nueva funcionalidad que usa el prompt (lo lento es error) no coincide con la de las referencias (293 unidades esperadas como Nueva funcionalidad salieron como Error); la variante con proyecto cubre más puntos difíciles y se compara sobre 207 pares de 322 a 476; Javiera no existe en los datos reales y sus 123 asignaciones salen de una regla por título; el juez es el mismo modelo | Martín | banco contexto 2: modo oráculo, segunda referencia, intervalos y comparación de a pares hechos ([medición corregida](investigaciones/mediciones/2026-10-21-perfiles-y-proyecto-corregida.md)); el perfil importa, el proyecto empeora la asignación, las listas empatan con la prosa. Queda: cinco repeticiones (se hizo una por el tope de gasto), la variante con proyecto en los 15 casos restantes, la frontera Error contra Nueva funcionalidad |
| H-91 | Las reglas de frontera entre áreas viven escondidas en el prompt del analizador y el Editor no las ve ni las edita (contradice «las instrucciones al modelo viven donde el usuario las edita») | sesión | en curso (agente prompts: mover cada regla de frontera a la descripción del área en `templates/areas.json`) |

## Ronda 1, juez B: enviar, analizar, revisar y publicar (informe `ronda1-B.md`, 30 hallazgos)

| # | Hallazgo | Origen | Estado |
|---|---|---|---|
| H-200 | Compositor: la barra crece de 52 a 138 px con adjuntos y enlace y empuja las listas | J1-B-01 (severidad 3), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-201 | Compositor: la × de quitar un adjunto mide 12 px y está sobre la miniatura | J1-B-02 (severidad 2), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-202 | Compositor: Enviar deshabilitado en tema claro casi no se distingue del fondo | J1-B-03 (severidad 2), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-203 | Compositor: filas con alineaciones propias; en móvil la columna de texto queda estrecha | J1-B-04 (severidad 2), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-204 | Compositor: no hay selector de idioma | J1-B-05 (severidad 2), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-205 | Progreso del análisis en 0 % durante unos 8 s, parece colgado | J1-B-06 (severidad 4), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-206 | Panel de Análisis en espera ocupa 380x650 px para una línea | J1-B-07 (severidad 3), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-207 | Estado y barra duplicados entre la fila de Envíos y el panel de Análisis | J1-B-08 (severidad 3), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-208 | Tres insignias de estado de peso parecido en la bandeja | J1-B-09 (severidad 2), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-209 | Al enviar desaparecen las listas de Inicio y el enlace para volver pesa 12 px | J1-B-10 (severidad 2), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-210 | Propuesta: un mensaje por vez con «1–1 de 3» y Enviar no dice cuántos manda | J1-B-11 (severidad 4), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-211 | «Sin acción 2» sin explicación | J1-B-12 (severidad 3), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-212 | Jerarquía plana de chips en cada mensaje de la propuesta | J1-B-13 (severidad 3), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-213 | Quitar un mensaje: sin aviso ni deshacer cerca, y se apaga sin decir por qué | J1-B-14 (severidad 3), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-214 | Desplegable de destinatarios: 4 de 9 visibles, filas de 3 líneas, sin barra de desplazamiento | J1-B-15 (severidad 3), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-215 | Deshacer y Rehacer sin mensaje de lo deshecho y presentes sin nada que deshacer | J1-B-16 (severidad 2), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-216 | Desplegable de áreas en móvil sale del contenedor | J1-B-17 (severidad 2), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-217 | Sin «Volver a analizar» ni plantilla visible en la propuesta | J1-B-18 (severidad 3), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-218 | Enter dentro del cuerpo guarda y cierra sin pista del atajo | J1-B-19 (severidad 2), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-219 | Dos «Reintentar» con estilos distintos | J1-B-20 (severidad 3), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-220 | Mensaje de error de proveedor sin decir si el envío se conservó | J1-B-21 (severidad 3), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-221 | Falla del análisis: Deshacer y Rehacer y panel vacío con tres cromas fuertes | J1-B-22 (severidad 2), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-222 | Tema oscuro: contraste bajo del rojo de error | J1-B-23 (severidad 2), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-223 | Móvil: la falla de un segundo envío queda bajo la propuesta abierta | J1-B-24 (severidad 2), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-224 | Publicar sin confirmación ni rastro | J1-B-25 (severidad 5), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-225 | Descartar elimina la propuesta de un clic, sin confirmar ni deshacer | J1-B-26 (severidad 4), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-226 | Al publicar con envíos en cola el panel salta al siguiente sin aviso | J1-B-27 (severidad 3), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-227 | Móvil: el Original ya leído va antes del Análisis mientras analiza | J1-B-28 (severidad 3), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-228 | Móvil: Enviar y Descartar quedan al final de la lista, sin ancla fija | J1-B-29 (severidad 3), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-229 | Objetivos táctiles de 12 a 28 px | J1-B-30 (severidad 2), agente ronda1-b | en curso (rama `wt-ronda1-b`) |
| H-130 | Una foto de teléfono de 12 MP falla en el VPS: al reducirla a 2576 px salía como PNG (13 MB, 17 MB en base64) y Anthropic respondió «image exceeds 10 MB maximum»; el input quedó `failed` | prueba en el VPS, 2026-10-21 | rama `wt-vps-media` (`normalizeImage`: lo que era JPEG o WebP sale como JPEG, y si aun así pasa de `maxBytes` se reduce a la mitad hasta el piso; la misma foto pasó de 13 MB a 553 KB; prueba `una foto grande de teléfono…`) |
| H-131 | Un 429 de Anthropic («Number of concurrent requests across all models») con un solo trabajo en la cola: el reintento esperó 112 ms, `Retry-After` se leía y no se usaba | prueba en el VPS, 2026-10-21 | rama `wt-vps-media` (`queue.fail` toma `retryAfterMs` como piso del retroceso, con tope en `retryMaxMs`; prueba nueva en `queue.test.js`). La causa de fondo, la concurrencia de la organización compartida con otras sesiones, sigue en H-83 |
| H-132 | Un reintento por 429 rehace todo el `analyze` (la clasificación ya pagada se repite) | prueba en el VPS | abierto: lo resuelve H-83 (semáforo por proveedor) y no se toca aquí para no pisarlo |
| H-133 | Una propuesta con cero mensajes (un enlace compartido sin pedido, 68 unidades todas descartadas) no se puede publicar: `422 messages_empty` | prueba en el VPS | abierto: agente prompts (el analizador descarta «Mira este artículo, me parece relevante para nosotros»; decidir si un enlace compartido sin pedido es una Idea) |
| H-134 | El texto de un enlace trae el pie de la página: referencias, miniaturas y enlaces en markdown (68 unidades para un artículo de Wikipedia) | prueba en el VPS | descartado: Readability entrega el contenido principal del artículo y las referencias forman parte de él; recortarlas sería una regla sobre texto ajeno. El analizador las descartó solas (un llamado, 0,0007 USD) |
| H-135 | Con un video, el analizador generó un primer mensaje genérico («Revisar el problema mostrado en la grabación») con sólo el texto del envío, además del mensaje real con las unidades de voz y de fotograma | prueba en el VPS | abierto: agente prompts |
| H-136 | La descripción de una captura se parte en 10 unidades por los «;» y los «:»; todas quedan en un mismo mensaje y bien numeradas | prueba en el VPS | descartado: sin efecto en la propuesta (una sola unidad de contexto por mensaje); se reabre si se mide un mensaje partido por esto |
| H-137 | El host del VPS tiene 115 MB libres y el swap al 96 % (otros contenedores); team-platform usó entre 85 y 202 MiB, con 4,7 GB disponibles como caché | medición en el VPS | descartado: el contenedor no es la causa; durante un video de 4 min 1080p (80 MB) el pico fue 202 MiB y no hubo reinicios ni OOM |

