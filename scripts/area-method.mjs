#!/usr/bin/env node
// Builds a routing configuration (areas, templates, member profiles) from the corpus of requests of one team.
//
//   node scripts/area-method.mjs labels  rows.jsonl
//   node scripts/area-method.mjs analyze rows.jsonl --team team.json [--families families.json] [--out report.json]
//   node scripts/area-method.mjs propose rows.jsonl --team team.json --purposes purposes.json --actor ed@x.org
//                                        [--families families.json] [--intents intents.json] [--intent-fields fields.json] [--out load.json]
//
// `rows.jsonl` has one request per line, as `scripts/request-rows.mjs` writes it. `docs/METODO-DE-REPARTO.md` explains each step, each
// criterion and the file shapes. Everything here is deterministic: the same rows give the same report and the same proposal. Nothing reads the
// words of a person to decide anything: the model that extracted the rows already interpreted them, and this script only counts and compares
// the fields it returned.

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseTemplate, TEMPLATE_DESCRIPTION_MAX } from '../src/analyze/templates.js'

// ---- knobs. Each default has its source; the command line overrides every one.
export const DEFAULTS = Object.freeze({
  // An area must hold enough requests to be measured with a sample of 60 routed requests (the sample the routing experiment uses): 3 of 60.
  minShare: 0.05,
  // Cohen (1988): a standardized difference of 0.5 is the conventional medium effect, the smallest one a person notices without measuring.
  minEffect: 0.5,
  // Definition: two areas share a map of the system when more than half of the shorter list of modules is common.
  maxOverlap: 0.5,
  // The map of an area is read from its ten most frequent modules; a longer list reaches modules that appear once.
  mapSize: 10,
  // A template needs 20 requests so that the mean of a 0..1 dimension has a standard error under a quarter of its standard deviation (1 / sqrt(20) = 0.22).
  minTemplate: 20,
  // 1.96 is the 97.5th percentile of the normal distribution: a one-sided 97.5 % bound on a proportion.
  z: 1.96,
  // 5 folds: the usual cross-validation size that keeps at least 80 % of the rows for training.
  folds: 5,
  // Fixed seed so a report can be reproduced (any integer would do).
  seed: 7,
  // Definition: the missing value is mostly in a person's hands when it passes half of the scale.
  personValueAbove: 0.5,
  // A description of an area holds at most three limits: the description is capped at TEMPLATE_DESCRIPTION_MAX characters.
  maxLimitsListed: 3,
  maxTerms: 3
})

export const DIMENSIONS = Object.freeze(['understand_vs_create', 'severity', 'irreversibility', 'missing_value', 'urgency'])

const STOP = new Set(`de la el en y a que los las del se un una con por para no lo al sin su es más o sea sus le les como pero ya the of and to in for on with is are it its be at as by an or if`.split(' '))

// ---- small statistics
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const sd = (xs) => { const m = mean(xs); return xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)) : 0 }
const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d

/** Standardized difference of two samples with the pooled standard deviation; 0 when either has fewer than two values or both are constant. */
export function cohenD (a, b) {
  if (a.length < 2 || b.length < 2) return 0
  const pooled = Math.sqrt(((a.length - 1) * sd(a) ** 2 + (b.length - 1) * sd(b) ** 2) / (a.length + b.length - 2))
  return pooled === 0 ? 0 : (mean(a) - mean(b)) / pooled
}

/** A seeded generator (mulberry32) so the folds of a validation do not change between runs. */
export function seededRandom (seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const words = (text) => String(text ?? '').toLowerCase().match(/\p{L}{3,}/gu)?.filter((w) => !STOP.has(w)) ?? []

/**
 * Up to `k` representative phrases of a list of short phrases. Each round takes the content word that appears in most of the remaining phrases,
 * keeps the most frequent phrase that has it (the shortest on a tie) and drops every phrase with that word, so the phrases kept are real ones
 * that say different things.
 */
export function topPhrases (phrases, k = DEFAULTS.maxTerms) {
  let left = phrases.map((p) => String(p ?? '').trim().toLowerCase()).filter(Boolean)
  const out = []
  while (out.length < k && left.length) {
    const count = new Map()
    for (const p of left) for (const w of new Set(words(p))) count.set(w, (count.get(w) ?? 0) + 1)
    const [word] = [...count.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null]
    const pool = word ? left.filter((p) => words(p).includes(word)) : left
    const freq = new Map()
    for (const p of pool) freq.set(p, (freq.get(p) ?? 0) + 1)
    const [best] = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]
    out.push(best)
    left = left.filter((p) => !pool.includes(p))
  }
  return out
}

