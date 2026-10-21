// Numeración de unidades del input extraído y partición (MASTER-SPEC §7.5; informe 02 §3.3 y §2.2).
//
// Una unidad es un párrafo, una viñeta, un segmento de transcripción con marca de tiempo, una línea de
// la descripción de una imagen o un fotograma. El sistema numera las unidades antes de la segunda
// llamada y exige que cada mensaje cite las suyas: con eso calcula solapes y huecos por aritmética
// de conjuntos, sin leer prosa.
//
// Esta segmentación mira la ESTRUCTURA del texto extraído (líneas en blanco, marcadores de viñeta,
// de encabezado y de marca de tiempo que los extractores de §7.4 escriben), nunca su significado:
// no decide área, destinatario ni estado (MASTER-SPEC §4.2).

// Marcadores estructurales de una línea. Los produce el extractor (§7.4): `mm:ss` de la
// transcripción y de los fotogramas, viñetas y encabezados del markdown del documento.
const BULLET = /^\s*(?:[-*•]|\d{1,3}[.)])\s+\S/;
const TIMESTAMP = /^\s*[[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?(?:\s|$)/;
const HEADING = /^\s{0,3}#{1,6}\s+\S/;

/** Tipos de adjunto cuyo texto es un monólogo o una línea de tiempo: no se parte (informe 02 §2.2). */
const ATOMIC_KINDS = new Set(['audio', 'video']);

function splitText(text) {
  const units = [];
  let current = null;
  let pendingHeading = [];
  let section = 0;
  const flush = () => {
    if (current) {
      units.push(current);
      current = null;
    }
  };
  const begin = (line) => {
    flush();
    current = { section, lines: [...pendingHeading, line] };
    pendingHeading = [];
  };
  for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') {
      flush();
    } else if (HEADING.test(line)) {
      // Un encabezado no es una unidad: abre una sección y se pega a la unidad que sigue.
      flush();
      section += 1;
      pendingHeading.push(line.trim());
    } else if (BULLET.test(line) || TIMESTAMP.test(line)) {
      begin(line.trimEnd());
      current.item = BULLET.test(line);
    } else if (current) {
      current.lines.push(line.trimEnd());
    } else {
      begin(line.trimEnd());
    }
  }
  flush();
  // Un encabezado final sin contenido es una unidad propia: no puede quedar sin contar.
  if (pendingHeading.length > 0) units.push({ section, lines: pendingHeading });
  return units.map((u) => ({ section: u.section, item: u.item === true, text: u.lines.join('\n') }));
}

/**
 * Numera las unidades del bundle: primero el texto del input y luego cada adjunto con texto extraído.
 * @param {{text?: string, attachments?: {id: number, kind: string, extracted?: string|null}[]}} bundle
 * @returns {{id: number, source: {type: 'input'} | {type: 'attachment', attachment_id: number, kind: string}, section: number, atomic: boolean, text: string}[]}
 */
export function numberUnits(bundle) {
  const out = [];
  let id = 0;
  const push = (source, atomic, text, sourceIndex) => {
    for (const u of splitText(text)) {
      id += 1;
      out.push({ id, source, section: u.section, atomic, item: u.item, sourceIndex, text: u.text });
    }
  };
  let sourceIndex = 0;
  if (typeof bundle.text === 'string' && bundle.text.trim() !== '') push({ type: 'input' }, false, bundle.text, sourceIndex);
  for (const att of bundle.attachments ?? []) {
    sourceIndex += 1;
    if (typeof att.extracted === 'string' && att.extracted.trim() !== '') {
      push({ type: 'attachment', attachment_id: att.id, kind: att.kind }, ATOMIC_KINDS.has(att.kind), att.extracted, sourceIndex);
    }
  }
  return out;
}

function sourceLabel(source) {
  return source.type === 'input' ? 'Texto del input' : `Adjunto ${source.attachment_id} (${source.kind})`;
}

/** Texto de las unidades para el prompt: `[u12] …`, agrupadas por origen. */
export function renderUnits(units) {
  const lines = [];
  let lastKey = null;
  for (const u of units) {
    const key = u.source.type === 'input' ? 'input' : `a${u.source.attachment_id}`;
    if (key !== lastKey) {
      if (lastKey !== null) lines.push('');
      lines.push(`### ${sourceLabel(u.source)}`);
      lastKey = key;
    }
    lines.push(`[u${u.id}] ${u.text.replace(/\n/g, '\n      ')}`);
  }
  return lines.join('\n');
}

export function estimateTokens(text, charsPerToken) {
  return Math.ceil(String(text).length / charsPerToken);
}

/**
 * Parte las unidades en trozos disjuntos por unidad sólo por fronteras estructurales (informe 02 §2.2 y §3.3):
 * cambio de origen o de sección. Un adjunto de audio o video no se parte (un monólogo retoma temas lejanos,
 * partirlo suma ruido de tarea y de agregación [F19]). Si todo cabe en el presupuesto, un solo trozo.
 *
 * @param {ReturnType<typeof numberUnits>} units
 * @param {{budgetTokens: number, charsPerToken: number}} opts
 * @returns {ReturnType<typeof numberUnits>[]}
 */
export function partitionUnits(units, { budgetTokens, charsPerToken }) {
  const cost = (list) => estimateTokens(renderUnits(list), charsPerToken);
  if (units.length === 0 || cost(units) <= budgetTokens) return [units];

  // Grupos contiguos indivisibles: mismo origen y misma sección, o el adjunto atómico entero.
  const groups = [];
  for (const u of units) {
    const last = groups.at(-1);
    const sameGroup = last && last.sourceIndex === u.sourceIndex && (u.atomic || last.section === u.section);
    if (sameGroup) last.units.push(u);
    else groups.push({ sourceIndex: u.sourceIndex, section: u.section, units: [u] });
  }

  // Un grupo que por sí solo no cabe se abre en cada viñeta o ítem (un docx de N puntos se parte por ítems,
  // informe 02 §2.2). Sin ítems queda entero: no hay otra frontera estructural.
  const pieces = groups.flatMap((g) => {
    if (g.units.length < 2 || g.units[0].atomic || cost(g.units) <= budgetTokens) return [g];
    const split = [];
    for (const u of g.units) {
      if (split.length === 0 || u.item) split.push({ ...g, units: [u] });
      else split.at(-1).units.push(u);
    }
    return split;
  });

  const chunks = [];
  let current = [];
  for (const g of pieces) {
    if (current.length > 0 && cost([...current, ...g.units]) > budgetTokens) {
      chunks.push(current);
      current = [];
    }
    current.push(...g.units);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
