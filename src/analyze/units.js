// Numbering of the units of the extracted input and partitioning (MASTER-SPEC §7.5; report 02 §3.3 and §2.2).
//
// A unit is a sentence of a paragraph (Intl.Segmenter, locale `es`), an item of an inline enumeration
// («1) … 2) …»), a bullet, a transcript segment with a timestamp, a line of the description of an
// image or a frame. In a chat each line is a paragraph. The system numbers the units before the second
// call and requires each message to cite its own: with that it computes overlaps and gaps by set
// arithmetic, without reading prose.
//
// This segmentation looks at the STRUCTURE of the extracted text (line breaks, sentence punctuation, enumeration
// markers, bullets, headings and timestamps that the §7.4 extractors write), never at its meaning:
// it decides no area, recipient or state (MASTER-SPEC §4.2).

// Structural markers of a line. The extractor produces them (§7.4): `mm:ss` of the
// transcript and of the frames, bullets and headings of the document markdown.
const BULLET = /^\s*(?:[-*•]|\d{1,3}[.)]|[a-z][.)])\s+\S/;
const BULLET_PREFIX = /^\s*(?:[-*•]|\d{1,3}[.)]|[a-z][.)])\s+/;
// Timestamp at the start of the line: «[00:12] …», «00:12 …», «[1:02:05] …», the range «[00:05-00:10] …» and «[15:55, 7/10/2026] …» (the comma follows the time).
const CLOCK = '\\d{1,2}:\\d{2}(?::\\d{2})?';
const TIMESTAMP = new RegExp(`^\\s*[[(]?${CLOCK}(?:\\s*[-–]\\s*${CLOCK})?[\\])]?(?:[\\s,]|$)`);
// Time of a unit: `mm:ss`, `h:mm:ss` or the range `mm:ss-mm:ss` at the start of its text (an optional heading aside).
// Lines the video extractor writes (§7.4): «[mm:ss-mm:ss] Voz: …» and «[mm:ss] Fotograma N: …». Each one is a single
// unit even when it holds several sentences. Other speakers (a meeting transcript) still go down to sentences.
const EXTRACTOR_SENDER = /^(?:Voz|Fotograma \d+)$/;
const UNIT_TIME = new RegExp(`^(?:#.*\\n)*\\s*[[(]?(${CLOCK}(?:\\s*[-–]\\s*${CLOCK})?)[\\])]?(?:[\\s,]|$)`);
// Chat line with a sender: «[15:55, 7/10/2026] Name: …», «[09:12] Name: …» and «7/10/2026 15:55 - Name: …».
const CHAT_BRACKET = /^\s*(\[[^\]\n]*\d{1,2}:\d{2}[^\]\n]*\])\s*([^:\n]{1,60}?):\s+(\S.*)$/;
const CHAT_DASH = /^\s*(\d{1,2}[/.]\d{1,2}[/.]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s?m\.?)?\s*-)\s*([^:\n]{1,60}?):\s+(\S.*)$/i;
// Row of a markdown table and its separator line («|---|:--:|»).
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function parseChatLine(line) {
  const m = line.match(CHAT_BRACKET) ?? line.match(CHAT_DASH);
  return m ? { prefix: `${m[1]} ${m[2].trim()}:`, sender: m[2].trim(), body: m[3] } : null;
}
const HEADING = /^\s{0,3}#{1,6}\s+\S/;
// An indented line after a bullet continues that bullet.
const INDENTED = /^(?: {2,}|\t)\S/;

// A unit with no content of its own (H-1902): the speaker line of a meeting transcript («00:12:41 Name», «Name:»), the bare
// number of a list item, or a line with no letter or digit. It reads the shape of the text, never its meaning (§4.2).
const SPEAKER_MARK = new RegExp(`^[[(]?${CLOCK}[\\])]?\\s+\\p{L}[\\p{L}\\p{N}_'-]*(?:\\s+\\p{L}[\\p{L}\\p{N}_'-]*){0,2}$`, 'u');
const SPEAKER_LABEL = /^\p{L}[\p{L}\p{N}_'-]*(?:\s+\p{L}[\p{L}\p{N}_'-]*){0,2}:$/u;
const BARE_NUMBER = /^\d{1,3}[.)]$/;

/**
 * True when the text of a unit says nothing by itself: a speaker mark with its time, a speaker label, a bare list number or
 * only symbols. Such a unit belongs with the unit that follows it (the intervention it introduces), never in a message alone.
 * @param {string} text
 */
export function isEmptyUnit(text) {
  const t = String(text ?? '').trim();
  if (t === '') return true;
  return !/[\p{L}\p{N}]/u.test(t) || BARE_NUMBER.test(t) || SPEAKER_MARK.test(t) || SPEAKER_LABEL.test(t);
}

/** Attachment kinds whose text is a monologue or a timeline: it is not split (report 02 §2.2). */
const ATOMIC_KINDS = new Set(['audio', 'video']);

