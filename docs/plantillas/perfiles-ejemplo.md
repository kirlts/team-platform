# Perfiles de ejemplo

Cuatro perfiles de miembro (UD-023) para un equipo que atiende pedidos de un producto médico con un agente de IA. Los dos primeros se probaron con el analizador. Acertó el destinatario en 91 de 96 y 92 de 96 pedidos, en dos corridas. Con un perfil de una línea por miembro acertó 77 de 96. Los dos últimos son propuestas: cada persona escribe el suyo.

Las funciones («el fundador», «el socio comercial», «el doctor») se reemplazan por los nombres de los miembros. Cada persona edita su perfil con `PATCH /members/me`. Quien crea al miembro puede fijarlo con `POST /members`. El tope es `config.members.profileMaxLength` (4.000 caracteres).

## Dueño del producto

2531 caracteres. Se escribe en primera persona porque el analizador lo lee entero y es lo único que sabe de la persona.

```text
Soy el fundador y el único ingeniero del producto, un sistema para clínicas con una asistente de conversación para pacientes. Programo conversando con IA, así que escribir código no me cuesta. Lo escaso es mi atención. Trabajo con varias sesiones a la vez, leo en diagonal y muchas veces desde el teléfono. Tomo decisiones; no reviso planes ni informes.

Un pedido me corresponde cuando mi respuesta cambia lo que se hace. Me corresponde el dinero: cobros, precios, planes y todo gasto nuevo de infraestructura o del modelo. Los topes de gasto que ya fijé no se me consultan. También los datos de pacientes: qué se guarda, quién los ve, qué se mueve o se borra. Me corresponde lo que no se puede deshacer: una migración, un borrado, la configuración real de una clínica en producción. Me corresponde lo que llega a una persona real: mensajes, correos y accesos. Me corresponde el alcance acordado con el cliente: qué se construye, qué se cotiza aparte y qué se descarta. Me corresponde lo ambiguo que admite dos respuestas, si ninguna regla escrita decide y equivocarse cuesta más que un minuto de deshacer. Me corresponde todo pedido que Claude no atiende: ideas, preguntas, decisiones, capacidades nuevas y gestiones externas. Me corresponde lo que depende de un tercero: un servicio externo, un permiso o un archivo que debe entregar otra persona. Me corresponde un incidente que afecta ahora a pacientes o clínicas reales y exige a una persona.

No me corresponde lo que otra sesión resuelve sola. Un error con causa y arreglo evidentes en una pantalla lo arregla Claude sin pasar por mí. Son errores un rótulo, un texto o un dato equivocado, un botón que no hace lo que dice y una vista mal dibujada. Si un pedido mezcla un arreglo con una decisión mía, se parte: el arreglo lo hace Claude y la decisión me llega. Tampoco me corresponde un pedido ya arreglado o ya decidido: basta citar el arreglo o la decisión. Tampoco un hallazgo al pasar. Si un pedido del socio comercial choca con una decisión mía anterior, el pedido me llega: manda lo del socio comercial y yo registro la decisión nueva. Los textos que el socio comercial o el doctor pidieron palabra por palabra no se discuten.

Cuando algo sí llega a mí, quiero una pregunta de una línea. Lleva una recomendación y lo que pasa si me equivoco. Si solo necesito poner mis manos (mi clave, mi sesión), quiero un comando listo para pegar. No quiero listas de pendientes ni el relato de cómo se investigó. Una sospecha sin investigar no me llega: antes se intenta refutar.
```

## Agente Claude

2768 caracteres. Es el perfil del miembro que recibe los mensajes con «Arreglable por IA» en «sí» o «en parte» (plantilla «Error directo»).

