# Motor de análisis y adjuntos: qué hace la industria en 2026

Consultado el 2026-10-20 por dos agentes de investigación en paralelo. Cada dato lleva su fuente; lo marcado «sin verificar» no tiene fuente primaria. La decisión que esto alimenta es de Martín: bucle propio contra la API o harness externo por input.

## 1. Bucle propio contra harness externo

### Qué cuesta un harness por input

| Dato | Valor | Fuente |
|---|---|---|
| `claude -p` sin `--bare` carga hooks, skills, MCP, memoria y CLAUDE.md como una sesión interactiva | Documentado; `--bare` lo omite y será el valor por omisión | code.claude.com/docs/en/headless, 2026-10-20 |
| Tokens de arranque en frío en la raíz de un repo | ~150.000 (sin `--bare`) | dev.to/rulestack, 2026 |
| Tokens de prompt de sistema y definiciones de herramientas | 27.169 sin configuración; 30.919 con proyecto. Sistema 2.300–3.600, herramientas 14.000–17.600 | claudecodecamp.com, sin verificar contra Anthropic |
| Latencia fija de proceso | `claude --version` ~600 ms; wrappers por llamada miden 2–4 s | github.com/anthropics/claude-code/issues/8164 y NousResearch/hermes-official-plugins/issues/42 |
| Espera constante de ~405 s en `claude -p` 2.1.220–221 | Issue abierto desde 2026-08-03 | github.com/anthropics/claude-code/issues/83859 |
| Consumo de la ventana de 5 h | 1,8× el modo interactivo | github.com/anthropics/claude-code/issues/97074 |
| Con DeepSeek vía `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic` | Imágenes sí; bloques `document` (PDF) no; `cache_control` se ignora | api-docs.deepseek.com/guides/anthropic_api, 2026-10-20 |
| Entrada por stdin | Máximo 10 MB | code.claude.com/docs/en/headless |
| SIGTERM a mitad de turno | Sin resultado, exit 143 | ídem |
| Uso de Agent SDK y `claude -p` en planes de suscripción | Crédito mensual aparte desde 2026-06-15 | blog secundario, sin verificar |

Harness abiertos con DeepSeek: OpenCode (`opencode serve`, `--attach` evita el arranque en frío de MCP; 75+ proveedores) y Kilo CLI (fork de OpenCode, `kilo run --auto`, guía oficial de DeepSeek). Fuentes: opencode.ai/docs/cli, opencode.ai/docs/providers, kilo.ai/docs, 2026-10-20.

### Quién embebe un harness como ejecutor de trabajos

Orquestadores abiertos que lanzan CLIs de código en headless, uno por worktree, para tareas sobre repositorios: Claw Orchestrator, Bernstein, ao (github.com/Enderfga/claw-orchestrator; github.com/bradAGI/awesome-cli-coding-agents). Ningún producto de bandeja de entrada o documentos encontrado usa un harness de código como ejecutor. Ausencia de hallazgo, no prueba.

Para correr agentes en producción Anthropic ofrece Managed Agents (hospedado) o el Agent SDK dentro del proceso propio; las guías exigen sandbox de contenedor y lista de herramientas con denegación por omisión (hatchworks.com y qovery.com, blogs secundarios).

### Dónde se optimizan los tokens de un adjunto grande

La pregunta de Martín: «para adjuntos grandes, nosotros tendríamos que optimizar los tokens … un harness es mejor para manejar una variedad de inputs, ¿o me equivoco?».

Lo que un harness hace con un adjunto grande es lo mismo que haría un bucle propio: lo lee por partes con sus herramientas de archivo y decide él cuánto leer. La diferencia es quién fija el presupuesto. En un harness el presupuesto lo fija el modelo turno a turno, sobre un contexto que ya partió en 27.000–150.000 tokens; en un bucle propio lo fija el servidor antes de llamar, con el adjunto ya extraído a texto y con el tamaño medido. Y una capacidad que el harness no tiene: repartir un adjunto de 40 puntos en varias llamadas chicas en paralelo (mapa) y una de consolidación (reducción), registrando el costo de cada paso.

Lo que sí hace mejor un harness: explorar con herramientas de archivo un insumo cuya forma no se conoce de antemano (un repositorio, un zip con estructura arbitraria). Los insumos de team-platform tienen forma conocida: texto, imagen, video, audio, PDF, DOCX, enlace.

### Veredicto de la investigación

