# Calibración de `charsPerToken` y del tope de salida (TASK-015)

Fecha: 2026-10-26. Sin llamadas a ningún proveedor. Lee el registro de siete archivos `bench/results/private-*.json` del 2026-10-21, fuera de git: Haiku 5.5, 57 corridas de casos reales, 202 llamadas de texto. El script es `bench/calibrate.mjs`, con su prueba en `bench/calibrate.test.js`:

```sh
node bench/calibrate.mjs bench/results/private-*.json
```

## `charsPerToken`

Cada corrida que clasificó en un solo trozo guarda dos cifras. Una es la estimación del analizador, `estimated_input_tokens`: caracteres de las unidades divididos por `charsPerToken`, que valía 3. La otra son los tokens de entrada que contó el modelo en la clasificación. La llamada lleva además las instrucciones, el equipo y las áreas, que no dependen de las unidades y caen en la ordenada. Ajuste por mínimos cuadrados de los tokens reales contra la estimación:

| Modelo | Corridas | Estimación | Pendiente | Ordenada | R² | Caracteres por token medidos |
|---|---|---|---|---|---|---|
| Haiku 5.5 | 57 | 344 a 19.993 | 1,333 | 2.500 | 0,9962 | 2,25 (3 / 1,333) |

Con 3 caracteres por token el analizador subestimaba la entrada en una cuarta parte: un texto estimado en 100.000 tokens ocupaba 133.000. El valor de 3 salía de la guía de migración de Haiku 5.5, no de una corrida. La guía decía 4 caracteres por token con el tokenizador anterior y 30 % más tokens. `src/analyze/config.js` queda con 2,25 y esta medición como fuente. La entrada más larga de las 57 corridas ocupa unos 26.700 tokens.

Límite: la medición es de Haiku 5.5. Las corridas de Sonnet 5.5 de la muestra heterogénea (2026-10-22) no guardan la estimación, así que no hay ajuste para él. El mismo script lo calcula con archivos de resultado de ese modelo, porque agrupa por modelo. `src/providers/anthropic.js` conserva su propio 3 para decidir si las instrucciones alcanzan el mínimo de caché. Ese valor cuenta instrucciones y no unidades en español, y no está medido.

## Tokens de salida por llamada

| Paso | Esfuerzo | Llamadas | p50 | p95 | p99 | Máximo | Tope | Llamadas en el tope |
|---|---|---|---|---|---|---|---|---|
| descomposición | medio | 143 | 3.176 | 14.519 | 16.597 | 25.018 | 32.000 (el reintento duplica 16.000) | 2 |
| clasificación | bajo | 58 | 1.576 | 5.873 | 8.697 | 8.697 | 16.000 | 0 |
| rescate | medio | 1 | 213 | 213 | 213 | 213 | 16.000 | 0 |

Percentil por rango más cercano. Estas corridas descomponían con esfuerzo medio y razonamiento adaptativo, y los tokens de razonamiento cuentan como salida. El ajuste de hoy descompone con esfuerzo bajo y sin razonamiento (`decomposeEffort` y `decomposeThinking`, medición `2026-10-20-primera-corrida-real.md`). El p95 de la descomposición de arriba no describe lo que corre ahora. Dos de 143 llamadas llegaron a los 16.000 del primer intento y pasaron por el reintento. `maxTokens` queda en 16.000: con el ajuste de hoy no hay una corrida que mida su p95.

## Lo que falta y cómo se cierra

Corridas con el ajuste de hoy y registro de llamadas, sobre el banco privado, con presupuesto de API:

```sh
node bench/run-private.mjs run --repeat 3 --budget 3
node bench/calibrate.mjs bench/results/private-<fecha>.json
```

El umbral bajado a 8.000 tokens equivale a una cuarta parte de la reunión más larga. Con él la corrida ejercita la partición con texto real:

```sh
node bench/run-private.mjs run --case u12-reunion-parte-1 --case u13-reunion-parte-2 --config '{"partitionThresholdTokens":8000}' --repeat 3 --budget 3
```
