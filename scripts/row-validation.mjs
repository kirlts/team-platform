#!/usr/bin/env node
// Validates the extraction against people who read the ORIGINAL text, before any measure of the method counts as accuracy.
//
//   node scripts/row-validation.mjs sample   --units units.jsonl --rows rows.jsonl --team team.json [--families f.json] [--stage all|tune|confirm] [--holdout 0.5]
//                                            [--target-rate 0.8] [--half-width 0.15] [--with-text] --out sample.jsonl
//   node scripts/row-validation.mjs agree    --units units.jsonl --rows rows.jsonl --labels labels.jsonl --team team.json [--families f.json] [--stage ...]
//                                            [--reference-rater name] [--retest rows2.jsonl] [--min-kappa 0.6] [--max-unaligned-share 0.2] [--waive limit:id] [--min-limit-positives 5] [--resamples 1000] [--out validation.json]
//   node scripts/row-validation.mjs analyzer --units units.jsonl --labels labels.jsonl --analysis analysis.jsonl --team team.json [--reference-rater name] [--out analyzer.json]
//
// `sample` draws UNITS, not summaries: a person reads the original text of each unit and lists the requests in it, so a request the extractor left out, split badly or made up is seen.
// The sample file names the unit; the text stays in `units.jsonl` (`--with-text` writes it into the sheet for working locally). `labels.jsonl` has one line per unit and rater:
// `{ unit, rater, requests: [{ area, value_holder, limits }] }`, the requests in the order of the text. `agree` measures what the extraction found against what the people found
// (requests left out and made up, and the agreement of area, value holder, whether a person is needed and each limit), the agreement between two people, and between two runs of
// the extraction. `analyzer` does the same for the guards that the product's analyzer touched (`guards_touched`), whose answers are collected from the API by hand.
// Why this exists and how to read it: docs/METODO-DE-REPARTO.md, section «Validar las filas».
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { DEFAULTS, areaTitle, readJson, readJsonl, requiresPerson, seededRandom, shuffle, unitStage, validateRows, validateTeam, wilson, wilsonSampleSize } from './area-method.mjs'

/** The rows with a `key` that names each request: the unit and the order of the request inside the unit, in the order of the file. */
export function keyRows (rows) {
  const seen = new Map()
  return rows.map((r) => {
    const n = (seen.get(r.unit) ?? 0) + 1
    seen.set(r.unit, n)
    return { ...r, key: r.key ?? `${r.unit}#${n}` }
  })
}

/** The sizes of the validation: units per stratum, and units labeled twice. Both come from the interval count of `wilsonSampleSize`, not from a round number. */
export function validationSizes ({ targetRate = DEFAULTS.targetRate, halfWidth = DEFAULTS.halfWidth, z = DEFAULTS.z } = {}) {
  const n = wilsonSampleSize(targetRate, halfWidth, z)
  return { per_stratum: n, double: n }
}

// ---- units, strata and stages
export function rowsByUnit (rows) {
  const by = new Map()
  for (const r of rows) by.set(r.unit, [...(by.get(r.unit) ?? []), r])
  return by
}

/**
 * The stratum of every unit: `zero` when the extraction found no request in it (where a request left out hides), otherwise the rarest limit of the team that one of its
 * requests touches (`limit:<id>`, rarest by number of units, so that a rare limit has its own cases), or `none`. The strata are disjoint, which is what lets a weight per stratum
 * (units in the population over units labeled) give unbiased estimates.
 */
export function unitStrata (unitIds, byUnit, team) {
  const touches = (id) => new Set((byUnit.get(id) ?? []).flatMap((r) => r.limits ?? []))
  const count = Object.fromEntries((team.limits ?? []).map((l) => [l.id, unitIds.filter((id) => touches(id).has(l.id)).length]))
  return new Map(unitIds.map((id) => {
    if (!(byUnit.get(id) ?? []).length) return [id, 'zero']
    const mine = (team.limits ?? []).filter((l) => touches(id).has(l.id)).sort((a, b) => count[a.id] - count[b.id] || a.id.localeCompare(b.id))
    return [id, mine.length ? `limit:${mine[0].id}` : 'none']
  }))
}

