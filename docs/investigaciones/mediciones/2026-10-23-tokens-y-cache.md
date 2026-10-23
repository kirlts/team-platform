# Tokens y caché de las llamadas a Anthropic, 2026-10-23

Resultado: un envío de dos videos con el caché frío baja de 0,264 a 0,214 USD (media de tres corridas cada uno, Sonnet 5.5), porque las llamadas paralelas de «descomponer» dejan de escribir el mismo prefijo varias veces. El tiempo no cambia más allá del ruido (56 s contra 59 s con la máquina cargada). En el harness, una sesión de 37 minutos pagó 0,92 USD de escrituras de caché, 72 % de ellas por reescribir el contexto cada vez que una herramienta tardó más de 5 minutos; con TTL de 1 hora ese tramo se lee a un 4 % del precio. Mover el CLAUDE.md y la parte estable del prompt al prompt de sistema baja la segunda sesión de 55.500 a 6.900 tokens escritos. El orden del texto dentro del prompt de `execute` no cambia el caché.

Fecha: 2026-10-23. Código medido: rama `wt-tokens-cache`. Gasto de API de las mediciones: 2,79 USD, declarados en `bench/results/private-spend.jsonl` con el prefijo `tokens-cache/`.

## Fuentes

Consultadas el 2026-10-23.

| Fuente | Dato usado |
|---|---|
| https://platform.claude.com/docs/en/build-with-claude/prompt-caching | Mínimo cacheable de 512 tokens en Sonnet 5.5 y Haiku 5.5. Escritura 1,25 veces (5 min) y 2 veces (1 hora) el precio de entrada; lectura 0,1 veces, 0,05 veces en Sonnet 5.5 y Opus 5.5. «A cache entry only becomes available after the first response starts». Hasta 4 puntos de corte. `max_tokens: 0` precalienta y no admite `output_config.format` |
| https://platform.claude.com/docs/en/build-with-claude/structured-outputs | «Changing the `output_config.format` parameter will invalidate any prompt cache for that conversation thread» |
| https://platform.claude.com/docs/en/about-claude/pricing | Sonnet 5.5: entrada 2, escritura 2,50 (5 min) y 4 (1 hora), lectura 0,10, salida 10 USD por millón. Haiku 5.5: 0,10, 0,125, 0,20, 0,01 y 0,50. Lote: 50 % |
| https://platform.claude.com/docs/en/build-with-claude/batch-processing | Lote asíncrono, 50 % menos, «most batches finishing in less than 1 hour», hasta 24 horas; el caché en lote es «best-effort», 30 a 98 % de aciertos |
| https://code.claude.com/docs/en/prompt-caching | Capas de Claude Code, TTL, `CLAUDE_CODE_PROMPT_CACHE_TTL`, alcance del caché |
| https://code.claude.com/docs/en/cli-reference | `--append-system-prompt-file`, `--exclude-dynamic-system-prompt-sections` |
| https://code.claude.com/docs/en/env-vars | `CLAUDE_CODE_PROMPT_CACHE_TTL` (5m o 1h, desde la 2.1.242), `CLAUDE_CODE_DISABLE_CLAUDE_MDS`, `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS` |

La página de precios dice en un párrafo «$0.20» para la lectura de Opus 5.5 y Sonnet 5.5 juntos; la tabla da 0,10 para Sonnet 5.5 y 0,20 para Opus 5.5 (5 % de 2 y de 4). Se usa la tabla. `bench/pricing.js` tenía 0,20 para Sonnet 5.5 y quedó en 0,10. El costo que Claude Code informa (`total_cost_usd`, `execute_runs.cost_usd`) usa 0,20: en la ejecución 2 de la instancia del cliente (2.281.132 tokens leídos) sobra 0,228 de 1,369 USD.

## Análisis hoy

Fuente: tabla `spans` del VPS (copia de solo lectura, 1.160 spans, 2026-10-21 a 2026-10-23) y las trazas de los 42 trabajos de la instancia del cliente (`GET /api/jobs/:id/trace`, 124 llamadas a modelos). Tokens de entrada sin caché, leídos y escritos; Sonnet 5.5 y Haiku 5.5 sumados por tipo.

