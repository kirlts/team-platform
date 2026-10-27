#!/usr/bin/env node
// Builds a routing configuration (areas, guards, templates, member profiles) from the corpus of requests of one team.
//
//   node scripts/area-method.mjs labels  rows.jsonl
//   node scripts/area-method.mjs analyze rows.jsonl --team team.json [--families families.json] [--cut [AAAA-MM-DD]] [--out report.json]
//   node scripts/area-method.mjs propose rows.jsonl --team team.json --purposes purposes.json --actor ed@x.org
//                                        [--families families.json] [--intents intents.json] [--intent-fields fields.json] [--out load.json]
//
// `rows.jsonl` has one request per line, as `scripts/request-rows.mjs` writes it. `docs/METODO-DE-REPARTO.md` explains each step, each criterion and the file shapes. Everything here is
// deterministic: the same rows give the same report and the same proposal (the partitions and the permutations use a seed). Nothing reads the words of a person to decide anything: the model that
// extracted the rows already interpreted them, and this script only counts and compares the fields it returned. The words of a confidential unit reach no output. The proposal is a draft
// (`confirmed: false` in every area) until the team confirms it, and `scripts/apply-load-file.mjs` is what loads it.

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseTemplate, TEMPLATE_DESCRIPTION_MAX } from '../src/analyze/templates.js'
import { VALUE_HOLDERS } from '../src/domain/assessment.js'

// ---- knobs. Each default has its source; the command line overrides every one.
export const DEFAULTS = Object.freeze({
  // An area must hold at least as many requests as it takes to measure its routing with a Wilson interval of half width `halfWidth` around `targetRate`
  // (`wilsonSampleSize`: 26 with the defaults). A share of the corpus says nothing about that: 5 % of 60 is 3 requests and 5 % of 2,000 is 100. `null` derives it.
  minRows: null,
  // Level of every test of the method: the conventional 0.05 (Fisher 1925). Five dimensions are compared at once, so it is shared out with Holm's method (see `holm`).
  alpha: 0.05,
  // Permutations of a test: 999, so that the smallest p-value is 0.001, below alpha divided by the 5 dimensions (0.01). A permutation p-value is (hits + 1) / (permutations + 1) so it is
  // never zero (Phipson and Smyth 2010, Stat. Appl. Genet. Mol. Biol. 9:39).
  permutations: 999,
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
  // The rate the method expects of a routing that works, and the half width wanted for the interval of any rate it measures. With 0.8 and 0.15 a Wilson interval
  // needs 26 requests (`wilsonSampleSize`): a rate observed at 0.8 then has its lower bound near 0.62, above a coin toss. Both are the team's to change.
  targetRate: 0.8,
  halfWidth: 0.15,
  // Repeats of the cross-validation (see `recognition`). Measured 2026-10-26 on 8 invented corpora of 4 areas (60, 40, 20 and 12 rows) with 30 fold seeds each: with 1 draw, of 32
  // area verdicts changed with the seed alone (noise 0.75 to 0.9: 2, 7, 12 and 15); with 10 draws, 0, 1, 4 and 5 (bench/area-method-recognition.mjs).
  repeats: 10,
  // Kappa that a field of the extraction needs against the people who read the same requests: 0.6 is where «substantial» agreement starts (Landis and Koch 1977,
  // Biometrics 33:159-174). It is the team's to raise; it is fixed before measuring.
  minKappa: 0.6,
  // The retest must pair the requests of all but this share of the units. A team's knob: with more than one unit in five unpaired the second run does not reproduce the count of
  // requests, and the kappa describes only the part of the corpus where the two runs already agreed on how many there were.
  maxUnalignedShare: 0.2,
  // A limit enters the gate of the validation when at least five requests of the sample touch it: the kappa of a rarer category swings with one label (declared courtesy of the team).
  minLimitPositives: 5,
  // Resamples of the interval of a kappa: at least 1,000 for percentile intervals (Efron and Tibshirani 1993, An Introduction to the Bootstrap).
  resamples: 1000,
  // Share of the units kept out of the construction of descriptions and profiles. Half is held out and split again into a tuning set and a confirmation set, which gives
  // the 50 / 25 / 25 split that Hastie, Tibshirani and Friedman (2009, The Elements of Statistical Learning, 2nd ed., section 7.2) suggest for abundant data.
  holdout: 0.5,
  // Fixed seed so a report can be reproduced (any integer would do).
  seed: 7,
  // A description of an area holds at most three limits: the description is capped at TEMPLATE_DESCRIPTION_MAX characters.
  // A border with a neighbour is named only when the text confuses the two in at least two requests: one confusion can come from a single row the extractor got wrong, two are a pattern.
  // The team's to change.
  minBorderConfusions: 2,
  maxLimitsListed: 3,
  maxTerms: 3,
  // Definition: an area is supported by its confidential rows when they are more than half of its rows. The title, the phrases and the examples of an
  // area come from the rows that can be quoted; if most rows cannot, the area is not proposed and its title is not written in any output.
  maxConfidentialShare: 0.5
})

export const DIMENSIONS = Object.freeze(['understand_vs_create', 'severity', 'irreversibility', 'missing_value', 'urgency'])

const STOP = new Set(`de la el en y a que los las del se un una con por para no lo al sin su es más o sea sus le les como pero ya the of and to in for on with is are it its be at as by an or if`.split(' '))

// ---- small statistics
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const sd = (xs) => { const m = mean(xs); return xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)) : 0 }
const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d

/**
 * Wilson score interval for `k` successes in `n` trials (Wilson 1927, J. Am. Stat. Assoc. 22:209-212). Unlike the Wald interval it stays inside [0, 1] and does not
 * collapse to a point when k = 0 or k = n (Brown, Cai and DasGupta 2001, Statistical Science 16:101-133, recommend it from n = 0 upwards for small samples).
 * With 3 of 3 the Wald lower bound is 1; Wilson's is 0.44.
 */
export function wilson (k, n, z = DEFAULTS.z) {
  if (!(n > 0)) return { p: 0, lower: 0, upper: 1, n: 0 }
  const p = k / n
  const z2 = z * z
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n)
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))
  return { p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half), n }
}