/** The stage of every unit: the hash of its id and the seed (`unitStage`), the same for units with rows and units with none. */
export function stageMap (rows, unitIds, { holdout = DEFAULTS.holdout, seed = DEFAULTS.seed } = {}) {
  return new Map([...new Set([...rows.map((r) => r.unit), ...unitIds])].map((id) => [id, unitStage(id, { holdout, seed })]))
}

function candidates (units, rows, team, { stage = 'all', holdout, splitSeed, families = {} } = {}) {
  validateRows(rows)
  const open = units.filter((u) => !u.confidential)
  const ids = units.map((u) => u.id)
  const byUnit = rowsByUnit(rows)
  const stages = stage === 'all' ? null : stageMap(rows, ids, { holdout, seed: splitSeed })
  const chosen = open.filter((u) => !stages || stages.get(u.id) === stage)
  const strata = unitStrata(chosen.map((u) => u.id), byUnit, team)
  return { chosen, strata, byUnit, families }
}

/**
 * The sample for the people who label: units of one stage (or all), `per_stratum` of each stratum (or all it has), and `double` of them marked for a second person. Only units
 * that are not confidential are drawn; the confidential ones are read by a person without a sample.
 */
export function drawValidationSample (units, rows, team, { stage = 'all', holdout = DEFAULTS.holdout, splitSeed = DEFAULTS.seed, seed = DEFAULTS.seed, withText = false, families = {}, ...knobs } = {}) {
  validateTeam(team)
  const { chosen, strata } = candidates(units, rows, team, { stage, holdout, splitSeed, families })
  const sizes = validationSizes(knobs)
  const rand = seededRandom(seed)
  const picked = []
  const short = []
  for (const name of [...new Set(strata.values())].sort()) {
    const pool = shuffle(chosen.filter((u) => strata.get(u.id) === name), rand)
    if (pool.length < sizes.per_stratum) short.push({ stratum: name, available: pool.length, needed: sizes.per_stratum })
    picked.push(...pool.slice(0, sizes.per_stratum).map((u) => ({ u, stratum: name })))
  }
  const doubled = new Set(shuffle(picked.map((p) => p.u.id), rand).slice(0, sizes.double))
  return {
    items: picked.map(({ u, stratum }) => ({ unit: u.id, source: u.source ?? '', date: u.date ?? '', stratum, double: doubled.has(u.id), ...(withText ? { text: u.text } : {}) })),
    sizes, short, stage
  }
}

// ---- kappa and the bootstrap by unit
/** Cohen's kappa (1960, Educ. Psychol. Meas. 20:37-46) of pairs `{ a, b, w }` with weights: the observed agreement against the one expected from the marginals. */
export function weightedKappa (pairs) {
  const total = pairs.reduce((s, p) => s + p.w, 0)
  if (!(total > 0)) return { kappa: null, observed: null, expected: null }
  const observed = pairs.filter((p) => p.a === p.b).reduce((s, p) => s + p.w, 0) / total
  const marginal = (side) => { const m = new Map(); for (const p of pairs) m.set(p[side], (m.get(p[side]) ?? 0) + p.w / total); return m }
  const ma = marginal('a')
  const mb = marginal('b')
  const expected = [...ma.entries()].reduce((s, [k, v]) => s + v * (mb.get(k) ?? 0), 0)
  if (expected >= 1) return { kappa: observed === 1 ? 1 : 0, observed, expected } // a single category on both sides: nothing to disagree about
  return { kappa: (observed - expected) / (1 - expected), observed, expected }
}

/**
 * Gwet's AC1 (2008, Br. J. Math. Stat. Psychol. 61:29-48) of the same pairs. Kappa falls when one category is very frequent even if the raters agree almost always; AC1 does not, because
 * its chance agreement is computed from the mean frequency of each category. It is printed next to kappa as a contrast and does not decide anything.
 */