// Abbreviations that the ICU sentence segmenter wrongly cuts in Spanish («Sr. García»).
// It is a list of sentence boundaries, not a reading of the meaning of the text.
const ABBREVIATIONS = new Set(['sr', 'sra', 'srta', 'dr', 'dra', 'ing', 'lic', 'prof', 'arq', 'pág', 'págs', 'núm', 'aprox', 'vs', 'etc', 'ej', 'cap', 'art', 'tel', 'av']);

const sentenceSegmenter = new Intl.Segmenter('es', { granularity: 'sentence' });

/** Sentences of a single-line text (ICU, locale `es`), with abbreviations glued to what follows. */
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
 * Inline enumeration: «1) one 2) two 3) three» or «a) one b) two». Only a sequence that starts
 * at 1 (or at «a») and goes up one at a time counts, with at least two items: so «versión 2. Luego» does not cut.
 * Returns the indexes where each item starts.
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

/** A single-line paragraph that lists several requests with dashes: «- one - two - three». */
function dashListStarts(text) {
  if (!/^\s*[-–—•]\s/.test(text)) return [];
  return [...text.matchAll(/\s([-–—•])\s+(?=\S)/g)].map((m) => m.index + 1);
}

/** Sentences of a block after cutting inline enumerations, dash lists and semicolons. */
function splitBlock(text) {
  let pieces = cutAt(text, enumerationStarts(text));
  pieces = pieces.flatMap((p) => cutAt(p, dashListStarts(p)));
  // A semicolon separates clauses: each one is a candidate for its own request.
  pieces = pieces.flatMap((p) => p.split(/(?<=;)\s+/));
  const out = [];
  for (const piece of pieces) {
    // The list marker («1)», «-») is set aside before segmenting so it does not count as a sentence.
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

/**
 * Blocks of a text. Each non-empty line is a block (a paragraph), except:
 *  - a bullet absorbs the indented lines that follow it;
 *  - a chat line with a sender absorbs the following lines that do not start another chat line;
 *  - a markdown table is a single paragraph and each row is a block; the header stays as context of the table.
 * In an atomic source (audio, video) there is no chat or tables: each line with its timestamp is a block.
 */
function splitBlocks(text, { atomic }) {
  const blocks = [];
  let current = null;
  let pendingHeading = [];
  let section = 0;
  let paragraph = 0;
  const flush = () => {
    if (current) {
      blocks.push(current);
      current = null;
    }
  };
  const begin = (line, item) => {
    flush();
    paragraph += 1;
    current = { section, item, paragraph, heading: pendingHeading, lines: [line] };
    pendingHeading = [];
    return current;
  };
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      flush();
    } else if (HEADING.test(line)) {
      // A heading is not a unit: it opens a section and sticks to the unit that follows.
      flush();
      section += 1;
      pendingHeading.push(line.trim());
    } else if (!atomic && TABLE_ROW.test(line)) {
      flush();
      const rows = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        rows.push(lines[i].trim());
        i += 1;
      }
      i -= 1;
      const hasHeader = rows.length >= 2 && TABLE_SEPARATOR.test(rows[1]);
      const header = hasHeader ? rows[0] : null;
      const data = hasHeader ? rows.slice(2) : rows;
      paragraph += 1;
      data.forEach((row, k) => {
        blocks.push({ section, item: true, paragraph, row: k + 1, table: { header }, heading: k === 0 ? pendingHeading : [], lines: [row] });
        if (k === 0) pendingHeading = [];
      });
    } else if (!atomic && current?.chat && !parseChatLine(line) && !TIMESTAMP.test(line)) {
      current.lines.push(line.trim());
      current.chat.body.push(line.trim());
    } else if (current?.item && INDENTED.test(line)) {
      current.lines.push(line.trim());
    } else {
      // In a chat a line break is a deliberate cut: each line is a paragraph.
      const chat = atomic ? null : parseChatLine(line.trim());
      const block = begin(line.trim(), BULLET.test(line));
      if (chat) block.chat = { prefix: chat.prefix, sender: chat.sender, body: [chat.body] };
    }
  }
  flush();
  // A trailing heading with no content is a block of its own: it cannot go uncounted.
  if (pendingHeading.length > 0) {
    paragraph += 1;
    blocks.push({ section, item: false, paragraph, heading: [], lines: pendingHeading });
  }
  return blocks;
}

/**
 * Splits a text into units. In atomic sources (audio, video) the block is the unit: a transcript
 * line carries its timestamp and is not split. Otherwise, the block drops down to sentences when it has
 * more than one (Intl.Segmenter, locale `es`), and an inline enumeration, a dash or a semicolon also cut.
 * A table row is a unit (`p3.r12`) and its header travels as context. A chat line keeps its sender.
 */
