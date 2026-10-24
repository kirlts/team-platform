---
name: Pedido de funcionalidad
description: Pedido explícito de que el producto haga algo que hoy no hace, con una necesidad concreta detrás. Úsala cuando el input dice «necesitamos», «hay que agregar», «falta que», o describe cómo debe ser algo que todavía no existe (un widget, una pantalla, un informe) y quien escribe espera que se construya, con o sin plazo.
fields:
  - { name: need,       label: Necesidad,                       required: true }
  - { name: request,    label: Qué debería hacer el producto,   required: true }
  - { name: users,      label: Quién lo necesita,               required: false }
  - { name: acceptance, label: Cómo se sabrá que está listo,    required: false }
output:
  - { name: built,        label: Qué se construyó,          type: text, required: false }
  - { name: verification, label: Verificación,              type: text, required: false }
  - { name: branch,       label: Rama,                      type: text, required: false }
  - { name: pending,      label: Pendiente,                 type: list, required: false }
---
## Método
Un pedido de funcionalidad es un comportamiento nuevo que alguien espera. Cada capacidad distinta es un mensaje. Dos pedidos son uno solo cuando no se pueden entregar por separado sin que el primero deje de servir; son dos cuando cada uno se puede construir y usar sin el otro.

Cuando la descripción del proyecto ayuda a explicar dónde o por qué, el mensaje puede enriquecerse con ella: solo con lo que la descripción dice, sin inventar nada.

Una lista de requisitos en viñetas puede traer un pedido por viñeta cuando cada uno se puede decidir, asignar o entregar por separado. Los pasos, requisitos, criterios o restricciones de UNA misma funcionalidad (el botón, la pantalla, la validación, el vencimiento, el registro de quién la usó, el navegador donde debe andar) son una sola pieza: un mensaje, con la lista en su cuerpo. Un requisito que solo precisa a otro (un formato, un límite, un caso borde) pertenece al mensaje del pedido que precisa. Separa por capacidad, no por línea. En la duda, menos mensajes.

Cómo llenar cada campo:
- Necesidad: el problema o la tarea que hoy no se puede resolver, tal como la persona lo cuenta.
- Qué debería hacer el producto: el comportamiento pedido, en términos observables: quién hace qué y con qué resultado.
- Quién lo necesita: el rol, el cliente o el equipo que lo usaría, solo si el input lo dice.
- Cómo se sabrá que está listo: criterios que el input mencione (un formato, un plazo, un ejemplo de resultado). Un plazo o una fecha comprometida se conserva siempre, tal como el input la dice. No inventes criterios.

Destinatarios: los miembros cuyos dominios incluyen la parte del producto que cambiaría. Si el input nombra a alguien, esa persona.

Si la persona describe algo que ya existe pero falla, es un error. Si propone sin pedir que se construya, es una idea. Si pregunta si algo se puede hacer, es una pregunta.

## Formato de salida
Un mensaje por funcionalidad.

Título: verbo en infinitivo y objeto, por ejemplo «Exportar el listado de mensajes a CSV».

Cuerpo: dos o tres frases: la necesidad y lo que el producto debería hacer; quién lo necesita y los criterios de listo van solo si el input los da, y si no los da no se escribe nada sobre ellos. Sin proponer diseño ni tecnología que el input no mencione. Lo que el input no da no se menciona en el cuerpo: ni «no se indica» ni una frase sobre lo que falta. Cuando la persona describió la funcionalidad en pasos, requisitos o criterios numerados, el cuerpo los conserva como lista, tal como los escribió.

## Salida
Qué se construyó: el comportamiento nuevo, en términos observables. Verificación: el comando corrido y su resultado. Pendiente: lo que falta del pedido, una línea por punto.