export function weightedAC1 (pairs) {
  const total = pairs.reduce((s, p) => s + p.w, 0)
  if (!(total > 0)) return null
  const categories = [...new Set(pairs.flatMap((p) => [p.a, p.b]))]
  if (categories.length < 2) return 1
  const observed = pairs.filter((p) => p.a === p.b).reduce((s, p) => s + p.w, 0) / total
  const mean = (c) => pairs.reduce((s, p) => s + p.w * ((p.a === c ? 1 : 0) + (p.b === c ? 1 : 0)) / 2, 0) / total
  const chance = categories.reduce((s, c) => s + mean(c) * (1 - mean(c)), 0) / (categories.length - 1)
  return chance >= 1 ? 1 : (observed - chance) / (1 - chance)
}

const round3 = (x) => Math.round(x * 1000) / 1000

/**
 * Percentile interval of a statistic of `items` (each with `unit` and `stratum`) by a seeded bootstrap that resamples UNITS inside each stratum: the requests of one unit
 * share text and author and are not independent, so they travel together.
 */
export function bootstrapByUnit (items, statistic, { resamples = DEFAULTS.resamples, seed = DEFAULTS.seed } = {}) {
  const rand = seededRandom(seed)
  const strata = new Map()
  for (const it of items) {
    const units = strata.get(it.stratum) ?? new Map()
    units.set(it.unit, [...(units.get(it.unit) ?? []), it])
    strata.set(it.stratum, units)
  }
  const groups = [...strata.values()].map((units) => [...units.values()])
  const draws = []
  for (let b = 0; b < resamples; b++) {
    const sample = []
    for (const g of groups) for (let i = 0; i < g.length; i++) sample.push(...g[Math.floor(rand() * g.length)])
    const v = statistic(sample)
    if (v !== null && Number.isFinite(v)) draws.push(v)
  }
  draws.sort((x, y) => x - y)
  if (!draws.length) return { lower: null, upper: null }
  const at = (q) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(q * draws.length)))]
  return { lower: round3(at(0.025)), upper: round3(at(0.975)) }
}

/** The kappa of weighted items with a bootstrap interval by unit. */
export function kappaWithInterval (items, knobs = {}) {
  const point = weightedKappa(items)
  if (point.kappa === null) return { ...point, lower: null, upper: null, n: 0 }
  return { kappa: round3(point.kappa), ac1: round3(weightedAC1(items)), observed: round3(point.observed), ...bootstrapByUnit(items, (s) => weightedKappa(s).kappa, knobs), n: items.length }
}

const FIELDS = {
  area: (x) => x.area,
  value_holder: (x) => x.value_holder,
  needs_person: (x, team) => String(requiresPerson(x, team))
}

function agreementBlock (items, team, knobs) {
  const field = (f) => kappaWithInterval(items.map((it) => ({ ...it, a: f(it.left, team), b: f(it.right, team) })), knobs)
  return {
    area: field(FIELDS.area), value_holder: field(FIELDS.value_holder), needs_person: field(FIELDS.needs_person),
    limits: Object.fromEntries((team.limits ?? []).map((l) => {
      const touches = (x) => String((x.limits ?? []).includes(l.id))
      return [l.id, { ...kappaWithInterval(items.map((it) => ({ ...it, a: touches(it.left), b: touches(it.right) })), knobs), positives: items.filter((it) => it.left.limits?.includes(l.id) || it.right.limits?.includes(l.id)).length }]
    }))
  }
}

// ---- the reference of the people
/** The ADJUDICATED rater: a person who reads the labels of two raters on a unit and writes the one that is right. */
export const ADJUDICATOR = 'adjudicated'

const sameRequests = (a, b) => a.length === b.length && a.every((x, i) => x.area === b[i].area && x.value_holder === b[i].value_holder && JSON.stringify([...(x.limits ?? [])].sort()) === JSON.stringify([...(b[i].limits ?? [])].sort()))

/**
 * The reference label of every unit, by a procedure that does not depend on the names of the raters. `referenceRater` is the person who labeled the whole sample. Where a second
 * person labeled the same unit: if they list the same requests the label stands; if they differ it is the label of an `adjudicated` rater, and with none the unit is left out of
 * the reference (counted in `unadjudicated`), because there is no way to say which of the two is right. With two people and no `referenceRater` it throws.
 */