/**
 * The smallest n for which a Wilson interval around the rate `p` has a half width of at most `halfWidth`. This is the written count behind every sample size
 * of the method: the margin the team wants, the rate it expects and the interval above; nothing is a round number.
 */
export function wilsonSampleSize (p = DEFAULTS.targetRate, halfWidth = DEFAULTS.halfWidth, z = DEFAULTS.z) {
  for (let n = 1; n < 100000; n++) {
    const w = wilson(Math.round(p * n), n, z)
    if ((w.upper - w.lower) / 2 <= halfWidth) return n
  }
  throw new Error('No sample size reaches that half width.')
}

/** A new array in a uniformly random order: Fisher-Yates in the form of Durstenfeld (1964, Commun. ACM 7:420), with a seeded generator. */
export function shuffle (items, rand) {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

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

/**
 * The stage of one unit, from a hash of `seed:id` alone: `build` for the share `1 - holdout` of the hash range, then `tune` and `confirm` with a quarter of the range each at the
 * default holdout (half of the held-out share each). The stage does not depend on the other units, so adding a unit, or a unit that loses its rows in a new extraction, moves no other
 * one: a confirmation set read last week is the same set next week. 4294967296 is 2^32, the range of the 32 bits taken from the digest.
 */
export function unitStage (id, { holdout = DEFAULTS.holdout, seed = DEFAULTS.seed } = {}) {
  const u = parseInt(createHash('sha256').update(`${seed}:${id}`).digest('hex').slice(0, 8), 16) / 4294967296
  return u < 1 - holdout ? 'build' : u < 1 - holdout / 2 ? 'tune' : 'confirm'
}

/**
 * Splits the rows by unit into the construction side and two held-out sets: `tune` (the descriptions are corrected against it) and `confirm` (it is read once, at the end).
 * A unit is always on one side only, so the examples of a description and the profiles of the members, which come from `build`, never contain a request that is measured.
 * The side of a unit is `unitStage`, so it does not change when the corpus grows.
 */
export function splitUnits (rows, { holdout = DEFAULTS.holdout, seed = DEFAULTS.seed } = {}) {
  const units = [...new Set(rows.map((r) => r.unit))].sort()
  const side = new Map(units.map((u) => [u, unitStage(u, { holdout, seed })]))
  const count = (name) => units.filter((u) => side.get(u) === name).length
  if (count('build') < 1 || count('tune') < 1 || count('confirm') < 1) throw new Error(`${units.length} units are too few to hold out ${holdout}: the construction, the tuning and the confirmation sets need one unit each at least.`)
  const pick = (name) => rows.filter((r) => side.get(r.unit) === name)
  return { build: pick('build'), tune: pick('tune'), confirm: pick('confirm') }
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
    if (l.mechanism !== undefined && typeof l.mechanism !== 'string') problems.push(`Limit ${l.id}: mechanism must be a text`)
  }
  if ((team?.members ?? []).length === 0) problems.push('The team has no members')
  if (problems.length) throw new Error(problems.join('\n'))
  return team
}

export const limitById = (team) => new Map((team.limits ?? []).map((l) => [l.id, l]))

/**
 * Every row says whether it comes from a confidential unit. A row without the field is refused: the default of «open» is how a recorded meeting reached the output.
 * Throws with the first rows that fail.
 */
export function validateRows (rows) {
  const bad = rows.map((r, i) => [r, i]).filter(([r]) => typeof r?.confidential !== 'boolean')
  if (bad.length) throw new Error(`Every row needs a boolean "confidential"; ${bad.length} do not (first at line ${bad[0][1] + 1}).`)
  return rows
}

/**
 * Whether the request needs a person. It is the definition of the product (`touchesPerson`, src/domain/assessment.js): the value that is missing is a person's
 * (`value_holder` is `person`, one of `VALUE_HOLDERS`) or the request touches a limit that a person lifts. There is no threshold: the extractor also gives
 * `missing_value`, a 0 to 1 estimate that describes the area but decides nothing here. A test compares both definitions on the same requests.
 */
export function requiresPerson (row, team) {
  const limits = limitById(team)
  return row.value_holder === 'person' || (row.limits ?? []).some((id) => limits.get(id)?.person === true)
}

// ---- grouping
const slug = (text) => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/** The title of the area of a row before any area is hidden: its object through the families map, or the object with a capital. */
export const areaTitle = (row, families = {}) => families[row.object] ?? capital(row.object)

/** The area (family) title of each row: the object label through the families map, or the label itself with a capital. */
export function withAreas (rows, families = {}, hidden = new Map()) {
  return rows.map((r) => { const title = areaTitle(r, families); return { ...r, area: hidden.get(title) ?? title } })
}

/**
 * The areas whose rows are mostly confidential, with the neutral name that replaces their title in every output (`Área confidencial 1`, in the order of the titles).
 * Their counts still enter the report; their words never do.
 */
export function hiddenAreas (rows, families = {}, maxShare = DEFAULTS.maxConfidentialShare) {
  const by = new Map()
  for (const r of rows) {
    const t = areaTitle(r, families)
    const c = by.get(t) ?? { n: 0, confidential: 0 }
    c.n++
    if (r.confidential) c.confidential++
    by.set(t, c)
  }
  const titles = [...by.entries()].filter(([, c]) => c.confidential / c.n > maxShare).map(([t]) => t).sort()
  return new Map(titles.map((t, i) => [t, `Área confidencial ${i + 1}`]))
}

const weeksOf = (rows) => {
  const t = rows.map((r) => Date.parse(r.date)).filter(Number.isFinite)
  return t.length > 1 ? Math.max(1, (Math.max(...t) - Math.min(...t)) / 604800000) : 1 // 604800000 ms: seven days
}

/**
 * What the rows of one group say: sizes, means of the dimensions, who asks, who holds the value, limits, terms and modules.
 * The counts and the means use every row. Everything that is words (phrases, modules, intents) comes only from the rows that are not confidential.
 */
