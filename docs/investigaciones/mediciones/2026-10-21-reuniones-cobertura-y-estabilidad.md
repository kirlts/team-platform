# Cobertura y estabilidad en reuniones largas, 2026-10-21

Resultado: la pérdida real de puntos en el banco privado es 0,85 % de las unidades de referencia (IC 0,5 a 1,2), no 8,2 %. El 76 % de las unidades "perdidas" no tiene contenido. La clasificación sí pierde puntos enteros (ocho mensajes de referencia sin ninguna unidad cubierta, cuatro de ellos el mismo par de puntos de r10 en las dos repeticiones, y un plazo descartado en un chat) y traza grupos distintos en cada repetición (acuerdo entre repeticiones 0,62). Con una pasada de cobertura y 40 unidades de contexto antes de cada ventana: unidades sin grupo 8,1 a 2,1 % en los 39 casos, área acertada sobre todas las unidades esperadas 74,9 a 79,9 % (p 0,011), acuerdo entre repeticiones 0,62 a 0,78 en las cinco transcripciones (p 0,004). Costo por corrida de clasificación +19 %.

## Método

- Modelo `claude-haiku-5-5`, proyecto de 200.000 caracteres en la clasificación, 39 casos privados.
- Línea base: la corrida `h1600` de UD-060 (39 casos, 2 repeticiones, 732 unidades de referencia sin mensaje de 8.914).
- Auditoría: muestra estratificada de 122 de las 496 unidades distintas sin mensaje, leídas en memoria. Cada una se etiqueta: **A** punto accionable ausente de toda la propuesta, **B** detalle de un punto que otro mensaje recoge, **N** sin contenido (marca de hablante, número de lista, relleno), **U** dudosa. Las etiquetas viven en `bench/private/_audit/` y no entran a git.
- Experimentos de clasificación: `bench/classify-stage.mjs` corre `classifyInput` (la etapa real de `src/analyze/api.js`) sin la descomposición. `bench/coverage-stats.mjs` mide cobertura y acuerdo entre repeticiones; `bench/areas-stats.mjs --all` mide el área sobre todas las unidades esperadas. Comparación de a pares con remuestreo por caso, 10 repeticiones sobre las cinco transcripciones (r09, r10, r12, u12, u13).
- Los dos lectores de la referencia cortan las mismas unidades en los 39 casos (`expected.json` y `expected-b.json` difieren sólo en el área). La accionabilidad de una unidad la juzgó, entonces, un solo lector; la auditoría es el segundo juicio.

## Tasa real de pérdida

| Etiqueta | Unidades estimadas por repetición | % de lo perdido | % de las 8.914 unidades de referencia |
|---|---:|---:|---:|
| A accionable | 76 | 10,4 | 0,85 (IC 0,48 a 1,24) |
| U dudosa | 19 | 2,6 | 0,21 |
| B detalle recogido | 78 | 10,6 | 0,87 |
| N sin contenido | 559 | 76,4 | 6,27 (IC 5,70 a 6,86) |

Por tipo de insumo (unidades de referencia sin mensaje, antes de auditar): reunión 12,7 %, audio 3,9, docx 3,2, video 1,7, chat 1,6, tabla e imagen 0. De la muestra auditada, A aparece en r10 (7 de 14), r09 (3 de 12, más 3 dudosas) y en el chat (2 de 2: un plazo de entrega y su restricción de alcance). docx (26), video (10) y audio (4) no tienen ningún A.

A nivel de punto, sobre 744 mensajes de referencia por repetición: 8 (1,1 %) quedan sin ninguna unidad cubierta y 36 (4,8 %) con la mitad o menos. Cuatro de los ocho son dos puntos de r10 perdidos en las dos repeticiones; los otros cuatro están en r09, u02, u11 y u13, uno en cada una.

Las N son unidades que la referencia incluye dentro de un mensaje y que no dicen nada: líneas "00:12:41 Martín", números de lista como "27.", "Exacto.", "Ya?". Las 732 son descartes explícitos del modelo; ninguna es omisión ni corte por `max_tokens` (0 reintentos por corte).

## Causa

1. El descarte ocurre por ventana completa. En r10 la última ventana de 84 unidades aparta de golpe las unidades 181 a 251 con un motivo genérico ("charla social, reflexiones generales"); lo repite en las dos repeticiones y pierde tres mensajes de referencia. La tasa de descarte por ventana va de 0 a 71 %; dentro de una ventana es plana (18 a 24 % por quinto), así que no es un efecto de posición ni de límite de salida.
2. El modelo no ve lo que precede a su ventana. Un punto que cruza el borde se parte y la mitad nueva se juzga sin su tema.
3. En el chat, la repetición 1 descartó un plazo con el motivo "plazo de entrega sin punto accionable", contra la regla 7 de la clasificación ("nunca descartes una unidad que fija un plazo").

## Variación entre repeticiones (H-1003)

Línea base, 10 repeticiones: grupos por repetición 12 a 26 en r12, 35 a 49 en u12, 7 a 15 en r09. Acuerdo entre dos repeticiones (índice de Rand ajustado, unidades de cada caso): 0,56 a 0,69, media 0,62. La desviación de 3,6 puntos de área sale de ahí.

