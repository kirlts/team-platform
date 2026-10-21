// Counts the marks of generated writing in the titles, bodies and field values the analyzer produces (UD-019).
//
// Each pattern cites the section of the Wikipedia guide "Signs of AI writing" it comes from (local copy in .local-ref, not
// versioned). This is a measurement of the bench only: nothing at runtime rewrites or filters the prose of the model.
//
//   countTells(text, { input })   marks found in a text; a match that the input itself contains verbatim is not counted,
//                                 because the analyzer must keep names, figures and quotations as they appear
//   tellsOfProposal(proposal, { input })   { total, perMessage, byPattern, found } over the whole proposal

// Sections of the guide, by the short key the patterns cite.
export const SECTIONS = Object.freeze({
  significance: 'Undue emphasis on significance, legacy, and broader trends',
  notability: 'Canned emphasis on notability, attribution, and media coverage',
  superficial: 'Superficial analyses',
  promotional: 'Promotional and advertisement-like language',
  vague: 'Vague attributions and overgeneralization of opinions',
  outline: 'Outline-like conclusions about challenges and future prospects',
  vocabulary: 'High density of "AI vocabulary" words',
  copulatives: 'Avoidance of basic copulatives ("is"/"are" phrases)',
  connection: 'Vague expression of connection or association',
  parallelism: 'Negative parallelisms',
  triplet: 'Rule of three',
  bold: 'Overuse of boldface',
  inlineHeader: 'Inline-header vertical lists',
  emDash: 'Overuse of em dashes',
  emoji: 'Emoji as formatting',
  curly: 'Curly quotation marks and apostrophes',
  markdown: 'Use of Markdown',
  collaborative: 'Collaborative communication',
  cutoff: 'Knowledge-cutoff disclaimers and speculation about gaps in sources',
  placeholder: 'Phrasal templates and placeholder text',
  summary: 'Section summaries (historical indicators)',
  didactic: 'Didactic disclaimers (historical indicators)',
});

const words = (list) => `(?:${list.join('|')})`;