export function profileOf (rows, team, opts = {}, totalRows = rows.length, weeks = weeksOf(rows)) {
  const n = rows.length
  const open = rows.filter((r) => !r.confidential)
  const share = (items, k) => top(items, k).map(([name, c]) => ({ name, n: c, share: round(c / n) }))
  return {
    n,
    n_open: open.length,
    confidential_share: round(n ? (n - open.length) / n : 0),
    share: round(n / totalRows),
    per_week: round(n / weeks, 2),
    dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, round(mean(rows.map((r) => Number(r[d]) || 0)))])),
    person_share: round(rows.filter((r) => requiresPerson(r, team)).length / n),
    askers: share(rows.map((r) => r.who), 4),
    holders: share(rows.map((r) => (r.value_holder === 'person' ? r.holder || 'person' : 'model')), 4),
    limits: top(rows.flatMap((r) => r.limits ?? []), 5).map(([id, c]) => ({ id, n: c })),
    // One quality: what wins when two designs fulfil everything. The other frequent phrases are candidates for the team to choose from, not part of the description.
    maximize: topPhrases(open.map((r) => r.maximize).filter(Boolean), 1),
    maximize_candidates: topPhrases(open.map((r) => r.maximize).filter(Boolean), DEFAULTS.maxTerms),
    sacrifice: topPhrases(open.map((r) => r.sacrifice).filter(Boolean)),
    modules: top(open.map((r) => String(r.module ?? '').toLowerCase()), opts.mapSize ?? DEFAULTS.mapSize).map(([m]) => m),
    correction_share: round(rows.filter((r) => r.correction).length / n),
    intents: top(open.map((r) => r.intent), 12).map(([label, c]) => ({ label, n: c }))
  }
}

// ---- how well a group is recognized by the text alone: multinomial naive Bayes with Laplace smoothing, cross-validated by unit
/**
 * Assigns the groups (units) to `folds` folds: the groups are shuffled with the seed and each goes to the fold that holds the fewest rows, so the rows of one
 * unit are never on both sides of a partition and the folds stay balanced.
 */
export function foldsByGroup (groups, folds, seed) {
  const rand = seededRandom(seed)
  const size = new Map()
  for (const g of groups) size.set(g, (size.get(g) ?? 0) + 1)
  const load = new Array(folds).fill(0)
  const foldOf = new Map()
  for (const g of shuffle([...size.keys()], rand)) {
    const f = load.indexOf(Math.min(...load))
    foldOf.set(g, f)
    load[f] += size.get(g)
  }
  return groups.map((g) => foldOf.get(g))
}

/**
 * Recognition of every class by the words of the summary, with the unit as the group of the folds. The text is the summary only: the module is part of the
 * object the label comes from, so using it would hand the classifier the answer. Per class it reports recall and precision with their Wilson bounds and the
 * baseline of a classifier that does not read: its share of the corpus (a guess drawn by the proportions, or the majority class for everything, gets that
 * precision, and the proportional guess gets that recall).
 */
export function recognition (rows, labelOf, { folds = DEFAULTS.folds, seed = DEFAULTS.seed, z = DEFAULTS.z, repeats = DEFAULTS.repeats, groupOf = (r, i) => r.unit ?? i } = {}) {
  const labels = rows.map(labelOf)
  const tokens = rows.map((r) => words(r.summary))
  const classes = [...new Set(labels)]
  const stat = new Map(classes.map((c) => [c, { n: 0, ok: 0, predicted: 0 }]))
  const confusion = {}
  // Repeated cross-validation: the partition by unit is drawn `repeats` times with consecutive seeds and the counts are averaged, so the verdict does not hang on one draw.
  for (let rep = 0; rep < repeats; rep++) {
  const fold = foldsByGroup(rows.map(groupOf), folds, seed + rep)
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
      stat.get(labels[i]).n++
      if (best) stat.get(best.c).predicted++
      if (best?.c === labels[i]) stat.get(best.c).ok++
      else if (best) { const key = `${labels[i]} -> ${best.c}`; confusion[key] = (confusion[key] ?? 0) + 1 }
    })
  }
  }
  for (const h of stat.values()) { h.n = Math.round(h.n / repeats); h.ok = Math.round(h.ok / repeats); h.predicted = Math.round(h.predicted / repeats) }
  for (const k of Object.keys(confusion)) confusion[k] = Math.round(confusion[k] / repeats)
  const total = rows.length
  const accuracy = [...stat.values()].reduce((a, h) => a + h.ok, 0) / total
  const base = Math.max(...[...stat.values()].map((h) => h.n)) / total
  const perClass = Object.fromEntries([...stat.entries()].map(([c, h]) => {
    const recall = wilson(h.ok, h.n, z)
    const precision = wilson(h.ok, h.predicted, z)
    const share = h.n / total
    return [c, { n: h.n, share: round(share), recall: round(recall.p), recall_lower: round(recall.lower), precision: round(precision.p), precision_lower: round(precision.lower), baseline: round(share) }]
  }))
  const overall = wilson(Math.round(accuracy * total), total, z)
  return { accuracy: round(accuracy), base: round(base), lower: round(overall.lower), per_class: perClass, confusion: Object.fromEntries(Object.entries(confusion).sort((a, b) => b[1] - a[1])) }
}

const pairSeed = (key) => parseInt(createHash('sha256').update(key).digest('hex').slice(0, 8), 16)

/**
 * Holm's step-down adjustment (Holm 1979, Scand. J. Statistics 6:65-70) of a list of p-values: it controls the probability of any false positive among them at `alpha`
 * without assuming the tests are independent, which the five dimensions are not. Returns the adjusted p-values in the order given.
 */
export function holm (pValues) {
  const m = pValues.length
  const order = pValues.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0])
  const adjusted = new Array(m)
  let running = 0
  order.forEach(([p, i], rank) => { running = Math.max(running, Math.min(1, (m - rank) * p)); adjusted[i] = running })
  return adjusted
}

/**
 * Compares two groups of rows dimension by dimension. For each dimension, the permutation p-value of the standardized difference (the areas of the rows are permuted, one
 * permutation for all the dimensions), then Holm's adjustment over the dimensions. A dimension differs when its effect is at least `minEffect` and its adjusted p-value
 * is at most `alpha`. The dimensions are estimates of a model and correlated with one another, and the rows of one unit are not independent: the test does not assume
 * either, but it does not model the second either, so a result near alpha is read with that in mind.
 */