```text
Soy Claude, el agente de ingeniería del producto. Trabajo una sesión desatendida sobre el código y la configuración del producto, bajo las reglas del repositorio.

Atiendo solo lo que ya existe o se acordó y falla, se ve mal, dice algo equivocado o calcula mal. Debe corregirse de una sola manera comprobable, sin elegir entre opciones ni fijar una regla de negocio. Tampoco puede depender de un archivo, una cuenta o una respuesta de otra persona, ni de un servicio externo. Atiendo textos, rótulos y datos equivocados, validaciones, botones que no hacen lo que dicen y pantallas que se ven o responden mal. Todo reporte del socio comercial, del doctor o de una clínica lo trato primero como una falla del sistema. Lo reproduzco antes de contestar «funciona».

Nunca atiendo ideas, preguntas, decisiones, capacidades nuevas ni gestiones externas. Esos pedidos son de una persona. Si un pedido mezcla una falla con una capacidad nueva, atiendo solo la falla. Un texto que la clínica pidió palabra por palabra lo dejo como lo pidió. Si lo que pide el socio comercial choca con una decisión escrita anterior, no cambio nada y lo dejo al fundador.

Primero examino la situación sin cambiar nada: el pedido, el código, el historial reciente, producción y el registro de decisiones. Si ya está resuelto, muestro la evidencia. Si una decisión registrada respalda el comportamiento actual, termino con la pregunta en una línea. Si hay algo que corregir, hago el cambio más pequeño que sirva y corro solo las pruebas que ese cambio puede romper. Pido una revisión independiente una vez; si el cambio dibuja una pantalla, el veredicto es de un juez distinto de mí. Si el arreglo exige más de 8 archivos, una pantalla o una tabla nuevas, devuelvo la rama con lo hecho y lo digo. Las conversaciones se prueban solo por el simulador.

Nunca gasto dinero ni comprometo un pago. Nunca cambio cobros, precios ni planes. No borro ni muevo datos de pacientes sin una reversa escrita y probada. No toco la configuración real de una clínica más allá de lo que su evidencia pide. No envío correos, avisos ni accesos a personas reales que nadie pidió. Si el código calcula mal un cobro, lo corrijo y aviso al fundador.

Empujo mi rama de trabajo y no empujo a main. La entrega a producción la hace después un trabajo aparte, sin IA, y no la espero. Respondo dos veces: al empezar, y al terminar en dos párrafos sin jerga dirigidos a quien hizo el pedido. Si falta un permiso, un acceso o un archivo ajeno, declaro lo que falta y avanzo en todo lo demás. Un límite que declaro lleva el comando que corrí y lo que respondió. Sin eso es trabajo que me falta.
```

## Socio comercial (a confirmar con la persona)

634 caracteres. Propuesta mínima: los datos permiten el rol y los temas, no cómo quiere ser atendido ni reportado.

```text
Soy el socio comercial que encarga el producto. Uso el panel con las clínicas y reporto lo que veo en pantalla. Reporto errores de la agenda, de las conversaciones, de la ficha, de los roles, de los estados del paciente y de cómo habla la asistente. Quiero que lo que reporto se arregle pronto y se vea en la pantalla.

Me corresponde poner en marcha el producto en una clínica. Eso incluye el canal de WhatsApp con Meta y el proveedor y el alta de clínicas nuevas. También lo que se conversa con el cliente sobre alcance. Me pueden preguntar cómo debe verse o sentirse una pantalla. El código y la infraestructura no me corresponden.
```

## Médico (a confirmar con la persona)

471 caracteres. Propuesta mínima por la misma razón.

```text
Soy médico, dueño de una clínica que usa el producto, y financio el proyecto. No soy técnico. Reporto lo que veo en la consulta: la receta, las citas, los boxes, el pabellón y los antecedentes clínicos. También reporto lo que la asistente les dice a mis pacientes.

Solo yo sé los hechos clínicos de mi práctica. Esos sí me los pueden preguntar, de a una o dos preguntas, en lenguaje de consulta. No me pregunten por el código, los textos de pantalla ni la configuración.
```

## Prueba

Se crearon en una instancia de prueba dos miembros personas con los perfiles del dueño y del agente, más un remitente sin responsabilidades. Cada pedido entró como texto en el área «Error directo», sin publicación automática. Se leyó la propuesta del análisis. Un pedido acierta si los destinatarios del mensaje son exactamente los esperados. Un pedido de ruido acierta si el análisis lo descarta.

Los destinatarios esperados salen de las reglas escritas del cliente. Claude recibe solo lo arreglable. El dueño recibe lo que cambia dinero, datos de pacientes, algo irreversible, el alcance o a una persona real. Lo que se deshace en minutos lo decide el agente y lo avisa.

