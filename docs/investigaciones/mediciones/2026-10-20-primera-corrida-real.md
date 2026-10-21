# Primera corrida real del analizador, 2026-10-20

Resultado: el mensaje de chat de cuatro puntos sale en cuatro mensajes con su área correcta (error, idea, pregunta, error) en 3,3 a 3,6 s. Son cinco corridas de cinco. Antes salía como un solo mensaje, en 6,5 a 9,1 s. En el banco de siete casos, seis tienen mediana entre 3,6 y 6,3 s y el docx de 40 puntos 10,5 s. La cobertura es 100 % en seis casos y 80 % en el monólogo.

## El defecto

El mensaje «1) popup vacío en agenda 2) idea de recordatorio por WhatsApp 3) pregunta a Pablo sobre la reunión 4) exportar a Excel tarda un minuto» se numeraba como una sola unidad (`units: 1`). Con una unidad hay un grupo y un mensaje, y ese mensaje fusionaba los cuatro puntos. La clasificación tuvo un reintento. La descomposición tardó 11,9 s con 1.919 tokens de salida.

## Qué cambió

Unidades por oración (`src/analyze/units.js`):

- Un párrafo con más de una oración baja a oración con `Intl.Segmenter` (granularidad `sentence`, locale `es`).
- Una enumeración en línea corta una unidad por elemento: «1) … 2) …» o «a) … b) …». Solo cuenta si empieza en 1 o en «a» y sube de a uno.
- Un punto y coma, y una lista de guiones en una línea, también cortan.
- En un chat cada salto de línea es un párrafo.
- Las transcripciones de audio y video no bajan a oración. Cada segmento con su marca de tiempo es una unidad.
- El número de unidad sigue siendo un entero. El rótulo (`p3.s2`, párrafo 3 oración 2) se muestra en el prompt y queda en `units[].label`.

Un punto por grupo:

- La clasificación reparte las unidades en grupos de un solo punto.
- La descomposición de un grupo devuelve un solo mensaje, salvo que el grupo traiga dos pedidos independientes.
- Las preguntas de diagnóstico, los datos concretos, quién se hace cargo y las acotaciones de alcance van en el grupo del punto, aunque otros mensajes los separen.

Sin descartes en la descomposición:

- Con `low` y sin pensamiento, el modelo usaba `discarded` para unidades cuyo dato ya estaba en el cuerpo del mensaje.
- También descartaba puntos breves, con razones como «solo enuncia el título de una idea».
- El esquema de la segunda llamada ya no tiene `discarded`. Descarta solo la clasificación.
- Un grupo que vuelve sin mensajes se reintenta una vez.

Perillas:

- `classifyThinking` y `decomposeThinking` se fijan por llamada (`disabled` o `null`).
- Por omisión: esfuerzo `low` y pensamiento apagado en las dos llamadas.
- `partitionConcurrency` pasa de 4 a 16.

## Método

- Proveedor real: Anthropic `claude-haiku-5-5`, con la llave de Martín cargada desde `~/.config/team-platform/env`. Ninguna llave entra al repositorio.
- Chat de cuatro puntos: un guion de medición fuera del repositorio sobre `analyze`, con el equipo de `scripts/analizar.mjs`.
- Banco: `node bench/run.mjs` con los siete casos. La columna final usa tres repeticiones; las otras, una, así que sus porcentajes son indicativos.
- La columna final se corrió con el código y los prompts del cierre de la rama. Incluye las filas de tabla, las líneas de chat con emisor y la regla de encargos (REG-002 a REG-004).
- `--config` pasa las perillas a `analyze`.
- Las columnas «antes», «v1» y «v2» se puntuaron contra la referencia de ese momento. La columna final se puntuó contra la referencia corregida (ver más abajo).

## Resultados del chat de cuatro puntos

| Configuración | Corridas | Tiempo total | Mensajes con su área |
|---|---|---|---|
| Esfuerzo `medium`, pensamiento adaptativo (anterior) | 3 | 5,9 a 9,1 s | 4 de 4 en las tres |
| `low` sin pensamiento, prompt anterior | 3 | 3,6 a 5,1 s | 2 de 4: el modelo descartó la idea y la pregunta |
| `low` sin pensamiento, prompt final | 5 | 3,3 a 3,6 s | 4 de 4 en las cinco |

En la configuración final la clasificación tarda 1,1 a 1,3 s con 116 tokens de salida. Cada descomposición tarda 1,3 a 2,4 s con 125 a 265 tokens. Los cuatro grupos se descomponen a la vez. El total es la clasificación más la descomposición más lenta.

## Resultados del banco

Cada celda es cobertura, clasificación y mediana de tiempo.

