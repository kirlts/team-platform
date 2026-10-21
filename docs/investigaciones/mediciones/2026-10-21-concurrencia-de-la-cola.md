# Concurrencia de la cola, 2026-10-21

Resultado: `QUEUE_CONCURRENCY` queda en 8. Cada proveedor lleva un tope de peticiones simultáneas en todo el proceso: `PROVIDER_MAX_INFLIGHT_ANTHROPIC` = 7, `PROVIDER_MAX_INFLIGHT_GROQ` = 7 y `PROVIDER_MAX_INFLIGHT_OPENAI_COMPATIBLE` = 7. Los dos últimos no tienen medición propia.

Con el tope, una ráfaga de 16 envíos con 8 trabajos a la vez terminó en 24,6 s (p95 22,6 s), sin envíos fallados por un proveedor. Sin tope y con 3 trabajos a la vez terminó en 28,4 s (p95 27,5 s). Sin tope y con 8 trabajos, 5 de 64 envíos fallaron por 429.

La primera medición de ese día, sin tope, dejó `QUEUE_CONCURRENCY` en 3 (primera parte de este archivo). El tope de peticiones simultáneas, que esa medición dejó como pendiente, está en `src/providers/limiter.js` (H-83) y es lo que permite subir los trabajos a la vez. Las secciones nuevas son «Sonda del tope de Anthropic», «Con el tope de peticiones» y «Duración de una llamada».

## Qué se midió

`bench/burst.mjs` manda N envíos de una misma persona a la vez por el camino real: cola, worker, extractores, analizador y proveedores. Un trabajo termina cuando queda la propuesta.

- Los envíos son cinco casos públicos de `bench/cases/` (chat de grupo, monólogo transcrito, reporte de error, idea suelta, mensaje mezclado), con el texto ya extraído como llega al analizador, y una nota de voz de 36,4 s sintetizada con espeak-ng. La nota pasa por el extractor de audio y por Groq (`whisper-large-v3-turbo`).
- Orden por N: N=1 chat; N=3 chat, voz, reporte; N=5 más idea y mensaje mezclado; N=8 más monólogo, un segundo chat y una segunda voz. Cada envío lleva una marca propia para que su hash sea distinto.
- Modelo: `claude-haiku-5-5` con la configuración del analizador de ese día (`partitionConcurrency` 16). Llaves reales de `~/.config/team-platform/env`.
- Una celda con C mayor o igual que N es la misma corrida que C=N y se ejecuta una vez. N=1 vale para C=1, 2, 4 y 8; N=3 con C=3 vale para C=4 y 8; N=5 con C=5 vale para C=8.
- Cada celda corre varias veces, intercaladas con las demás, con 10 s de pausa entre corridas. La tabla da la mediana de los tiempos y la suma de los conteos. Los 429 y las peticiones salen de un envoltorio sobre `fetch`; los reintentos son los del worker (intentos mayores que 1).
- El presupuesto de audio por hora (7.200 s) sigue activo. Las 45 transcripciones suman unos 1.640 s y ningún envío de voz falló por presupuesto.

## Resultados