| Banco | Contenido |
|---|---|
| Ajuste (20) | 7 arreglables, 7 que necesitan decisión, 3 ideas y 3 preguntas. Sirvió para ajustar el texto. |
| Ciego (23) | Casos tomados de pedidos reales ya resueltos. Se ajustó con él después de la primera lectura. |
| Límites A (18) y B (17) | Casos que un perfil de una línea no resuelve: decisiones chicas reversibles, ajustes contradichos, hallazgos al pasar, errores que afectan cobros, pacientes afectados ahora y ruido. A sirvió para ajustar; B, en dos casos. |
| Posterior (18) | Redactado después, con voz de mensaje de voz transcrito y pedidos de dos puntos. No se ajustó con él. |

| Banco | Pedidos | Perfil de una línea | Perfil final, corrida 1 | Perfil final, corrida 2 |
|---|---|---|---|---|
| Ajuste | 20 | 18/20 | 19/20 | 20/20 |
| Ciego | 23 | 19/23 | 20/23 | 21/23 |
| Límites A | 18 | 14/18 | 18/18 | 17/18 |
| Límites B | 17 | 11/17 | 17/17 | 16/17 |
| Posterior | 18 | 15/18 | 17/18 | 18/18 |
| Total | 96 | 77/96 | 91/96 | 92/96 |

La tabla mide una versión anterior de los textos contra la plantilla «Error directo» original, donde Claude recibe también los pedidos «en parte». Los textos de este documento reflejan la plantilla «Error directo v2»: Claude recibe solo los «sí», y las ideas, preguntas, decisiones y gestiones externas son de una persona. Esa versión se midió una vez. Los bancos Ajuste, Límites A y Posterior se reetiquetaron con ese criterio. Acertó el destinatario en 50 de 54 pedidos. Fallaron cuatro. Una pregunta de estado fue a Claude. Claude tomó una idea chica como arreglo. Un error de apagado de canal no llegó a Claude. Un pedido sumó al socio comercial.

Un perfil de una línea ya resuelve los casos claros, porque la plantilla y el modelo los separan solos. El perfil mueve los casos de borde. Son las decisiones chicas que no necesitan al dueño y los errores que mezclan dinero con código. También los pacientes afectados ahora y las preguntas cuya respuesta ya está escrita. Entre corridas del mismo perfil hay una diferencia de 1 a 2 pedidos por banco.

## Evidencia

Cada frase lleva su fuente. Tipo: T, palabras del dueño citadas en la fuente; W, regla o procedimiento escrito; I, inferida sin frase del dueño. Las líneas son las de las fuentes al 2026-10-23. Las fuentes del cliente se citan sin nombre propio: reglas, decisiones (D-nnn) y memorias (Mnn y Gnn, con la leyenda al final).


### Dueño del producto

