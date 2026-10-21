// Numeración de unidades del input extraído y partición (MASTER-SPEC §7.5; informe 02 §3.3 y §2.2).
//
// Una unidad es una oración de un párrafo (Intl.Segmenter, locale `es`), un elemento de una enumeración en
// línea («1) … 2) …»), una viñeta, un segmento de transcripción con marca de tiempo, una línea de la
// descripción de una imagen o un fotograma. En un chat cada línea es un párrafo. El sistema numera las unidades antes de la segunda
// llamada y exige que cada mensaje cite las suyas: con eso calcula solapes y huecos por aritmética
// de conjuntos, sin leer prosa.
//
// Esta segmentación mira la ESTRUCTURA del texto extraído (saltos de línea, puntuación de oración, marcadores
// de enumeración, viñeta, encabezado y marca de tiempo que los extractores de §7.4 escriben), nunca su significado:
// no decide área, destinatario ni estado (MASTER-SPEC §4.2).

// Marcadores estructurales de una línea. Los produce el extractor (§7.4): `mm:ss` de la
// transcripción y de los fotogramas, viñetas y encabezados del markdown del documento.
const BULLET = /^\s*(?:[-*•]|\d{1,3}[.)]|[a-z][.)])\s+\S/;
const BULLET_PREFIX = /^\s*(?:[-*•]|\d{1,3}[.)]|[a-z][.)])\s+/;
const TIMESTAMP = /^\s*[[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?(?:\s|$)/;
const HEADING = /^\s{0,3}#{1,6}\s+\S/;
// Una línea con sangría después de una viñeta continúa esa viñeta.
const INDENTED = /^(?: {2,}|\t)\S/;

/** Tipos de adjunto cuyo texto es un monólogo o una línea de tiempo: no se parte (informe 02 §2.2). */
const ATOMIC_KINDS = new Set(['audio', 'video']);

// Abreviaturas que el segmentador de oraciones de ICU corta por error en español («Sr. García»).
// Es una lista de fronteras de oración, no una lectura del significado del texto.
const ABBREVIATIONS = new Set(['sr', 'sra', 'srta', 'dr', 'dra', 'ing', 'lic', 'prof', 'arq', 'pág', 'págs', 'núm', 'aprox', 'vs', 'etc', 'ej', 'cap', 'art', 'tel', 'av']);

const sentenceSegmenter = new Intl.Segmenter('es', { granularity: 'sentence' });

/** Oraciones de un texto de una línea (ICU, locale `es`), con las abreviaturas pegadas a lo que sigue. */
function splitSentences(text) {
  const raw = [...sentenceSegmenter.segment(text)].map((s) => s.segment.trim()).filter(Boolean);
  const out = [];
  let carry = '';
  for (const part of raw) {
    const joined = carry ? `${carry} ${part}` : part;
    const lastWord = joined.match(/([\p{L}]+)\.$/u)?.[1]?.toLowerCase();
    if (lastWord && ABBREVIATIONS.has(lastWord)) carry = joined;
    else {
      out.push(joined);
      carry = '';
    }
  }
  if (carry) out.push(carry);
  return out;
}

/**
 * Enumeración en línea: «1) uno 2) dos 3) tres» o «a) uno b) dos». Sólo cuenta una secuencia que empieza
 * en 1 (o en «a») y sube de a uno, con al menos dos elementos: así «versión 2. Luego» no corta.
 * Devuelve los índices donde empieza cada elemento.
 */
const INLINE_MARKER = /(?:^|\s)(\d{1,2}|[a-z])[.)](?=\s+\S)/g;
function enumerationStarts(text) {
  const marks = [...text.matchAll(INLINE_MARKER)].map((m) => {
    const token = m[1];
    const isDigit = /\d/.test(token);
    return { index: m.index + (m[0].length - m[1].length - 1), kind: isDigit ? 'd' : 'a', value: isDigit ? Number(token) : token.charCodeAt(0) - 96 };
  });
  const starts = [];
  for (let i = 0; i < marks.length; i += 1) {
    if (marks[i].value !== 1) continue;
    let end = i;
    while (end + 1 < marks.length && marks[end + 1].kind === marks[i].kind && marks[end + 1].value === marks[end].value + 1) end += 1;
    if (end > i) {
      for (let k = i; k <= end; k += 1) starts.push(marks[k].index);
      i = end;
    }
  }
  return starts;
}

function cutAt(text, indexes) {
  const cuts = [...new Set(indexes)].filter((i) => i > 0).sort((x, y) => x - y);
  const out = [];
  let from = 0;
  for (const i of cuts) {
    out.push(text.slice(from, i));
    from = i;
  }
  out.push(text.slice(from));
  return out.map((t) => t.trim()).filter(Boolean);
}

/** Un párrafo de una línea que lista varios pedidos con guiones: «- uno - dos - tres». */
function dashListStarts(text) {
  if (!/^\s*[-–—•]\s/.test(text)) return [];
  return [...text.matchAll(/\s([-–—•])\s+(?=\S)/g)].map((m) => m.index + 1);
}

/** Oraciones de un bloque tras cortar enumeraciones en línea, listas con guiones y puntos y coma. */
function splitBlock(text) {
  let pieces = cutAt(text, enumerationStarts(text));
  pieces = pieces.flatMap((p) => cutAt(p, dashListStarts(p)));
  // Un punto y coma separa cláusulas: cada una es candidata a pedido propio.
  pieces = pieces.flatMap((p) => p.split(/(?<=;)\s+/));
  const out = [];
  for (const piece of pieces) {
    // El marcador de lista («1)», «-») se aparta antes de segmentar para que no cuente como oración.
    const marker = piece.match(BULLET_PREFIX)?.[0] ?? '';
    const sentences = splitSentences(piece.slice(marker.length));
    if (sentences.length === 0) {
      if (piece.trim()) out.push(piece.trim());
      continue;
    }
    sentences[0] = `${marker}${sentences[0]}`.trim();
    out.push(...sentences);
  }
  return out;
}

/** Bloques de un texto: una línea o una viñeta con sus líneas con sangría. Cada línea no vacía es un bloque. */
function splitBlocks(text) {
  const blocks = [];
  let current = null;
  let pendingHeading = [];
  let section = 0;
  const flush = () => {
    if (current) {
      blocks.push(current);
      current = null;
    }
  };
  const begin = (line, item) => {
    flush();
    current = { section, item, heading: pendingHeading, lines: [line] };
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
    } else if (current?.item && INDENTED.test(line)) {
      current.lines.push(line.trim());
    } else {
      // En un chat un salto de línea es un corte deliberado: cada línea es un párrafo.
      begin(line.trim(), BULLET.test(line));
    }
  }
  flush();
  // Un encabezado final sin contenido es un bloque propio: no puede quedar sin contar.
  if (pendingHeading.length > 0) blocks.push({ section, item: false, heading: [], lines: pendingHeading });
  return blocks;
}