const top = (items, k) => {
  const count = new Map()
  for (const x of items) if (x) count.set(x, (count.get(x) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, k)
}

// ---- reading
export const readJsonl = (file) => readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

/** The team file: `{ members: [{ email, name, kind, role }], limits: [{ id, text, person }] }`. Throws on a shape the rest cannot use. */
export function validateTeam (team) {
  const problems = []
  const names = new Set()
  for (const m of team?.members ?? []) {
    if (!m.name || !m.email) problems.push(`A member needs name and email: ${JSON.stringify(m)}`)
    if (names.has(m.name)) problems.push(`Repeated member name ${m.name}`)
    names.add(m.name)
    if (!['person', 'agent'].includes(m.kind ?? 'person')) problems.push(`Member ${m.name}: kind must be person or agent`)
  }
  const ids = new Set()
  for (const l of team?.limits ?? []) {
    if (!/^[a-z][a-z0-9_]*$/.test(l.id ?? '')) problems.push(`Limit id ${l.id} must be lowercase letters, digits and underscore`)
    if (ids.has(l.id)) problems.push(`Repeated limit id ${l.id}`)
    ids.add(l.id)
    if (!l.text) problems.push(`Limit ${l.id} needs a text`)
  }
  if ((team?.members ?? []).length === 0) problems.push('The team has no members')
  if (problems.length) throw new Error(problems.join('\n'))
  return team
}

export const limitById = (team) => new Map((team.limits ?? []).map((l) => [l.id, l]))

/** Whether the request needs a person: the missing value is mostly a person's, or it touches a limit that a person lifts. */
export function requiresPerson (row, team, { personValueAbove = DEFAULTS.personValueAbove } = {}) {
  const limits = limitById(team)
  const personHolder = row.value_holder && !['model', 'nobody'].includes(row.value_holder)
  return (personHolder && row.missing_value > personValueAbove) || (row.limits ?? []).some((id) => limits.get(id)?.person === true)
}

// ---- grouping
const slug = (text) => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/** The area (family) title of each row: the object label through the families map, or the label itself with a capital. */
export function withAreas (rows, families = {}) {
  return rows.map((r) => ({ ...r, area: families[r.object] ?? capital(r.object) }))
}

const weeksOf = (rows) => {
  const t = rows.map((r) => Date.parse(r.date)).filter(Number.isFinite)
  return t.length > 1 ? Math.max(1, (Math.max(...t) - Math.min(...t)) / 604800000) : 1 // 604800000 ms: seven days
}

/** What the rows of one group say: sizes, means of the dimensions, who asks, who holds the value, limits, terms and modules. */
export function profileOf (rows, team, opts = {}, totalRows = rows.length, weeks = weeksOf(rows)) {
  const n = rows.length
  const share = (items, k) => top(items, k).map(([name, c]) => ({ name, n: c, share: round(c / n) }))
  return {
    n,
    share: round(n / totalRows),
    per_week: round(n / weeks, 2),
    dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, round(mean(rows.map((r) => Number(r[d]) || 0)))])),
    person_share: round(rows.filter((r) => requiresPerson(r, team, opts)).length / n),
    askers: share(rows.map((r) => r.who), 4),
    holders: share(rows.map((r) => r.value_holder), 4),
    limits: top(rows.flatMap((r) => r.limits ?? []), 5).map(([id, c]) => ({ id, n: c })),
    maximize: topPhrases(rows.map((r) => r.maximize).filter(Boolean)),
    sacrifice: topPhrases(rows.map((r) => r.sacrifice).filter(Boolean)),
    modules: top(rows.map((r) => String(r.module ?? '').toLowerCase()), opts.mapSize ?? DEFAULTS.mapSize).map(([m]) => m),
    correction_share: round(rows.filter((r) => r.correction).length / n),
    intents: top(rows.map((r) => r.intent), 12).map(([label, c]) => ({ label, n: c }))
  }
}