| Frase | Fuente | Tipo |
|---|---|---|
| Soy el fundador y el único ingeniero del producto, un sistema para clínicas con una asistente de conversación para pacientes. | reglas del repositorio del cliente, l. 20-24; criterio de delegación del dueño (procedimiento), l. 3-4 | W |
| Programo conversando con IA, así que escribir código no me cuesta. | reglas del repositorio del cliente, l. 20-22 | T |
| Lo escaso es mi atención. | reglas del repositorio del cliente, l. 22-24; criterio de delegación del dueño (procedimiento), l. 978 | TW |
| Trabajo con varias sesiones a la vez, leo en diagonal y muchas veces desde el teléfono. | preferencias globales del dueño, l. 13-15; memoria del repositorio del cliente M01 l. 11-24 | T |
| Tomo decisiones; no reviso planes ni informes. | reglas del repositorio del cliente, l. 382; criterio de delegación del dueño (procedimiento), l. 943; memoria personal del dueño G02 l. 13-17 | T |
| Un pedido me corresponde cuando mi respuesta cambia lo que se hace. | reglas del repositorio del cliente, l. 382-383; criterio de delegación del dueño (procedimiento), l. 944-946 | T |
| Me corresponde el dinero: cobros, precios, planes y todo gasto nuevo de infraestructura o del modelo. | reglas del repositorio del cliente, l. 460; decisiones del cliente, l. 3997-3999 (D-130); decisiones del cliente, l. 5274-5280 (D-160); criterio de delegación del dueño (reglas), l. 676 | TW |
| Los topes de gasto que ya fijé no se me consultan. | memoria del repositorio del cliente M03 l. 25-27 | T |
| También los datos de pacientes: qué se guarda, quién los ve, qué se mueve o se borra. | reglas del repositorio del cliente, l. 144; decisiones del cliente, l. 3997-3998 (D-130); decisiones del cliente, D-240; criterio de delegación del dueño (reglas), l. 516-520 | TW |
| Me corresponde lo que no se puede deshacer: una migración, un borrado, la configuración real de una clínica en producción. | reglas del repositorio del cliente, l. 398-400; decisiones del cliente, l. 3999-4000 (D-130); memoria del repositorio del cliente M04 l. 11-15; criterio de delegación del dueño (reglas), l. 522-527 | T |
| Me corresponde lo que llega a una persona real: mensajes, correos y accesos. | memoria del repositorio del cliente M05 l. 8-12; criterio de delegación del dueño (reglas), l. 638-657 | T |
| Me corresponde el alcance acordado con el cliente: qué se construye, qué se cotiza aparte y qué se descarta. | reglas del repositorio del cliente, l. 15-17; decisiones del cliente, D-208, D-212, D-189, D-191; memoria del repositorio del cliente M06 l. 11-18 | TW |
| Me corresponde lo ambiguo que admite dos respuestas, si ninguna regla escrita decide y equivocarse cuesta más que un minuto de deshacer. | reglas del repositorio del cliente, l. 398-401; criterio de delegación del dueño (procedimiento), l. 957-973 | T |
| Me corresponde todo pedido que Claude no atiende: ideas, preguntas, decisiones, capacidades nuevas y gestiones externas. | plantilla «Error directo», v2 l. 42 (Destinatarios) y 34 (cuándo es «no»); decisiones de esta plataforma, UD-259 | TW |
| Me corresponde lo que depende de un tercero: un servicio externo, un permiso o un archivo que debe entregar otra persona. | criterio de delegación del dueño (reglas), l. 638-657; criterio de delegación del dueño (procedimiento), l. 957-961; decisiones del cliente, D-244 (cliente OAuth y verificación a cargo del dueño; fila 1 de X) | ITW |
| Me corresponde un incidente que afecta ahora a pacientes o clínicas reales y exige a una persona. | memoria del repositorio del cliente M07 l. 11-15; decisiones del cliente, D-144, condición de reversión | TW |
| No me corresponde lo que otra sesión resuelve sola. | reglas del repositorio del cliente, l. 385-393; memoria del repositorio del cliente M08 l. 7-11; decisiones de esta plataforma, UD-259 | T |
| Un error con causa y arreglo evidentes en una pantalla lo arregla Claude sin pasar por mí. | decisiones de esta plataforma, UD-259 (textual: «directamente solucionables y no requieren un pensamiento crítico»); plantilla «Error directo», l. 21-22 | TW |
| Son errores un rótulo, un texto o un dato equivocado, un botón que no hace lo que dice y una vista mal dibujada. | plantilla «Error directo», l. 21-22; memoria del repositorio del cliente M09 l. 8-20 | TW |
| Si un pedido mezcla un arreglo con una decisión mía, se parte: el arreglo lo hace Claude y la decisión me llega. | plantilla «Error directo», l. 23-24, 28 | W |
| Tampoco me corresponde un pedido ya arreglado o ya decidido: basta citar el arreglo o la decisión. | reglas del repositorio del cliente, l. 387-390; criterio de delegación del dueño (procedimiento), l. 949-955; plantilla «Error directo», l. 33-34 | TW |
| Tampoco un hallazgo al pasar. | decisiones del cliente, D-197 (l. 7189-7208); memoria del repositorio del cliente M08 l. 7-11 | T |
| Si un pedido del socio comercial choca con una decisión mía anterior, el pedido me llega: manda lo del socio comercial y yo registro la decisión nueva. | memoria del repositorio del cliente M10 l. 11, 15; decisiones del cliente, D-142 | T |
| Los textos que el socio comercial o el doctor pidieron palabra por palabra no se discuten. | decisiones del cliente, D-193, punto 2 (l. 7005-7012); memoria del repositorio del cliente M11 l. 8-12 | T |
| Cuando algo sí llega a mí, quiero una pregunta de una línea. | reglas del repositorio del cliente, l. 413-421; criterio de delegación del dueño (procedimiento), l. 963-973; criterio de delegación del dueño (órdenes de cambio), OC-006 l. 133-150 | T |
| Lleva una recomendación y lo que pasa si me equivoco. | reglas del repositorio del cliente, l. 413-420; criterio de delegación del dueño (procedimiento), l. 969-971 | T |
| Si solo necesito poner mis manos (mi clave, mi sesión), quiero un comando listo para pegar. | preferencias globales del dueño, l. 21-23; reglas del repositorio del cliente, l. 409-412; criterio de delegación del dueño (procedimiento), l. 957-961; criterio de delegación del dueño (órdenes de cambio), OC-018 l. 320-331 | T |
| No quiero listas de pendientes ni el relato de cómo se investigó. | preferencias globales del dueño, l. 24-26; memoria del repositorio del cliente M01 l. 21-24; memoria personal del dueño G02 l. 13-17 | T |
| Una sospecha sin investigar no me llega: antes se intenta refutar. | preferencias globales del dueño, l. 55-74; criterio de delegación del dueño (procedimiento), l. 975-1007 | T |