export function referenceLabels (labels, { referenceRater = null } = {}) {
  const people = [...new Set(labels.map((l) => l.rater).filter((r) => r !== ADJUDICATOR))].sort()
  if (people.length === 0) throw new Error('The labels file has no labels from a person.')
  if (people.length > 1 && !referenceRater) throw new Error(`Two or more raters (${people.join(', ')}): name the one who labeled the whole sample with --reference-rater. The order of their names decides nothing.`)
  const main = referenceRater ?? people[0]
  if (!people.includes(main)) throw new Error(`The reference rater ${main} has no labels.`)
  const second = people.find((r) => r !== main) ?? null
  const find = (rater, unit) => labels.find((l) => l.rater === rater && l.unit === unit)
  const reference = new Map()
  let unadjudicated = 0
  for (const l of labels.filter((x) => x.rater === main)) {
    const other = second ? find(second, l.unit) : null
    const judged = find(ADJUDICATOR, l.unit)
    if (judged) reference.set(l.unit, judged)
    else if (!other || sameRequests(l.requests, other.requests)) reference.set(l.unit, l)
    else unadjudicated++
  }
  return { reference, main, second, unadjudicated, find }
}

// ---- the agreement
const rowLabel = (r, families) => ({ area: areaTitle(r, families), value_holder: r.value_holder, limits: r.limits ?? [] })

/**
 * What the extraction found against what the people found, for the labeled units. Per unit, the requests the person listed (`p`) and the rows the extraction wrote (`r`): the ones
 * in excess are made up and the ones missing are left out (`recall` and `precision` of the extraction, by request). Where the counts agree the requests are paired by order and
 * their area, value holder and limits are compared with Cohen's kappa. A unit whose counts differ is `unaligned` and cannot be paired; its share is a rule of the gate.
 * Every estimate weighs a unit by its stratum (units in the stage over units labeled) and its interval resamples units.
 *
 * The gate is on the LOWER bound of the interval of every estimate (the kappas, the recall and the precision of the extraction, and the agreement between two people), not on the point
 * value: with 78 labels the interval of a kappa is about 0.29 wide and a point value of 0.6 passes 45 % of the time when the true kappa is 0.6 (bench/area-method-kappa.mjs), and the
 * recall of the extraction with a true value of 0.80 passed 48 % of the times on its point value with 104 requests and 11 % when it was 0.75 (reaudit 3, 2026-10-27, 1,000 simulated
 * samples). `minKappa` and `targetRate` are the floors that lower bound must reach, fixed by the team before measuring. The sample that a lower bound needs is in the document (section 3):
 * the interval of a kappa is as narrow as the pairs allow, and 26 units labeled twice leave it too wide to pass. A limit enters the gate when at least `minLimitPositives` requests of the sample touch it; one
 * with fewer is listed and fails unless it is waived by name. `validated` is true only when every rule holds, nothing is missing and the reference has no unadjudicated unit.
 */