/**
 * Divide un texto en unidades. En fuentes atómicas (audio, video) el bloque es la unidad: una línea de la
 * transcripción lleva su marca de tiempo y no se parte. En el resto, el bloque baja a oración cuando tiene
 * más de una (Intl.Segmenter, locale `es`), y una enumeración en línea, un guion o un punto y coma también cortan.
 * @returns {{section: number, item: boolean, paragraph: number, sentence: number|null, text: string}[]}
 */
function splitText(text, { atomic }) {
  const units = [];
  splitBlocks(text).forEach((block, index) => {
    const paragraph = index + 1;
    const body = block.lines.join(' ');
    const pieces = atomic ? [block.lines.join('\n')] : splitBlock(body);
    pieces.forEach((piece, i) => {
      const prefix = i === 0 && block.heading.length > 0 ? `${block.heading.join('\n')}\n` : '';
      units.push({
        section: block.section,
        item: block.item && i === 0,
        paragraph,
        sentence: pieces.length > 1 ? i + 1 : null,
        text: `${prefix}${piece}`,
      });
    });
    if (pieces.length === 0 && block.heading.length > 0) {
      units.push({ section: block.section, item: false, paragraph, sentence: null, text: block.heading.join('\n') });
    }
  });
  return units;
}

/**
 * Numera las unidades del bundle: primero el texto del input y luego cada adjunto con texto extraído.
 * El `id` es un entero consecutivo (el contrato de `unit_ids` del esquema); el `label` (`p3.s2`: párrafo 3,
 * oración 2; `a7.p3` en un adjunto) deja ver al modelo de qué párrafo viene cada oración.
 * @param {{text?: string, attachments?: {id: number, kind: string, extracted?: string|null}[]}} bundle
 */
export function numberUnits(bundle) {
  const out = [];
  let id = 0;
  const push = (source, atomic, text, sourceIndex, labelPrefix) => {
    for (const u of splitText(text, { atomic })) {
      id += 1;
      const label = `${labelPrefix}p${u.paragraph}${u.sentence ? `.s${u.sentence}` : ''}`;
      out.push({ id, label, source, section: u.section, atomic, item: u.item, sourceIndex, text: u.text });
    }
  };
  let sourceIndex = 0;
  if (typeof bundle.text === 'string' && bundle.text.trim() !== '') push({ type: 'input' }, false, bundle.text, sourceIndex, '');
  for (const att of bundle.attachments ?? []) {
    sourceIndex += 1;
    if (typeof att.extracted === 'string' && att.extracted.trim() !== '') {
      push({ type: 'attachment', attachment_id: att.id, kind: att.kind }, ATOMIC_KINDS.has(att.kind), att.extracted, sourceIndex, `a${att.id}.`);
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
    lines.push(`[u${u.id}] (${u.label}) ${u.text.replace(/\n/g, '\n      ')}`);
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
