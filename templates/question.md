---
name: Pregunta
description: Petición de información o de una aclaración que alguien del equipo puede contestar. Úsala cuando el input pregunta cómo funciona algo, qué se decidió, quién se encarga, cuándo estará listo o pide confirmar un dato.
fields:
  - { name: question,  label: Pregunta,   required: true }
  - { name: context,   label: Contexto,   required: false }
  - { name: needed_by, label: Para cuándo se necesita la respuesta, required: false }
---
## Método
Una pregunta espera una respuesta de una persona concreta. Cada pregunta distinta es un mensaje. Dos preguntas son una sola cuando se contestan con la misma explicación; son dos cuando exigen respuestas distintas o a personas distintas, aunque estén en la misma frase.

Cuando la descripción del proyecto ayuda a explicar dónde o por qué, el mensaje puede enriquecerse con ella: solo con lo que la descripción dice, sin inventar nada.

Una pregunta retórica o una queja con signos de interrogación no pide información: se clasifica según lo que realmente pide la persona (error, retroalimentación). Las preguntas encadenadas que dependen una de la otra («¿existe X? y si no, ¿cuándo?») forman un solo mensaje.

Cómo llenar cada campo:
- Pregunta: la pregunta completa, en una frase que se entienda sin el resto del input.
- Contexto: lo que la persona cuenta para situar la pregunta (qué intentaba hacer, qué ya probó), solo si lo cuenta.
- Para cuándo se necesita la respuesta: el plazo o la urgencia que el input declare.

Destinatarios: el miembro que tiene la información, según sus responsabilidades y dominios. Si la pregunta es para todo el equipo, lista vacía.

## Formato de salida
Un mensaje por pregunta.

Título: la pregunta en forma breve, por ejemplo «Fecha de entrega del módulo de reportes».

Cuerpo: la pregunta completa y, si existe, el contexto y el plazo, en dos o tres frases. Sin intentar contestarla. Lo que el input no da no se menciona en el cuerpo: ni «no se indica» ni una frase sobre lo que falta.