export function agreement (units, rows, labels, team, { families = {}, stage = 'all', holdout = DEFAULTS.holdout, splitSeed = DEFAULTS.seed, seed = DEFAULTS.seed, minKappa = DEFAULTS.minKappa, targetRate = DEFAULTS.targetRate, resamples = DEFAULTS.resamples, retest = null, referenceRater = null, maxUnalignedShare = DEFAULTS.maxUnalignedShare, minLimitPositives = DEFAULTS.minLimitPositives, waive = [] } = {}) {
  validateTeam(team)
  const { chosen, strata, byUnit } = candidates(units, rows, team, { stage, holdout, splitSeed, families })
  const population = new Map()
  for (const id of chosen.map((u) => u.id)) population.set(strata.get(id), (population.get(strata.get(id)) ?? 0) + 1)
  const { reference, main, second, unadjudicated, find } = referenceLabels(labels, { referenceRater })
  const inSample = [...reference.values()].filter((l) => strata.has(l.unit))
  const labeledOf = new Map()
  for (const l of inSample) labeledOf.set(strata.get(l.unit), (labeledOf.get(strata.get(l.unit)) ?? 0) + 1)
  const knobs = { resamples, seed }
  const items = []
  const counts = []
  let unaligned = 0
  for (const l of inSample) {
    const stratum = strata.get(l.unit)
    const w = population.get(stratum) / labeledOf.get(stratum)
    const mine = (byUnit.get(l.unit) ?? []).map((r) => rowLabel(r, families))
    counts.push({ unit: l.unit, stratum, w, p: l.requests.length, r: mine.length })
    if (mine.length !== l.requests.length) { unaligned++; continue }
    mine.forEach((left, i) => items.push({ unit: l.unit, stratum, w, left, right: l.requests[i] }))
  }
  const extraction = agreementBlock(items, team, knobs)
  const rate = (sample, num, den) => { const d = sample.reduce((s, c) => s + c.w * den(c), 0); return d > 0 ? sample.reduce((s, c) => s + c.w * num(c), 0) / d : null }
  const matched = (c) => Math.min(c.p, c.r)
  const exhaustiveness = {
    units: counts.length, requests_by_people: counts.reduce((s, c) => s + c.p, 0), rows: counts.reduce((s, c) => s + c.r, 0),
    omitted: counts.reduce((s, c) => s + Math.max(0, c.p - c.r), 0), invented: counts.reduce((s, c) => s + Math.max(0, c.r - c.p), 0),
    recall: { value: round3(rate(counts, matched, (c) => c.p) ?? 0), ...bootstrapByUnit(counts, (s) => rate(s, matched, (c) => c.p), knobs) },
    precision: { value: round3(rate(counts, matched, (c) => c.r) ?? 0), ...bootstrapByUnit(counts, (s) => rate(s, matched, (c) => c.r), knobs) },
    unaligned_units: unaligned, unaligned_share: counts.length ? round3(unaligned / counts.length) : 0
  }
  let humans = null
  let peopleUnaligned = 0
  if (second) {
    const both = labels.filter((l) => l.rater === main).map((l) => [l, find(second, l.unit)]).filter(([, b]) => b)
    const pairs = []
    for (const [a, b] of both) {
      if (a.requests.length !== b.requests.length) { peopleUnaligned++; continue }
      a.requests.forEach((left, i) => pairs.push({ unit: a.unit, stratum: 'people', w: 1, left, right: b.requests[i] }))
    }
    humans = pairs.length ? { units: both.length, unaligned_units: peopleUnaligned, ...agreementBlock(pairs, team, knobs) } : null
  }
  const run = retest ? testRetest(rows, retest, team, { families, resamples, seed }) : null
  const rules = []
  const lowerRule = (name, k) => rules.push({ name, kappa: k.kappa, lower: k.lower, floor: minKappa, on: 'lower', pass: k.lower !== null && k.lower >= minKappa })
  for (const name of ['area', 'value_holder', 'needs_person']) lowerRule(name, extraction[name])
  for (const l of team.limits ?? []) {
    const k = extraction.limits[l.id]
    if (k.positives >= minLimitPositives) lowerRule(`limit:${l.id}`, k)
    else rules.push({ name: `limit:${l.id}`, positives: k.positives, needed: minLimitPositives, waived: waive.includes(`limit:${l.id}`), pass: waive.includes(`limit:${l.id}`), note: 'too few cases in the sample to measure it' })
  }
  rules.push({ name: 'extraction:recall', value: exhaustiveness.recall.value, lower: exhaustiveness.recall.lower, floor: targetRate, on: 'lower', pass: exhaustiveness.recall.lower !== null && exhaustiveness.recall.lower >= targetRate })
  rules.push({ name: 'extraction:precision', value: exhaustiveness.precision.value, lower: exhaustiveness.precision.lower, floor: targetRate, on: 'lower', pass: exhaustiveness.precision.lower !== null && exhaustiveness.precision.lower >= targetRate })
  rules.push({ name: 'extraction:unaligned_share', value: exhaustiveness.unaligned_share, ceiling: maxUnalignedShare, pass: exhaustiveness.unaligned_share <= maxUnalignedShare })
  if (humans) for (const name of ['area', 'value_holder', 'needs_person']) rules.push({ name: `people:${name}`, kappa: humans[name].kappa, lower: humans[name].lower, floor: minKappa, on: 'lower', pass: humans[name].lower !== null && humans[name].lower >= minKappa })
  if (run) {
    lowerRule('retest:area', run.area)
    lowerRule('retest:needs_person', run.needs_person)
    rules.push({ name: 'retest:unaligned_share', value: run.unaligned_share, ceiling: maxUnalignedShare, pass: run.unaligned_share <= maxUnalignedShare })
  }
  rules.push({ name: 'reference:unadjudicated', value: unadjudicated, ceiling: 0, pass: unadjudicated === 0 })
  const missing = [...(run ? [] : ['retest']), ...(humans ? [] : ['second_rater'])]
  const failing = rules.filter((r) => !r.pass).map((r) => r.name)
  return {
    validated: failing.length === 0 && missing.length === 0,
    min_kappa: minKappa, rules, failing, missing,
    reference: { rater: main, second_rater: second, adjudicated: labels.filter((l) => l.rater === ADJUDICATOR).length, unadjudicated },
    sample: { stage, labeled_units: inSample.length, strata: Object.fromEntries([...population.entries()].map(([k, N]) => [k, { units: N, labeled: labeledOf.get(k) ?? 0 }])) },
    extraction_vs_people: { ...extraction, exhaustiveness }, between_people: humans, retest: run
  }
}