// ---- how well a group is recognized by the text alone: multinomial naive Bayes with Laplace smoothing, cross-validated
export function recognition (rows, labelOf, { folds = DEFAULTS.folds, seed = DEFAULTS.seed, z = DEFAULTS.z } = {}) {
  const labels = rows.map(labelOf)
  const tokens = rows.map((r) => words(`${r.summary} ${r.module ?? ''}`))
  const rand = seededRandom(seed)
  const order = rows.map((_, i) => i).sort(() => rand() - 0.5)
  const fold = new Array(rows.length)
  order.forEach((i, k) => { fold[i] = k % folds })
  const classes = [...new Set(labels)]
  const hits = new Map(classes.map((c) => [c, { n: 0, ok: 0 }]))
  const confusion = {}
  for (let f = 0; f < folds; f++) {
    const model = new Map(classes.map((c) => [c, { docs: 0, total: 0, count: new Map() }]))
    const vocabulary = new Set()
    rows.forEach((_, i) => {
      if (fold[i] === f) return
      const m = model.get(labels[i])
      m.docs++
      for (const t of tokens[i]) { m.count.set(t, (m.count.get(t) ?? 0) + 1); m.total++; vocabulary.add(t) }
    })
    const trained = rows.filter((_, i) => fold[i] !== f).length
    rows.forEach((_, i) => {
      if (fold[i] !== f) return
      let best = null
      for (const [c, m] of model) {
        if (m.docs === 0) continue
        let score = Math.log(m.docs / trained)
        for (const t of tokens[i]) score += Math.log(((m.count.get(t) ?? 0) + 1) / (m.total + vocabulary.size + 1)) // Laplace: +1
        if (!best || score > best.score) best = { c, score }
      }
      const h = hits.get(labels[i])
      h.n++
      if (best?.c === labels[i]) h.ok++
      else if (best) { const key = `${labels[i]} -> ${best.c}`; confusion[key] = (confusion[key] ?? 0) + 1 }
    })
  }
  const total = rows.length
  const accuracy = [...hits.values()].reduce((a, h) => a + h.ok, 0) / total
  const base = Math.max(...[...hits.values()].map((h) => h.n)) / total
  const bound = (p, n) => p - z * Math.sqrt((p * (1 - p)) / Math.max(n, 1))
  return {
    accuracy: round(accuracy), base: round(base), lower: round(bound(accuracy, total)),
    per_class: Object.fromEntries([...hits.entries()].map(([c, h]) => [c, { n: h.n, recall: round(h.ok / (h.n || 1)), lower: round(bound(h.ok / (h.n || 1), h.n)) }])),
    confusion: Object.fromEntries(Object.entries(confusion).sort((a, b) => b[1] - a[1]))
  }
}

const dominantLimit = (profile) => profile.limits[0]?.id ?? null
const overlap = (a, b) => { const small = Math.min(a.length, b.length); return small === 0 ? 0 : a.filter((m) => b.includes(m)).length / small }