| Caso | Antes (corrida del coordinador) | v1: oraciones, `medium` | v2: `low` sin pensamiento, prompt anterior | Final |
|---|---|---|---|---|
| 01-chat-grupo | 100 % / 100 % / 16,7 s | 100 % / 100 % / 17,7 s | 0 % / 77 % / 10,8 s | 100 % / 100 % / 4,4 s |
| 02-docx-40-puntos | 100 % / 93 % / 33,9 s | 100 % / 96 % / 39,5 s | 100 % / 76 % / 17,3 s | 100 % / 92 % / 10,5 s |
| 03-monologo-prueba | 89 % / 97 % / 25,6 s | 67 % / 90 % / 26,7 s | 78 % / 94 % / 11,4 s | 80 % / 90 % / 6,3 s |
| 04-reporte-de-error | 100 % / 100 % / 9,0 s | 100 % / 100 % / 9,7 s | 100 % / 100 % / 8,6 s | 100 % / 100 % / 4,8 s |
| 05-idea-suelta | 0 % / 67 % / 6,8 s | 100 % / 100 % / 6,0 s | 100 % / 100 % / 3,8 s | 100 % / 100 % / 3,6 s |
| 06-mensaje-mezclado | 100 % / 100 % / 8,4 s | 100 % / 100 % / 8,4 s | 100 % / 100 % / 4,1 s | 100 % / 100 % / 3,8 s |
| 07-video-de-pantalla | 100 % / 75 % / 17,2 s | 100 % / 75 % / 13,1 s | 100 % / 75 % / 4,7 s | 100 % / 100 % / 4,1 s |

En la columna final, tres repeticiones:

- MECE completo (cobertura 100 % y nada más) en 01 (2 de 3), 02, 04, 05, 06 y 07 (3 de 3).
- 03 no alcanza MECE en ninguna repetición: cobertura 80 %, mensajes de más 8 %, partidos 10 % y fusionados 8 %.
- Cada input hace entre 2 y 12 llamadas, salvo el docx con 41.
- El costo va de 0,0003 a 0,0087 USD por input, con la tarifa de lista de Haiku 5.5.

Concurrencia con el docx de 40 puntos (40 grupos), una corrida por valor y sin errores 429:

| A la vez | Tiempo |
|---|---|
| 4 | 26 s |
| 8 | 16 s |
| 16 | 10,5 s |

## Referencias del banco corregidas

El informe 02 §5.1 pide auditar la referencia con las salidas de los modelos. Hay cuatro cambios, cada uno con su motivo.

1. Numeración. La segmentación por oración cambió los números de unidad de los casos 01, 02 y 04. Cada unidad vieja pasó a las unidades nuevas que la componen, en el mismo mensaje.
2. 01-chat-grupo. La unidad 1 («buenas!») pasó de m1 a descartada. Es un saludo y ahora queda en una unidad aparte.
3. 03-monologo-prueba. El mensaje m9 mezclaba una falla con una pregunta. La falla es que el calendario no marca el lunes feriado y deja reprogramar sin avisar. La pregunta es la unidad 34, que el hablante marca como «pregunta para Joaquín». Eso viola la regla del banco de un punto atómico por mensaje. Quedó en m9 con las unidades 32, 33 y 35 (Error) y m10 con la 34 (Pregunta). El caso pasa de 9 a 10 mensajes.
4. 07-video-de-pantalla. El mensaje m4 acepta también el área y la plantilla Pregunta. El hablante dice «no sé si es un error o está pensado así».

Los cuatro cambios corrigen el input o la regla de la referencia. Ninguno toca el puntaje.

Una plantilla cambió con la corrección 3. `templates/feedback.md` conservaba toda opinión positiva. Ahora una confirmación sin nada que decidir ni responder («funciona bien, sin comentarios») queda descartada, como en la referencia. Una valoración positiva con un detalle que el equipo debe saber sigue siendo un mensaje.

## Lo que no está resuelto

03-monologo-prueba, cobertura 80 %:

- El punto que falla en las repeticiones es m7, el aviso por WhatsApp.
- El modelo a veces deja la unidad 27 como mensaje propio o la descarta. Dice «eso sería una funcionalidad aparte, no es de esta rama».
- La referencia la incluye en m7 porque acota el mismo punto. No se cambió: es una duda de juicio, no un error de la referencia.
- Con `medium` y pensamiento adaptativo el mismo caso daba 67 % y tardaba 26,7 s.

01-chat-grupo, MECE 2 de 3:

- En una repetición el mensaje del mapa en Safari quedó sin la unidad 4: «yo lo veo bien en mi iPhone, qué versión de iOS tienes?».
- La clasificación la descartó como pregunta de diagnóstico.

02-docx-40-puntos, 10,5 s:

- Son 16 llamadas a la vez. El pedido exceptúa este caso del objetivo de 10 s.
- La clasificación de área y plantilla es 92 %. Los errores son entre áreas vecinas: Error contra Retroalimentación en lo que «tarda» o «se ve mal».

Alcance de la medición:

- Una sola cuenta y una sola máquina. Los tiempos incluyen la red de un notebook.
- El límite de tasa de otra cuenta puede obligar a bajar `partitionConcurrency`.