/**
 * The agreement between two runs of the extraction over the same units. Requests are paired by order inside a unit, and only when both runs found the same number
 * of requests there: when they differ, the unit is reported as unaligned and does not enter the kappa (`unaligned_share` says how many were left out). The kappa is unweighted.
 */
export function testRetest (rowsA, rowsB, team, { families = {}, resamples = DEFAULTS.resamples, seed = DEFAULTS.seed } = {}) {
  const a = rowsByUnit(rowsA)
  const b = rowsByUnit(rowsB)
  const items = []
  let aligned = 0
  let unaligned = 0
  for (const [unit, listA] of a) {
    const listB = b.get(unit)
    if (!listB || listB.length !== listA.length) { unaligned++; continue }
    aligned++
    listA.forEach((x, i) => items.push({ unit, stratum: 'all', w: 1, left: rowLabel(x, families), right: rowLabel(listB[i], families) }))
  }
  return { aligned_units: aligned, unaligned_units: unaligned, unaligned_share: aligned + unaligned ? round3(unaligned / (aligned + unaligned)) : 0, ...agreementBlock(items, team, { resamples, seed }) }
}

/**
 * The guards that the product's analyzer touched (`guards_touched`, collected from the API for the labeled units, one line `{ unit, guards_touched }` each, with the id or the text of the
 * guard) against the limits the people found in the unit. This measures the component that holds the wall, which is not the extractor. Per limit, by unit and unweighted: recall,
 * precision (Wilson) and kappa. A limit of the team is matched to a guard by its text.
 */