| N | C | Runs | Wall median (s) | p50 median (s) | p95 median (s) | Inputs done | Runs with a 429 | Anthropic 429 / requests | Groq 429 | Queue retries | Failed inputs | Peak in flight | Cost (USD) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 3 | 4.5 | 4.5 | 4.5 | 3/3 | 0 | 0 / 13 | 0 | 0 | 0 | 3 | 0.003 |
| 3 | 1 | 3 | 16.5 | 11.5 | 16.5 | 9/9 | 0 | 0 / 31 | 0 | 0 | 0 | 3 | 0.007 |
| 3 | 2 | 3 | 9.6 | 5.3 | 9.6 | 9/9 | 0 | 0 / 33 | 0 | 0 | 0 | 7 | 0.007 |
| 3 | 3 | 3 | 6.4 | 5.5 | 6.4 | 9/9 | 0 | 0 / 33 | 0 | 0 | 0 | 7 | 0.008 |
| 5 | 1 | 3 | 25.4 | 17.5 | 25.4 | 15/15 | 0 | 0 / 55 | 0 | 0 | 0 | 4 | 0.011 |
| 5 | 2 | 3 | 13.4 | 9.2 | 13.4 | 15/15 | 1 | 2 / 59 | 0 | 1 | 0 | 6 | 0.011 |
| 5 | 4 | 3 | 8.2 | 5.4 | 8.2 | 15/15 | 1 | 2 / 59 | 0 | 1 | 0 | 9 | 0.011 |
| 5 | 5 | 3 | 6.3 | 4.9 | 6.3 | 15/15 | 1 | 1 / 58 | 0 | 1 | 0 | 11 | 0.011 |
| 8 | 1 | 3 | 40.6 | 19.2 | 40.6 | 24/24 | 0 | 0 / 108 | 0 | 0 | 0 | 8 | 0.025 |
| 8 | 2 | 18 | 22.0 | 9.8 | 22.0 | 144/144 | 1 | 7 / 670 | 0 | 2 | 0 | 15 | 0.147 |
| 8 | 3 | 15 | 14.7 | 8.7 | 14.7 | 120/120 | 0 | 0 / 550 | 0 | 0 | 0 | 17 | 0.122 |
| 8 | 4 | 3 | 13.7 | 5.6 | 12.2 | 23/24 | 2 | 15 / 138 | 0 | 4 | 1 | 21 | 0.027 |
| 8 | 8 | 3 | 11.4 | 5.1 | 11.4 | 22/24 | 3 | 42 / 193 | 0 | 19 | 2 | 25 | 0.033 |

Notas de la tabla: «Runs with a 429» cuenta corridas, no respuestas. «Peak in flight» es el máximo de peticiones a Anthropic simultáneas dentro de una corrida. El costo total de la medición fue 0,42 USD sobre un tope de 1.

## Lo que dicen los 429

- Todos los 429 vienen de Anthropic. Groq no devolvió ninguno en 45 peticiones; sus cabeceras declaran 2.000 peticiones (por día) y el uso fue de 45.
- Los límites por minuto de la cuenta no se acercaron: las cabeceras declaran 1.000 peticiones, 2.000.000 tokens de entrada y 400.000 de salida por minuto, y el mínimo restante fue 975 peticiones y 1.555.000 tokens de entrada.
- El 429 dice «Number of concurrent requests across all models has exceeded your organization's limit». Es un tope de peticiones simultáneas de la organización, no de tasa. El valor no aparece en las cabeceras. Las corridas con 429 tuvieron entre 10 y 25 peticiones en vuelo; las limpias llegaron a 21 (C=4) y 17 (C=3), así que el umbral no es un número fijo. La llave se comparte con otras sesiones que llaman a Anthropic al mismo tiempo, y esas peticiones cuentan para la organización.
- La respuesta 429 no trae `Retry-After`. El trabajo se reencola con el retroceso exponencial de la cola, que parte de 1 s. Un 429 hace fallar el intento completo del análisis: se pierden las llamadas ya pagadas del envío. Con 3 intentos, un envío puede fallar de forma definitiva (pasó en C=4 y en C=8).
- Cada análisis lanza hasta 16 peticiones en paralelo (`partitionConcurrency`). Por eso el tope de peticiones simultáneas se alcanza con pocos trabajos: C × peticiones por análisis.

## Decisión de la primera medición (sin tope, reemplazada)

Regla: el mayor C sin ningún 429 en las ráfagas del mayor N, con el menor p95.

| C | Ráfagas de 8 | Con algún 429 | p95 mediano |
|---|---|---|---|
| 1 | 3 | 0 | 40,6 s |
| 2 | 18 | 1 (7 respuestas) | 22,0 s |
| 3 | 15 | 0 | 14,7 s |
| 4 | 3 | 2 | 12,2 s |
| 8 | 3 | 3 | 11,4 s |

