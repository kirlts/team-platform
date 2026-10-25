# Un envío, varios mensajes (UD-293)

Un envío se descompone en tantos mensajes como pedidos traiga, cada uno con su área, su plantilla, sus campos y sus adjuntos. Fallaba un caso: varios pedidos en una sola oración sin puntuación daban un mensaje. Con el paso de corte dan uno por pedido. Banco de 12 envíos sintéticos: Haiku 5.5 pasa 24 de 24 corridas finales (antes 10 de 12). Sonnet 5.5 pasa 12 de 12.

Fecha: 2026-10-25. Modelos por `claude -p` de la cuenta de la sesión, sin llave de API (`bench/claude-cli-provider.mjs`). Datos sintéticos de un producto de reparto; ningún dato de personas.

## Cómo funciona hoy

| Pregunta | Respuesta medida en el código |
|---|---|
| Cuántos mensajes propone | Sin tope. El banco público trae un caso de 40 mensajes (`02-docx-40-puntos`). La batería publica cinco de tres áreas (`src/api/one-send-many-messages.test.js`) |
| Cómo se parte | Numeración de unidades por estructura (`units.js`), clasificación en grupos de un pedido con su área y plantilla, chequeo de partición por grupo escrito (H-3737) y una descomposición por grupo con la plantilla de su área. Cada mensaje trae su área, su plantilla y sus campos |
| Cada mensaje con su área y plantilla | Sí. El esquema de la propuesta exige `area_id` y `template_id` por mensaje; la publicación los guarda por mensaje |
| Texto que pertenece a dos mensajes | Una unidad va en un solo mensaje (cada unidad en exactamente un mensaje o descartada, por aritmética de conjuntos). Hasta ahora una oración con dos pedidos iba entera en el primero; con el paso de corte se parte antes de clasificar |
| Adjuntos | Un adjunto puede acompañar a varios mensajes (`message_attachments`, prueba `attachments-shared.test.js`). Ahora el sistema agrega a cada mensaje los adjuntos de donde salen sus unidades; antes dependía de que el modelo los nombrara, y en un audio con tres pedidos el tercer mensaje salió sin él |
| Orden | El de la primera unidad de cada pedido; el reparto de un pedido retomado más adelante queda en un solo mensaje (`resumes_at`) |
| Voz y capturas | Cada línea de voz con su tiempo y cada línea de descripción de imagen es una unidad; una captura va con el mensaje del pedido que la cita. Un audio con tres pedidos en una sola línea de tiempo también se corta (comprobado con Haiku 5.5: tres mensajes de tres áreas) |
| Producción | Los dos envíos reales (44 y 45) traen un solo pedido cada uno: una especificación de funcionalidad y una petición de unificar la subida de archivos. Un mensaje por envío era correcto. Además sólo hay un área activa (Error directo; las otras cinco están borradas), así que ningún envío podía repartirse entre áreas |
| Modelo en producción | `TEXT_MODEL=claude-sonnet-5-5`, leído del contenedor el 2026-10-25. El valor por omisión del código es Haiku 5.5 |

## Falla encontrada

Un párrafo dictado con un error, una pregunta a una persona y una idea es una sola unidad para `Intl.Segmenter`. El modelo no puede citar la mitad de una unidad, así que el envío salió como un mensaje y la idea se perdió. Con Haiku 5.5: 1 de 3 mensajes esperados. Con Sonnet 5.5 en esfuerzo `high`: 1 de 3 en las dos corridas. Lo mismo con una pregunta de investigación pegada a un arreglo en una oración (1 de 2).

## Arreglo

Paso de corte antes de clasificar (`cutPass`, MASTER-SPEC §7.5 paso 1b). El modelo declara las palabras con que empieza cada pedido posterior al primero. El sistema comprueba que estén en la unidad una sola vez, corta y numera de nuevo. No hay ningún `if` sobre el texto de la persona. Sondeo del paso solo, una llamada por caso (`bench/envios/cut-probe.mjs`), sobre los 10 casos públicos y los 12 del banco: 22 de 22 con Haiku 5.5 y 22 de 22 con Sonnet 5.5. Ninguno corta de más. El caso 09 corta sus dos oraciones compuestas y deja el saludo y el elogio sin cortar.

