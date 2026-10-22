# Análisis de dos videos de un cliente (H-3728)

Con Sonnet 5.5, el arreglo deja en 0 los mensajes nacidos de fotogramas y en 7 de 7 las áreas en las tres corridas. Recoge 7 de 7 pedidos en 1 corrida y 5 de 7 en 2. En esas dos, dos pedidos seguidos de la misma conversación (el historial que no se abre y la persona duplicada) quedan en un solo mensaje. El costo por envío no cambia: 0,13 USD con Sonnet. Commit medido: `1e39e2a`.

Fecha: 2026-10-22. Caso: un envío de dos videos de un cliente, 86 unidades (33 de voz, 53 de fotogramas), siete pedidos dichos en voz. Revisión manual del caso y verdad: `bench/private/envio-33/` (fuera de git). Medidor: `bench/envio-33.mjs --runs 3`.

## Envío de dos videos

| Analizador | Modelo | Recogidos solos | Mensajes mezclados | Sólo fotogramas | Perdidos | Área correcta | USD por envío |
|---|---|---|---|---|---|---|---|
| Propuesta publicada | Haiku 5.5 | 2 de 7 | 1 de 4 | 1 | 0 | 6 de 7 | sin dato |
| `main` | Sonnet 5.5 | 3, 3, 5 | 2, 2, 1 | 0, 0, 1 | 0 | 6, 6, 7 | 0,13 |
| Rama, `b8b9a7a` | Sonnet 5.5 | 7, 5, 4 | 0, 1, 1 | 0 | 0 | 7, 7, 6 | 0,15 |
| Rama, `0da46a2` | Sonnet 5.5 | 5, 5, 5 | 1, 1, 1 | 0 | 0 | 6, 6, 6 | 0,16 |
| Rama, `189c9d2` | Sonnet 5.5 | 5, 5, 5 | 1, 1, 1 | 0 | 0 | 7, 7, 7 | 0,14 |
| Rama, `8b50cc3` | Sonnet 5.5 | 7, 5, 5 | 0, 1, 1 | 0 | 0 | 6, 6, 6 | 0,15 |
| Rama, `1e39e2a` | Sonnet 5.5 | 7, 5, 5 | 0, 1, 1 | 0 | 0 | 7, 7, 7 | 0,13 |

En todas las corridas de la rama: 0 pedidos sin nombrar, 0 unidades de voz sin asignar, 0 unidades en dos mensajes. Con Sonnet, las seis corridas de `main` y de la rama usan la palabra que se lee en pantalla. La propuesta publicada con Haiku usaba la de la voz.

El par que queda junto son dos segmentos de voz seguidos. El corte de la transcripción cae a mitad de una frase que habla de la misma conversación. Una sonda de la clasificación sola lo junta en 6 de 6 lecturas. Lo junta también con esfuerzo `medium` y con pensamiento encendido. El modelo escribe ese grupo con un solo pedido unido por «y», aunque el prompt pide partirlo.

## Qué cambió

| Defecto de la revisión | Arreglo | Prueba |
|---|---|---|
| Un fotograma se convierte en pedido | Cada unidad tiene un tipo (`voice`, `frame`, `text`) por su fuente y la etiqueta del extractor. Si el autor habla o escribe, un grupo sólo de fotogramas es error de forma, y tras el reintento va a descartados. Un mensaje sólo de fotogramas se une al siguiente. Lo visto y no dicho va en `observed`, plegado en la ficha | `src/analyze/frames.test.js`, `src/api/message-observed.test.js`, `panel/src/components/Observed.test.tsx` |
| Varios pedidos en un mensaje | Prompt: un pedido por grupo y por mensaje. Esquema: el grupo lista `requests`, y más de uno pide partirlo. El mensaje declara `resumes_at`, y las unidades habladas deben formar un tramo o declarar la vuelta | `frames.test.js` |
| Pedido perdido | La unidad no estaba descartada: estaba en un grupo de 48 unidades con cinco pedidos, y la descomposición escribía un mensaje por grupo. Se arregla al partir por pedido. La pasada de cobertura relee sólo voz y texto | `frames.test.js` |
| El mismo síntoma en dos mensajes | Cada fotograma pasa al grupo del segmento de voz que suena en su minuto | `frames.test.js` |
| Título que no nombra el pedido | Regla 8 de la descomposición | `frames.test.js` |
| Error para algo que nunca existió | Regla 3 de la clasificación y plantilla de error: lo que se busca y no se encuentra es Nueva funcionalidad | `frames.test.js` |
| «Dónde» con dos pantallas | Regla 9 de la descomposición y plantilla de error | `frames.test.js` |
| Palabra mal transcrita | Regla 7: la cita sale de la pantalla | `frames.test.js` |

## Regresiones

Haiku 5.5, el modelo de las mediciones anteriores. `main` y la rama en paralelo, mismos casos, 3 repeticiones.

Clasificación sola (`bench/classify-stage.mjs`), cinco reuniones y cuatro videos del banco privado:

| Medida | `main` | Rama |
|---|---|---|
| Área por unidad, rama menos `main` | | +8,8 puntos, IC95 [-1,1; 16,0], p 0,095 |
| Unidades con mensaje de referencia sin grupo | 3,20 % | 4,21 % |
| Lo mismo, sin unidades vacías | 2,34 % | 3,69 % |
| Mensajes de referencia sin ninguna unidad cubierta | 0 de 100 | 0 de 100 |
| Grupos por repetición | 92 | 128 |
| USD por repetición | 0,102 | 0,124 |
| Segundos por caso | 13,0 | 21,4 |
| Corridas fallidas | 0 de 27 | 1 de 27 |

La corrida fallida es una ventana de una consulta que salió inválida dos veces. La única regla de forma nueva que no se repara era el largo mínimo de cada línea de `requests`; se quitó. Después, 4 de 4 corridas de ese caso sin falla (0,08 USD).

Los grupos son más finos (128 contra 92). H-1904 midió grupos más gruesos que la referencia, así que van en la dirección de la referencia. El tiempo sube por los reintentos que piden partir un grupo.

Oraciones con dos puntos (`bench/probe-compound.mjs --repeat 5`, H-1600): ambos puntos recogidos en 22 de 25 en `main` y 23 de 25 en la rama.

## Gasto

3,67 USD de un tope de 6, declarado en `bench/results/private-spend.jsonl`.

| Parte | USD |
|---|---|
| Medidor del envío, 18 corridas | 2,61 |
| Sondas de la clasificación, 6 | 0,24 |
| Clasificación del banco | 0,78 |
| Oraciones con dos puntos | 0,05 |

## Comandos

```
TEXT_MODEL=claude-sonnet-5-5 VISION_MODEL=claude-sonnet-5-5 node bench/envio-33.mjs --runs 3 --budget 1 --private-dir bench/private --results-dir bench/results
node bench/classify-stage.mjs --label rama --repeat 3 --cases <cinco reuniones y cuatro videos> --project bench/private/project.md --results-dir bench/results/2026-10-22-videos/rama --budget 0.6
node bench/coverage-stats.mjs table base=<archivo> rama=<archivo> [--ignore-empty]
node bench/areas-stats.mjs pair base=<archivo> rama=<archivo> --all
node bench/probe-compound.mjs --repeat 5
```