`QUEUE_CONCURRENCY` = 3 en esa medición. C=2 tuvo una ráfaga con 429 en 18; C=4 y C=8 los tienen casi siempre. Con 3 la ráfaga de 8 termina en 14,7 s en la mediana, contra 40,6 s de una en una. El p95 de C=4 y C=8 es menor, pero con envíos que fallan, y un envío fallado cuesta más que los 3 s de diferencia.

C=3 se midió con 15 ráfagas sin ningún 429; con ese número no se puede afirmar que nunca ocurra. Cambian el resultado otro uso de la misma llave, un cambio de `partitionConcurrency` o un límite distinto de la organización. Se repite con `node bench/burst.mjs --n 8 --c 2,3,4 --repeat 5`.

## Qué faltaba para subirlo

El límite es de peticiones simultáneas y no de trabajos. Un tope único de peticiones en vuelo a Anthropic para todo el proceso permitiría más trabajos a la vez sin pasar el umbral. Se implementó después, en `src/providers/limiter.js`; las secciones siguientes lo miden.

## Sonda del tope de Anthropic

`node bench/burst.mjs --probe --repeat 3` dispara a la vez 4, 8, 12, 16, 24 y 32 peticiones mínimas a `claude-haiku-5-5` (una frase que pide los números del 1 al 20, 48 tokens de salida como máximo, menos de 0,0001 USD cada una). Sube de nivel mientras no haya 429 y se detiene en el primer nivel con 429. Son dos corridas de tres repeticiones, el 2026-10-21 entre las 04:33 y las 04:39 UTC, sin otra carga de este proyecto. La llave se comparte con otras sesiones y, según UD-027, puede compartirse con el despliegue real. La sonda no ve esa carga, así que no se puede afirmar que la organización estuviera sola. El número de abajo vale para la carga ajena que hubiera en ese momento.

| Nivel | Repeticiones que lo alcanzaron | Repeticiones con 429 | Respuestas 429 por repetición |
|---|---|---|---|
| 4 | 6 | 0 | 0 / 0 / 0 / 0 / 0 / 0 |
| 8 | 6 | 0 | 0 / 0 / 0 / 0 / 0 / 0 |
| 12 | 6 | 2 | 1 / 0 / 0 / 0 / 0 / 4 |
| 16 | 4 | 0 | 0 / 0 / 0 / 0 |
| 24 | 4 | 4 | 1 / 2 / 1 / 12 |
| 32 | 0 | no se alcanzó | |

Regla: el nivel más alto sin ningún 429 en ninguna repetición, por debajo del primer nivel con 429 de cualquier repetición, menos uno. El primer nivel con 429 fue 12 (dos repeticiones). El nivel limpio más alto debajo de él es 8 y el tope es 7.

Las cuatro repeticiones que pasaron de 12 salieron limpias en 16, y en 24 el tope aceptó 22 o 23 peticiones en tres de ellas. Con la llave libre el tope de la organización está cerca de 22. Las dos repeticiones que fallaron en 12 rechazaron 1 y 4 peticiones, lo que supone peticiones ajenas en vuelo (inferencia: la sonda no las ve). El valor es conservador a propósito: cada proceso que use la llave debe llevar su parte del tope.

`PROVIDER_MAX_INFLIGHT_ANTHROPIC` = 7. `PROVIDER_MAX_INFLIGHT_GROQ` = 7 y `PROVIDER_MAX_INFLIGHT_OPENAI_COMPATIBLE` = 7 no tienen sonda: Groq no devolvió ningún 429 (0 en 45 peticiones de la primera medición y 0 en 234 de las dos grillas, con 2 en vuelo como máximo) y los compatibles con OpenAI no se usaron. Heredan el valor de Anthropic, la única medición, hasta que haya una propia. Cualquiera de los tres acepta 0, que apaga el tope de ese proveedor.

