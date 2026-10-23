# Documentos largos y listas de pedidos (H-3737)

En los tres elementos de texto largo de la muestra de diez envíos, los pedidos que salen solos en su mensaje pasan de 38 de 71 (54 %) a 59 de 71 (83 %). El análisis completo de los diez elementos pasa de 45 a 66 de 88 (51 % a 75 %). Los sobrantes bajan de 10 a 9. El envío 33 sigue en 7 de 7 en tres corridas de tres. No llega al 80 % en el total porque los siete elementos de voz, imagen y video no cambian (7 de 17), y en ellos la referencia cuenta por separado varios relatos de la misma falla.

Fecha: 2026-10-23. Sonnet 5.5. Continúa [la muestra heterogénea](2026-10-22-muestra-heterogenea.md). Datos reales fuera de git (`bench/private/muestra-10/`); aquí sólo cifras.

## Causa

| Hipótesis | Resultado |
|---|---|
| La ventana o el tope de salida cortan la lista de grupos | Descartada. La salida de clasificación fue de 500 a 900 tokens contra un tope de 16.000; ninguna corrida se cortó |
| El modelo agrupa por tema en documentos | Confirmada. Una especificación de 171 unidades salió en 2 grupos (1 por ventana) con `requests` de un solo elemento cada uno: el modelo nombró el documento entero como un pedido («Integrar X») y la validación de «un pedido por grupo» no tenía nada que rechazar. Otra corrida del mismo texto dio 11 grupos: el resultado era inestable |
| «Una unidad, un pedido» no se activa en texto largo | Confirmada. El modelo declara 1 pedido por grupo en todas las corridas de clasificación observadas; la regla 2d le da un incentivo a escribir uno |
| Pasada estructural previa con candidatos numerados | No hizo falta. Las reglas nuevas y el chequeo posterior resuelven el caso sin listar candidatos. Queda un hallazgo de extracción: los marcadores de lista del .docx llegan escapados (`\*`, `1\.`), no se reconocen como viñetas y la numeración queda como unidad aparte. No se tocó para no renumerar unidades |
| Trozos más cortos con unión de duplicados | La unión se probó y se descartó (abajo) |
| Esfuerzo por tamaño | No se probó: el chequeo corre en `low` y no hizo falta subir la clasificación |

El contexto convertido en tarea tenía dos causas: la regla 7 («nunca descartes un compromiso de entrega») se aplicaba también a lo que el autor promete hacer él mismo, y los elogios y las decisiones ya tomadas se agrupaban como puntos.

## Cambios

| Cambio | Dónde |
|---|---|
| Regla 2g de la clasificación: un documento o lista no es un pedido; título, objetivo y resumen no forman grupo; cada sección o viñeta construible por separado es un grupo; los criterios de aceptación van con el pedido que verifican; la fase posterior es otro grupo | `src/analyze/prompts-es.js`, `prompts-en.js` |
| Regla 2h: lo que el autor promete hacer él mismo, lo ya decidido, la descripción del estado actual y los elogios no forman grupo. Regla 7: el compromiso de entrega que sigue sin descartarse es el de otra persona o del equipo | los mismos |
| Chequeo de división: tras la clasificación, cada grupo de texto escrito con dos o más unidades se lee solo, en una llamada corta (`low`, sin razonamiento), que devuelve sus pedidos con sus unidades. Más de uno parte el grupo. Cobertura exacta validada por conjuntos, reparada por aritmética si el reintento falla; una llamada que falla deja el grupo como estaba | `src/analyze/api.js` (`splitGroups`), `validate.js` (`validateSplit`, `repairSplit`, `settleSplit`), `schema.js`, perillas `splitPass`, `splitPassEffort`, `splitPassThinking` |
| Los grupos con unidades de voz no se chequean: la transcripción corta por tiempo y el chequeo, que ve sólo el grupo, separó el inicio de una frase de su continuación (2 sobrantes en el envío 33) | `splitGroups` |
| Error corregido: `applySplits` fallaba con `TypeError` en un audio, porque su línea no lleva «Voz:» | `validate.js`, prueba en `voice-split.test.js` |
| Medidor con la referencia de la muestra | `bench/muestra.js`, `bench/muestra.mjs`, `bench/muestra.test.js` |

## Unión de duplicados descartada

Una llamada sobre la lista de grupos nombraba los que piden lo mismo y los unía. Redujo una especificación de 35 a 29 grupos sin cambiar los solos, y en las otras dos unió pedidos distintos de la referencia: 31 a 27 solos en el documento de 33 ítems, y un grupo con tres pedidos en la reunión. Se retiró el código. Con las reglas 2g y 2h, los pares con el mismo pedido en dos mensajes del informe anterior (el documento de calendario) desaparecen porque los grupos ya no son resúmenes del documento.

## Medidor