Bucle propio con extracción determinista antes del modelo, esquema de salida validado y presupuesto de tokens fijado por el servidor. Un harness sólo si el trabajo exige exploración abierta de archivos; en ese caso OpenCode o Kilo en modo `serve`, que aceptan DeepSeek, nunca `claude -p` por input.

## 2. Adjuntos grandes

### PDF nativo (Anthropic)

32 MB y 600 páginas por solicitud (100 si el contexto es menor a 1M). Cada página cuesta 1.500–3.000 tokens de texto más la imagen de la página; un PDF de 60 páginas son 90.000–180.000 tokens crudo. Files API para no reenviar el base64. Fuente: platform.claude.com/docs/en/build-with-claude/pdf-support, 2026-10-20. DeepSeek Flash no acepta PDF (api-docs.deepseek.com/guides/vision).

### Extraer a markdown antes del modelo

| Herramienta | Velocidad (reglamento de 14 págs., 4 vCPU) | Tablas | Escaneado | Licencia | Estrellas |
|---|---|---|---|---|---|
| MarkItDown (Microsoft) | 0,6 s | rompe tablas | salida vacía | MIT | ~191.000 |
| Docling (IBM) | 41 s | excelente | legible (OCR) | MIT | ~69.200 |
| Marker | 2 min 14 s | excelente | legible | GPL-3.0; pesos con licencia que cobra sobre 2 M USD de ingresos | — |

Fuente: dev.to/dmaxdev, 2026-05-03 (tres documentos; benchmark de terceros). Otro benchmark (github.com/pdfmarkdownapp/pdf-to-markdown-benchmark) da MarkItDown 57/100, Docling 77, Marker y MinerU 86.

Docling lee PDF, DOCX, PPTX, XLSX, imágenes y audio; se sirve como REST con `docling-serve` (Python, puerto 5001, imagen Docker). No hay nada nativo en Node con estructura de tablas: `unpdf` (PDF.js) extrae texto sin layout; `mammoth` declara deprecada su salida markdown (github.com/mwilliamson/mammoth.js). El patrón escalonado de la fuente: MarkItDown para DOCX y PDF digital simple; Docling cuando la estructura sale rota o hay escaneo.

## 3. Modelos y precios (USD por millón de tokens)

### Texto y visión

| Modelo | Entrada | Caché lectura | Salida | Contexto | Imagen | PDF | Fuente |
|---|---|---|---|---|---|---|---|
| `claude-haiku-5-5` (prompt ≤100K) | 0,10 | 0,01 | 0,50 (lote: 0,05 / 0,25) | 1M | sí | sí, nativo | platform.claude.com/docs/en/about-claude/pricing, 2026-10-20 |
| `claude-sonnet-5-5` | 2 | 0,10 | 10 | 1M | sí | sí | ídem |
| `deepseek-flash` (V4.1-Flash-1017; «DeepSeek V4.1 Vision» no existe con ese nombre, `deepseek-v4-flash-vision-exp` es alias) | 0,15 valle / 0,30 punta | 0,003 / 0,006 | 0,60 / 1,20 | 1M | hasta 600 por solicitud, 1.024 tokens cada una | no | api-docs.deepseek.com/quick_start/pricing y /guides/vision, 2026-10-20 |
| `deepseek-v4-pro` | 0,66 valle | — | 1,98 valle | — | no | no | ídem |

Haiku 5.5 sobre 100K tokens de prompt sube a 0,50 / 2,50. Haiku 5.5 tiene salidas estructuradas (`output_config.format` con `json_schema`; sin `minLength` ni `maximum`; `additionalProperties:false` obligatorio; primer uso de un esquema añade latencia de compilación, caché 24 h) y pensamiento por omisión `medium`, que para clasificar se baja a `low`. Sonnet 5.5 no admite `tool_choice` forzado. Costo por llamada con 1.000 de entrada y 300 de salida: Haiku ≈ 0,00025; DeepSeek Flash en valle ≈ 0,00033. Punta de DeepSeek: lunes a viernes 01–04 y 06–10 UTC. DeepSeek expone endpoints compatibles con OpenAI y con Anthropic Messages. Pesos abiertos de DeepSeek: MIT según fuentes secundarias, sin verificar en Hugging Face.

### Transcripción

