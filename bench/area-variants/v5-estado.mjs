// H-1000, hypothesis 2: in status tables and lists of pending items each row is classified by what it says about the item,
// and a status column («en revisión», «feedback», «pendiente») is not an opinion about a finished product.
import { addBorder, addRule } from './_lib.mjs';
export const additions = {
    Retroalimentación: 'En una tabla de estado, una lista de pendientes o un informe de revisión, cada fila se clasifica por lo que dice del elemento: una columna de estado («en revisión», «con feedback», «observado») no convierte la fila en Retroalimentación. Es Retroalimentación solo cuando la fila valora algo ya entregado sin pedir cambio ni reportar falla.',
    'Nueva funcionalidad': 'En una tabla de estado o una lista de pendientes, la fila que nombra algo por construir, conectar, completar o ajustar en una pantalla o una función es Nueva funcionalidad, aunque su columna diga que está en revisión, pendiente o con comentarios.',
    Error: 'En una tabla de estado o un informe de revisión, la fila que dice que algo entregado no funciona, no se ve o no responde como se acordó es Error, aunque llegue como observación del revisor.',
};
export const rule = 'En una tabla, una matriz o una lista de elementos, cada fila o elemento es un punto propio que se clasifica por lo que dice de ese elemento; el estado, la prioridad o el responsable de la fila son datos del punto y no deciden su área.';
export default {
  areas: (areas) => addBorder(areas, additions),
  instructions: addRule(rule),
};
