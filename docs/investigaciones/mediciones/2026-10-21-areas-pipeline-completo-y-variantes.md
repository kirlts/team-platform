# Exactitud de área en el pipeline completo y variantes de las descripciones, 2026-10-21

Resultado: con el pipeline completo (clasificación, descomposición, equipo y proyecto de 200.000 caracteres) las descripciones v2-orden aciertan el área en 87,5 % de los mensajes que recibieron una (intervalo 82-91 %, entre repeticiones 85-90 %). Por unidad la clasificación acierta 81,5 % (80-83 %). El criterio de UD-033 (82,6 % por mensaje) se cumple y las descripciones largas se mantienen. Ninguna de las seis variantes probadas supera a v2-orden: cuatro empatan dentro del ruido y dos empeoran (ventana de 200 unidades, 5,1 puntos; descripciones cortas, 5,0 puntos).

## Método

- Modelo `claude-haiku-5-5`, 39 casos privados, dos lectores; «unión» acierta si coincide con cualquiera.
- Pipeline completo: `bench/run-private.mjs run --project` con equipo y proyecto, 3 repeticiones, 117 corridas, 2,34 USD.
- Variantes: `bench/areas-classify.mjs --no-grouping --project`, que arma ventanas, validación, reparación y cierre de tramos como el pipeline y ahora recibe el proyecto en el bloque de sistema, como en producción. De 4 a 10 repeticiones por variante, 0,14 USD por repetición.
- Comparación de a pares con `bench/areas-stats.mjs pair`: el remuestreo es por caso (las unidades de un caso se mueven juntas), con 20.000 remuestreos. El intervalo es más ancho que el de Wilson por unidad (±1) y es el que separa o no una variante.

## Pipeline completo (H-602)

| Medida | Valor |
|---|---:|
| Corridas | 117 (39 casos, 3 repeticiones) |
| Área por mensaje que recibió una | 87,5 % [82-91] |
| Entre repeticiones | 85-90 % |
| Clasificación, unidades que recibieron mensaje | 81,5 % [80-83] |
| Clasificación, sobre todas las unidades esperadas | 74,8 % |
| Mensajes obtenidos / esperados | 1.625 / 1.128 |
| Costo | 2,34 USD |

El proyecto agrega ruido, no exactitud: sin proyecto la clasificación por unidad dio 83,8 % (3 repeticiones, desviación 1,1) y con proyecto 82,5 % (9 repeticiones, desviación 3,6). La diferencia no es significativa (p 0,29).

## Variantes con el proyecto en la clasificación

Exactitud por unidad, unión de lectores. «Dif.» es contra v2-orden con 9 repeticiones (82,5 %), con intervalo del 95 % por casos y prueba bilateral.

| Variante | Qué cambia | Rep. | Exactitud | Dif. [IC95], p | s por caso | USD por rep. |
|---|---|---:|---:|---|---:|---:|
| v2-orden | Control (UD-033) | 9 | 82,5 | | 6,1 | 0,147 |
| cortas | Descripciones de 144 a 218 caracteres | 4 | 77,5 | -5,0 [-9,4; +0,3], 0,060 | 5,4 | 0,132 |
| v4-tramo | Las preguntas de exploración dentro de una reunión toman el área del punto que se explora; regla 11 | 10 | 80,7 | -1,7 [-4,4; +0,2], 0,085 | 5,7 | 0,135 |
| v5-estado | Cada fila de una tabla de estado se clasifica por lo que dice del elemento; regla 11 | 4 | 80,4 | -2,1 [-5,1; +0,7], 0,143 | 6,0 | 0,138 |
| v45 | v4 y v5 juntas | 4 | 81,5 | -0,9 [-3,6; +1,7], 0,515 | 5,9 | 0,140 |
| v6-orden | La regla 4 pasa a cinco preguntas en orden: falla, pedido, pregunta, valoración, propuesta | 4 | 81,9 | -0,6 [-4,3; +2,1], 0,725 | 5,8 | 0,135 |
| esfuerzo medium | `classifyEffort: medium` (H-15) | 4 | 82,1 | -0,3 [-3,1; +1,8], 0,778 | 6,0 | 0,140 |
| ventana de 200 | `classifyWindowUnits: 200` | 4 | 77,3 | -5,1 [-9,0; -0,3], 0,034 | 4,6 | 0,118 |

Las repeticiones de v2-orden van de 78,4 a 88,7 %: la desviación entre corridas es de 3,6 puntos y la sostienen las cinco transcripciones de reunión más largas, donde un grupo de cien unidades cambia de área entera de una corrida a otra. Una sola repetición no separa nada; con 4 a 10 repeticiones y comparación por casos, el intervalo todavía mide ±2 a ±4 puntos.

## Matriz de confusión

Unidades por repetición, referencia del lector A contra la obtenida, en las nueve repeticiones de v2-orden con proyecto.

| Referencia | Obtenida | Unidades |
|---|---|---:|
| Error | Nueva funcionalidad | 101 |
| Nueva funcionalidad | Retroalimentación | 75 |
| Nueva funcionalidad | Pregunta | 63 |
| Error | Pregunta | 58 |
| Nueva funcionalidad | Idea | 56 |
| Idea | Nueva funcionalidad | 55 |
| Error | Retroalimentación | 51 |
| Idea | Pregunta | 44 |

Los errores se reparten en ocho pares y ninguno domina: las variantes que atacan dos o tres de ellos (v4, v5, v6) mueven unas unidades de un par a otro. El patrón común es el tramo de reunión, entrevista o chat largo donde el modelo traza un grupo de otra extensión que el de las referencias y le da un área entera; la unidad no es la que falla, es la frontera del grupo.

## Por qué no se llega al techo

- El techo de 95,5 % es el acuerdo de área entre lectores por mensaje con la agrupación dada. El pipeline traza sus propios grupos y el acuerdo por unidad entre los dos lectores es menor.
- Los grupos que más cuestan son ambiguos para los propios lectores: una pregunta de exploración que termina siendo un pedido, o una observación de estado que es un pedido de ajuste.
- Cada texto añadido a las descripciones desplaza unidades entre áreas vecinas sin reducir el total. Con esta desviación entre corridas, un efecto menor de 2 a 3 puntos no se detecta con menos de unas veinte repeticiones por variante (cerca de 3 USD por variante con el proyecto).

## Gasto

Tarea de áreas y de H-1600: 10,1 USD de 12 (corridas completas 3,9 USD, de ellas 2,3 en H-602 y 1,6 en H-1600; clasificación sola 6,0 USD; sondas 0,1 USD). El registro está en `bench/results/areas2/private-spend.jsonl`.

## Cómo repetirlo

```sh
BENCH_PRIVATE_DIR=bench/private node bench/areas-classify.mjs --variant v4-tramo --no-grouping --project bench/private/project.md --repeat 4 --label v4-proj
node bench/areas-stats.mjs table v4=<archivos> ; node bench/areas-stats.mjs pair base=<archivos> v4=<archivos>
```
