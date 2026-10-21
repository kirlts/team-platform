# Oraciones con varios puntos accionables, 2026-10-21

Resultado: una oración compuesta es una sola unidad, y con el prompt anterior el mensaje que la citaba recogía los dos hechos en 28 de 50 corridas. La clasificación no pierde la unidad: la deja en un grupo, nunca la descarta. La pérdida es de la descomposición, que escribía un mensaje sobre el primer hecho y omitía el segundo. Con la regla 4 de la descomposición reescrita, los dos hechos aparecen en 46 de 50 corridas. La tasa de unidades accionables sin mensaje en el banco privado no cambia (8,2 %): esa tasa viene de otra causa.

## Reproducción

`node bench/probe-compound.mjs --repeat 10` corre el analizador real (Haiku 5.5, es-419, equipo del juego inicial) sobre cinco oraciones. «Ambos puntos» cuenta las corridas donde algún mensaje nombra los dos hechos (revisión de la medición con raíces de palabra; nada así corre en el producto).

| Oración | Antes | Después |
|---|---:|---:|
| Elogio, defecto visual y defecto de rendimiento en la página de ajustes | 1/10 | 10/10 |
| Dos defectos unidos por «y» | 10/10 | 10/10 |
| Elogio y dos fallas de funciones distintas | 4/10 | 9/10 |
| Defecto de rendimiento junto a defecto visual | 7/10 | 10/10 |
| Defecto y pedido en la misma oración | 6/10 | 7/10 |
| Total | 28/50 | 46/50 |

En ninguna corrida hubo más de un mensaje, ninguna unidad quedó descartada y todas terminaron con propuesta.

## Causa

`numberUnits` separa por oración, y una oración compuesta es una unidad atómica. La regla 5 de la clasificación manda una unidad con puntos de áreas distintas al grupo del punto principal, y la regla 4 de la descomposición pedía «nombrar ambos puntos en su cuerpo»: el modelo la leía como un permiso y escribía el título y el cuerpo sobre el primer hecho. Un elogio al inicio hacía que el primer hecho fuera lo único a lo que el modelo daba forma de mensaje.

## Arreglo

La regla 4 de la descomposición (`src/analyze/prompts-es.js` y `prompts-en.js`) exige que el mensaje atienda todos los puntos de la unidad: el título nombra cada uno, el cuerpo les dedica una frase con sus datos, los campos de la plantilla recogen los de todos, y antes de responder el modelo revisa que cada falla, pedido, pregunta o idea de la unidad aparece. Solo se deja fuera un elogio sin nada que decidir. No hay expresión regular ni lista de palabras sobre el texto de la persona, ni capa que reescriba la prosa del modelo.

## Lo que sigue pasando

- En 1 de 6 corridas de «defecto y pedido» el pedido de elegir la hora falta. Es una unidad con puntos de áreas distintas: la regla 5 de la clasificación la manda a Error y el pedido queda como segundo hecho de un mensaje de falla.
- Un mensaje con dos puntos sigue siendo uno solo. Separarlos en dos mensajes exige que una unidad pueda citarse en dos mensajes o que el analizador divida la oración, un cambio del contrato de unidades (MASTER-SPEC §7.5) que no se tocó.

## Unidades accionables sin mensaje en el banco privado

Unidades que alguno de los dos lectores pone en un mensaje y que la propuesta no cita. 39 casos, `bench/units-uncovered.mjs`.

| Prompt | Unidades | Tasa | Por repetición |
|---|---:|---:|---|
| Anterior (3 repeticiones) | 1.103 de 13.371 | 8,25 % | 7,2; 9,7; 7,8 |
| Regla 4 nueva (2 repeticiones) | 732 de 8.914 | 8,21 % | 8,2; 8,2 |

Las 732 unidades son descartes explícitos del modelo, ninguna es un hueco. Cinco transcripciones de reunión largas concentran 627 de ellas: intervenciones breves («sí», «ya») dentro de un tramo que las referencias atribuyen al punto y el modelo descarta como charla. Eso es clasificación, no oraciones compuestas, y el cambio no lo toca.

## Caso público

`bench/cases/09-oracion-compuesta` lleva dos oraciones con dos hechos cada una. La puntuación por unidades no ve el contenido de un mensaje, por eso `expected.json` agrega `mentions` y `bench/probe-compound.mjs` revisa que cada mensaje las nombre. `bench/probe-compound.test.js` prueba la revisión sin red.

## Gasto

0,1 USD las sondas (cinco corridas de 50 análisis) y 1,6 USD la corrida de dos repeticiones del banco privado.