export function analyzerAgreement (labels, analyses, team, { referenceRater = null, resamples = DEFAULTS.resamples, seed = DEFAULTS.seed } = {}) {
  const { reference, main } = referenceLabels(labels, { referenceRater })
  const byUnit = new Map(analyses.map((a) => [a.unit, new Set((a.guards_touched ?? []).map(String))]))
  const idOf = (token) => (team.limits ?? []).find((l) => l.id === token || l.text === token)?.id ?? null
  const touched = new Map([...byUnit.entries()].map(([u, set]) => [u, new Set([...set].map(idOf).filter(Boolean))]))
  const units = [...reference.values()].filter((l) => touched.has(l.unit))
  const per = Object.fromEntries((team.limits ?? []).map((l) => {
    const pairs = units.map((u) => ({ unit: u.unit, stratum: 'all', w: 1, a: String(touched.get(u.unit).has(l.id)), b: String(u.requests.some((r) => (r.limits ?? []).includes(l.id))) }))
    const tp = pairs.filter((p) => p.a === 'true' && p.b === 'true').length
    const analyzerPositive = pairs.filter((p) => p.a === 'true').length
    const humanPositive = pairs.filter((p) => p.b === 'true').length
    const r = wilson(tp, humanPositive)
    const pr = wilson(tp, analyzerPositive)
    const k = weightedKappa(pairs)
    return [l.id, { units: pairs.length, human_positive: humanPositive, analyzer_positive: analyzerPositive, recall: { value: humanPositive ? round3(tp / humanPositive) : null, lower: round3(r.lower) }, precision: { value: analyzerPositive ? round3(tp / analyzerPositive) : null, lower: round3(pr.lower) }, kappa: k.kappa === null ? null : round3(k.kappa), ...(k.kappa === null ? {} : bootstrapByUnit(pairs, (s) => weightedKappa(s).kappa, { resamples, seed })) }]
  }))
  // The idea guard: the people mark a request `idea: true` when what is asked is to explore an idea (nothing changes without a person's approval); the analyzer's answer is `idea_guard`.
  const withIdea = units.filter((u) => byUnit.has(u.unit) && analyses.find((a) => a.unit === u.unit && typeof a.idea_guard === 'boolean') && u.requests.some((r) => typeof r.idea === 'boolean'))
  const idea = withIdea.length ? (() => {
    const pairs = withIdea.map((u) => ({ unit: u.unit, stratum: 'all', w: 1, a: String(analyses.find((x) => x.unit === u.unit).idea_guard), b: String(u.requests.some((r) => r.idea === true)) }))
    const tp = pairs.filter((p) => p.a === 'true' && p.b === 'true').length
    const humanPositive = pairs.filter((p) => p.b === 'true').length
    const analyzerPositive = pairs.filter((p) => p.a === 'true').length
    const k = weightedKappa(pairs)
    return { units: pairs.length, human_positive: humanPositive, analyzer_positive: analyzerPositive, recall: { value: humanPositive ? round3(tp / humanPositive) : null, lower: round3(wilson(tp, humanPositive).lower) }, precision: { value: analyzerPositive ? round3(tp / analyzerPositive) : null, lower: round3(wilson(tp, analyzerPositive).lower) }, kappa: k.kappa === null ? null : round3(k.kappa) }
  })() : null
  return { reference_rater: main, units: units.length, limits: per, idea }
}

/**
 * The agreement between two sets of scores of the same jobs on the scale of the job evaluation (-2 to +2): for example the judge and a person, or two readings of the judge, or two
 * people. Lines `{ job, id, score }`; a job-indicator that only one of them scored is left out (`unpaired`). Per indicator, the quadratic weighted kappa (Cohen 1968, Psychological
 * Bulletin 70:213-220), which counts a near miss as less of a disagreement than a far one on an ordered scale, and the share of pairs within one point.
 */
export function judgeAgreement (first, second, { levels = [-2, -1, 0, 1, 2] } = {}) {
  const b = new Map(second.map((l) => [`${l.job}|${l.id}`, l.score]))
  const ids = [...new Set(first.map((l) => l.id))].sort()
  const span = (levels.length - 1) ** 2
  const out = {}
  let unpaired = 0
  for (const id of ids) {
    const pairs = first.filter((l) => l.id === id && b.has(`${l.job}|${id}`)).map((l) => [l.score, b.get(`${l.job}|${id}`)])
    unpaired += first.filter((l) => l.id === id).length - pairs.length
    const n = pairs.length
    if (!n) { out[id] = { n: 0, kappa: null, within_one: null }; continue }
    const share = (side, v) => pairs.filter((p) => p[side] === v).length / n
    let observed = 0
    let expected = 0
    for (const [x, y] of pairs) observed += ((x - y) ** 2) / span
    for (const x of levels) for (const y of levels) expected += share(0, x) * share(1, y) * (((x - y) ** 2) / span)
    out[id] = { n, kappa: expected === 0 ? (observed === 0 ? 1 : 0) : round3(1 - (observed / n) / expected), within_one: round3(pairs.filter(([x, y]) => Math.abs(x - y) <= 1).length / n) }
  }
  return { indicators: out, unpaired }
}