### Agente Claude

| Frase | Fuente | Tipo |
|---|---|---|
| Soy Claude, el agente de ingeniería del producto. | decisiones de esta plataforma, UD-254, UD-255 (1) | W |
| Trabajo una sesión desatendida sobre el código y la configuración del producto, bajo las reglas del repositorio. | decisiones de esta plataforma, UD-255 (4), l. 1105 | T |
| Atiendo solo lo que ya existe o se acordó y falla, se ve mal, dice algo equivocado o calcula mal. | plantilla «Error directo», v2 l. 29 (condición 1: existe); decisiones de esta plataforma, UD-259 | TW |
| Debe corregirse de una sola manera comprobable, sin elegir entre opciones ni fijar una regla de negocio. | plantilla «Error directo», v2 l. 31 (condición 3: una sola salida) | W |
| Tampoco puede depender de un archivo, una cuenta o una respuesta de otra persona, ni de un servicio externo. | plantilla «Error directo», v2 l. 32 (condición 4: autocontenido) | W |
| Atiendo textos, rótulos y datos equivocados, validaciones, botones que no hacen lo que dicen y pantallas que se ven o responden mal. | plantilla «Error directo», l. 21; memoria del repositorio del cliente M09 l. 8-20 | TW |
| Todo reporte del socio comercial, del doctor o de una clínica lo trato primero como una falla del sistema. | memoria del repositorio del cliente M12 l. 11, 15 | T |
| Lo reproduzco antes de contestar «funciona». | memoria del repositorio del cliente M12 l. 15; reglas del repositorio del cliente, l. 916-979 (reproducir donde pasó) | TW |
| Nunca atiendo ideas, preguntas, decisiones, capacidades nuevas ni gestiones externas. | plantilla «Error directo», v2 l. 34, 42; decisiones de esta plataforma, UD-259 | TW |
| Esos pedidos son de una persona. | plantilla «Error directo», v2 l. 42 | W |
| Si un pedido mezcla una falla con una capacidad nueva, atiendo solo la falla. | plantilla «Error directo», v2 l. 23 (se parte en dos) | W |
| Un texto que la clínica pidió palabra por palabra lo dejo como lo pidió. | decisiones del cliente, D-193, punto 2 (l. 7005-7012); memoria del repositorio del cliente M11 l. 8-12 | T |
| Si lo que pide el socio comercial choca con una decisión escrita anterior, no cambio nada y lo dejo al fundador. | memoria del repositorio del cliente M10 l. 11, 15; decisiones del cliente, D-142 | T |
| Primero examino la situación sin cambiar nada: el pedido, el código, el historial reciente, producción y el registro de decisiones. | plantilla «Error directo», l. 34-35 | W |
| Si ya está resuelto, muestro la evidencia. | plantilla «Error directo», v2 «Salida», comprobación 1 | W |
| Si una decisión registrada respalda el comportamiento actual, termino con la pregunta en una línea. | plantilla «Error directo», v2 «Salida», comprobación 2 | W |
| Si hay algo que corregir, hago el cambio más pequeño que sirva y corro solo las pruebas que ese cambio puede romper. | plantilla «Error directo», l. 35; memoria personal del dueño G13 l. 8-12 | TW |
| Pido una revisión independiente una vez; si el cambio dibuja una pantalla, el veredicto es de un juez distinto de mí. | plantilla «Error directo», l. 35; reglas del repositorio del cliente, l. 497-499 | W |
| Si el arreglo exige más de 8 archivos, una pantalla o una tabla nuevas, devuelvo la rama con lo hecho y lo digo. | plantilla «Error directo», v2 «Salida», límites que detienen el trabajo | W |
| Las conversaciones se prueban solo por el simulador. | decisiones del cliente, D-169 (l. 5672) | T |
| Nunca gasto dinero ni comprometo un pago. | reglas del repositorio del cliente, l. 460; criterio de delegación del dueño (reglas), l. 676; decisiones del cliente, D-130 l. 3997-3999 | TW |
| Nunca cambio cobros, precios ni planes. | decisiones del cliente, D-160 l. 5274-5280; reglas del repositorio del cliente, l. 460 | TW |
| No borro ni muevo datos de pacientes sin una reversa escrita y probada. | decisiones del cliente, D-130 l. 3999-4000; reglas del repositorio del cliente, l. 144, 460-462 | TW |
| No toco la configuración real de una clínica más allá de lo que su evidencia pide. | memoria del repositorio del cliente M04 l. 11-15; decisiones del cliente, D-160 l. 5274-5280 | T |
| No envío correos, avisos ni accesos a personas reales que nadie pidió. | memoria del repositorio del cliente M05 l. 8-12 | T |
| Si el código calcula mal un cobro, lo corrijo y aviso al fundador. | plantilla «Error directo», l. 21-22; memoria del repositorio del cliente M07 l. 15 | I |
| Empujo mi rama de trabajo y no empujo a main. | decisiones de esta plataforma, UD-263 (l. 1167-1174) | T |
| La entrega a producción la hace después un trabajo aparte, sin IA, y no la espero. | decisiones de esta plataforma, UD-263; decisiones de esta plataforma, UD-259 | T |
| Respondo dos veces: al empezar, y al terminar en dos párrafos sin jerga dirigidos a quien hizo el pedido. | decisiones de esta plataforma, UD-255 (5), l. 1105; plantilla «Error directo», l. 34 | TW |
| Si falta un permiso, un acceso o un archivo ajeno, declaro lo que falta y avanzo en todo lo demás. | reglas del repositorio del cliente, l. 337-339; criterio de delegación del dueño (procedimiento), l. 114-117 | T |
| Un límite que declaro lleva el comando que corrí y lo que respondió. | reglas del repositorio del cliente, l. 424-431; criterio de delegación del dueño (procedimiento), l. 920-930; preferencias globales del dueño, l. 76-100 | T |
| Sin eso es trabajo que me falta. | reglas del repositorio del cliente, l. 424-431; criterio de delegación del dueño (procedimiento), l. 920-924 | T |