export function compareGroups (a, b, { minEffect = DEFAULTS.minEffect, alpha = DEFAULTS.alpha, permutations = DEFAULTS.permutations, rand }) {
  const column = (rows, dim) => rows.map((r) => Number(r[dim]) || 0)
  const all = [...a, ...b]
  const observed = DIMENSIONS.map((dim) => cohenD(column(a, dim), column(b, dim)))
  if (a.length < 2 || b.length < 2) return { dimensions: Object.fromEntries(DIMENSIONS.map((dim, i) => [dim, { d: round(observed[i], 2), p: 1, p_adjusted: 1, differs: false }])), any_differs: false, biggest_effect: 0 }
  const hits = DIMENSIONS.map(() => 0)
  const columns = DIMENSIONS.map((dim) => Float64Array.from(column(all, dim)))
  const na = a.length
  const nb = b.length
  const order = Int32Array.from(all.map((_, i) => i))
  const d = (col) => { // the standardized difference of the first na and the last nb entries of `col` taken in the current order, in one pass
    let sa = 0; let sb = 0; let qa = 0; let qb = 0
    for (let i = 0; i < na; i++) { const x = col[order[i]]; sa += x; qa += x * x }
    for (let i = na; i < na + nb; i++) { const x = col[order[i]]; sb += x; qb += x * x }
    const ma = sa / na; const mb = sb / nb
    const pooled = Math.sqrt(((qa - na * ma * ma) + (qb - nb * mb * mb)) / (na + nb - 2))
    return pooled === 0 ? 0 : (ma - mb) / pooled
  }
  for (let k = 0; k < permutations; k++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t } // Fisher-Yates in place
    columns.forEach((col, i) => { if (Math.abs(d(col)) >= Math.abs(observed[i]) - 1e-9) hits[i]++ })
  }
  const p = hits.map((h) => (h + 1) / (permutations + 1))
  const adjusted = holm(p)
  const dimensions = Object.fromEntries(DIMENSIONS.map((dim, i) => [dim, { d: round(observed[i], 2), p: round(p[i], 4), p_adjusted: round(adjusted[i], 4), differs: Math.abs(observed[i]) >= minEffect && adjusted[i] <= alpha }]))
  return { dimensions, any_differs: Object.values(dimensions).some((x) => x.differs), biggest_effect: Math.max(...observed.map(Math.abs)) }
}

/**
 * The limit an area touches most. When two limits tie for the first place the area has no dominant limit (null): the order of the counts would otherwise decide the
 * criterion. Two areas differ by limit only when both have one and they are not the same.
 */
/**
 * A multinomial naive Bayes (Laplace smoothing) trained on the summaries of `rows`, as a function from a text to the label it predicts. It is the router with no model that the experiment
 * has to beat: it reads the same words, from the construction rows, and costs nothing.
 */
export function trainNaiveBayes (rows, labelOf) {
  const classes = new Map()
  const vocabulary = new Set()
  for (const r of rows) {
    const c = classes.get(labelOf(r)) ?? { docs: 0, total: 0, count: new Map() }
    c.docs++
    for (const t of words(r.summary)) { c.count.set(t, (c.count.get(t) ?? 0) + 1); c.total++; vocabulary.add(t) }
    classes.set(labelOf(r), c)
  }
  return (text) => {
    let best = null
    for (const [label, c] of classes) {
      let score = Math.log(c.docs / rows.length)
      for (const t of words(text)) score += Math.log(((c.count.get(t) ?? 0) + 1) / (c.total + vocabulary.size + 1))
      if (!best || score > best.score) best = { label, score }
    }
    return best?.label ?? null
  }
}

const dominantLimit = (profile) => {
  const [first, second] = profile.limits
  return first && second && first.n === second.n ? null : first?.id ?? null
}
const overlap = (a, b) => { const small = Math.min(a.length, b.length); return small === 0 ? 0 : a.filter((m) => b.includes(m)).length / small }

