---
name: Reporte de error
description: Algo que antes funcionaba o debería funcionar y no lo hace. Úsala cuando el input cuenta una falla, un resultado incorrecto, un dato o un texto equivocado, una pantalla que se ve o se comporta mal respecto de lo acordado, o una función que tarda mucho más de lo razonable.
fields:
  - { name: steps,    label: Pasos para reproducir, required: true }
  - { name: expected, label: Qué se esperaba,       required: true }
  - { name: actual,   label: Qué pasó,              required: true }
  - { name: where,    label: "Dónde (pantalla, URL, versión o dispositivo)", required: false }
  - { name: impact,   label: A quién afecta o qué bloquea, required: false }
---
## Método
Un error es una conducta del producto distinta de la esperada. Cuenta como error distinto todo lo que difiera en la pantalla, en la acción que lo dispara o en el resultado observado. La misma falla vista en dos pantallas es un solo error cuando la persona la describe como un problema; son dos cuando los describe por separado.

Cuando la descripción del proyecto ayuda a explicar dónde o por qué, el mensaje puede enriquecerse con ella: solo con lo que la descripción dice, sin inventar nada.

Una captura, un video o un audio puede mostrar dos fallas. En ese caso el adjunto acompaña a ambos mensajes (va en attachment_ids de los dos), pero las unidades que describen cada falla van cada una al mensaje de su falla.

Cómo llenar cada campo:
- Pasos para reproducir: lo que la persona hizo antes de la falla, en orden. En una transcripción o en la descripción de un video, las acciones narradas o mostradas, con su marca de tiempo si existe. Si la persona no cuenta los pasos, escribe los que se deducen del contexto y nada más.
- Qué se esperaba: lo que la persona dice que debería ocurrir. Si solo se queja, el comportamiento que su queja implica, dicho en una frase.
- Qué pasó: el resultado observado. Los mensajes de error y los textos de pantalla se copian literalmente, entre comillas.
- Dónde: pantalla, URL, versión, navegador, dispositivo o sistema operativo, solo los que el input menciona o que se ven en una captura.
- A quién afecta o qué bloquea: solo si el input lo dice (un cliente, todo el equipo, un flujo que no se puede completar).

Destinatarios: los miembros cuyos dominios incluyen la pantalla, el componente o el servicio donde ocurre la falla. Si el input nombra a alguien, esa persona.

No cuentan como error: un deseo de que el producto haga algo que nunca hizo (pedido de funcionalidad), una opinión sobre algo que funciona como se diseñó (retroalimentación) ni una duda sobre cómo se usa algo (pregunta).

## Formato de salida
Un mensaje por error.

Título: verbo en infinitivo y lugar, por ejemplo «Corregir pantalla en blanco al ingresar con correo». Describe el problema, no la causa supuesta ni la solución.

Cuerpo: dos a cuatro frases en este orden: qué falla y dónde, cómo se llega a la falla, qué se esperaba y el impacto; cada parte va solo si el input la da, y si no la da no se escribe nada sobre ella. Sin saludos ni relleno. Lo que el input no da no se menciona en el cuerpo: ni «no se indica» ni una frase sobre lo que falta.