function splitText(text, { atomic }) {
  const units = [];
  for (const block of splitBlocks(text, { atomic })) {
    const { paragraph } = block;
    const heading = block.heading.length > 0 ? `${block.heading.join('\n')}\n` : '';
    if (block.table) {
      units.push({
        section: block.section, item: true, paragraph, row: block.row, sentence: null, sender: null,
        table: { paragraph, header: block.table.header }, text: `${heading}${block.lines[0]}`,
      });
      continue;
    }
    const body = block.chat ? block.chat.body.join(' ') : block.lines.join(' ');
    const wholeLine = EXTRACTOR_SENDER.test(block.chat?.sender ?? '');
    const pieces = atomic ? [block.lines.join('\n')] : wholeLine ? [body] : splitBlock(body);
    pieces.forEach((piece, i) => {
      // The first sentence of a chat line keeps its timestamp and its sender; the others carry the sender.
      const withSender = block.chat ? `${i === 0 ? block.chat.prefix : `${block.chat.sender}:`} ${piece}` : piece;
      units.push({
        section: block.section,
        item: block.item && i === 0,
        paragraph,
        row: null,
        sentence: pieces.length > 1 ? i + 1 : null,
        sender: block.chat?.sender ?? null,
        table: null,
        text: `${i === 0 ? heading : ''}${withSender}`,
      });
    });
    if (pieces.length === 0 && block.heading.length > 0) {
      units.push({ section: block.section, item: false, paragraph, row: null, sentence: null, sender: null, table: null, text: block.heading.join('\n') });
    }
  }
  return units;
}

/**
 * Numbers the units of the bundle: first the text of the input and then each attachment with extracted text.
 * The `id` is a consecutive integer (the `unit_ids` contract of the schema); the `label` (`p3.s2`: paragraph 3,
 * sentence 2; `p3.r12`: row 12 of the table of paragraph 3; `a7.p3` in an attachment) shows the model the structure.
 * `sender` is the sender of a chat line, or `null`.
 * @param {{text?: string, attachments?: {id: number, kind: string, extracted?: string|null}[]}} bundle
 */
export function numberUnits(bundle) {
  const out = [];
  let id = 0;
  const push = (source, atomic, text, sourceIndex, labelPrefix) => {
    for (const u of splitText(text, { atomic })) {
      id += 1;
      const suffix = u.row ? `.r${u.row}` : (u.sentence ? `.s${u.sentence}` : '');
      const label = `${labelPrefix}p${u.paragraph}${suffix}`;
      out.push({
        id, label, source, section: u.section, atomic, item: u.item, sourceIndex, text: u.text, sender: u.sender, time: u.text.match(UNIT_TIME)?.[1] ?? null,
        ...(u.table ? { table: { label: `${labelPrefix}p${u.table.paragraph}`, header: u.table.header } } : {}),
      });
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

// Labels the prompts show around the units, one set per account language (UD-018).
const LABELS = {
  'es-419': { input: 'Texto del input', attachment: 'Adjunto', tableHeader: 'Cabecera de la tabla' },
  en: { input: 'Input text', attachment: 'Attachment', tableHeader: 'Header of table' },
};

function sourceLabel(source, labels) {
  return source.type === 'input' ? labels.input : `${labels.attachment} ${source.attachment_id} (${source.kind})`;
}

/** Text of the units for the prompt: `[u12] …`, grouped by source. */
export function renderUnits(units, language = 'es-419') {
  const labels = LABELS[language] ?? LABELS['es-419'];
  const lines = [];
  let lastKey = null;
  let lastTable = null;
  for (const u of units) {
    const key = u.source.type === 'input' ? 'input' : `a${u.source.attachment_id}`;
    if (key !== lastKey) {
      if (lastKey !== null) lines.push('');
      lines.push(`### ${sourceLabel(u.source, labels)}`);
      lastKey = key;
    }
    // A table header is context, not a unit: it goes once before its rows.
    if (u.table?.header && u.table.label !== lastTable) lines.push(`${labels.tableHeader} ${u.table.label}: ${u.table.header}`);
    lastTable = u.table?.label ?? null;
    lines.push(`[u${u.id}] (${u.label}) ${u.text.replace(/\n/g, '\n      ')}`);
  }
  return lines.join('\n');
}

export function estimateTokens(text, charsPerToken) {
  return Math.ceil(String(text).length / charsPerToken);
}

/**
 * Splits the units into chunks disjoint by unit only at structural boundaries (report 02 §2.2 and §3.3):
 * change of source or of section. An audio or video attachment is not split (a monologue returns to distant topics,
 * splitting it adds task and aggregation noise [F19]). If everything fits in the budget, a single chunk.
 *
 * @param {ReturnType<typeof numberUnits>} units
 * @param {{budgetTokens: number, charsPerToken: number}} opts
 * @returns {ReturnType<typeof numberUnits>[]}
 */
export function partitionUnits(units, { budgetTokens, charsPerToken }) {
  const cost = (list) => estimateTokens(renderUnits(list), charsPerToken);
  if (units.length === 0 || cost(units) <= budgetTokens) return [units];

  // Indivisible contiguous groups: same source and same section, or the whole atomic attachment.
  const groups = [];
  for (const u of units) {
    const last = groups.at(-1);
    const sameGroup = last && last.sourceIndex === u.sourceIndex && (u.atomic || last.section === u.section);
    if (sameGroup) last.units.push(u);
    else groups.push({ sourceIndex: u.sourceIndex, section: u.section, units: [u] });
  }

  // A group that does not fit on its own is opened at each bullet or item (a docx of N points is split by items,
  // report 02 §2.2). Without items it stays whole: there is no other structural boundary.
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
