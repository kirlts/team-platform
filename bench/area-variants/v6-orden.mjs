// H-1000, hypothesis 3: replace rule 4 (the most specific description wins) by an ordered list of questions that mirrors the
// decision the catalog already describes: failure first, then request, then question, then valuation, then proposal.
export default {
  areas: (areas) => areas.map((a) => ({ ...a, position: ['Nueva funcionalidad', 'Error', 'Retroalimentación', 'Idea', 'Pregunta'].indexOf(a.title) + 1 })),
  instructions: (text) => text.replace(/^4\. .*$/m, '4. Si dos áreas parecen servir, decide con estas preguntas, en este orden, y quédate con la primera que se responde que sí. (a) ¿Cuenta que algo existente o acordado hoy no anda como debería, aunque proponga cómo arreglarlo? Es Error. (b) ¿Pide o describe algo que el producto debe hacer o mostrar y hoy no hace, o trae plazo, prioridad o responsable? Es Nueva funcionalidad. (c) ¿Espera la respuesta de una persona concreta sobre cómo funciona algo, qué se decidió, quién o cuándo, y nada más? Es Pregunta. (d) ¿Valora algo que ya existe y funciona, sin pedir cambio? Es Retroalimentación. (e) En otro caso, es una propuesta sin compromiso: Idea.'),
};
