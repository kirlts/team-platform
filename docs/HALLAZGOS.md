# Hallazgos de la sesión del 2026-10-20

> Registro de todo lo que cualquier agente encontró o dejó sin hacer en esta sesión, con su dueño y su estado. Regla de Martín, textual: «es súper súper importante que absolutamente el 100 % de los hallazgos que cualquier subagente tuyo haya tenido en esta sesión quede totalmente atendido. No pueden haber hallazgos huérfanos o a medio hacer». Una fila sale de acá sólo cuando su arreglo está en `main` con su prueba, o cuando Martín la descarta por nombre.

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
| H-29 | Cambiar el área de un mensaje propuesto y publicar falla por campos de la plantilla anterior (A1) | juez de pantallas | en curso (agente panel; la API ya valida con `template_id`) |
| H-30 | Un análisis fallido sólo ofrece «Descartar» y pierde el texto (A2) | juez de pantallas | en curso (agente panel) |
| H-31 | El Editor no puede dar de alta ni quitar miembros (E1) | juez de pantallas | `main` en la API (`PATCH /members/:id` `active`); panel en curso |
| H-32 | No se puede cambiar la contraseña (S1) | juez de pantallas | en curso (agente panel) |
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
| H-48 | Sin íconos por tipo de medio en mensajes y respuestas | Martín, juez | en curso (agente panel, UD-016) |
| H-49 | Elementos desalineados: título en x=339 a 417, estado en x=515 a 620 | Martín, juez | en curso (agente panel, UD-016) |
| H-50 | Diez textos truncados con puntos suspensivos | Martín, juez | en curso (agente panel, UD-016) |
| H-51 | Edición en el lugar con deshacer y rehacer | Martín (UD-017) | en curso (agente panel) |
| H-52 | Cada vista cabe en una pantalla; prueba `test:fit` | Martín (UD-017) | en curso (agente panel) |
| H-53 | Un solo control de idioma que cambia interfaz, prompts y salida | Martín (UD-018) | en curso (agente panel, API y prompts) |
| H-54 | Notas del juez de 1,0 a 2,0 por vista; informe con 8 a 14 hallazgos por vista | juez de pantallas | en curso (agente panel trabaja el informe entero) |
| H-55 | Destello de fondo bajo el contador en Mensajes en móvil | agente panel | en curso (agente panel, dentro de H-49) |
| H-56 | Micrófono sólo probado con el dispositivo falso de Chromium; Safari e iPhone sin probar | agente panel | abierto: necesita un iPhone real (Martín) |
| H-57 | SSE tras `tailscale serve` o un proxy con búfer sin probar | agente panel | abierto: se prueba al instalar en el VPS |
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