| Tipo de llamada | Modelo | n | Sin caché | Leídos | Escritos | Salida | Lectura sobre lectura más escritura | USD por llamada | s por llamada |
|---|---|---|---|---|---|---|---|---|---|
| Clasificar | Sonnet | 35 | 99.224 | 155.124 | 65.624 | 47.222 | 70 % | 0,0243 | 14,1 |
| Clasificar | Haiku | 32 | 31.878 | 48.197 | 62.122 | 3.687 | 44 % | 0,0004 | 1,8 |
| Cobertura | Sonnet | 14 | 18.050 | 89.330 | 0 | 9.080 | 100 % | 0,0097 | 7,6 |
| Segunda lectura | Sonnet | 2 | 6.008 | 15.476 | 0 | 1.579 | 100 % | 0,0147 | 6,8 |
| Descomponer | Sonnet | 110 | 220.226 | 428.900 | 152.228 | 48.113 | 74 % | 0,0122 | 7,9 |
| Descomponer | Haiku | 60 | 36.425 | 80.679 | 163.550 | 16.148 | 33 % | 0,0005 | 2,3 |
| Visión, lote de fotogramas | Sonnet | 2 | 26.084 | 0 | 0 | 8.355 | sin caché | 0,0679 | 30,1 |
| Visión, una imagen | Sonnet | 4 | 8.793 | 0 | 0 | 5.179 | sin caché | 0,0173 | 15,5 |
| Visión, lote de fotogramas | Haiku | 5 | 38.689 | 0 | 0 | 19.196 | sin caché | 0,0027 | 17,0 |

Notas de la tabla:

- Costo calculado con los precios de la página de precios del 2026-10-23, escritura a 5 minutos. Los spans de Sonnet no traen costo (`src/telemetry/pricing.js` solo conoce Haiku).
- No hay llamadas de PDF en ninguna fuente: no se pudo medir.
- Las llamadas de visión no llevan sistema, así que no hay nada que cachear; el costo es el de las imágenes (unos 450 tokens de entrada y 126 a 246 de salida por fotograma, ya deduplicados por `dHash`).
- Reintentos por salida inválida o corte: 5 de 262 spans de clasificar, cobertura y descomponer (2 %). Un reintento ya lee el sistema del caché; cachear también el mensaje de usuario cuesta 0,25 veces su tamaño en cada llamada y ahorra 0,9 veces en el 2 % que reintenta, así que no se hace.

Dónde se va el dinero en la instancia del cliente (Sonnet, 16 análisis, 1,88 USD): salida 52 %, entrada sin caché 34 %, escritura de caché 12 %, lectura 3 %. El caché es una palanca de un 10 % del gasto como máximo. La salida de clasificar con esfuerzo alto (UD-260) es 21 % del total y no se toca.

Tasa de aciertos del primer clasificar de cada envío: 4 de 12 en el VPS y 12 de 16 en el cliente; los 12 del cliente vienen de ráfagas de la muestra de diez (separadas por menos de 6 minutos). Los envíos sueltos están separados por 1 a 3 horas.

## Qué pasa con el prefijo

Medido con `bench/cache-probe.mjs` (Sonnet 5.5 y Haiku 5.5, 5.100 tokens de prefijo, mismos resultados en los dos):

| Caso | Escritura | Lectura |
|---|---|---|
| Mismo sistema y esquema, repetida | 0 | 5.137 |
| Mismo sistema, otro esquema de salida | 5.098 | 0 |
| Mismo sistema, sin esquema | 4.450 | 0 |
| `max_tokens: 0` sin esquema y luego la llamada con esquema | 5.138 | 0 |
| Dos puntos de corte (compartido y plantilla), otra plantilla | 6.116 | 0 |
| Cuatro llamadas simultáneas, caché frío | 4 × 5.136 | 0 |
| Una quinta, después de las cuatro | 0 | 5.136 |
| Primera llamada con flujo y tres más al llegar `message_start` (1,2 a 1,9 s) | 5.138 | 3 × 5.138 |

Consecuencias:

- El esquema de salida es parte de la clave. Las plantillas de «descomponer» tienen cada una su esquema, así que no comparten prefijo y un punto de corte intermedio no sirve. El orden de los bloques del sistema ya es estable primero (instrucciones, catálogo o plantilla, proyecto); no se cambia.
- El precalentamiento con `max_tokens: 0` no sirve: no admite esquema y la llamada real escribe de nuevo.
- Lo que sirve es esperar el primer evento de la primera llamada y recién entonces lanzar las demás. Esperar la respuesta completa suma 2 a 5 s; esperar `message_start` suma 1,2 a 1,9 s.

## Llamadas paralelas con el mismo prefijo

`src/providers/cache-warmup.js` y `src/providers/anthropic.js`. De las llamadas con el mismo prefijo (modelo, sistema con sus puntos de corte, formato de salida, esfuerzo y razonamiento), la primera va en modo flujo y las demás salen al llegar su `message_start`. Un prefijo que una llamada empezó hace menos de su TTL se considera tibio y sale todo junto. Un líder que falla libera a los demás; ninguna espera pasa de 15 s. Se activa solo si el sistema alcanza el mínimo cacheable del modelo (`minCacheableTokens`, tabla de la página de caché). Se apaga con `ANTHROPIC_CACHE_WARMUP=off`. El tope de 15 s es unas diez veces el primer evento medido (1,2 a 1,9 s).