/** Measures every candidate area against the four criteria of the method. Returns the report. */
export function analyze (rows, team, { families = {}, ...overrides } = {}) {
  validateTeam(team)
  const o = { ...DEFAULTS, ...overrides }
  const tagged = withAreas(rows, families)
  const weeks = weeksOf(tagged)
  const titles = [...new Set(tagged.map((r) => r.area))]
  const byArea = new Map(titles.map((t) => [t, tagged.filter((r) => r.area === t)]))
  const profiles = new Map(titles.map((t) => [t, profileOf(byArea.get(t), team, o, tagged.length, weeks)]))
  const recognized = recognition(tagged, (r) => r.area, o)
  const areas = titles.map((title) => {
    const p = profiles.get(title)
    const others = titles.filter((t) => t !== title)
    const overlaps = Object.fromEntries(others.map((t) => [t, round(overlap(p.modules, profiles.get(t).modules))]))
    const effects = Object.fromEntries(others.map((t) => {
      const d = Object.fromEntries(DIMENSIONS.map((dim) => [dim, round(cohenD(byArea.get(title).map((r) => Number(r[dim]) || 0), byArea.get(t).map((r) => Number(r[dim]) || 0)), 2)]))
      const sameLimit = dominantLimit(p) === dominantLimit(profiles.get(t))
      const biggest = Math.max(...DIMENSIONS.map((dim) => Math.abs(d[dim])))
      return [t, { biggest_effect: biggest, same_dominant_limit: sameLimit, distinct: !sameLimit || biggest >= o.minEffect }]
    }))
    const recall = recognized.per_class[title]
    const criteria = {
      volume: { pass: p.share >= o.minShare, value: p.share, min: o.minShare },
      recognized_by_text: { pass: recall.lower > p.share, recall: recall.recall, lower: recall.lower, chance: p.share },
      own_map: { pass: Object.values(overlaps).every((v) => v <= o.maxOverlap), overlap_with: overlaps, max: o.maxOverlap },
      distinct_treatment: { pass: Object.values(effects).every((e) => e.distinct), against: effects, min_effect: o.minEffect }
    }
    const nearest = others.map((t) => ({ t, d: Math.hypot(...DIMENSIONS.map((dim) => p.dimensions[dim] - profiles.get(t).dimensions[dim])) })).sort((a, b) => a.d - b.d)[0]
    return { title, id: slug(title), profile: p, criteria, keep: Object.values(criteria).every((c) => c.pass), merge_into: Object.values(criteria).every((c) => c.pass) ? null : nearest?.t ?? null }
  })
  return { rows: tagged.length, weeks: round(weeks, 1), partition: recognized, areas, knobs: o }
}

