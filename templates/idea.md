---
name: Idea
description: Ocurrencia o propuesta de mejora que se comparte para pensarla, sin pedir que se construya ahora ni reportar una falla. Úsala cuando el input dice «y si…», «se me ocurre», «podríamos» o plantea una alternativa sin urgencia ni compromiso.
fields:
  - { name: idea,       label: La idea,                     required: true }
  - { name: motivation, label: Qué problema o ganancia hay detrás, required: true }
  - { name: reference,  label: Ejemplo o referencia,        required: false }
output:
  - { name: findings,       label: Hallazgos,               type: list, required: true }
  - { name: recommendation, label: Recomendación,           type: text, required: true }
  - { name: effort,         label: Esfuerzo,                type: text, required: true, enum: [bajo, medio, alto] }
---
## Método
Una idea es una propuesta abierta: nadie dice que haya que hacerla ya. Cada idea distinta es un mensaje. Dos ideas son la misma cuando resuelven el mismo problema por el mismo camino; son distintas cuando resuelven problemas distintos o toman caminos incompatibles, aunque se mencionen juntas.

Cuando la descripción del proyecto ayuda a explicar dónde o por qué, el mensaje puede enriquecerse con ella: solo con lo que la descripción dice, sin inventar nada.

Si dentro de un mismo párrafo la persona propone algo y justifica por qué, ambas partes sostienen un solo mensaje. Una justificación que apoya a dos ideas distintas se cita en la idea principal y se nombra en la otra.

Cómo llenar cada campo:
- La idea: lo que se propone, en una o dos frases, sin adornos.
- Qué problema o ganancia hay detrás: la razón que la persona da. Si no la da, escribe la que su propio texto deja ver; si no deja ver ninguna, «No indicado».
- Ejemplo o referencia: un producto, una pantalla, un enlace o un adjunto que la persona cita como modelo.

Destinatarios: quien decide o tiene a cargo el área que la idea toca, según sus responsabilidades. Si la idea afecta a todo el equipo o al proceso y ningún miembro corresponde en particular, lista vacía.

Una propuesta que dice «hagan X» con plazo o con una necesidad concreta no es una idea sino un pedido de funcionalidad. Una duda sobre algo que existe es una pregunta.

## Formato de salida
Un mensaje por idea.

Título: sustantivo o verbo en infinitivo que nombre la idea, por ejemplo «Agrupar los mensajes por día».

Cuerpo: dos o tres frases: qué se propone, para qué serviría y, si existe, el ejemplo que la persona dio. Sin evaluar la idea ni agregar opiniones propias. Lo que el input no da no se menciona en el cuerpo: ni «no se indica» ni una frase sobre lo que falta.

## Salida
Hallazgos: lo que se encontró al investigar, una línea por hallazgo, con su fuente. Recomendación: hacerla, no hacerla o probarla, en una frase. Esfuerzo: bajo, medio o alto.