function main (argv) {
  const [command, ...rest] = argv
  const option = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback }
  if (command === 'judge') {
    const o = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined }
    if (!o('--first') || !o('--second')) { console.error('Uso: node scripts/row-validation.mjs judge --first scores-a.jsonl --second scores-b.jsonl [--out agreement.json]   (líneas { job, id, score })'); process.exit(2) }
    const text = `${JSON.stringify(judgeAgreement(readJsonl(o('--first')), readJsonl(o('--second'))), null, 2)}\n`
    if (o('--out')) writeFileSync(o('--out'), text); else process.stdout.write(text)
    return
  }
  const need = command === 'analyzer' ? ['--units', '--labels', '--analysis', '--team'] : command === 'agree' ? ['--units', '--rows', '--labels', '--team'] : ['--units', '--rows', '--team']
  if (!['sample', 'agree', 'analyzer'].includes(command) || need.some((f) => !option(f))) {
    console.error('Uso: node scripts/row-validation.mjs sample --units units.jsonl --rows rows.jsonl --team team.json [--families f.json] [--stage all|tune|confirm] [--holdout 0.5] [--target-rate 0.8] [--half-width 0.15] [--with-text] --out sample.jsonl\n     node scripts/row-validation.mjs agree --units units.jsonl --rows rows.jsonl --labels labels.jsonl --team team.json [--families f.json] [--stage ...] [--reference-rater name] [--retest rows2.jsonl] [--min-kappa 0.6] [--max-unaligned-share 0.2] [--waive limit:id] [--min-limit-positives 5] [--resamples 1000] [--out validation.json]\n     node scripts/row-validation.mjs analyzer --units units.jsonl --labels labels.jsonl --analysis analysis.jsonl --team team.json [--reference-rater name] [--out analyzer.json]')
    process.exit(2)
  }
  const team = readJson(option('--team'))
  const families = option('--families') ? readJson(option('--families')) : {}
  const emit = (value, text = null) => { const out = text ?? `${JSON.stringify(value, null, 2)}\n`; if (option('--out')) writeFileSync(option('--out'), out); else process.stdout.write(out) }
  const stage = { stage: option('--stage', 'all'), holdout: option('--holdout') ? Number(option('--holdout')) : DEFAULTS.holdout }
  try {
    const units = readJsonl(option('--units'))
    if (command === 'sample') {
      const { items, sizes, short } = drawValidationSample(units, readJsonl(option('--rows')), team, { families, ...stage, withText: rest.includes('--with-text'), ...(option('--target-rate') ? { targetRate: Number(option('--target-rate')) } : {}), ...(option('--half-width') ? { halfWidth: Number(option('--half-width')) } : {}) })
      emit(items, `${items.map((i) => JSON.stringify(i)).join('\n')}\n`)
      console.error(`${items.length} unidades para leer en su texto original (${sizes.per_stratum} por estrato), ${items.filter((i) => i.double).length} para una segunda persona`)
      for (const s of short) console.error(`Aviso: el estrato ${s.stratum} tiene ${s.available} unidades y la muestra pide ${s.needed}.`)
      return
    }
    if (command === 'analyzer') {
      emit(analyzerAgreement(readJsonl(option('--labels')), readJsonl(option('--analysis')), team, { referenceRater: option('--reference-rater') ?? null }))
      return
    }
    const result = agreement(units, readJsonl(option('--rows')), readJsonl(option('--labels')), team, {
      families, ...stage, minKappa: option('--min-kappa') ? Number(option('--min-kappa')) : DEFAULTS.minKappa, ...(option('--resamples') ? { resamples: Number(option('--resamples')) } : {}),
      referenceRater: option('--reference-rater') ?? null, ...(option('--max-unaligned-share') ? { maxUnalignedShare: Number(option('--max-unaligned-share')) } : {}), ...(option('--min-limit-positives') ? { minLimitPositives: Number(option('--min-limit-positives')) } : {}),
      retest: option('--retest') ? readJsonl(option('--retest')) : null, waive: rest.flatMap((x, i) => (x === '--waive' ? [rest[i + 1]] : []))
    })
    emit(result)
    console.error(result.validated ? `Validadas: el límite inferior de cada kappa llega a ${result.min_kappa}.` : `No validadas. Reglas que fallan: ${result.failing.join(', ') || 'ninguna'}. Falta: ${result.missing.join(', ') || 'nada'}.`)
    if (!result.validated) process.exit(1)
  } catch (error) { console.error(error.message); process.exit(1) }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