La referencia de cada elemento se llevó a unidades: un modelo asignó a cada pedido de `referencia/NN.md` las unidades que lo enuncian (0,13 USD en total). El núcleo de un pedido son sus unidades exclusivas; un pedido sin núcleo se une al que comparte sus unidades y no se cuenta aparte. Un pedido es solo si el mensaje donde tiene más unidades no es el principal de otro; mezclado o enterrado si lo es (enterrado: pesa menos de la mitad que el más pesado). Sobrante: mensaje sin ninguna unidad de pedido. Calibración: las propuestas guardadas del informe anterior, puntuadas así, dan 45 solos, 10 sobrantes, y por elemento 27, 0 y 11 en los tres textos largos, contra 24, 0 y 9 de la lectura manual; los sobrantes coinciden (10).

Límites: la referencia cuenta como pedidos separados varios relatos de una misma falla en las grabaciones (7 de 17 en los siete elementos no textuales), y agrupa en un pedido lo que el sistema ahora separa (seis endpoints de una especificación salen como seis mensajes). Ambos efectos reducen los solos sin ser errores del sistema. Las corridas usan el texto ya extraído (sin voz ni imágenes), sin otros envíos recientes, con las áreas y plantillas de la instancia y sin descripción de proyecto.

## Tabla por elemento

Antes: propuestas de producción del informe anterior, puntuadas con el medidor. Después: una corrida completa del código de la rama. Costo y tiempo antes incluyen la extracción; después, sólo el análisis.

| Elemento | Pedidos | Mensajes antes / después | Solos antes / después | Sobrantes antes / después | USD antes / después | Segundos antes / después |
|---|---|---|---|---|---|---|
| 01 video 3 min | 4 | 3 / 2 | 1 / 1 | 1 / 0 | 0,31 / 0,08 | 384 / 26 |
| 02 video 16 s | 2 | 2 / 2 | 2 / 2 | 0 / 0 | 0,13 / 0,03 | 52 / 10 |
| 03 audio 2 min | 4 | 2 / 2 | 1 / 1 | 0 / 0 | 0,11 / 0,04 | 46 / 17 |
| 04 audio 50 s | 2 | 1 / 1 | 0 / 0 | 0 / 0 | 0,09 / 0,02 | 19 / 12 |
| 05 captura con texto | 1 | 1 / 1 | 1 / 1 | 0 / 0 | 0,09 / 0,02 | 44 / 12 |
| 06 captura marcada | 0 | 2 / 2 | 0 / 0 | 2 / 2 | 0,18 / 0,06 | 61 / 20 |
| 07 documento, 33 ítems | 37 | 35 / 38 | 27 / 31 (31) | 1 / 0 (1) | 0,85 / 0,43 (0,34) | 93 / 93 (79) |
| 08 especificación | 18 | 2 / 29 (36) | 0 / 14 (16) | 0 / 1 (1) | 0,13 / 0,38 (0,31) | 34 / 58 (53) |
| 09 reunión escrita | 16 | 20 / 23 | 11 / 14 | 6 / 5 | 0,84 / 0,61 | 84 / 106 |
| 10 audio, captura y texto | 4 | 4 / 4 | 2 / 2 | 0 / 1 | 0,25 / 0,05 | 49 / 22 |
| Total | 88 | 72 / 104 | 45 / 66 | 10 / 9 | 2,97 / 1,72 | |

Entre paréntesis, la segunda corrida (sólo 07 y 08). Mezclados y enterrados después: 11 y 1 en los tres textos largos (antes 19 y 14); perdidos 0 en ambas. Los costos de antes y después no son comparables: el medidor del informe anterior calculó el costo desde la traza, y el de ahora desde el uso de cada llamada, sin la extracción.

Límites del caso más pesado: la reunión de 22 KB tarda 106 s y cuesta 0,61 USD; ningún elemento pasa de 3 minutos ni de 1,5 USD. El chequeo agrega de 12 a 25 llamadas cortas por documento.

## Envío 33

`bench/envio-33.mjs --runs 3` con la rama final: 7 de 7 solos en las tres corridas, 0 mezclados, 0 perdidos, áreas 7 de 7, sobrantes 0, 1 y 0 (la configuración anterior dio 0 a 1), 47 a 64 s, 0,17 a 0,19 USD. Una versión intermedia del chequeo, que también leía grupos con voz, dio 2 sobrantes en tres de tres corridas; de ahí la exclusión de la voz.

## Contexto convertido en tarea

Reunión escrita: el grupo de la valoración positiva y el de la promesa de retomar la reunión desaparecen (sobrantes 6 a 4 en la clasificación sola, 5 en la corrida completa). Quedan sobrantes que la referencia no cuenta y que son pedidos plausibles (una revisión pendiente con el doctor, una observación sobre la tablet).

## Gasto

7,50 USD de un tope de 8, declarados en `bench/results/private-spend.jsonl`. Las corridas por variante son 2 en la clasificación de cinco elementos y 1 en la completa de diez (2 en 07 y 08), no 3: tres corridas completas por variante costaban unos 9 USD.

| Parte | USD |
|---|---|
| Referencia por unidades | 0,13 |
| Clasificación, variantes (base, reglas, chequeo, unión) | 2,95 |
| Envío 33, dos series de tres corridas | 1,26 |
| Corrida completa de diez elementos y segunda de 07 y 08 | 2,38 |
| Depuración no registrada en su momento | 0,15 |
