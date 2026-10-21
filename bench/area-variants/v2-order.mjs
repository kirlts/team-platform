// v2 with the areas listed in the prompt as Nueva funcionalidad, Error, Retroalimentación, Idea, Pregunta (hypothesis c).
import { fileURLToPath } from 'node:url';
const order = ['Nueva funcionalidad', 'Error', 'Retroalimentación', 'Idea', 'Pregunta'];
export default {
  areasFile: fileURLToPath(new URL('./v2.areas.json', import.meta.url)),
  areas: (areas) => areas.map((a) => ({ ...a, position: order.indexOf(a.title) + 1 })),
};