El 429 de tope lleva este mensaje en las 21 respuestas 429 de la sonda: «Number of concurrent requests across all models has exceeded your organization's limit. Wait for in-flight requests to complete and retry.», sin `Retry-After`.

## Duración de una llamada

El p95 de la duración de una llamada a Anthropic (hasta las cabeceras de la respuesta) fue 2,9 a 3,4 s en las 14 celdas de la grilla de abajo, y la mediana de la llamada mínima de la sonda fue 0,9 s. El retroceso adaptativo del tope (un 429 sin `Retry-After` baja el tope efectivo en uno, a lo más una vez por ventana, y lo devuelve de a uno) usa ese p95 como ventana: es lo que tardan en terminar las peticiones ajenas que causaron el 429. `PROVIDER_BACKOFF_COOLDOWN_MS` = 3300 y `PROVIDER_BACKOFF_RESTORE_STEP_MS` = 3300.

## Con el tope de peticiones

Grilla de ráfagas de 8 y de 16 envíos, C = 3, 6, 8 y 12 trabajos a la vez, con el tope de Anthropic en 7 y, para comparar, apagado (`--inflight 0`). Mismos envíos que en la primera medición; las ráfagas de 16 repiten la lista de 6 envíos (hay 2 monólogos y 3 notas de voz). Dos corridas, `grid-1` (apagado y 7, 4 repeticiones) y `grid-2` (7, 5 repeticiones, ya con la ventana de 3300 ms), entre las 04:43 y las 05:27 UTC. «Fallos por proveedor» cuenta los envíos que terminaron con un error HTTP o de tiempo de un proveedor; el resto de los fallos es el análisis.

| N | C | Tope | Corridas | Pared (s) | p95 (s) | Hechos | Fallos por proveedor | 429 Anthropic / peticiones | Reintentos de la cola | Máximo en vuelo | Bajadas del tope | Espera máxima por cupo (s) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 8 | 3 | apagado | 4 | 16,7 | 16,7 | 32/32 | 0 | 17 / 186 | 8 | 15 | 0 | 0,0 |
| 8 | 6 | apagado | 4 | 10,0 | 10,0 | 30/32 | 2 | 43 / 218 | 13 | 20 | 0 | 0,0 |
| 8 | 8 y 12 | apagado | 4 | 10,4 | 10,4 | 31/32 | 1 | 39 / 204 | 14 | 23 | 0 | 0,0 |
| 16 | 3 | apagado | 4 | 28,4 | 27,5 | 62/64 | 0 | 13 / 330 | 8 | 17 | 0 | 0,0 |
| 16 | 6 | apagado | 4 | 18,8 | 18,8 | 61/64 | 3 | 75 / 424 | 27 | 24 | 0 | 0,0 |
| 16 | 8 | apagado | 4 | 13,0 | 12,2 | 58/64 | 5 | 114 / 415 | 36 | 28 | 0 | 0,0 |
| 16 | 12 | apagado | 4 | 11,7 | 11,7 | 56/64 | 7 | 129 / 468 | 45 | 36 | 0 | 0,0 |
| 8 | 3 | 7 | 9 | 17,1 | 17,1 | 72/72 | 0 | 8 / 344 | 5 | 7 | 3 | 4,1 |
| 8 | 6 | 7 | 9 | 12,4 | 12,3 | 71/72 | 0 | 0 / 329 | 0 | 7 | 0 | 7,7 |
| 8 | 8 y 12 | 7 | 9 | 12,6 | 12,6 | 72/72 | 0 | 0 / 330 | 0 | 7 | 0 | 7,9 |
| 16 | 3 | 7 | 9 | 33,0 | 33,0 | 143/144 | 0 | 10 / 659 | 7 | 7 | 4 | 4,4 |
| 16 | 6 | 7 | 9 | 23,8 | 23,5 | 141/144 | 0 | 11 / 663 | 11 | 7 | 5 | 12,6 |
| 16 | 8 | 7 | 9 | 24,6 | 22,6 | 140/144 | 0 | 4 / 637 | 4 | 7 | 3 | 17,4 |
| 16 | 12 | 7 | 9 | 24,0 | 24,0 | 142/144 | 0 | 14 / 670 | 14 | 7 | 4 | 20,6 |

