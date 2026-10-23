---
name: Error directo v2
description: "Pedido de cambio de un producto ya construido. Se marca arreglable cuando algo que existe o se acordó falla, se ve mal, dice algo equivocado o calcula mal, y se corrige de una sola manera comprobable, sin elegir entre opciones de producto ni depender de otra persona. Lo demás (capacidades nuevas, reglas de negocio, ideas, preguntas, gestiones externas) entra igual y se marca para una persona."
fields:
  - { name: tipo,       label: "Tipo (falla, texto, dato, cálculo, pantalla, capacidad nueva, regla, permisos, servicio externo, pregunta, idea)", required: true }
  - { name: bloqueo,    label: "Qué impide el sí (nada, opciones, regla de negocio, dato faltante, servicio externo, capacidad nueva, decisión previa)", required: true }
  - { name: arreglable, label: "Arreglable por IA (sí, no o en parte)",   required: true }
  - { name: motivo,     label: Por qué (una frase),                       required: true }
  - { name: actual,     label: Qué pasa,                                  required: true }
  - { name: expected,   label: Qué se esperaba,                           required: true }
  - { name: where,      label: "Dónde (una pantalla, URL o dispositivo)", required: false }
output:
  - { name: cause,        label: Causa,            type: text, required: true }
  - { name: zone,         label: Zona tocada,      type: text, required: true, enum: [ninguna, pagos, datos de personas, migración de datos, servicio externo, permisos] }
  - { name: fix,          label: Arreglo,          type: text, required: false }
  - { name: verification, label: Verificación,     type: text, required: false }
  - { name: branch,       label: Rama,             type: text, required: false }
  - { name: files,        label: Archivos tocados, type: list, required: false }
---
## Método
Un mensaje por pedido. Todo pedido de cambio entra en esta plantilla, también el que no se puede arreglar sin una persona: lo que decide quién lo atiende es el campo «Arreglable por IA».

Un texto con varios pedidos se parte en un mensaje por pedido. Un pedido que mezcla una falla con una capacidad nueva se parte en dos: el primero se evalúa solo, el segundo va con «no».

Orden de llenado: primero «Tipo», luego «Qué impide el sí», y recién después «Arreglable por IA». El veredicto sale de las dos primeras respuestas.

Cómo llenar «Arreglable por IA»:
- «sí» exige cinco condiciones a la vez.
  1. Existe: habla de algo que ya está en el producto o se acordó entregar, y falla, se ve mal, dice algo equivocado o calcula mal. Una falla, un texto o rótulo, un dato, un cálculo, una validación o una pantalla que no responde cumplen esta condición.
  2. Observado: cuenta qué ocurre o qué se ve (el texto de pantalla, el valor, el paso donde pasa), no sólo qué se quiere.
  3. Una sola salida: lo esperado es una cosa que se puede comprobar. No hay que elegir entre caminos («o bien», «quizá», «podría ser»), ni fijar una regla de negocio (precio, descuento, abono, plazo, quién puede qué).
  4. Autocontenido: no depende de un archivo, una cuenta, una credencial o una respuesta que debe entregar otra persona, ni del comportamiento de un servicio externo (mensajería, calendario, pagos, correo).
  5. Sin choque con lo decidido: no pide cambiar algo que una decisión ya tomada fijó, ni dice que un cambio anterior «no quedó como se pidió» sin decir en qué.
- «no»: una capacidad que nunca existió («agregar», «que haya», «la posibilidad de»), una idea, una opinión sobre algo que funciona como se diseñó, una pregunta, una regla de negocio, una gestión externa, o un pedido que depende de un dato o archivo que no está.
- «en parte»: una parte cumple las cinco condiciones y otra no, o hay un solo punto dudoso. Dos casos fijos: el reclamo de que algo falta o no se encuentra (puede existir sin rótulo o sin ubicación claros) y el reclamo de que algo se perdió o no quedó como se pidió (puede chocar con una decisión). El mensaje dice cuál es cada parte.
- La duda se resuelve hacia el lado que envía a una persona: entre «sí» y «en parte», «en parte»; entre «en parte» y «no», «no».

«Qué impide el sí» lleva «nada» sólo cuando «Arreglable por IA» es «sí». «Por qué» es una frase con la razón del veredicto; nombra la condición que decidió.

Cómo llenar el resto: «Qué pasa» es el resultado observado, con los textos de pantalla copiados literalmente entre comillas. «Qué se esperaba» es lo que la persona dice que debería ocurrir; si sólo se queja, el comportamiento que su queja implica, en una frase. «Dónde» es una sola pantalla, la que cambia. Lo que el input no da no se escribe ni se menciona.

Destinatarios: Claude recibe el mensaje cuando «Arreglable por IA» es «sí». Con «en parte» o «no» lo recibe quien conoce la pantalla o el tema.

## Formato de salida
Título: verbo en infinitivo y lugar, por ejemplo «Corregir rótulo del campo de título en la pantalla de ajustes». Describe el problema, no la causa ni la solución. Cuerpo: dos a cuatro frases con lo que pasa, cómo se llega y qué se esperaba; sin saludos ni relleno.

## Salida
Quien atiende este mensaje examina primero la situación, sin cambiar nada: qué se pidió, el código, el historial reciente, lo que muestra producción y el registro de decisiones. Tres comprobaciones fijas antes de tocar código.
1. Si ya está resuelto, o la capacidad ya existe y sólo falta ubicarla o rotularla, lo dice con la evidencia. Cambia, como máximo, el rótulo o la ubicación.
2. Si una decisión registrada respalda el comportamiento actual, o el pedido exige elegir entre opciones, termina en «needs_decision» con la pregunta en una línea y no cambia nada.
3. Si el síntoma tiene una causa más general (la misma falla en varias pantallas o en varios pedidos abiertos), arregla la causa y lo dice.

Si hay algo que corregir, hace el cambio más pequeño que sirva y empieza por una prueba que falla con el comportamiento actual. Corre sólo las pruebas que el cambio puede romper, pide una revisión aparte una sola vez sobre el cambio final y deja la rama. No toca código ni pruebas ajenos al pedido; si algo ajeno falla por el entorno, lo dice con la salida medida.

Límites que detienen el trabajo: si el arreglo exige tocar más de 8 archivos de código, una pantalla nueva o una tabla nueva, el pedido era mayor de lo marcado; devuelve la rama con lo hecho y termina en «investigated» o «needs_decision».

«Zona tocada» registra la zona más delicada que el cambio toca. Con cualquier valor distinto de «ninguna», la rama espera la revisión de una persona antes de fusionarse; con «ninguna», sigue el flujo normal. Un cambio de pagos, de datos de personas, de migración de datos, de un servicio externo o de permisos nunca se fusiona sin esa revisión.

Responde dos veces: al empezar y al terminar, la segunda en dos párrafos sin jerga dirigidos a quien lo pidió.
Causa: la que se midió, con el archivo o el dato que la muestra. Arreglo y Rama: sólo si hubo cambio. Verificación: el comando corrido y su resultado.
