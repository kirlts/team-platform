# Concurrencia de la cola, 2026-10-21

Resultado: `QUEUE_CONCURRENCY` queda en 3. Con ráfagas de 8 envíos, 3 trabajos a la vez dieron 0 respuestas 429 en 15 ráfagas y un p95 de 14,7 s; con 1 a la vez el p95 es 40,6 s. Con 4 a la vez hubo 429 en 2 de 3 ráfagas y un envío falló. Con 8 hubo 429 en las 3 y fallaron dos envíos. Sustituye al valor 1, que era convención de pg-boss, walq y liteque (informe 03 §12) y no una medición.

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

## Decisión

Regla: el mayor C sin ningún 429 en las ráfagas del mayor N, con el menor p95.

| C | Ráfagas de 8 | Con algún 429 | p95 mediano |
|---|---|---|---|
| 1 | 3 | 0 | 40,6 s |
| 2 | 18 | 1 (7 respuestas) | 22,0 s |
| 3 | 15 | 0 | 14,7 s |
| 4 | 3 | 2 | 12,2 s |
| 8 | 3 | 3 | 11,4 s |

`QUEUE_CONCURRENCY` = 3. C=2 tuvo una ráfaga con 429 en 18; C=4 y C=8 los tienen casi siempre. Con 3 la ráfaga de 8 termina en 14,7 s en la mediana, contra 40,6 s de una en una. El p95 de C=4 y C=8 es menor, pero con envíos que fallan, y un envío fallado cuesta más que los 3 s de diferencia.

C=3 se midió con 15 ráfagas sin ningún 429; con ese número no se puede afirmar que nunca ocurra. Cambian el resultado otro uso de la misma llave, un cambio de `partitionConcurrency` o un límite distinto de la organización. Se repite con `node bench/burst.mjs --n 8 --c 2,3,4 --repeat 5`.

## Qué falta para subirlo

El límite es de peticiones simultáneas y no de trabajos. Un tope único de peticiones en vuelo a Anthropic para todo el proceso (un semáforo en `src/providers/` o en el analizador) permitiría más trabajos a la vez sin pasar el umbral. No se implementó: `src/analyze/` y `src/providers/` son de otro encargo.

## Cómo repetirlo

```sh
set -a; . ~/.config/team-platform/env; set +a
node bench/burst.mjs --repeat 3 --budget 0.8              # la grilla N=1,3,5,8 y C=1,2,4,8
node bench/burst.mjs --n 8 --c 2,3 --repeat 10 --budget 0.4
node bench/burst.mjs --fake                               # sin red ni llaves, sólo el banco
```

El resultado completo de cada corrida queda en `bench/results/` (fuera de git). Corridas de esta medición: la grilla con 3 repeticiones y dos tandas de N=8 con C=2 y 3, de 5 y 10 repeticiones.