| Opción | Precio | Límite | Calidad | Fuente |
|---|---|---|---|---|
| Groq `whisper-large-v3-turbo` | 0,04 USD/h (≈0,00067/min) | 25 MB gratis, 100 MB de pago; mínimo 10 s; 20 req/min, 2.000/día, 7.200 s/h, 28.800 s/día (atribuidos al plan Developer; el gratuito exacto se ve en la consola, sin verificar) | WER 12 %; factor de velocidad 216 (~0,3 s por minuto de audio, cálculo, sin medir) | console.groq.com/docs/speech-to-text y /rate-limits, 2026-10-20 |
| Groq `whisper-large-v3` | 0,111 USD/h | ídem | WER 10,3 % | ídem |
| Mistral Voxtral 3 Mini Transcribe | 0,0035 USD/min (5× Groq turbo) | — | — | mistral.ai/news/voxtral-3, 2026-10-20 |
| Deepgram Nova-3 | 0,0043 USD/min; 200 USD de crédito inicial | — | — | deepgram.com/pricing |
| faster-whisper / whisper.cpp local | 0 | CPU del VPS | Whisper, 99 idiomas, MIT | — |
| Parakeet TDT 0.6B v3 | 0 | 25 idiomas europeos, CC-BY-4.0 | WER 6,32 en inglés contra 7,83 de v3-turbo (Open ASR Leaderboard, arxiv.org/pdf/2510.06961); español sin medir | — |

Es lo que el autor ya usa en otra herramienta propia: Groq `whisper-large-v3-turbo` por `curl`.

### Video

Dos caminos. Propio: `ffmpeg` con `select='gt(scene,0.2–0.4)'` conserva el primer fotograma y los cambios de escena (bogotobogo.com; el proyecto claude-video usa 0,20); `-skip_frame nokey` es más barato pero no se alinea con los cortes; deduplicación por hash perceptual sin fuente, a medir. Pista de audio a transcripción. Nativo: Gemini acepta video a 1 fotograma/s (`fps` configurable), 100 tokens/s en resolución baja y 300 en alta más 32 de audio; hasta 3 h en baja; Files API 2 GB gratis. 20 minutos ≈ 120.000 tokens en baja. Precios: `gemini-2.5-flash-lite` 0,10 / 0,40 (20 min ≈ 0,012 USD); `gemini-3.1-flash-lite` 0,25 / 1,50; `gemini-3.5-flash-lite` 0,30 / 2,50; `gemini-3.8-flash` 0,75 / 3,75 hasta 2026-12-31 y 1,50 / 7,50 después. Todas con nivel gratuito. Fuentes: ai.google.dev/gemini-api/docs/pricing y /video-understanding, 2026-10-20. Qwen con video por OpenRouter: `qwen/qwen3.7-flash` 0,03 / 0,13, duración sin verificar.

### Compuerta única

OpenRouter enruta `deepseek/deepseek-v4.1-flash-1017`, `anthropic/claude-haiku-5.5` y `google/gemini-3.8-flash`, todos con tools y structured outputs; comisión 5,5 % al comprar créditos; sin endpoint de transcripción (audio sólo en base64 por chat); latencia del gateway sin verificar. Fuente: openrouter.ai/api/v1/models y /pricing, 2026-10-20.

## 4. Cola y progreso en Node + SQLite

Las librerías de cola sobre SQLite son chicas o abandonadas: Workmatic (MIT, better-sqlite3 + Kysely, arriendo y reintentos, 8 estrellas, sin eventos documentados); better-queue-sqlite (3 años sin versión); plainjob y walq sin verificar. Una tabla `jobs` propia con estados y arriendo es más corta que cualquiera de ellas. Progreso: SSE por omisión (reconexión del navegador, un solo sentido); WebSocket sólo con control bidireccional; cancelar va por `POST` aparte. Fuentes: github.com/litepacks/workmatic; alexcloudstar.com (2026); blog.promptlayer.com (2026-05).

## 5. Comparables

| Producto | Licencia | Qué hace con IA | Descompone un input en varios |
|---|---|---|---|
| Plane (plane.so/intake) | AGPL-3.0 | Agente por @mención revisa el ítem y recomienda aceptar o rechazar; de pago | No |
| Quackback | AGPL | Sentimiento, duplicados, demanda, resumen con citas; servidor MCP | No |
| ClearFlask | abierto | «Ideas a tareas», sin detalle | sin verificar |
| FeedLog | MIT | Agente en el widget convierte el mensaje en reporte de error | No |
| Linear Triage Intelligence | cerrado | Sugiere duplicados y destino | No |
| Fider, Astuto (archivado 2026-02-08), Huly | AGPL / EPL | Sin IA | No |

Ninguno descompone un input heterogéneo en varios mensajes MECE con plantilla por categoría ni deja que el remitente confirme. Ese hueco es el de team-platform.
