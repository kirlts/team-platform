# Pérdida por punto, marcas de hablante y mensajes fundidos, 2026-10-21

Resultado: la pérdida por punto es 0 de 376 puntos sin ninguna unidad cubierta y 2,2 % cubiertos a lo sumo la mitad (3 repeticiones, 39 casos). Un grupo o un mensaje hecho sólo de marcas de hablante deja de llegar a la propuesta: 10 de 121 mensajes antes, 0 de 141 después. Un mensaje que funde dos puntos asigna peor (44,3 % contra 55,4 % de asignación exacta), pero con el punto fijo la diferencia es cero (4 peores, 4 mejores, p 1,0).

## H-1901, pérdida por punto

`bench/coverage-stats.mjs` acepta `--ignore-empty`: las unidades sin contenido propio (`isEmptyUnit` de `src/analyze/units.js`: marca de hablante con hora, nombre con dos puntos, número de lista, línea de símbolos) salen de los mensajes de referencia, y un mensaje hecho sólo de ellas sale de la lista. `empty` cuenta esas unidades en la referencia.

| Tipo | Unidades en mensajes | Sin contenido | Mensajes con alguna unidad vacía |
|---|---:|---:|---:|
| reunión | 2.483 | 605 (24,4 %) | 78 de 125 |
| audio | 76 | 17 (22,4 %) | 5 de 6 |
| docx | 1.187 | 82 (6,9 %) | 43 de 196 |
| chat | 63 | 1 (1,6 %) | 1 de 9 |
| imagen, video, tabla | 648 | 0 | 0 |
| total | 4.457 | 705 (15,8 %) | 127 de 376 |

Ningún mensaje de referencia está hecho sólo de unidades vacías. Las dos lecturas cortan las mismas unidades, así que no hace falta cambiar `units.js` ni migrar las 5.329 unidades: la medida las excluye.

| Corrida (39 casos) | Unidades sin grupo | Con `--ignore-empty` | Puntos sin ninguna unidad cubierta | Cubiertos a lo sumo la mitad |
|---|---:|---:|---:|---:|
| base, 2 repeticiones | 8,10 % | 5,94 % | 9,0 de 376 | 19,0 |
| adoptada (cobertura y contexto 40), 3 repeticiones | 2,06 % | 1,55 % | 0,0 de 376 | 8,3 |

Un 27 % de las unidades "perdidas" de la base son vacías. La pérdida de puntos que queda es 2,2 % cubiertos a lo sumo la mitad.

## H-1902, marcas de hablante solas

Antes: 5 grupos hechos sólo de unidades vacías en 117 corridas de clasificación de la variante adoptada. En la propuesta completa de cinco transcripciones (1 repetición): 10 de 121 mensajes citaban sólo marcas ("Confirmar el punto de Martín de la unidad 219"), por dos caminos: un grupo de marcas solas y un hueco que el rescate convertía en mensaje.

Arreglo (`src/analyze/api.js`, `validate.js`):

- `foldEmptyGroups`: un grupo de marcas solas se une al grupo de la unidad que sigue; si esa unidad se descartó, la marca se descarta con ella.
- `closeEmptyGaps`: un hueco hecho sólo de unidades vacías se cierra en el mensaje de la unidad siguiente, sin llamada de rescate.
- `foldEmptyMessages`: un mensaje de marcas solas se une al siguiente.

Después, mismas cinco transcripciones: 0 de 141 mensajes con sólo marcas, 15 huecos cerrados sin rescate, 9 mensajes unidos. En 154 corridas de clasificación con el arreglo: 0 grupos de marcas solas. La regla 3 de la descomposición no cambia: ya no recibe ese grupo. Pruebas: `src/analyze/validate.test.js`, `units.test.js` y `api.test.js` ("a speaker mark alone is not a point").

## H-1904, dos puntos fundidos

`bench/fused-stats.mjs` empareja cada punto de referencia con el mensaje más estrecho que lo contiene. El par es "fundido" si ese mensaje contiene también todas las unidades con contenido de otro punto. Remuestreo por caso.

| Medida | Sueltos (260 pares) | Fundidos (140 pares) | Diferencia | IC95 |
|---|---:|---:|---:|---|
| asignación exacta | 55,4 % | 44,3 % | -11,1 | [-30,3; 13,7] |
| recall de destinatarios | 88,2 % | 82,6 % | -5,7 | [-23,8; 8,7] |
| precisión de destinatarios | 76,3 % | 70,6 % | -5,7 | [-15,3; 8,9] |
| área acertada | 81,2 % | 76,4 % | -4,7 | [-30,0; 15,3] |

Con el mismo punto fundido en unas corridas y suelto en otras: 20 puntos, 4 peores fundidos, 4 mejores, p 1,0. Con tres archivos de resultados (1.000 pares, 366 fundidos): -12,5 puntos de asignación exacta [-27,8; 6,2]; 42 puntos, 11 peores, 13 mejores, p 0,84. La brecha entre puntos existe y no se debe a la fusión: los puntos que se funden son los difíciles. El 35 % de los pares está fundido.

## Gasto

0,67 USD: dos corridas completas de cinco transcripciones (0,33 y 0,34). El resto del análisis usa resultados ya medidos. Registro en `bench/results/h1902/private-spend.jsonl` y `h1902b/`.

## Cómo repetirlo

```sh
export BENCH_PRIVATE_DIR=<carpeta de casos>
node bench/coverage-stats.mjs empty
node bench/coverage-stats.mjs table base=<archivo> adoptada=<archivo> --ignore-empty
node bench/fused-stats.mjs <resultado completo>.json [...]
node bench/run-private.mjs run --variant fix2 --cases r09-txt-reunion-plan-de-accion,r10-txt-reunion-infraestructura,r12-txt-consulta-con-el-doctor,u12-reunion-parte-1,u13-reunion-parte-2 --team bench/private/team.json --project bench/private/project.md --results-dir bench/results/h1902b --budget 0.8
```