Pared y p95 son la mediana de las corridas. Costo de la medición completa de este encargo: 1,25 USD (sonda 0,008, grilla apagada y 7 en `grid-1` 0,77, `grid-2` 0,45, prueba de humo 0,02) sobre un tope de 2.

Lo que dice la tabla:

- Sin tope, subir C trae 429 y envíos perdidos: con 16 envíos y 12 trabajos a la vez fallaron 7 de 64 por un error de proveedor y hubo 129 respuestas 429. Con el tope en 7 el máximo en vuelo es 7 en todas las celdas y ningún envío falló por un proveedor en 9 corridas de cada celda (144 envíos por celda con N = 16). Los 429 que quedan (4 a 14 por celda en N = 16) vienen de la carga ajena sobre la llave: el tope bajó solo (columna «Bajadas del tope») y la cola reintentó, sin pérdida.
- Regla: de las celdas con N = 16, la que no pierde envíos por proveedor y tiene el menor p95. Con el tope en 7 es C = 8 (p95 22,6 s, pared 24,6 s). C = 6 (23,5 s) y C = 12 (24,0 s) quedan a menos de 1,5 s, dentro del ruido de 9 corridas; C = 8 tuvo además la menor cantidad de 429 (4) y reintentos (4). Sube la espera por cupo (17 s en C = 8), que es la cola dentro del tope; el plazo de una llamada es 900 s.
- Con el tope en 7 y C = 8 la ráfaga de 16 termina en 24,6 s, contra 28,4 s de la configuración anterior (C = 3 sin tope), y en 8 envíos baja de 16,7 a 12,6 s. C = 3 con tope es más lento que C = 3 sin tope (33,0 contra 28,4 s) porque el tope le quita los picos de 17 peticiones en vuelo; por eso no se queda en 3.
- Con el tope apagado y C = 8 o 12 la pared es menor (13,0 y 11,7 s en N = 16), pero a costa de 5 y 7 envíos perdidos de 64.
- Todos los envíos que quedaron sin propuesta con el tope encendido (11 de 792 en las dos grillas) son el análisis y no un proveedor. Es el monólogo de `bench/cases/03-monologo-prueba`, que falla con «El análisis no logró repartir el contenido sin solapes ni huecos.» (10 veces en 36 corridas de N = 16, una en 27 de N = 8) y una vez con «las unidades 34 no están en ningún lugar». Pasa también con el tope apagado (4 veces en 16 corridas de N = 16), así que no depende de la concurrencia. Es un defecto del analizador con textos largos; queda como hallazgo y no se arregla acá porque `src/analyze/` es de otro encargo. Con él ninguna celda llega a «cero envíos fallados», por eso el criterio se aplicó a los fallos por proveedor.

`QUEUE_CONCURRENCY` = 8.

Para repetir: `node bench/burst.mjs --n 8,16 --c 3,6,8,12 --inflight 0,7 --repeat 4` y, para juntar varias corridas guardadas, `node bench/burst.mjs --report bench/results/grid-1.json,bench/results/grid-2.json`. La sonda: `node bench/burst.mjs --probe --repeat 3`.

## Cómo repetirlo

```sh
set -a; . ~/.config/team-platform/env; set +a
node bench/burst.mjs --repeat 3 --budget 0.8              # la grilla N=1,3,5,8 y C=1,2,4,8
node bench/burst.mjs --n 8 --c 2,3 --repeat 10 --budget 0.4
node bench/burst.mjs --fake                               # sin red ni llaves, sólo el banco
```

El resultado completo de cada corrida queda en `bench/results/` (fuera de git). Corridas de esta medición: la grilla con 3 repeticiones y dos tandas de N=8 con C=2 y 3, de 5 y 10 repeticiones.