El estado es del proceso, así que también agrupa los análisis simultáneos de una ráfaga.

Antes y después en `bench/envio-33.mjs` (dos videos, 86 unidades, Sonnet 5.5, esfuerzo alto en clasificar), una corrida por variante intercalada, tres pares:

| Estado del caché | Variante | USD por envío | Segundos | Pedidos recogidos | Escritura en descomponer | Lectura en descomponer |
|---|---|---|---|---|---|---|
| Frío | Antes | 0,2665 0,2579 0,2667 (media 0,264) | 51 56 60 | 7 5 7 | 36.570 31.292 31.286 | 0 |
| Frío | Después | 0,2072 0,2199 0,2149 (media 0,214) | 53 61 62 | 7 7 7 | 10.370 10.366 10.368 | 26.200 |
| Tibio | Antes | 0,1948 0,1814 0,2017 (media 0,193) | 73 70 80 | 5 7 7 | 0 | 31.250 a 36.521 |
| Tibio | Después | 0,1667 0,1687 0,1793 (media 0,172) | 65 63 72 | 7 7 7 | 0 | 36.521 |

El caché frío es un envío después de una hora sin envíos. Tibio es el segundo envío en 5 minutos. Los 12 envíos salieron con la máquina entre 16 y 58 de carga, así que los segundos no distinguen 3 s. Los pedidos recogidos varían entre corridas del mismo código (documentado en el 2026-10-22); este cambio no toca ningún texto. El ahorro frío es de 0,050 USD por envío (19 %). En el tibio, la diferencia de 0,021 USD es ruido de salida.

## TTL de 1 hora en el análisis

No se cambia. La escritura a 1 hora cuesta 2 veces (Sonnet: 4 USD por millón) y conviene si el equipo envía más de unos 0,6 envíos por hora de forma sostenida (con llegadas al azar: a 1 por hora el acierto a 5 minutos es 8 % y a 1 hora 63 %, costo relativo 1,15 contra 0,77; a 0,3 por hora, 1,22 contra 1,49). Los envíos sueltos medidos van separados por 1 a 3 horas, donde ningún TTL acierta. Con más uso se activa con `ANTHROPIC_CACHE_TTL=1h`. El ahorro posible es de unos 0,0075 USD por envío con el prefijo de 5.000 tokens.

## Harness, contexto base y reescrituras

Fuente: la transcripción de una ejecución real (39 turnos, 37 minutos, Sonnet 5.5, TTL de 5 minutos) y los totales de las ejecuciones 2 y 4 de la instancia del cliente.

| Ejecución | Turnos | Escritura | Lectura | Costo informado |
|---|---|---|---|---|
| Transcripción | 39 | 367.868 | 3.112.148 | sin dato |
| Ejecución 2 | 53 | 340.253 | 2.281.132 | 1,369 USD |
| Ejecución 4 | 39 | 414.090 | 1.399.665 | 1,728 USD |

- La primera vuelta escribe 71.826 tokens.
- Tres esperas de 392, 410 y 601 s vencieron el caché de 5 minutos y reescribieron 84.106, 85.205 y 94.849 tokens: 264.160 tokens, 72 % de todo lo escrito.
- A 2,50 USD por millón, las escrituras de la transcripción cuestan 0,92 USD; a 1 hora, esas tres esperas habrían sido lecturas.
- Cálculo para esa sesión con `CLAUDE_CODE_PROMPT_CACHE_TTL=1h`: escritura 103.708 tokens a 4 USD (0,415) y lectura 3.376.308 a 0,10 (0,338), total 0,753 contra 1,231 USD. Ahorro 0,478 USD (39 %) en entrada.

Dónde cae el prefijo entre sesiones (`claude` 2.1.284, Haiku 5.5, CLAUDE.md de 25.000 tokens, ocho sesiones seguidas con TTL de 1 hora; cuerpos de las peticiones capturados con `OTEL_LOG_RAW_API_BODIES`):

| Variante | Escrito por sesión | Leído por sesión |
|---|---|---|
| Orden actual del prompt, en el mensaje de usuario | 55.476 | 35.382 |
| Estable primero, en el mensaje de usuario | 55.609 | 35.382 |
| Parte estable en `--append-system-prompt-file` | 49.991 | 41.013 |
| Lo anterior más el CLAUDE.md en ese archivo y `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` | 6.874 | 76.630 |
| Lo anterior más `--exclude-dynamic-system-prompt-sections` y `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1` | 6.669 | 74.113 |

