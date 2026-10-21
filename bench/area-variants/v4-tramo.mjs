// H-1000, hypothesis 1: in a meeting, an interview or a long chat, the questions that explore a need and their answers
// belong to the point being explored, and the area is the one the point ends up requiring.
import { addBorder, addRule } from './_lib.mjs';
export const additions = {
    Pregunta: 'En una reunión, una entrevista o un chat largo, las preguntas con que alguien explora una necesidad, pide que le expliquen o repasa lo que ya vio, y las respuestas que las siguen, forman parte del punto que se está explorando y toman su área (Nueva funcionalidad, Error, Idea o Retroalimentación). Solo es Pregunta el punto cuyo resultado es una respuesta o una decisión que alguien debe dar.',
    Retroalimentación: 'En una reunión o una entrevista, el tramo en que una persona cuenta cómo usa algo, qué le gusta o qué le falta es Retroalimentación solo mientras se limite a valorar; cuando termina describiendo algo que el producto debería hacer, el tramo entero es Nueva funcionalidad.',
};
export const rule = 'En una reunión, una entrevista o un chat largo, clasifica cada tramo por el punto que termina resolviendo, no por el tono de cada intervención: las preguntas de exploración, las aclaraciones y las confirmaciones dentro del tramo toman el área del pedido, la falla o la idea que el tramo discute.';
export default {
  areas: (areas) => addBorder(areas, additions),
  instructions: addRule(rule),
};