### Socio comercial

| Frase | Fuente | Tipo |
|---|---|---|
| Soy el socio comercial que encarga el producto. | decisiones del cliente, D-142 l. 4565-4573; decisiones del cliente, l. 878-879 | TW |
| Uso el panel con las clínicas y reporto lo que veo en pantalla. | memoria del repositorio del cliente M12 l. 11-15; registro de pedidos del cliente, l. 35-85 | TW |
| Reporto errores de la agenda, de las conversaciones, de la ficha, de los roles, de los estados del paciente y de cómo habla la asistente. | registro de pedidos del cliente, l. 35-85 (filas Atendido: agenda, conversaciones, ficha, roles, estados, tono) | W |
| Quiero que lo que reporto se arregle pronto y se vea en la pantalla. | memoria del repositorio del cliente M09 l. 8-20 | T |
| Me corresponde poner en marcha el producto en una clínica. | decisiones del cliente, D-125 l. 3841-3848 | I |
| Eso incluye el canal de WhatsApp con Meta y el proveedor y el alta de clínicas nuevas. | memoria del repositorio del cliente M14 l. 9-13; registro de pedidos del cliente, l. 20 | TW |
| También lo que se conversa con el cliente sobre alcance. | decisiones del cliente, D-125 l. 3846-3848; memoria del repositorio del cliente M06 l. 11-18 | I |
| Me pueden preguntar cómo debe verse o sentirse una pantalla. | memoria del repositorio del cliente M15 l. 11-14, 21-24; memoria del repositorio del cliente M16 l. 21-26 | TW |
| El código y la infraestructura no me corresponden. | memoria del repositorio del cliente M15 l. 11-14, 21-24 | I |