- Claude Code pone sus puntos de corte en el prompt de sistema (dos, a 1 hora) y al final del primer mensaje del usuario. El CLAUDE.md, los avisos de los ganchos y el prompt van dentro de ese mensaje, antes del último corte, y el prompt cambia en cada trabajo. La API solo encuentra una entrada en un punto de corte previo, así que lo que está antes del prompt no se lee entre sesiones. Por eso reordenar el prompt no cambia nada y mover lo estable al prompt de sistema sí.
- La rama del git y los últimos commits viajan en el contexto de la sesión. En las ocho sesiones la rama cambió en cada una y la cuarta variante igual leyó 74.113 tokens, así que la rama no impide la lectura. `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1` quita además las instrucciones de commit de Claude Code; no se recomienda.
- Ahorro de la cuarta variante por sesión, con Sonnet y escritura a 1 hora: 48.600 tokens menos escritos (0,194 USD) y 41.200 más leídos (0,004 USD): 0,19 USD, con la segunda sesión dentro de 1 hora de la primera.
- El costo informado por Claude Code para Haiku 5.5 no es válido (`unrecognized_model`); las cifras de la tabla son tokens.

## Cambios en el harness

- `buildExecuteParts` en `src/execute/prompt.js`: parte estable (contrato, proyecto, perfil del agente, cómo trabajar, respuestas, ayuda de `team`, reglas del anfitrión, entrega, plantilla) y parte variable (remitente, mensaje, bloque `job` con ids, rama e idioma de respuesta, fallo de entrega). El texto de las instrucciones ya no nombra ids, ramas ni nombres que cambian. Prueba: `src/execute/prompt.test.js`.
- `EXECUTE_STABLE_AS_SYSTEM=1`: la parte estable va en `--append-system-prompt-file` (en la máquina, `system.md` junto a `prompt.md`) y el mensaje lleva solo la parte variable.
- `EXECUTE_SESSION_ENV`: pares CLAVE=valor para cualquier variable de `claude -p`, con el mismo formato que `EXECUTE_OTEL_ENV`.

## Recomendaciones para el anfitrión

| Ajuste | Dónde | Ahorro medido o calculado |
|---|---|---|
| `EXECUTE_SESSION_ENV="CLAUDE_CODE_PROMPT_CACHE_TTL=1h"` | `.env` del servidor | 0,48 USD en la sesión de 37 minutos de la transcripción (39 % de la entrada). En una suscripción dentro del plan Claude Code ya usa 1 hora; la transcripción mostró solo escrituras de 5 minutos, así que la máquina no estaba en ese caso. Se verifica con `usage.cache_creation.ephemeral_1h_input_tokens` en el resultado |
| `EXECUTE_STABLE_AS_SYSTEM=1` | `.env` del servidor | 5.500 tokens menos escritos por sesión (0,02 USD a 1 hora) |
| CLAUDE.md del repositorio entregado como archivo de sistema, con `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` en `EXECUTE_SESSION_ENV` | Imagen de la máquina | 0,19 USD por sesión cuando hay otra sesión de la misma imagen en la hora anterior. Cambia dónde pesa el texto del CLAUDE.md (sistema en vez de mensaje): hay que probar una ejecución real antes |
| Reducir el CLAUDE.md de 25.000 tokens | Repositorio del anfitrión | 25.000 tokens × 4 USD por millón = 0,10 USD por primera vuelta y 0,0025 USD por cada turno siguiente a 0,10 |
| Ganchos que inyectan texto | Máquina | La transcripción trae 4 avisos de ganchos de 592 a 4.567 caracteres y un listado de habilidades de 7.836; cada uno se reescribe en cada sesión |

## Lo que no se pudo medir

- Llamadas de PDF: ninguna en las fuentes.
- La muestra de diez insumos antes y después: el cambio 1 no toca ningún texto ni orden del análisis, y el costo medido (1,2 USD restantes del tope) no alcanzaba para dos pasadas completas.
- Dos corridas reales mínimas del harness con el prompt nuevo en una máquina nueva: las ocho sesiones de arriba usaron Haiku 5.5 en un directorio de prueba y no el contexto del anfitrión (CLAUDE.md de 25.000 tokens sintético).
- El lote (Batch API): 50 % menos, pero responde en minutos a horas y no admite flujo. El análisis de un envío es interactivo (la persona espera el resultado). Una reprocesada lanzada a mano también espera. No aplica a lo que hay hoy; aplicaría a un reanálisis masivo del banco.
- `maxTokens`: el mayor `output_tokens` visto en una llamada es 5.134 contra el tope de 16.000. Bajar el tope no ahorra nada mientras el modelo no llegue a él, y un tope más bajo agrega cortes con reintento. Sin cambio.
- Menos fotogramas o descripciones más cortas: cada fotograma cuesta unos 450 tokens de entrada y 126 a 246 de salida en visión, y se deduplica por `dHash` antes. Cambiar `frameHashDistance` o el texto de la extracción cambia la calidad y no se midió.