/** Measures every candidate area against the four criteria of the method. Returns the report. */
export function analyze (rows, team, { families = {}, hiddenTitles = null, ...overrides } = {}) {
  validateTeam(team)
  validateRows(rows)
  const o = { ...DEFAULTS, ...overrides }
  const minRows = o.minRows ?? wilsonSampleSize(o.targetRate, o.halfWidth, o.z)
  // An area is decided on the whole corpus and measured on the confirmation set, which is a quarter of the units (half of the held-out half): for that set to have `minRows` requests the
  // area needs four times as many. With `holdout: 0` nothing is held out and the minimum is the interval count.
  const rowsNeeded = o.holdout > 0 ? Math.ceil(minRows / (o.holdout / 2)) : minRows
  // `hiddenTitles` is the numbering of the whole corpus when the rows are one window of it (`analyzeWindows`): the same area has the same neutral name in every window.
  const hidden = hiddenTitles ?? hiddenAreas(rows, families, o.maxConfidentialShare)
  const tagged = withAreas(rows, families, hidden)
  const weeks = weeksOf(tagged)
  const titles = [...new Set(tagged.map((r) => r.area))]
  const byArea = new Map(titles.map((t) => [t, tagged.filter((r) => r.area === t)]))
  const profiles = new Map(titles.map((t) => [t, profileOf(byArea.get(t), team, o, tagged.length, weeks)]))
  const recognized = recognition(tagged, (r) => r.area, o)
  const tests = new Map()
  const areas = titles.map((title) => {
    const p = profiles.get(title)
    const others = titles.filter((t) => t !== title)
    const overlaps = Object.fromEntries(others.map((t) => [t, round(overlap(p.modules, profiles.get(t).modules))]))
    // An area is compared with the other areas that have the rows to be an area; one that fails the volume is going to merge and does not decide whether this one is distinct.
    const candidates = others.filter((t) => profiles.get(t).n >= rowsNeeded)
    const effects = Object.fromEntries(candidates.map((t) => {
      const [x, y] = [title, t].sort() // one test per pair of areas, whichever of the two is being described
      const key = `${x}|${y}`
      // One generator per pair, seeded from the seed and the titles: adding an area does not change the p-values of the pairs that were already there.
      if (!tests.has(key)) tests.set(key, compareGroups(byArea.get(x), byArea.get(y), { minEffect: o.minEffect, alpha: o.alpha, permutations: o.permutations, rand: seededRandom((o.seed ^ pairSeed(key)) >>> 0) }))
      const test = tests.get(key)
      const mine = dominantLimit(p)
      const theirs = dominantLimit(profiles.get(t))
      const limitDiffers = mine !== null && theirs !== null && mine !== theirs
      return [t, { biggest_effect: round(test.biggest_effect, 2), limit_differs: limitDiffers, dimensions: test.dimensions, distinct: limitDiffers || test.any_differs }]
    }))
    const recall = recognized.per_class[title]
    const criteria = {
      volume: { pass: p.n >= rowsNeeded, rows: p.n, min_rows: minRows, rows_needed_to_measure: rowsNeeded, confirmation_rows: Math.round(p.n * o.holdout / 2) },
      recognized_by_text: { pass: recall.recall_lower > recall.baseline && recall.precision_lower > recall.baseline, recall: recall.recall, recall_lower: recall.recall_lower, precision: recall.precision, precision_lower: recall.precision_lower, baseline: recall.baseline },
      own_map: { pass: Object.values(overlaps).every((v) => v <= o.maxOverlap), overlap_with: overlaps, max: o.maxOverlap },
      distinct_treatment: { pass: Object.values(effects).every((e) => e.distinct), against: effects, min_effect: o.minEffect, alpha: o.alpha }
    }
    const nearest = others.map((t) => ({ t, d: Math.hypot(...DIMENSIONS.map((dim) => p.dimensions[dim] - profiles.get(t).dimensions[dim])) })).sort((a, b) => a.d - b.d)[0]
    // An area that is mostly confidential is never kept, whatever its criteria say: it cannot be described with words that can be quoted.
    const publicSupport = { pass: p.confidential_share <= o.maxConfidentialShare, confidential_share: p.confidential_share, max: o.maxConfidentialShare }
    const keep = Object.values(criteria).every((c) => c.pass) && publicSupport.pass
    return { title, id: slug(title), profile: p, criteria, public_support: publicSupport, keep, merge_into: keep ? null : nearest?.t ?? null }
  })
  // What the report cannot say by itself: a corpus with no room for two areas, a team with nobody to share the work with, and fewer than two areas left.
  const warnings = []
  if (tagged.length < 2 * rowsNeeded) warnings.push({ kind: 'corpus_small', rows: tagged.length, needed: 2 * rowsNeeded })
  if (team.members.length < 2) warnings.push({ kind: 'single_member', detail: 'with one member there is nothing to route between' })
  // An area that would merge into one that is not kept either has nowhere to go; with labels in two languages this is how a real area splits in two and one half disappears.
  const lost = areas.filter((a) => !a.keep && a.merge_into && !areas.find((t) => t.title === a.merge_into)?.keep).map((a) => ({ area: a.title, merge_into: a.merge_into }))
  if (lost.length) warnings.push({ kind: 'merge_target_not_kept', areas: lost, detail: 'the area it would merge into is not kept either: unify the labels of the objects in families.json' })
  if (areas.filter((a) => a.keep).length < 2) warnings.push({ kind: 'single_area', detail: 'fewer than two areas are kept: there is nothing to route between' })
  return { rows: tagged.length, weeks: round(weeks, 1), partition: recognized, areas, warnings, knobs: o }
}

/**
 * «Two runs in a row» of the rule that creates and merges areas means two cuts of the data by date, and not two runs over the same rows (those give the same report by
 * construction). The rows before `cut` and the rows from `cut` are analyzed apart. Per area: whether it is kept in each window, in both (`stable_keep`: it can be born or stay)
 * and whether it fails the volume in both (`volume_fail_both`: it merges). Without `cut`, the middle date of the rows.
 */
