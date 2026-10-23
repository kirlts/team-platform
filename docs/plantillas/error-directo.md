---
name: Error directo
description: "Todo pedido de cambio del producto entra aquí. Se marca arreglable cuando la plataforma debía hacer algo y no lo hace, o lo hace distinto de lo acordado, y se corrige cambiando código o configuración sin una decisión de producto: una falla, un texto o un dato equivocado, una pantalla que se ve o responde mal."
fields:
  - { name: arreglable, label: "Arreglable por IA (sí, no o en parte)", required: true }
  - { name: motivo,     label: Por qué (una frase),                    required: true }
  - { name: actual,     label: Qué pasa,                               required: true }
  - { name: expected,   label: Qué se esperaba,                        required: true }
  - { name: where,      label: "Dónde (una pantalla, URL o dispositivo)", required: false }
output:
  - { name: cause,        label: Causa,            type: text, required: true }
  - { name: fix,          label: Arreglo,          type: text, required: false }
  - { name: verification, label: Verificación,     type: text, required: false }
  - { name: branch,       label: Rama,             type: text, required: false }
  - { name: files,        label: Archivos tocados, type: list, required: false }
---
## Método
Un mensaje por pedido. Todo pedido de cambio del producto entra en esta plantilla, también el que no se puede arreglar sin una persona: lo que decide qué se hace con él es el campo «Arreglable por IA».

Cómo llenar «Arreglable por IA»:
- «sí»: algo que ya existe o se acordó y no funciona como se espera (una falla, un texto o dato equivocado, una pantalla que se ve o responde mal, un rótulo, una validación), y que se corrige cambiando código o configuración sin elegir entre opciones de producto ni depender de otra persona.
- «no»: una idea o una funcionalidad nueva, una pregunta, una decisión de producto o de negocio, una gestión externa, algo que exige datos o credenciales que no están en el pedido, o una investigación de causas de negocio.
- «en parte»: una parte se corrige sola y otra necesita a una persona. El mensaje dice cuál es cada una.
«Por qué» es una frase con la razón del sí, del no o del en parte.

Cómo llenar el resto: «Qué pasa» es el resultado observado, con los textos de pantalla copiados literalmente entre comillas. «Qué se esperaba» es lo que la persona dice que debería ocurrir. «Dónde» es una sola pantalla, la que cambia. Lo que el input no da no se escribe ni se menciona.

Destinatarios: Claude recibe el mensaje cuando «Arreglable por IA» es «sí» o «en parte»; con «no» lo recibe quien conoce la pantalla o el tema.

## Formato de salida
Título: verbo en infinitivo y lugar, por ejemplo «Corregir rótulo del campo del número en el canal oficial». Describe el problema, no la causa ni la solución. Cuerpo: dos a cuatro frases con lo que pasa, cómo se llega y qué se esperaba; sin saludos ni relleno.

## Salida
Quien atiende este mensaje examina primero la situación: qué se pidió, el código, el historial reciente y lo que muestra producción. Si ya está resuelto o lo está en parte, lo dice con la evidencia y no cambia nada. Si hay algo que corregir, hace el cambio más pequeño que sirva, corre sólo las pruebas que ese cambio puede romper, pide una revisión aparte una sola vez sobre el cambio final y deja la rama. No toca código ni pruebas ajenos al pedido; si algo ajeno falla por el entorno, lo dice con la salida medida. Responde dos veces: al empezar y al terminar, la segunda en dos párrafos sin jerga dirigidos a quien lo pidió.
Causa: la que se midió, con el archivo o el dato que la muestra. Arreglo y Rama: sólo si hubo cambio. Verificación: el comando corrido y su resultado.