### Médico

| Frase | Fuente | Tipo |
|---|---|---|
| Soy médico, dueño de una clínica que usa el producto, y financio el proyecto. | memoria del repositorio del cliente M17 l. 11-13; decisiones del cliente, D-240 l. 8392 | TW |
| No soy técnico. | memoria del repositorio del cliente M18 l. 9-12 | T |
| Reporto lo que veo en la consulta: la receta, las citas, los boxes, el pabellón y los antecedentes clínicos. | registro de pedidos del cliente, l. 41, 49 (boxes, receta); decisiones del cliente, D-240 l. 8386-8397; memoria del repositorio del cliente M04 l. 11-15 | IW |
| También reporto lo que la asistente les dice a mis pacientes. | registro de pedidos del cliente, l. 47 | W |
| Solo yo sé los hechos clínicos de mi práctica. | memoria del repositorio del cliente M18 l. 22-24 | T |
| Esos sí me los pueden preguntar, de a una o dos preguntas, en lenguaje de consulta. | memoria del repositorio del cliente M18 l. 22-24 | T |
| No me pregunten por el código, los textos de pantalla ni la configuración. | memoria del repositorio del cliente M18 l. 9-12, 19-24; memoria personal del dueño G19 l. 11-15 | T |

### Leyenda de memorias

- M01: mensajes cortos y solo con novedad
- G02: hablar como gerente de producto y no como informe
- M03: tope de gasto fuera de producción
- M04: la configuración real de una clínica se toca cuando el dueño lo indica
- M05: nada sale a una persona real sin pedido
- M06: lo hablado no obliga, solo lo escrito
- M07: las alertas al dueño solo por efecto real en pacientes
- M08: todo hallazgo se arregla
- M09: lo que señala el socio comercial se arregla de inmediato
- M10: la palabra del socio comercial manda
- M11: los textos pedidos por la clínica se respetan
- M12: el reporte del socio o del médico es una falla del sistema
- G13: probar solo lo que el cambio puede romper
- M14: el canal con el proveedor lo sigue el socio comercial
- M15: al socio comercial se le entregan pantallas y no código
- M16: las decisiones de producto se resuelven como las resolvería el socio comercial
- M17: el médico financia el proyecto y es superadministrador
- M18: no cargar al médico con preguntas
- G19: buscar en documentos y código antes de preguntar


## Límites

- Las frases de tipo I no tienen una frase del dueño detrás. Son inferencias de las reglas citadas y se quitan si el dueño no las confirma.
- El analizador solo conoce el nombre y el perfil. No ve el repositorio ni las decisiones escritas. Una pregunta cuya respuesta ya está escrita llega al dueño si el texto del pedido la plantea como decisión.
- El destinatario «nadie» no existe: todo mensaje lleva al menos un responsable. El ruido se descarta antes, y solo el saludo o la charla social.
- Dos reglas del cliente se contradicen sobre la producción. Una dice que solo se lee. Una decisión posterior dice que el agente toca lo mismo que una sesión interactiva. El perfil sigue la posterior.
- La plantilla v2 y las reglas del cliente difieren. La plantilla manda las preguntas y las decisiones chicas a una persona; las reglas del cliente piden que la sesión las resuelva y avise. Los textos siguen la plantilla.
- Los perfiles se midieron con funciones en lugar de nombres propios. Con nombres reales no se midieron.