// ---- writing the descriptions: four clauses plus limits, with what enters and what does not
const phrases = (items) => items.join('; ')
const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`)
const pct = (x) => `${Math.round(x * 100)} %`

/** Drops the clauses with the highest `drop` rank until the text fits `max`; throws when the required ones alone do not fit. */
export function fitClauses (clauses, max = TEMPLATE_DESCRIPTION_MAX) {
  const kept = [...clauses]
  const text = () => kept.map((c) => c.text).join(' ')
  while (text().length > max) {
    const i = kept.reduce((best, c, k) => (c.drop > (kept[best]?.drop ?? 0) ? k : best), -1)
    if (i < 0 || kept[i].drop === 0) throw new Error(`The required clauses take ${text().length} characters and the limit is ${max}.`)
    kept.splice(i, 1)
  }
  return text()
}

function areaClauses (entry, { team, purpose, examples, neighbours }) {
  const p = entry.profile
  const limits = limitById(team)
  const listed = p.limits.slice(0, DEFAULTS.maxLimitsListed).map((l) => limits.get(l.id)).filter(Boolean)
  const lifted = (l) => (l.person ? 'lo levanta una persona' : 'lo hace cumplir el sistema')
  const clauses = [{ text: `Propósito: ${purpose}`, drop: 0 }]
  if (p.maximize.length) clauses.push({ text: `Se maximiza: ${phrases(p.maximize)}.`, drop: 0 })
  if (p.sacrifice.length) clauses.push({ text: `Se sacrifica: ${phrases(p.sacrifice)}.`, drop: 0 })
  const askers = p.askers.slice(0, 2).map((a) => `${a.name} (${pct(a.share)})`)
  clauses.push({ text: `Entorno: lo piden ${list(askers)}; el ${pct(p.person_share)} exige a una persona.`, drop: 1 })
  if (listed.length) clauses.push({ text: `Límites: ${listed.map((l) => `${l.text} (${lifted(l)})`).join('; ')}.`, drop: 0 })
  if (examples.length) clauses.push({ text: `Entra: ${examples.map((e) => `«${e}»`).join(', ')}.`, drop: 3 })
  if (neighbours.length) clauses.push({ text: `No entra: lo propio de ${list(neighbours)} (va a su área).`, drop: 2 })
  return clauses
}

/** Up to three examples of an area: the summaries of its most frequent modules, one each; never from a confidential source. */
export function examplesOf (rows, area, count = 3) {
  const seen = new Set()
  const out = []
  const mine = rows.filter((r) => r.area === area && !r.confidential)
  for (const [module] of top(mine.map((r) => String(r.module ?? '').toLowerCase()), 12)) {
    const row = mine.find((r) => String(r.module ?? '').toLowerCase() === module)
    if (row && !seen.has(row.summary)) { seen.add(row.summary); out.push(row.summary) }
    if (out.length === count) break
  }
  return out
}

// ---- templates
const COMMON_FIELDS = Object.freeze([
  { name: 'request', label: 'Qué se pide', required: true },
  { name: 'value_missing', label: 'Qué falta y de quién es el valor (nadie si nada falta)', required: true },
  { name: 'limits_touched', label: 'Límites que toca (ninguno, o cuáles y quién los levanta)', required: true },
  { name: 'undo', label: 'Cómo se deshace y cuánto cuesta', required: false }
])
const q = (s) => JSON.stringify(s)

/** The markdown of one template: the area and the intent it serves, the common fields, the fields of the intent and the booleans of the area limits as output. */
export function templateMarkdown ({ intent, area, profile, team, extraFields = [] }) {
  const limits = limitById(team)
  const areaLimits = profile.limits.map((l) => limits.get(l.id)).filter(Boolean)
  const person = areaLimits.filter((l) => l.person)
  const description = fitClauses([
    { text: `${capital(intent.label)} del área ${area}: ${intent.n} pedidos del corpus.`, drop: 0 },
    ...(profile.maximize.length ? [{ text: `Se cuida: ${phrases(profile.maximize)}.`, drop: 1 }] : []),
    ...(profile.sacrifice.length ? [{ text: `Puede quedar apenas suficiente: ${phrases(profile.sacrifice)}.`, drop: 2 }] : []),
    ...(person.length ? [{ text: `Se detiene y consulta a una persona cuando toca: ${list(person.map((l) => l.text))}.`, drop: 3 }] : [])
  ])
  const fields = [...COMMON_FIELDS, ...extraFields]
  const lines = ['---', `name: ${q(capital(intent.label))}`, `description: ${q(description)}`, 'fields:',
    ...fields.map((f) => `  - { name: ${f.name}, label: ${q(f.label)}, required: ${f.required} }`)]
  if (areaLimits.length) {
    lines.push('output:', ...areaLimits.map((l) => `  - { name: touches_${l.id}, label: ${q(`Toca: ${l.text}`)}, type: boolean, required: true }`))
  }
  lines.push('---', '## Método',
    `Un pedido de tipo «${intent.label}» en el área ${area}. Cómo llenar cada campo:`,
    ...fields.map((f) => `- ${f.label}: ${f.required ? 'siempre, con lo que el pedido dice o deja deducir' : 'sólo si el pedido lo dice'}.`),
    'Un dato que el pedido no da ni deja deducir se deja vacío y no se inventa.', '',
    '## Formato de salida', 'Un mensaje por pedido. Título: verbo en infinitivo y objeto. Cuerpo: dos a cuatro frases con lo que se pide, dónde y qué se espera.', '',
    '## Salida',
    `Maximiza: ${profile.maximize.length ? phrases(profile.maximize) : 'que lo pedido quede resuelto'}. Acepta: ${profile.sacrifice.length ? phrases(profile.sacrifice) : 'un resultado sin pulir'}. ` +
    (person.length ? `Para y consulta a una persona si toca: ${list(person.map((l) => l.text))}.` : 'No tiene límites que exijan a una persona.'))
  return `${lines.join('\n')}\n`
}

// ---- member profiles
/** A draft profile in the first person, from what the corpus says about the member. The `role` sentence is the member's own. */
export function memberProfile (member, rows, team, opts = {}) {
  const asked = rows.filter((r) => r.who === member.name)
  const received = rows.filter((r) => r.to === member.name)
  const held = rows.filter((r) => r.value_holder === member.name)
  const limits = limitById(team)
  const parts = [member.role.trim()]
  const base = member.kind === 'agent' ? received : asked
  if (base.length) {
    const terms = topPhrases(base.map((r) => r.maximize).filter(Boolean))
    const lost = topPhrases(base.map((r) => r.sacrifice).filter(Boolean))
    if (terms.length) parts.push(`Maximizo: ${phrases(terms)}.${lost.length ? ` Acepto que quede apenas suficiente: ${phrases(lost)}.` : ''}`)
    const areas = top(base.map((r) => r.area), 3).map(([a, c]) => `${a} (${pct(c / base.length)})`)
    parts.push(member.kind === 'agent' ? `Lo que atiendo se reparte así: ${list(areas)}.` : `Pido sobre todo en ${list(areas)}.`)
  }
  if (member.kind === 'agent') {
    const person = (team.limits ?? []).filter((l) => l.person).map((l) => l.text)
    if (person.length) parts.push(`No decido: ${list(person)}. Eso sube a quien tiene el valor, como una pregunta de una línea con mi recomendación.`)
  } else if (held.length) {
    const areas = top(held.map((r) => r.area), 3).map(([a, c]) => `${a} (${c})`)
    parts.push(`Tengo el valor que falta en ${held.length} pedidos: ${list(areas)}. Esas decisiones son mías.`)
    const own = top(held.flatMap((r) => r.limits ?? []).filter((id) => limits.get(id)?.person), 2).map(([id]) => limits.get(id).text)
    if (own.length) parts.push(`Lo que sólo yo levanto: ${list(own)}.`)
  }
  return parts.join(' ')
}

// ---- the load file: areas with their templates, and member profiles
/**
 * Builds the load file from the rows. `purposes` maps an area title to its purpose sentence (a purpose is the team's, not the corpus's);
 * `intents` maps an intent label to the name of its template; `intentFields` maps a template name to extra fields.
 * Only areas that pass the four criteria are proposed; the others are listed in `skipped` with the area they would merge into.
 */
export function propose (rows, team, { purposes = {}, families = {}, intents = {}, intentFields = {}, actor, ...overrides } = {}) {
  const report = analyze(rows, team, { families, ...overrides })
  const tagged = withAreas(rows, families).map((r) => ({ ...r, intent: intents[r.intent] ?? r.intent }))
  const minTemplate = overrides.minTemplate ?? DEFAULTS.minTemplate
  const missing = report.areas.filter((a) => a.keep && !purposes[a.title]).map((a) => a.title)
  if (missing.length) throw new Error(`A purpose sentence is needed for: ${missing.join(', ')}`)
  const areas = []
  const skipped = []
  report.areas.forEach((entry, index) => {
    if (!entry.keep) { skipped.push({ title: entry.title, merge_into: entry.merge_into, failed: Object.entries(entry.criteria).filter(([, c]) => !c.pass).map(([k]) => k) }); return }
    // The areas the text most often confuses with this one are named as its borders.
    const borders = Object.keys(report.partition.confusion).filter((k) => k.startsWith(`${entry.title} -> `)).slice(0, 2).map((k) => k.split(' -> ')[1])
    const description = fitClauses(areaClauses(entry, { team, purpose: purposes[entry.title], examples: examplesOf(tagged, entry.title), neighbours: borders }))
    const mine = tagged.filter((r) => r.area === entry.title)
    const templates = [...new Set(mine.map((r) => r.intent))]
      .map((label) => ({ label, n: mine.filter((r) => r.intent === label).length }))
      .filter((i) => i.n >= minTemplate)
      .map((intent) => {
        const profile = profileOf(mine.filter((r) => r.intent === intent.label), team, { ...DEFAULTS, ...overrides })
        const markdown = templateMarkdown({ intent, area: entry.title, profile, team, extraFields: intentFields[intent.label] ?? [] })
        const parsed = parseTemplate(markdown)
        return { name: parsed.name, description: parsed.description, body_markdown: markdown }
      })
    areas.push({ title: entry.title, description, position: index + 1, templates })
  })
  const members = team.members.filter((m) => m.role).map((m) => ({ email: m.email, profile: memberProfile(m, tagged, team) }))
  const spec = { version: 1, ...(actor ? { actor } : {}), areas, members }
  validateLoadFile(spec)
  return { spec, skipped, report }
}

/** Throws when the load file has a shape the product would refuse: a template that does not parse, repeated names or a member without email. */
export function validateLoadFile (spec) {
  const problems = []
  const titles = new Set()
  for (const a of spec.areas ?? []) {
    if (titles.has(a.title)) problems.push(`Repeated area ${a.title}`)
    titles.add(a.title)
    if (!a.description) problems.push(`Area ${a.title} has no description`)
    const names = new Set()
    for (const t of a.templates ?? []) {
      try {
        const parsed = parseTemplate(t.body_markdown)
        if (names.has(parsed.name.toLowerCase())) problems.push(`Repeated template ${parsed.name} in ${a.title}`)
        names.add(parsed.name.toLowerCase())
      } catch (error) { problems.push(`Template ${t.name} of ${a.title}: ${error.message}`) }
    }
  }
  for (const m of spec.members ?? []) if (!m.email || !m.profile) problems.push(`A member needs email and profile: ${m.email}`)
  if (problems.length) throw new Error(problems.join('\n'))
  return spec
}

// ---- command line
function main (argv) {
  const [command, rowsFile, ...rest] = argv
  const option = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined }
  const numeric = Object.fromEntries(['minShare', 'minEffect', 'maxOverlap', 'minTemplate', 'z', 'folds', 'seed', 'mapSize', 'personValueAbove'].map((k) => [k, option(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`)]).filter(([, v]) => v !== undefined).map(([k, v]) => [k, Number(v)]))
  const out = (value) => { const text = `${JSON.stringify(value, null, 2)}\n`; if (option('--out')) writeFileSync(option('--out'), text); else process.stdout.write(text) }
  if (!['labels', 'analyze', 'propose'].includes(command) || !rowsFile) {
    console.error('Uso: node scripts/area-method.mjs (labels|analyze|propose) rows.jsonl [--team team.json] [--families f.json] [--intents i.json] [--intent-fields x.json] [--purposes p.json] [--actor correo] [--out archivo]')
    process.exit(2)
  }
  const rows = readJsonl(rowsFile)
  if (command === 'labels') {
    out({ objects: top(rows.map((r) => r.object), 1000).map(([label, n]) => ({ label, n })), intents: top(rows.map((r) => r.intent), 1000).map(([label, n]) => ({ label, n })) })
    return
  }
  if (!option('--team')) { console.error('Falta --team'); process.exit(2) }
  const team = readJson(option('--team'))
  const load = (flag, fallback) => (option(flag) ? readJson(option(flag)) : fallback)
  const common = { families: load('--families', {}), ...numeric }
  try {
    if (command === 'analyze') out(analyze(rows, team, common))
    else {
      const result = propose(rows, team, { ...common, purposes: load('--purposes', {}), intents: load('--intents', {}), intentFields: load('--intent-fields', {}), actor: option('--actor') })
      if (result.skipped.length) console.error(`Áreas que no cumplen los criterios: ${result.skipped.map((s) => `${s.title} (${s.failed.join(', ')}; se uniría a ${s.merge_into})`).join('; ')}`)
      out(result.spec)
    }
  } catch (error) { console.error(error.message); process.exit(1) }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