/** @type {{id: string, section: keyof typeof SECTIONS, lang: 'en'|'es'|'any', pattern: RegExp}[]} */
export const PATTERNS = [
  // Style and markup
  { id: 'em-dash', section: 'emDash', lang: 'any', pattern: /—|\s–\s/ },
  { id: 'bold', section: 'bold', lang: 'any', pattern: /\*\*[^*\n]+\*\*|__[^_\n]+__/ },
  { id: 'inline-header-list', section: 'inlineHeader', lang: 'any', pattern: /^\s*(?:[-*•]|\d+[.)])\s+\*\*[^*\n]+\*\*\s*:/m },
  { id: 'markdown-heading', section: 'markdown', lang: 'any', pattern: /^\s{0,3}#{1,6}\s+\S/m },
  { id: 'emoji', section: 'emoji', lang: 'any', pattern: /\p{Extended_Pictographic}/u },
  { id: 'curly-quotes', section: 'curly', lang: 'any', pattern: /[“”‘’]/ },
  { id: 'placeholder', section: 'placeholder', lang: 'any', pattern: /\[(?:insert|your|nombre|fecha|completar|pegar)[^\]]*\]|lorem ipsum|\bXX[-/]XX\b|\bTODO\b|\{\{[^}]*\}\}|<<[^>]*>>/i },

  // AI vocabulary
  { id: 'vocab-en', section: 'vocabulary', lang: 'en', pattern: new RegExp(`\\b${words(['delv(?:e|es|ed|ing)', 'crucial(?:ly)?', 'pivotal', 'seamless(?:ly)?', 'robust', 'landscape', 'tapestry', 'underscor(?:e|es|ed|ing)', 'showcas(?:e|es|ed|ing)', 'foster(?:s|ed|ing)?', 'vibrant', 'enhanc(?:e|es|ed|ing)', 'intricate', 'meticulous(?:ly)?', 'leverag(?:e|es|ed|ing)', 'holistic', 'comprehensive', 'streamlin(?:e|es|ed|ing)', 'invaluable', 'paramount', 'cutting-edge', 'game-chang(?:er|ing)'])}\\b`, 'i') },
  { id: 'vocab-es', section: 'vocabulary', lang: 'es', pattern: new RegExp(`\\b${words(['cruciales', 'fundamental(?:es)?', 'robust[oa]s?', 'integral(?:es)?', 'potenci(?:ar|a|an|ando|ado)', 'sin fisuras', 'panorama', 'destac(?:ar|a|an|ando|ado)', 'garantiz(?:ar|a|an|ando)', 'valios[oa]s?', 'dinámic[oa]s?', 'vital(?:es)?', 'pilares?', 'tapiz', 'enriquec(?:er|e|en|edor[a]?)', 'cabe señalar', 'meticulos[oa]s?', 'imprescindibles?'])}\\b|\\b(?:papel|rol|elemento|factor|pieza|aspecto|punto|momento|componente|pilar|paso|etapa|socio|persona)s?\\s+clave\\b|\\bes clave\\b`, 'i') },

  // Significance, legacy, trends
  { id: 'significance-en', section: 'significance', lang: 'en', pattern: /\b(?:testament to|lasting (?:impact|legacy)|enduring (?:legacy|relevance|impact)|marks? a (?:pivotal|significant|turning)|plays? an? (?:vital|key|crucial|significant|important|pivotal) role|broader (?:movement|trend|context)|reflects? a (?:broader|growing)|highlights? the importance|underscores? the (?:importance|need))\b/i },
  { id: 'significance-es', section: 'significance', lang: 'es', pattern: /\b(?:marca un hito|(?:desempeña|juega|cumple) un papel (?:clave|crucial|fundamental|importante|vital|esencial)|refleja una tendencia|legado|pone de relieve|subraya la|resalta la importancia|evidencia la importancia|testimonio de|impacto duradero|contexto más amplio|importancia (?:crucial|fundamental|creciente))\b/i },
  { id: 'notability', section: 'notability', lang: 'any', pattern: /\b(?:independent coverage|ha sido destacad[oa] en|cobertura (?:mediática|independiente)|featured in|media outlets|presencia (?:activa )?en redes|active social media presence)\b/i },

  // Superficial analyses ("-ing" tails)
  { id: 'ing-tail-en', section: 'superficial', lang: 'en', pattern: new RegExp(`,\\s+${words(['highlighting', 'underscoring', 'emphasizing', 'reflecting', 'ensuring', 'showcasing', 'contributing to', 'fostering', 'demonstrating', 'symbolizing', 'illustrating', 'enabling'])}\\b`, 'i') },
  { id: 'gerund-tail-es', section: 'superficial', lang: 'es', pattern: new RegExp(`,\\s+${words(['destacando', 'subrayando', 'reflejando', 'garantizando', 'asegurando', 'demostrando', 'evidenciando', 'contribuyendo a', 'fomentando', 'resaltando', 'ilustrando', 'permitiendo así'])}\\b`, 'i') },

  // Promotional language
  { id: 'promotional-en', section: 'promotional', lang: 'en', pattern: /\b(?:breathtaking|stunning|state-of-the-art|world-class|rich (?:cultural|history|heritage|tapestry)|diverse range|unique(?:ly)? (?:blend|experience)|renowned|exceptional|remarkable|powerful|elegant)\b/i },
  { id: 'promotional-es', section: 'promotional', lang: 'es', pattern: /\b(?:impresionante|de vanguardia|de primer nivel|de clase mundial|amplia gama|experiencia única|reconocid[oa]|excepcional|notable|poderos[oa]|elegante|innovador[a]?|excelencia)\b/i },

  // Vague attributions
  { id: 'vague-en', section: 'vague', lang: 'en', pattern: /\b(?:some (?:say|argue|believe|users)|many (?:users|people|believe)|experts (?:say|agree|believe)|it is (?:widely|often|generally) (?:believed|considered|said)|observers|industry reports|studies (?:show|suggest))\b/i },
  { id: 'vague-es', section: 'vague', lang: 'es', pattern: /\b(?:algunos (?:dicen|afirman|opinan|usuarios)|muchos (?:usuarios|piensan|creen)|los expertos|se (?:dice|considera ampliamente|cree) que|según diversas fuentes|diversos estudios)\b/i },
  { id: 'connection', section: 'connection', lang: 'any', pattern: /\b(?:in connection with|en relación con|asociad[oa]s? (?:principalmente|ampliamente)|widely associated)\b/i },
  { id: 'outline', section: 'outline', lang: 'any', pattern: /\b(?:despite (?:its|these|the)[^.]{0,60}(?:faces?|challenges)|a pesar de (?:sus|estos|los) desafíos|future (?:prospects|outlook)|perspectivas (?:a futuro|futuras)|desafíos y oportunidades|challenges and opportunities)\b/i },

  // Copulatives
  { id: 'copula-en', section: 'copulatives', lang: 'en', pattern: /\b(?:serves? as|stands? as|acts? as an?|boasts?|features? an?|represents? an?|constitutes?|functions? as)\b/i },
  { id: 'copula-es', section: 'copulatives', lang: 'es', pattern: /\b(?:se erige|sirve como|actúa como|cuenta con|constituye|representa un|funciona como|ostenta|alberga)\b/i },

  // Negative parallelisms
  { id: 'not-just-en', section: 'parallelism', lang: 'en', pattern: /\bnot (?:just|only|merely|simply)\b[^.]{0,100}\b(?:but|rather)\b|\b(?:it|this|that)(?:'s| is| isn't| is not)\s+not\b[^.;]{0,80}[,;—]\s*(?:but|it'?s|it is)\b|\brather than\b/i },
  { id: 'not-just-es', section: 'parallelism', lang: 'es', pattern: /\bno (?:solo|sólo|únicamente|simplemente|es solo|es sólo)\b[^.]{0,100}\b(?:sino|pero también)\b|\bno es\b[^.;]{0,80}[,;]\s*(?:sino|es)\b/i },
  { id: 'triplet', section: 'triplet', lang: 'any', pattern: /\b[a-záéíóúñ]+(?:ive|ful|ous|able|ible|ic|ivo|iva|oso|osa|able|ente|ico|ica),\s+[a-záéíóúñ]+(?:ive|ful|ous|able|ible|ic|ivo|iva|oso|osa|ente|ico|ica),?\s+(?:and|y|e|or|o)\s+[a-záéíóúñ]+(?:ive|ful|ous|able|ible|ic|ivo|iva|oso|osa|ente|ico|ica)\b/i },

  // Communication aimed at the user, disclaimers, closing summaries
  { id: 'collaborative-en', section: 'collaborative', lang: 'en', pattern: /(?:^|[.!?]\s+)(?:here(?:'s| is| are)|certainly|sure|of course|great question)\b|\bI hope (?:this|that)\b|\blet me know\b|\bfeel free\b|\bas an ai\b/i },
  { id: 'collaborative-es', section: 'collaborative', lang: 'es', pattern: /(?:^|[.!?]\s+)(?:aquí (?:tienes|está|van)|claro|por supuesto|con gusto)\b|\bespero que (?:esto|te|sirva)\b|\bavísame\b|\bno dudes en\b|\bcomo (?:un )?modelo de lenguaje\b/i },
  // Statements about what the input does not say, and guesses about what it might mean (guide: «speculation about gaps in sources»).
  { id: 'missing-info', section: 'cutoff', lang: 'es', pattern: /\bno se (?:indica|indican|indicó|indicaron|menciona|mencionan|mencionó|especifica|especifican|especificó|sabe|aclara|informa|señala)\b|\bsin (?:plazo|fecha|detalle|detalles) (?:indicad[oa]s?|especificad[oa]s?)\b/i },
  { id: 'missing-info-en', section: 'cutoff', lang: 'en', pattern: /\b(?:no|not) (?:deadline |date |detail |details )?(?:was |were |is |are )?(?:specified|mentioned|indicated|stated|given|provided)\b/i },
  { id: 'speculation', section: 'cutoff', lang: 'any', pattern: /\b(?:lo que|which) (?:sugiere|apunta|indica|implica|suggests|points to|indicates|implies)\b|\b(?:probablemente|presumiblemente|posiblemente|likely|probably|presumably)\b|\bsuggesting\b|\bsugiriendo\b/i },
  { id: 'cutoff', section: 'cutoff', lang: 'any', pattern: /\b(?:as of my last|not widely documented|not (?:publicly )?available|likely (?:supports|has|is)|no está (?:ampliamente )?documentad[oa]|no hay información (?:disponible|pública)|hasta mi última actualización)\b/i },
  { id: 'didactic', section: 'didactic', lang: 'any', pattern: /\b(?:it(?:'s| is) (?:important|worth|crucial) (?:to|noting)|worth noting|note that|es importante (?:señalar|destacar|notar|tener en cuenta|recordar)|cabe (?:destacar|señalar|mencionar|resaltar)|vale la pena (?:destacar|señalar|mencionar))\b/i },
  { id: 'closing-summary', section: 'summary', lang: 'any', pattern: /(?:^|[.!?]\s+|\n)(?:in (?:summary|conclusion)|to (?:summarize|sum up)|overall|en (?:resumen|conclusión|síntesis|definitiva)|para (?:resumir|concluir)|en general)\b/i },
];

/**
 * Marks found in a text. A match that the input contains verbatim is not counted: the analyzer keeps names, figures and
 * quotations as the person wrote them.
 * @param {string} text
 * @param {{input?: string}} [opts]
 * @returns {{id: string, section: string, match: string}[]}
 */
export function countTells(text, { input = '' } = {}) {
  const value = String(text ?? '');
  const source = String(input).toLowerCase();
  const found = [];
  for (const { id, section, pattern } of PATTERNS) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const m of value.matchAll(global)) {
      const match = m[0].trim();
      if (match && source.includes(match.toLowerCase())) continue;
      found.push({ id, section, match });
    }
  }
  return found;
}

// Function words used to tell which language a generated text is written in; each list holds words that the other
// language does not use. The bench uses it to check the output language (UD-018); nothing at runtime reads it.
const ES_WORDS = new Set('el la los las de del que y en un una por para con no se es al lo como más pero sus le ya o este esta son está cuando también sin sobre'.split(' '));
const EN_WORDS = new Set('the of and to in is are was for that this with it on as be at by from or an not but have has can will when also into than then which'.split(' '));

/** 'es', 'en' or null (too little text) by the weight of the function words of each language. */
export function detectLanguage(text) {
  const words = String(text ?? '').toLowerCase().match(/[a-záéíóúñü]+/g) ?? [];
  const es = words.filter((w) => ES_WORDS.has(w)).length;
  const en = words.filter((w) => EN_WORDS.has(w)).length;
  if (es + en < 4) return null;
  return es >= en ? 'es' : 'en';
}

/** Share of the messages of a proposal whose prose is written in `language` ('es' or 'en'); null without messages. */
export function languageShare(proposal, language) {
  const messages = proposal?.messages ?? [];
  const judged = messages.map((m) => detectLanguage(proseOf(m).join(' '))).filter((l) => l !== null);
  return judged.length === 0 ? null : judged.filter((l) => l === language).length / judged.length;
}

/** Texts of a message that carry prose: title, body and every field value. */
export function proseOf(message) {
  return [message.title, message.body, ...Object.values(message.fields ?? {}).filter((v) => typeof v === 'string')];
}

/**
 * Marks over a whole proposal.
 * @param {{messages?: object[]}} proposal
 * @param {{input?: string}} [opts]
 * @returns {{total: number, messages: number, perMessage: number, byPattern: Record<string, number>, found: object[]}}
 */
export function tellsOfProposal(proposal, { input = '' } = {}) {
  const messages = proposal?.messages ?? [];
  const found = [];
  messages.forEach((message, index) => {
    for (const text of proseOf(message)) for (const tell of countTells(text, { input })) found.push({ ...tell, message: index + 1 });
  });
  const byPattern = {};
  for (const t of found) byPattern[t.id] = (byPattern[t.id] ?? 0) + 1;
  return { total: found.length, messages: messages.length, perMessage: messages.length === 0 ? 0 : found.length / messages.length, byPattern, found };
}
