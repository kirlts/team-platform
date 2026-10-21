// Helpers shared by the H-1000 area-description variants: they start from the descriptions in templates/areas.json
// (v2-order, UD-033) and add edge-case text to the «Casos borde» paragraph, so a variant is a list of additions.
export const ORDER = ['Nueva funcionalidad', 'Error', 'Retroalimentación', 'Idea', 'Pregunta'];

/** Appends `extra` at the end of the «Casos borde.» paragraph (the one before the closing «No es …» sentence). */
export function addBorder(areas, additions) {
  return areas.map((a) => {
    const extra = additions[a.title];
    const next = { ...a, position: ORDER.indexOf(a.title) + 1 };
    if (!extra) return next;
    const paragraphs = a.description.split('\n\n');
    const at = paragraphs.findIndex((p) => p.startsWith('Casos borde'));
    paragraphs[at] = `${paragraphs[at]} ${extra}`;
    return { ...next, description: paragraphs.join('\n\n') };
  });
}

/** Inserts `rule` as a numbered rule 11 after the last rule of the classification instructions. */
export const addRule = (rule) => (instructions) => `${instructions}\n11. ${rule}`;
