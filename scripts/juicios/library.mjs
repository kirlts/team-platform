// The book of findings and decisions, read as data (UD-062). `docs/HALLAZGOS.md` is where every finding of every round
// ended up with its state; `docs/USER-DECISIONS.md` is where the owner's decisions are written. The judges of a screen
// receive from here what has been decided and what has been refuted, and the consolidator compares what they report
// against all of it. Nothing here calls a model: it is parsing and arithmetic.

export const SCREEN_IDS = ['home', 'messages', 'message-detail', 'areas', 'team', 'settings', 'connections', 'login']

// Where a finding lives, by the first words of its title. The book titles every finding «Pantalla: hallazgo». A prefix
// not listed here belongs to no screen and is only used to compare against.
const PREFIXES = [
  ['home', /^(Inicio|Compositor|Campana|Franja de Envíos|Fila)\b/i],
  ['messages', /^Mensajes\b/i],
  ['message-detail', /^(Ficha|Detalle)\b/i],
  ['areas', /^(Áreas|Plantilla|Nueva plantilla)\b/i],
  ['team', /^Equipo\b/i],
  ['settings', /^(Configuración|Proveedores|Proyecto)\b/i],
  ['connections', /^Conexiones\b/i],
  ['login', /^(Login|Entrar|Entrada)\b/i],
  ['flow-send', /^(Ventana de envíos|Propuesta|Quitar un mensaje|Volver a analizar)\b/i],
  ['global', /^(Lateral|Barra superior|Menú|Móvil|Tema oscuro)\b/i]
]

export function screenOfTitle (title) {
  const prefix = title.split(':')[0]
  return PREFIXES.find(([, re]) => re.test(prefix))?.[0] ?? null
}

const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim())

/** How the Estado column reads: refuted, decided, resolved or open. The reason is what follows the first colon. */
export function stateOf (estado) {
  const text = estado.replace(/`/g, '')
  if (/^(refutad|descartad)/i.test(text)) return { state: 'refuted', reason: text.replace(/^[^:]*:\s*/, '') }
  if (/^(main|cerrado|resuelto)/i.test(text)) return { state: 'resolved', reason: text.replace(/^[^:]*:\s*/, '') }
  if (/decisi[oó]n|UD-\d+/i.test(text)) return { state: 'decided', reason: text }
  return { state: 'open', reason: text }
}

/** Every row `| H-n | title | origin | state |` of the book. */
export function parseFindings (markdown) {
  const rows = []
  for (const line of markdown.split('\n')) {
    if (!/^\| H-\d+ \|/.test(line)) continue
    const [id, title, origin, estado = ''] = cells(line)
    if (!title) continue
    rows.push({
      id,
      title: title.replace(/`/g, ''),
      screen: screenOfTitle(title),
      origins: origin.match(/J\d-[AB]-\d+/g) ?? [],
      repeats: /Reaparece/.test(origin),
      ...stateOf(estado)
    })
  }
  return rows
}

/** The owner's decisions: `## [UD-n] title` with the line of «Decisión:». */
export function parseDecisions (markdown) {
  const out = []
  const blocks = markdown.split(/^## (?=\[UD-\d+\])/m).slice(1)
  for (const block of blocks) {
    const head = /^\[(UD-\d+)\]\s*(.+)/.exec(block)
    if (!head) continue
    const decision = /^\*\*Decisión:\*\*\s*(.+)$/m.exec(block)?.[1] ?? ''
    out.push({ id: head[1], title: head[2].trim(), decision: decision.trim(), text: `${head[2]} ${decision}`, ui: /panel\/|interfaz|pantalla|\bvista|bot[oó]n|[ií]cono/i.test(block) })
  }
  return out
}

// What decides whether a decision binds a screen: the words that name it. A decision about the whole interface binds all.
const SCREEN_WORDS = {
  home: /\binicio\b|campana|compositor|barra de texto|env[ií]os? seguidos|bandeja|últimos mensajes/i,
  messages: /\bmensajes\b|filtro respuestas/i,
  'message-detail': /ficha|detalle de un mensaje|respuestas? de un mensaje|\bmensaje (cerrado|abierto)\b/i,
  areas: /\báreas?\b|plantillas?/i,
  team: /\bequipo\b|miembros?|perfil/i,
  settings: /configuraci[oó]n|proveedor|descripci[oó]n del proyecto|idioma/i,
  connections: /conexiones|conector/i,
  login: /\blogin\b|\bentrar\b|inicio de sesi[oó]n/i
}
const WHOLE_INTERFACE = /cada vista|toda la interfaz|todo el panel|en todo el|íconos de medio|p[aá]rrafos largos|edici[oó]n en el lugar|se distingue a simple vista|estética/i

export function decisionsFor (screen, decisions) {
  return decisions.filter((d) => d.ui && (WHOLE_INTERFACE.test(d.text) || SCREEN_WORDS[screen]?.test(d.text)))
}

// ---- Comparing findings

const STOP = new Set('de la el los las un una unos unas en y o a al del que se su sus con por para sin sobre entre es son son como más menos pero sino ya no si lo le les tiene tienen hay'.split(' '))

const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/** The words that carry the meaning of a title: no accents, no function words, cut to their first five letters (a crude stem). */
export function tokens (title) {
  return new Set(fold(title).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)).map((t) => t.slice(0, 5)))
}

export function similarity (a, b) {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let common = 0
  for (const t of ta) if (tb.has(t)) common++
  return common / (ta.size + tb.size - common) // Jaccard
}

/**
 * Pairs of rows the book itself says are the same finding: a row that «Reaparece» with the id of an earlier one shares
 * that id in its origins. This is the ground truth the threshold is measured against.
 */
export function knownRepeats (rows) {
  const byOrigin = new Map()
  rows.forEach((r, i) => r.origins.forEach((o) => byOrigin.set(o, [...(byOrigin.get(o) ?? []), i])))
  const pairs = new Set()
  for (const idxs of byOrigin.values()) {
    for (let x = 0; x < idxs.length; x++) for (let y = x + 1; y < idxs.length; y++) pairs.add(`${idxs[x]}|${idxs[y]}`)
  }
  return pairs
}

/** Precision, recall and F1 of «same finding» by similarity threshold, over every pair of rows of the same screen. */
export function calibrate (rows, thresholds = Array.from({ length: 19 }, (_, i) => Number(((i + 1) * 0.05).toFixed(2)))) {
  const positives = knownRepeats(rows)
  const scored = []
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[i].screen !== rows[j].screen || rows[i].screen === null) continue
      scored.push({ truth: positives.has(`${i}|${j}`), score: similarity(rows[i].title, rows[j].title) })
    }
  }
  const total = scored.filter((s) => s.truth).length
  return {
    pairs: scored.length,
    repeats: total,
    table: thresholds.map((threshold) => {
      const hit = scored.filter((s) => s.score >= threshold)
      const tp = hit.filter((s) => s.truth).length
      const precision = hit.length === 0 ? 1 : tp / hit.length
      const recall = total === 0 ? 0 : tp / total
      return { threshold, flagged: hit.length, precision, recall, f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall) }
    })
  }
}