## Mensajes obtenidos contra esperados

Corte apagado (antes) y encendido (después). Área, plantilla, campos, adjuntos y orden también coinciden en todas las filas en verde.

| Envío | Esperados | Haiku antes | Haiku después | Sonnet antes | Sonnet después |
|---|---|---|---|---|---|
| e01 un pedido con captura | 1 | 1 | 1 | sin medir | 1 |
| e02 dos áreas | 2 | 2 | 2 | sin medir | 2 |
| e03 dos del mismo área | 2 | 2 | 2 | sin medir | 2 |
| e04 tres áreas en una oración dictada | 3 | 1 | 3 | 1 | 3 |
| e05 cinco pedidos de cuatro áreas | 5 | 5 | 5 | sin medir | 5 |
| e06 captura de uno solo | 2 | 2 | 2 | sin medir | 2 |
| e07 pregunta de investigación y arreglo en una oración | 2 | 1 | 2 | 1 | 2 |
| e08 audio con tres pedidos | 3 | 3 | 3 | sin medir | 3 |
| e09 tres capturas, tres pedidos | 3 | 3 | 3 | sin medir | 3 |
| e10 lista con viñetas | 3 | 3 | 3 | sin medir | 3 |
| e11 documento compartido por dos pedidos | 2 | 2 | 2 | sin medir | 2 |
| e12 vuelve al primer tema | 2 | 2 | 2 | sin medir | 2 |
| Envíos en verde | 12 | 10 de 12 | 12 de 12 | 0 de 2 medidos | 12 de 12 |

Corridas con el corte encendido, Haiku 5.5: 36 de 36 en tres repeticiones y 24 de 24 en dos repeticiones del banco final. Entre las dos tandas se reescribieron dos casos (e09 y e10) cuya área esperada era discutible.

Sonnet 5.5: 11 de 12 en la primera corrida y 12 de 12 en la final. El envío que falló (e09) clasificó «separar los botones» como funcionalidad, una decisión de criterio entre Error y Nueva funcionalidad y no una falla de partición.

## Haiku 5.5 contra Sonnet 5.5

Con el paso de corte los dos descomponen el banco completo con el mismo resultado: mismos mensajes, misma área y misma plantilla en cada pedido. La diferencia visible es de criterio de área en un caso ambiguo, que se resolvió en el caso y no en el modelo. La propuesta de UD-293 es `TEXT_MODEL=claude-haiku-5-5`. La medición usa 12 envíos sintéticos cortos. No incluye videos largos ni reuniones. En destinatarios, H-80 midió que Sonnet acierta más (conjunto exacto 80,0 % contra 53,0 %), y esta medición no lo repite.

## Consumo

| Concepto | Llamadas | Costo |
|---|---|---|
| Haiku 5.5 por `claude -p` | 419 | 6,15 USD según la CLI, que no conoce la tarifa de Haiku 5.5; a la tarifa de lista de `bench/pricing.js` son 0,25 USD |
| Sonnet 5.5 por `claude -p` | 160 | 1,62 USD según la CLI; 1,05 USD a la tarifa de lista |
| Sondeo del corte (22 casos, dos modelos) y sondeos sueltos | 60 aproximadas | sin registrar, menos de 1 USD |

## Cómo repetirlo

```sh
node bench/envios/run.mjs --model claude-haiku-5-5 --repeat 3              # banco contra un modelo real
node bench/envios/run.mjs --config '{"cutPass":false}'                      # el comportamiento anterior
node bench/envios/cut-probe.mjs --model claude-sonnet-5-5                   # sólo el paso de corte
TEAM_LIVE_ENVIOS=1 node --test bench/envios/envios.test.js                  # la prueba opcional con modelo real
```