`temperature` no se puede bajar: con `claude-haiku-5-5` la API responde 400 "`temperature` is deprecated for this model" para 0 y 0,3 y acepta sólo 1 (comprobado el 2026-10-21).

## Variantes (cinco transcripciones, 10 repeticiones)

| Variante | Sin grupo % | Área sobre todas las esperadas | Acuerdo entre repeticiones | Grupos por repetición | USD por repetición |
|---|---:|---:|---:|---:|---:|
| Base | 14,7 | 62,5 | 0,62 | 99 | 0,057 |
| Cobertura | 8,7 | 67,4 (+4,9, p 0,001) | 0,61 | 136 | 0,073 |
| Cobertura, nota selectiva | 7,8 | 64,9 (+1,5, p 0,52) | 0,63 | 124 | 0,067 |
| Contexto 20, sin cobertura | 6,4 | 67,9 (+5,4, p < 0,001) | 0,76 | 68 | 0,056 |
| Cobertura y contexto 20 | 3,2 | 66,9 | 0,74 | 85 | 0,064 |
| Cobertura y ventana de 60 | 9,2 | 65,2 (+2,8, p 0,23) | 0,61 | 174 | 0,090 |
| **Cobertura y contexto 40** | **2,8** | **70,6 (+8,2, p 0,003)** | **0,78 (+0,16, p 0,004)** | **78** | **0,066** |

Contexto 40 contra contexto 20, ambos con cobertura: acuerdo +0,044 (p < 0,001), área +3,8 (p 0,22). Los grupos quedan más gruesos que los de la referencia (puntos de referencia por grupo 1,69 en la base y 2,04 con la variante): el índice de Rand contra la referencia baja de 0,49 a 0,43.

Sobre las unidades de la auditoría etiquetadas A, la recuperación sube de 47 a 88 %. Las unidades N agrupadas suben de 53 a 88 %: absorben relleno dentro de grupos más grandes.

## Validación en los 39 casos (3 repeticiones, cobertura y contexto 40 contra base)

| Medida | Base | Variante | Diferencia |
|---|---:|---:|---|
| Área por unidad que recibió grupo | 81,7 | 81,6 | -0,1, p 1,0 |
| Área sobre todas las unidades esperadas | 74,9 | 79,9 | +4,9 [1,3; 7,3], p 0,011 |
| Unidades de referencia sin grupo | 8,1 % (9,4 por caso) | 2,1 % (2,4) | -3,3 puntos, p < 0,001 |
| Mensajes de referencia sin ninguna unidad | 9,0 de 376 | 0,0 de 376 | |
| Descartes de la referencia que quedan en un grupo | 14,2 de 22,3 por caso | 18,6 de 22,4 | +4,4 unidades (p 0,08) |
| USD por repetición de 39 casos | 0,129 | 0,154 | +19 % |
| Segundos por caso | 5,3 | 5,9 | +11 % |

Con la descomposición, cinco transcripciones, una repetición: unidades sin mensaje 14,6 % (10 corridas de la base) contra 3,7 %. Mensajes por corrida 33,3 contra 28,4. Mensajes que describen una unidad en vez de un punto ("Revisar la descomposición de u77"): 0,9 por corrida contra 1,0. Tiempo 22,7 contra 30,8 s por caso.

## Lo que no se midió

- `classifyDraws` (varias lecturas con la mayoría decidiendo el área) está implementado y probado con un proveedor falso. Con el modelo real triplica el costo de la clasificación y 10 repeticiones cuestan unos 1,7 USD. El tope de la tarea (7 USD) no alcanzó. Comando: `node bench/classify-stage.mjs --label draws3 --cases r09-txt-reunion-plan-de-accion,r10-txt-reunion-infraestructura,r12-txt-consulta-con-el-doctor,u12-reunion-parte-1,u13-reunion-parte-2 --repeat 10 --project bench/private/project.md --config '{"coveragePasses":1,"classifyContextUnits":40,"classifyDraws":3}'`.
- Un contexto mayor que 40 unidades.

## Gasto

6,01 USD de 7 (registro en `bench/results/reuniones/private-spend.jsonl`): base 0,57; cobertura 0,73; nota selectiva 0,68; contexto 20 sin cobertura 0,56 y con cobertura 0,65; ventana de 60 0,90; contexto 40 0,66; validación de 39 casos 0,86; descomposición completa 0,37; prueba de humo 0,04.

## Cómo repetirlo

```sh
node bench/classify-stage.mjs --label base5 --cases <cinco casos> --repeat 10 --project bench/private/project.md --config '{"coveragePasses":0,"classifyContextUnits":0}'
node bench/classify-stage.mjs --label nueva5 --cases <cinco casos> --repeat 10 --project bench/private/project.md
node bench/coverage-stats.mjs table base5=<archivo> nueva5=<archivo>
node bench/coverage-stats.mjs pair base5=<archivo> nueva5=<archivo>
node bench/coverage-stats.mjs stability nueva5=<archivo>
node bench/areas-stats.mjs pair base5=<archivo> nueva5=<archivo> --all
```
