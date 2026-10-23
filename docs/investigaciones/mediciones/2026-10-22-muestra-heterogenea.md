# Muestra heterogénea de diez envíos reales

Fecha: 2026-10-22 y 2026-10-23. Instancia de un cliente, Sonnet 5.5 en texto y visión, Groq `whisper-large-v3-turbo` en voz. Los materiales y su evaluación están en `bench/private/muestra-10/` (fuera de git); aquí sólo cifras agregadas.

## Muestra

| Tipo | Elementos |
|---|---|
| Video | 2 (15,6 s y 180 s; 3 MB y 187 MB) |
| Audio | 3 (51 s, 118 s y 107 s con captura y texto) |
| Captura | 2 (una con el pedido escrito dentro de la imagen, una marcada a mano sin texto) |
| Documento de errores (.docx) | 2 (720 y 1.867 palabras; con 0 y 16 imágenes) |
| Conversación exportada (.txt) | 1 (22 KB) |

El audio con captura y texto es el envío mixto. Cada elemento se subió como un envío. Los diez entraron en 25 segundos, no de a dos o tres: el script de subida salió tras enviar sin esperar el análisis. No hubo fallos de extracción ni de formato.

## Tiempo y costo del análisis

| Medida | Valor |
|---|---|
| Envíos analizados | 10 de 10 |
| Cola antes de empezar | 0,03 a 2,4 s, y 23 s en el video de 187 MB |
| Análisis | de 19 s (audio de 51 s) a 384 s (video de 3 min); mediana 50 s |
| Costo por envío | de 0,09 a 0,85 USD; total 2,97 USD (Sonnet 5.5, calculado desde los tokens de la traza) |
| Mensajes generados | 72 (de 1 a 35 por envío) |
| Reintentos de la cola | 1 envío con 3 intentos (el audio mixto, 98 s en total contra 49 s de análisis) |

El costo sigue al texto y no al peso del archivo. El documento de 1.867 palabras y la reunión de 22 KB cuestan 0,85 y 0,84 USD. El video de 187 MB cuesta 0,31 USD.

## Calidad de la descomposición

Referencia hecha aparte: cada material se leyó o transcribió de nuevo (faster-whisper `medium`, fotogramas cada 3 s, pandoc) y se listaron los pedidos reales. Criterio de `bench/private/envio-33/coherencia.md`.

| Medida | Valor |
|---|---|
| Pedidos reales | 94 |
| Recogidos solos en su mensaje | 42 (45 %) |
| Mezclados con otros en un mensaje | 39 (41 %) |
| Enterrados en el cuerpo de otro | 11 (12 %) |
| Perdidos | 2 (2 %) |
| Cobertura (solos, mezclados o enterrados) | 98 % |
| Mensajes totales | 72 |
| Mensajes sin pedido que los respalde | 10 (2 inventados desde lo que sólo se ve, 8 sobrantes: promesas del autor, decisiones ya tomadas o elogios hechos tarea) |
| Notas 1 a 5 por envío | 2 a 4; mediana 3 |

Un pedido nacido de un fotograma (envío 33) sólo persiste sin texto ni voz: la captura marcada a mano.

## Los tres defectos más graves

1. **Pedidos fundidos.** 39 de 94 pedidos comparten mensaje, sobre todo en los documentos. Uno de 18 pedidos sale en 2 mensajes y uno de 41 deja 14 mezclados. Con voz casi no ocurre: en los documentos los pedidos contiguos se juntan.
2. **Contexto hecho tarea y duplicados.** 8 mensajes sin pedido y pares con el mismo pedido, en la reunión y en el documento largo. La regla 7 prohíbe descartar un compromiso de entrega, y el modelo la aplica también a la promesa del propio autor.
3. **Referencias cruzadas sin respaldo.** El bloque de envíos recientes (UD-025) puso en 5 de 10 envíos la línea «Continúa el envío de las hh:mm» hacia otro sin relación. Un audio sobre un calendario se enlazó con uno sobre un widget. Es el defecto arreglado abajo.

Otros hallazgos, sin arreglo en esta rama:

| Hallazgo | Causa medida | Estado |
|---|---|---|
| Destinatario sin respaldo en lo dicho: 39 mensajes a una persona, 22 al miembro agente, 10 a otra, 1 a otra más; el autor casi nunca nombra a nadie (en el documento largo, 30 de 35 sin respaldo) | Tres de los cuatro miembros de la instancia tienen el perfil vacío; la regla «al menos un responsable» (H-86) asigna al más cercano | Configuración de la instancia: llenar los perfiles. No se toca la regla medida en H-86 |
| Una captura marcada a mano, sin texto, produce 2 mensajes (uno Error con seis anomalías del fotograma) | Con un adjunto como única fuente, no hay pedido dicho y el modelo describe lo visible | Decisión de producto pendiente: un mensaje de aclaración en lugar de un Error |
| Pedido perdido en un audio por un error de transcripción («inmóvil» por «en móvil») | Groq | Sin arreglo en el analizador |
| Un cuerpo afirma lo que el autor no dijo (resultado esperado armado desde la pantalla, pasos de reproducción inventados) | Campos de la plantilla de Error se rellenan siempre | Pendiente |

## Ejecución en la instancia del cliente

22 mensajes quedaron asignados al miembro agente y 22 trabajos `execute` fallaron. 21 fallaron al crear la máquina (cuota de núcleos de la nube) y 1 por el tiempo máximo de 3.630 s. Ninguno llegó a producción. Es conducta del arnés y no cuenta contra el análisis. El commit `4922f96` hace que, sin capacidad, el trabajo espere.

## Arreglo

Cambio: el bloque de envíos recientes pide la línea de continuación sólo si el punto es el mismo pedido (misma pantalla, mismo cambio). Compartir producto, área, tema o momento no basta. Archivos: `src/analyze/prompts-es.js`, `src/analyze/prompts-en.js`; prueba en `src/analyze/members-prompt.test.js`.

Medición con los mismos diez elementos, repetidos (18 corridas de elemento por variante, con los otros nueve como envíos recientes):

| Variante | Corridas con referencia cruzada | Referencias cruzadas | Mensajes (10 elementos, una corrida) |
|---|---|---|---|
| `main` | 11 de 18 | 24 | 79 |
| Rama | 3 de 18 | 6 | 80 |

Las 6 restantes unen envíos del mismo tema (dos envíos sobre el mismo widget). Pedidos y mensajes no cambian. Modelo y razonamiento por omisión intactos (UD-260). El costo de las corridas es de unos 0,3 USD por variante.

Límite de la medición: las corridas repiten el análisis con el texto ya extraído, sin voz ni imágenes. Los mensajes varían entre corridas del mismo elemento: el envío mixto sale con 2 a 4 y la reunión con 20, 29 y 23.
