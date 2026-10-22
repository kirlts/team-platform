# Análisis de dos videos de un cliente, segunda vuelta (H-3731)

Con pensamiento y esfuerzo `high` en la clasificación, el envío sale 7 de 7 en las tres corridas. Hay 0 sobrantes, 0 mezclados y áreas 7 de 7. Con la configuración por omisión (sin pensamiento, esfuerzo `low`) sale 7, 7 y 5 de 7, con un mensaje sobrante en una corrida. El pensamiento lleva el envío de 18 a 25 s a 51 a 65 s, con un costo parecido (0,17 USD). La configuración por omisión no se cambió. Commit medido: `f36000f` (el código del analizador no cambia hasta `6f6b30a`).

Fecha: 2026-10-22. Sonnet 5.5, `bench/envio-33.mjs --runs 3`. Continúa [la primera vuelta](2026-10-22-analisis-de-videos.md).

## Envío de dos videos

| Analizador | Configuración | Recogidos solos | Mezclados | Sobrantes | Sólo fotogramas | Área | USD | Segundos |
|---|---|---|---|---|---|---|---|---|
| `main` (`a2b3632`) | omisión | 5, 5, 5 | 1, 1, 1 | 1, 1, 1 | 0 | 7, 7, 7 | 0,16 | 17 a 20 |
| `main` | pensamiento, `high` | 7, 5, 7 | 0, 1, 0 | 0 | 0 | 7, 7, 7 | 0,16 | 34 a 46 |
| Rama, primer prompt | omisión | 5, 5, 5 | 1, 1, 1 | 0 | 0 | 7, 7, 7 | 0,14 | 12 a 23 |
| Rama | pensamiento, `medium` | 5, 4, 5 | 1, 1, 1 | 1, 0, 1 | 0 | 6, 7, 7 | 0,12 | 14 a 15 |
| Rama | pensamiento, `high` | 7, 7, 7 | 0 | 0 | 0 | 7, 7, 7 | 0,17 | 51 a 65 |
| Rama, final | omisión | 7, 7, 5 | 0, 0, 1 | 1, 0, 0 | 0 | 7, 7, 7 | 0,18 | 18 a 25 |

Un mensaje sobrante habla pero no lleva ninguna unidad propia de un pedido de la verdad: el cierre «que el equipo use la plataforma completa según su rol» hecho mensaje. El medidor lo cuenta desde este commit. Los sobrantes de `main` salen de puntuar de nuevo las propuestas guardadas.

Con esfuerzo `medium` el modelo no piensa: tarda lo mismo que sin pensamiento.

## Por qué `split_at` y no las marcas de tiempo por palabra

Se transcribió de nuevo el segundo video con Groq (`timestamp_granularities[]=word`). En el punto donde cambia el pedido («…esa conversación, | la persona aparece dos veces») no hay pausa: la palabra siguiente empieza en el mismo centésimo en que termina la anterior. El segmento de Groq tampoco corta ahí: corta en «de cómo se | desenvolvió». La pausa más larga del tramo, 0,8 s, está antes, en «no lo abre | entonces». Cortar por palabra o por pausa deja el cambio de pedido dentro de la misma unidad. Sólo la coma lo marca, y cortar la voz en cada coma multiplica las unidades.

Con `split_at` el modelo dice dónde empieza de verdad la unidad, copiando sus palabras. El sistema comprueba que estén en la unidad y pasa las anteriores a la unidad de voz previa; ids, rótulos y tiempos no cambian. En la sonda de la clasificación lo usó en 4 de 4 lecturas, en el punto exacto. Aun con el corte bien hecho, sin pensamiento juntó los dos pedidos en 3 de 3 lecturas. Con pensamiento y `high` los separó.

`main` con pensamiento junta los dos pedidos en 1 de 3 corridas; la rama con pensamiento, en 0 de 3.

## Qué cambió

| Defecto | Arreglo | Prueba |
|---|---|---|
| Unidad de voz cortada a mitad de frase | `split_at` en la clasificación; `applySplits` y `splitProblem` | `src/analyze/voice-split.test.js` |
| Cierre de pedidos hecho mensaje | `recap_unit_ids` en el grupo; un grupo hecho sólo de cierres es error de forma y, tras el reintento, se une al grupo del pedido anterior (`foldRecapGroups`) | `voice-split.test.js` |
| Dos fallas de la misma conversación en un grupo | Regla 2d: cada falla es un elemento de `requests` aunque una pueda causar la otra | `voice-split.test.js` |
| Mensajes sobrantes sin medir | `bench/envio-33.mjs` cuenta sobrantes y acepta `--config` | corrida del medidor |
| Clasificación fallida sin motivo en el banco | `bench/classify-stage.mjs` imprime los errores | corrida del banco |

## Regresiones

Haiku 5.5, clasificación sola, cinco reuniones y cuatro videos del banco privado.

| Medida | `main` | Rama, omisión | Rama, pensamiento `high` |
|---|---|---|---|
| Repeticiones | 3 | 3 | 2 |
| Área por unidad, contra `main` | | -1,5 puntos, IC95 [-6,6; 2,2], p 0,42 | +5,5 puntos, IC95 [-2,0; 9,5], p 0,13 |
| Unidades con mensaje de referencia sin grupo, sin vacías | 3,13 % | 2,97 % | 0,94 % |
| Mensajes de referencia sin ninguna unidad cubierta | 0,7 de 100 | 0 de 100 | 0 de 100 |
| Grupos por repetición | 125 | 123 | 163 |
| USD por repetición | 0,127 | 0,122 | 0,520 |
| Segundos por caso | 21 | 21 | 322 |
| Corridas fallidas | 0 de 27 | 1 de 27 | 0 de 18 |

La corrida fallida de la rama es una ventana de una reunión. El banco no guardaba el motivo; desde este commit lo imprime. Seis corridas más de ese caso salieron sin falla (0,15 USD).

Oraciones con dos puntos (`bench/probe-compound.mjs --repeat 5`): ambos puntos en 21 de 25 en `main` y en la rama.

## Decisión pendiente

El pensamiento en la clasificación da 7 de 7 estable y mejora el banco. A cambio, multiplica el tiempo: por 3 en el envío con Sonnet, por 15 por caso con Haiku. La velocidad de respuesta es la cualidad que Martín puso primero. Para activarlo en una instalación basta con poner `classifyThinking: null` y `classifyEffort: "high"` (`src/analyze/config.js`).

## Gasto

4,50 USD de un tope de 5, declarado en `bench/results/private-spend.jsonl`.

| Parte | USD |
|---|---|
| Medidor del envío, 18 corridas | 2,32 |
| Sondas de la clasificación, 4 | 0,19 |
| Clasificación del banco | 1,94 |
| Oraciones con dos puntos | 0,05 |

La transcripción con marcas por palabra usó la cuenta gratuita de Groq.