export function analyzeWindows (rows, team, { cut = null, ...options } = {}) {
  const dates = rows.map((r) => Date.parse(r.date)).filter(Number.isFinite).sort((a, b) => a - b)
  if (dates.length < 2) throw new Error('The windows need rows with dates.')
  const boundary = cut ?? new Date(dates[Math.floor(dates.length / 2)]).toISOString().slice(0, 10)
  const before = rows.filter((r) => r.date < boundary)
  const after = rows.filter((r) => r.date >= boundary)
  if (!before.length || !after.length) throw new Error(`The cut ${boundary} leaves one window with no rows.`)
  // The neutral names are numbered over the titles that are hidden in any window, and a title hidden in one window is hidden in both: «Área confidencial 1» is one area in the whole report.
  const { families = {} } = options
  const share = options.maxConfidentialShare ?? DEFAULTS.maxConfidentialShare
  const titles0 = [...new Set([before, after].flatMap((part) => [...hiddenAreas(part, families, share).keys()]))].sort()
  const hiddenTitles = new Map(titles0.map((t, i) => [t, `Área confidencial ${i + 1}`]))
  const reports = [analyze(before, team, { ...options, hiddenTitles }), analyze(after, team, { ...options, hiddenTitles })]
  const titles = [...new Set(reports.flatMap((r) => r.areas.map((a) => a.title)))].sort()
  const find = (report, title) => report.areas.find((a) => a.title === title)
  const areas = Object.fromEntries(titles.map((title) => {
    const found = reports.map((r) => find(r, title))
    const keep = found.map((a) => a?.keep === true)
    return [title, { keep, stable_keep: keep.every(Boolean), volume_fail_both: found.every((a) => !a || !a.criteria.volume.pass), rows: found.map((a) => a?.profile.n ?? 0) }]
  }))
  return { cut: boundary, windows: [{ until: boundary, rows: before.length }, { since: boundary, rows: after.length }], areas }
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

/**
 * What a limit says about how it is held. A limit of a person is held by the platform, which keeps the delivery until a person lifts it (UD-313). Any other limit is held by
 * the mechanism the team names (a hook, a scoped credential, a test). Without one, the text says so: a limit with no mechanism is a request to the model, not a wall.
 */
export function limitHold (limit) {
  if (limit.person) return 'lo levanta una persona'
  return String(limit.mechanism ?? '').trim() ? `lo sostiene: ${String(limit.mechanism).trim()}` : 'sin mecanismo declarado'
}

/** The purpose and the environment of an area from `purposes.json`: a sentence, or `{ purpose, environment }`. The environment is a fact of the team, not a statistic of the corpus. */
export const purposeOf = (entry) => (typeof entry === 'string'
  ? { purpose: entry, environment: '', maximize: '', sacrifice: '' }
  : { purpose: String(entry?.purpose ?? ''), environment: String(entry?.environment ?? '').trim(), maximize: String(entry?.maximize ?? '').trim(), sacrifice: String(entry?.sacrifice ?? '').trim() })

function areaClauses (entry, { team, purpose, environment = '', maximize = '', sacrifice = '', examples, neighbours }) {
  const p = entry.profile
  const limits = limitById(team)
  // The limits of a person come first, whatever their frequency: the serious ones are rare, and a list by frequency leaves them out. Then the ones the area touches most.
  const touched = p.limits.map((l) => limits.get(l.id)).filter(Boolean)
  const listed = [...(team.limits ?? []).filter((l) => l.person), ...touched.filter((l) => !l.person)].slice(0, DEFAULTS.maxLimitsListed)
  const clauses = [{ text: `Propósito: ${purpose}`, drop: 0 }]
  clauses.push({ text: `Se maximiza: ${p.maximize[0] ?? maximize}.`, drop: 0 })
  clauses.push({ text: `Se sacrifica: ${p.sacrifice.length ? phrases(p.sacrifice) : sacrifice}.`, drop: 0 })
  if (environment) clauses.push({ text: `Entorno: ${environment.replace(/[.\s]+$/, '')}.`, drop: 1 })
  if (listed.length) clauses.push({ text: `Límites: ${listed.map((l) => `${l.text} (${limitHold(l)})`).join('; ')}.`, drop: 0 })
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
// What the product does with a limit of a person that a request touches (UD-313): the delivery is held until a person lifts it. The template tells the session what to do meanwhile; it never
// tells it to stop, because a session that stops leaves no work prepared for the person to decide on.
const PERSON_LIMIT_PROTOCOL = 'Si toca uno de estos límites de una persona, nombra el límite y el riesgo, propone una alternativa que haga lo pedido sin cruzarlo y deja el trabajo en la rama; la entrega espera a una persona:'
const q = (s) => JSON.stringify(s)

/** The markdown of one template: the area and the intent it serves, the common fields, the fields of the intent and the booleans of the area limits as output. */
export function templateMarkdown ({ intent, area, profile, team, extraFields = [] }) {
  const limits = limitById(team)
  // The limits of a person are always in the template, touched or not in the corpus; then the ones this kind of request touches.
  const areaLimits = [...new Map([...(team.limits ?? []).filter((l) => l.person), ...profile.limits.map((l) => limits.get(l.id)).filter(Boolean)].map((l) => [l.id, l])).values()]
  const person = areaLimits.filter((l) => l.person)
  const description = fitClauses([
    { text: `${capital(intent.label)} del área ${area}: ${intent.n} pedidos del corpus.`, drop: 0 },
    ...(profile.maximize.length ? [{ text: `Se maximiza: ${phrases(profile.maximize)}.`, drop: 1 }] : []),
    ...(profile.sacrifice.length ? [{ text: `Se sacrifica: ${phrases(profile.sacrifice)}.`, drop: 2 }] : []),
    ...(person.length ? [{ text: `${PERSON_LIMIT_PROTOCOL} ${list(person.map((l) => l.text))}.`, drop: 3 }] : [])
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
    [profile.maximize.length ? `Se maximiza: ${phrases(profile.maximize)}.` : '', profile.sacrifice.length ? `Se sacrifica: ${phrases(profile.sacrifice)}.` : '',
      person.length ? `${PERSON_LIMIT_PROTOCOL} ${list(person.map((l) => l.text))}.` : 'No tiene límites que exijan a una persona.'].filter(Boolean).join(' '))
  return `${lines.join('\n')}\n`
}

// ---- member profiles
// The limit of the product for a profile: `config.members.profileMaxLength` (UD-023, a declared courtesy: two paragraphs are about 2,000 characters). A test compares both.
export const MEMBER_PROFILE_MAX = 4000
/** A draft profile in the first person, from what the corpus says about the member. The `role` sentence is the member's own. */
export function memberProfile (member, rows, team, opts = {}) {
  const max = opts.maxLength ?? MEMBER_PROFILE_MAX
  const proposed = opts.areas ? new Set(opts.areas) : null // only the areas that are proposed are named: the others do not exist for the product
  const inProposed = (r) => !proposed || proposed.has(r.area)
  const asked = rows.filter((r) => r.who === member.name)
  const received = rows.filter((r) => r.to === member.name)
  const held = rows.filter((r) => r.value_holder === 'person' && r.holder === member.name)
  const limits = limitById(team)
  const parts = [{ text: member.role.trim(), drop: 0 }]
  const add = (text, drop) => parts.push({ text, drop })
  const base = member.kind === 'agent' ? received : asked
  if (base.length) {
    const terms = topPhrases(base.filter((r) => !r.confidential).map((r) => r.maximize).filter(Boolean), 1) // words only from rows that can be quoted; one quality, as in an area
    const lost = topPhrases(base.filter((r) => !r.confidential).map((r) => r.sacrifice).filter(Boolean))
    if (terms.length) add(`Maximizo: ${phrases(terms)}.${lost.length ? ` Sacrifico: ${phrases(lost)}.` : ''}`, 3)
    const areas = top(base.filter(inProposed).map((r) => r.area), 3).map(([a, c]) => `${a} (${pct(c / base.length)})`)
    if (areas.length) add(member.kind === 'agent' ? `Lo que atiendo se reparte así: ${list(areas)}.` : `Pido sobre todo en ${list(areas)}.`, 2)
  }
  if (member.kind === 'agent') {
    const person = (team.limits ?? []).filter((l) => l.person).map((l) => l.text)
    if (person.length) add(`No decido: ${list(person)}. Eso sube a quien tiene el valor, como una pregunta de una línea con mi recomendación.`, 1)
  } else if (held.length) {
    const areas = top(held.filter(inProposed).map((r) => r.area), 3).map(([a, c]) => `${a} (${c})`)
    if (areas.length) add(`Tengo el valor que falta en ${held.length} pedidos: ${list(areas)}. Esas decisiones son mías.`, 2)
    const own = top(held.flatMap((r) => r.limits ?? []).filter((id) => limits.get(id)?.person), 2).map(([id]) => limits.get(id).text)
    if (own.length) add(`Lo que sólo yo levanto: ${list(own)}.`, 1)
  }
  try { return fitClauses(parts, max) } catch (error) { throw new Error(`The profile of ${member.name} does not fit in ${max} characters even with its role alone: ${error.message}`) }
}

// ---- the load file: areas with their templates, and member profiles
export const LOAD_FILE_VERSION = 2
// The limit of the product for the description of the project: `config.project.descriptionMaxChars` (PROJECT_DESCRIPTION_MAX_CHARS, UD-024). A test compares both.
export const PROJECT_DESCRIPTION_MAX = 200000
/**
 * Builds the load file from the rows. `purposes` maps an area title to its purpose sentence (a purpose is the team's, not the corpus's);
 * `intents` maps an intent label to the name of its template; `intentFields` maps a template name to extra fields.
 * Only areas that pass the four criteria are proposed; the others are listed in `skipped` with the area they would merge into.
 */
export function propose (rows, team, { purposes = {}, families = {}, intents = {}, intentFields = {}, actor, ...overrides } = {}) {
  const report = analyze(rows, team, { families, ...overrides })
  const hidden = hiddenAreas(rows, families, overrides.maxConfidentialShare ?? DEFAULTS.maxConfidentialShare)
  const tagged = withAreas(rows, families, hidden).map((r) => ({ ...r, intent: intents[r.intent] ?? r.intent }))
  const minTemplate = overrides.minTemplate ?? DEFAULTS.minTemplate
  const missing = report.areas.filter((a) => a.keep && !purposeOf(purposes[a.title]).purpose).map((a) => a.title)
  if (missing.length) throw new Error(`A purpose sentence is needed for: ${missing.join(', ')}`)
  // An area is described by a quality that wins and a quality that is sacrificed. When the corpus gives none, the team writes it (`maximize`, `sacrifice` in purposes.json): it is not left out.
  const without = (field) => report.areas.filter((a) => a.keep && !a.profile[field].length && !purposeOf(purposes[a.title])[field]).map((a) => a.title)
  for (const [field, label] of [['maximize', 'a quality to maximize'], ['sacrifice', 'something to sacrifice']]) {
    const names = without(field)
    if (names.length) throw new Error(`The corpus gives ${label} for none of the requests of: ${names.join(', ')}. Write it in purposes.json as "${field}".`)
  }
  const areas = []
  const skipped = []
  report.areas.forEach((entry) => {
    if (!entry.keep) { skipped.push({ title: entry.title, merge_into: entry.merge_into, failed: Object.entries({ ...entry.criteria, public_support: entry.public_support }).filter(([, c]) => !c.pass).map(([k]) => k) }); return }
    // The areas the text most often confuses with this one are named as its borders.
    const minBorder = overrides.minBorderConfusions ?? DEFAULTS.minBorderConfusions
    const borders = Object.entries(report.partition.confusion).filter(([k, count]) => k.startsWith(`${entry.title} -> `) && count >= minBorder).slice(0, 2).map(([k]) => k.split(' -> ')[1])
    const { purpose, environment, maximize, sacrifice } = purposeOf(purposes[entry.title])
    const description = fitClauses(areaClauses(entry, { team, purpose, environment, maximize, sacrifice, examples: examplesOf(tagged, entry.title), neighbours: borders }))
    const mine = tagged.filter((r) => r.area === entry.title && !r.confidential) // a template is written with rows that can be quoted
    const templates = [...new Set(mine.map((r) => r.intent))]
      .map((label) => ({ label, n: mine.filter((r) => r.intent === label).length }))
      .filter((i) => i.n >= minTemplate)
      .map((intent) => {
        const profile = profileOf(mine.filter((r) => r.intent === intent.label), team, { ...DEFAULTS, ...overrides })
        const markdown = templateMarkdown({ intent, area: entry.title, profile, team, extraFields: intentFields[intent.label] ?? [] })
        const parsed = parseTemplate(markdown)
        return { name: parsed.name, description: parsed.description, body_markdown: markdown }
      })
    // The limits belong to the team and not to an area: every area carries all of them as its guards, so that the analyzer can flag a request that touches one wherever it lands.
    // The area is a draft until the team confirms it: the quality it maximizes and what it sacrifices come from what people asked for, not from what the team decided.
    const guards = (team.limits ?? []).map((l) => ({ key: l.id, text: l.text, mechanism: String(l.mechanism ?? '').trim(), person: l.person === true }))
    areas.push({ title: entry.title, description, position: areas.length + 1, confirmed: false, candidates: { maximize: entry.profile.maximize_candidates, sacrifice: entry.profile.sacrifice }, guards, templates })
  })
  const members = team.members.filter((m) => m.role).map((m) => ({ email: m.email, profile: memberProfile(m, tagged, team, { areas: areas.map((a) => a.title) }) }))
  const spec = { version: LOAD_FILE_VERSION, ...(actor ? { actor } : {}), areas, members }
  validateLoadFile(spec)
  return { spec, skipped, report, warnings: loadWarnings(spec) }
}

/** The guards that are not about a person and name no mechanism: a request to the model and not a wall. The loader reports them and the descriptions say «sin mecanismo declarado». */
export function loadWarnings (spec) {
  return (spec.areas ?? []).flatMap((a) => (a.guards ?? []).filter((g) => g.person === false && !String(g.mechanism ?? '').trim()).map((g) => ({ kind: 'guard_without_mechanism', area: a.title, guard: g.text })))
}

/** Throws when the load file has a shape the product would refuse: a template that does not parse, repeated names or a member without email. */
export function validateLoadFile (spec) {
  const problems = []
  const titles = new Set()
  for (const a of spec.areas ?? []) {
    if (titles.has(a.title)) problems.push(`Repeated area ${a.title}`)
    titles.add(a.title)
    if (!a.description) problems.push(`Area ${a.title} has no description`)
    for (const clause of ['Se maximiza: ', 'Se sacrifica: ']) if (!String(a.description ?? '').includes(clause)) problems.push(`The description of ${a.title} needs the clause «${clause.trim()}»: the team confirms the quality that wins and the one that is sacrificed`)
    if (typeof a.confirmed !== 'boolean') problems.push(`Area ${a.title} needs a boolean "confirmed": the team confirms an area before it is loaded`)
    for (const g of a.guards ?? []) {
      if (!String(g?.text ?? '').trim()) problems.push(`A guard of ${a.title} needs a text`)
      if (g?.key !== undefined && !/^[a-z][a-z0-9_]{0,63}$/.test(g.key)) problems.push(`Guard "${g?.text}" of ${a.title}: the key must be a name (lowercase letters, digits and underscore)`)
      if (typeof g?.person !== 'boolean') problems.push(`Guard "${g?.text}" of ${a.title} needs a boolean "person"`)
      if (typeof g?.mechanism !== 'string') problems.push(`Guard "${g?.text}" of ${a.title} needs a "mechanism" text (empty when there is none)`)
    }
    const names = new Set()
    for (const t of a.templates ?? []) {
      try {
        const parsed = parseTemplate(t.body_markdown)
        if (names.has(parsed.name.toLowerCase())) problems.push(`Repeated template ${parsed.name} in ${a.title}`)
        names.add(parsed.name.toLowerCase())
      } catch (error) { problems.push(`Template ${t.name} of ${a.title}: ${error.message}`) }
    }
  }
  if (spec.project !== undefined) {
    // The description of the project is written by the team (section 8 of the document): `propose` never writes it, and the load file carries it when the team has confirmed it.
    if (!String(spec.project?.description ?? '').trim()) problems.push('The project needs a description')
    else if (spec.project.description.length > PROJECT_DESCRIPTION_MAX) problems.push(`The description of the project has ${spec.project.description.length} characters and the limit is ${PROJECT_DESCRIPTION_MAX}`)
    if (typeof spec.project?.confirmed !== 'boolean') problems.push('The project needs a boolean "confirmed"')
  }
  for (const m of spec.members ?? []) if (!m.email || !m.profile) problems.push(`A member needs email and profile: ${m.email}`)
  if (spec.version !== LOAD_FILE_VERSION) problems.push(`The load file has version ${spec.version} and this method writes version ${LOAD_FILE_VERSION}`)
  if (problems.length) throw new Error(problems.join('\n'))
  return spec
}

/**
 * The objects and intents with their frequency, for the person who groups them into families. A label that only confidential rows use is shown as
 * `(confidential)` with its count: the words of a recorded meeting do not leave through any output of the method.
 */
export function labels (rows) {
  const listing = (field) => {
    const all = top(rows.map((r) => r[field]), 1000)
    const open = new Set(rows.filter((r) => !r.confidential).map((r) => r[field]))
    return all.map(([label, n]) => (open.has(label) ? { label, n } : { label: '(confidential)', n, confidential_only: true }))
  }
  return { objects: listing('object'), intents: listing('intent') }
}

// ---- command line
function main (argv) {
  const [command, rowsFile, ...rest] = argv
  const option = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined }
  const numeric = Object.fromEntries(['minRows', 'minEffect', 'maxOverlap', 'minTemplate', 'z', 'folds', 'seed', 'mapSize', 'maxConfidentialShare', 'alpha', 'permutations', 'minBorderConfusions', 'maxUnalignedShare', 'minLimitPositives', 'repeats', 'targetRate', 'halfWidth', 'holdout'].map((k) => [k, option(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`)]).filter(([, v]) => v !== undefined).map(([k, v]) => [k, Number(v)]))
  const out = (value) => { const text = `${JSON.stringify(value, null, 2)}\n`; if (option('--out')) writeFileSync(option('--out'), text); else process.stdout.write(text) }
  if (!['labels', 'analyze', 'propose'].includes(command) || !rowsFile) {
    console.error('Uso: node scripts/area-method.mjs (labels|analyze|propose) rows.jsonl [--team team.json] [--families f.json] [--intents i.json] [--intent-fields x.json] [--purposes p.json] [--actor correo] [--out archivo]')
    process.exit(2)
  }
  const rows = readJsonl(rowsFile)
  if (command === 'labels') {
    try { validateRows(rows) } catch (error) { console.error(error.message); process.exit(1) }
    out(labels(rows))
    return
  }
  if (!option('--team')) { console.error('Falta --team'); process.exit(2) }
  const team = readJson(option('--team'))
  const load = (flag, fallback) => (option(flag) ? readJson(option(flag)) : fallback)
  const common = { families: load('--families', {}), ...numeric }
  try {
    if (command === 'analyze') out({ ...analyze(rows, team, common), ...(rest.includes('--cut') ? { stability: analyzeWindows(rows, team, { ...common, cut: option('--cut') && !option('--cut').startsWith('--') ? option('--cut') : null }) } : {}) })
    else {
      const result = propose(rows, team, { ...common, purposes: load('--purposes', {}), intents: load('--intents', {}), intentFields: load('--intent-fields', {}), actor: option('--actor') })
      for (const w of result.warnings) console.error(`Aviso: el límite «${w.guard}» del área ${w.area} no tiene mecanismo declarado: queda como un pedido al modelo.`)
      if (result.skipped.length) console.error(`Áreas que no cumplen los criterios: ${result.skipped.map((s) => `${s.title} (${s.failed.join(', ')}; se uniría a ${s.merge_into})`).join('; ')}`)
      out(result.spec)
    }
  } catch (error) { console.error(error.message); process.exit(1) }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
