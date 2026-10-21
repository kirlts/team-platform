# Descripciones de área largas y exactitud de área, 2026-10-21

Resultado: las descripciones largas de `areas-largas-v1` bajaron la exactitud de área de 82,6 % a 75,8 % (unión de lectores, pipeline sin proyecto). La causa son dos frases, no el largo: «también entran las gestiones» en Pregunta y «incluye pedir mover, renombrar o quitar» en Retroalimentación. Con ellas corregidas y otro orden del catálogo, la exactitud es 86,4 % y 85,5 % en dos corridas. Las descripciones cortas dan 82,6 %. No se alcanza el techo de acuerdo entre lectores (95,5 %).

## Método

- Modelo: `claude-haiku-5-5`. Referencias: 39 casos privados, 376 mensajes, 4.457 unidades, dos lectores. «Unión» acierta si coincide con cualquiera.
- `bench/areas-classify.mjs` corre solo la clasificación. Modo oráculo: el modelo recibe la agrupación de referencia. Modo pipeline (`--no-grouping`): ventanas de 100 unidades, validación con un reintento, reparación y cierre de tramos, como `src/analyze/api.js`. Sin descomposición, una corrida cuesta unos 0,05 USD.
- El oráculo no separa las variantes (cuadro siguiente). El modo pipeline sí, y reproduce la corrida completa: 82,6 % contra 82,4 % con las cortas, 75,8 % contra 73,1 % con las largas.
- Sin descripción del proyecto en ninguna corrida.

## Por qué el oráculo no lo veía

Con la agrupación dada, largas y cortas empatan. La caída aparece cuando el modelo arma sus propios grupos. Las largas mandan a Pregunta y a Retroalimentación unidades que las referencias tienen en Nueva funcionalidad y Error.

| Unidades por área | Referencia (lector A / B) | Cortas | Largas | v2 |
|---|---:|---:|---:|---:|
| Retroalimentación | 161 / 446 | 590 | 844 | 270 |
| Pregunta | 96 / 239 | 296 | 613 | 435 |
| Nueva funcionalidad | 2.441 / 2.417 | 2.292 | 1.969 | 2.418 |

## Variantes

Corridas de a una. Exactitud por unidad, unión de lectores. «Comunes» son los 36 casos que terminaron en todas las corridas (el tope de gasto cortó las últimas).

| Variante | Qué cambia | Oráculo (unidad / mensaje) | Pipeline, 39 casos | Pipeline, 36 comunes |
|---|---|---|---|---|
| cortas (5a66b37) | Control | 85,0 / 91,0 | 82,6 | 84,6; 82,2 |
| largas (`areas-largas-v1`) | Control | 89,2 / 89,1 | 75,8 | 77,9 |
| v1 | Edición y requisitos con «debe» pasan a Nueva funcionalidad | 88,7 / 90,7 | sin medir | sin medir |
| v2 | v1 más: «debe», «tiene que», «en vez de» marcan pedido; Retroalimentación sin modales; Pregunta sin la gestión como entrada general | sin medir | 84,1; 79,8 | 86,6; 82,3 |
| v3 | v2 más prioridad explícita hacia Nueva funcionalidad en Idea, Retroalimentación y Pregunta | sin medir | 77,8 | 78,5 |
| v2-orden | v2 con el catálogo en el orden Nueva funcionalidad, Error, Retroalimentación, Idea, Pregunta | 88,7 / 92,3 | 86,4; 85,5 | 87,5; 86,8; 89,4 |

Contra cada lector (v2-orden, pipeline, dos corridas): lector A 83,3 y 82,4; lector B 79,7 y 80,7. Cortas: A 77,4, B 80,0.

Hipótesis:

| Hipótesis | Resultado |
|---|---|
| (a) Caso central primero | Incluida en v2. No se midió aislada |
| (b) Regla de prioridad explícita | Refutada: v3 baja 6 puntos contra v2 porque Nueva funcionalidad absorbe Error y Retroalimentación |
| (c) Orden de las áreas | Efecto de 3 puntos entre promedios de v2 y v2-orden, dentro del ruido entre corridas de la misma variante (4 puntos en v2). Se adopta sin estar demostrado |
| (d) Ejemplos en lugar de reglas | No se probó: las descripciones ya llevan frases de ejemplo como criterio, y copiarlas de casos privados está prohibido |
| (e) Por unidad o por grupo | Medido: el oráculo (por grupo) no discrimina, el pipeline (por unidad) sí |

## Límites

- El ruido entre corridas de la misma variante es de hasta 4 puntos (v2: 84,1 y 79,8). Los intervalos de Wilson por unidad (±1) subestiman la incertidumbre, porque las unidades de un grupo se mueven juntas. Solo la diferencia contra las largas (8 a 10 puntos) y contra v3 es mayor que ese ruido. La diferencia contra las cortas (3 a 4 puntos en promedio) se repite en las corridas de v2-orden, pero no está demostrada.
- La corrida completa del pipeline (con descomposición) no se repitió con v2-orden: costaba 0,27 USD y quedaban 0,16. La cifra de 86,4 % es del modo pipeline de clasificación.
- Con el proyecto de 200.000 caracteres (la condición de la medición anterior) no se midió.
- Quedan más de 10 % de errores. Son Idea y Error que el modelo manda a Nueva funcionalidad. También Nueva funcionalidad que manda a Retroalimentación y Pregunta en tablas de estado y chats largos. Muchos de esos grupos son ambiguos para los propios lectores (acuerdo de área de 95,5 %).

## Gasto

1,34 USD de 1,5. Unas veinte corridas de clasificación (0,04 a 0,06 cada una) y dos corridas completas del pipeline (0,27 cada una).

## Cómo repetirlo

```sh
BENCH_PRIVATE_DIR=bench/private node bench/areas-classify.mjs --variant v2-order --no-grouping
node bench/areas-classify.mjs compare <a.json> <b.json>
node bench/areas-classify.mjs report <a.json>
```

Las variantes viven en `bench/area-variants/`.
