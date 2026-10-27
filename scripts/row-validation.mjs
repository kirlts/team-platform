#!/usr/bin/env node
// Validates the rows of the extraction against people before any measure of the method counts.
//
//   node scripts/row-validation.mjs sample rows.jsonl --team team.json [--families f.json] --out sample.jsonl
//   node scripts/row-validation.mjs agree  rows.jsonl --labels labels.jsonl --team team.json [--families f.json] [--retest rows2.jsonl] [--min-kappa 0.6] [--out validation.json]
//
// `sample` draws a stratified sample of the rows that are not confidential and writes one line per request, with the summary that identifies it and none of the fields
// the extractor estimated, so a person labels it blind. `labels.jsonl` has one line per label: `{ key, rater, area, value_holder, limits }` (`value_holder` is
// `person` or `model`, `limits` the ids of the limits of the team the request touches). Every request of the sample is labeled by the first rater and the requests
// marked `double` by a second one. `agree` computes the agreement between the extraction and the people, between two people, and between two runs of the extraction.
// Why this exists and how to read it: docs/METODO-DE-REPARTO.md, section «Validar las filas».
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { DEFAULTS, areaTitle, hiddenAreas, readJson, readJsonl, requiresPerson, seededRandom, shuffle, validateRows, validateTeam, wilsonSampleSize, withAreas } from './area-method.mjs'

/** The rows with a `key` that names each request: the unit and the order of the request inside the unit, in the order of the file. */
export function keyRows (rows) {
  const seen = new Map()
  return rows.map((r) => {
    const n = (seen.get(r.unit) ?? 0) + 1
    seen.set(r.unit, n)
    return { ...r, key: r.key ?? `${r.unit}#${n}` }
  })
}

/** The sizes of the validation: requests per area, and requests labeled twice. Both come from the interval count of `wilsonSampleSize`, not from a round number. */
export function validationSizes ({ targetRate = DEFAULTS.targetRate, halfWidth = DEFAULTS.halfWidth, z = DEFAULTS.z } = {}) {
  const n = wilsonSampleSize(targetRate, halfWidth, z)
  return { per_area: n, double: n }
}

const stratumOf = (row, team) => `${row.area}|${requiresPerson(row, team) ? 'person' : 'model'}`

/**
 * A stratified sample for the people who label. Strata: area, and whether the request needs a person (the extraction says so, and only to choose: the estimates
 * use the weights of the strata). Each area gets `per_area` requests split in two halves; when a half does not have that many rows the other takes the rest.
 * Only rows that are not confidential are drawn; the rows of a confidential unit are read by a person without a sample (docs, section «Material de partida»).
 */
export function drawValidationSample (rows, team, { families = {}, seed = DEFAULTS.seed, ...knobs } = {}) {
  validateTeam(team)
  validateRows(rows)
  const hidden = hiddenAreas(rows, families)
  const tagged = keyRows(withAreas(rows, families, hidden)).filter((r) => !r.confidential && !hidden.has(r.area))
  const sizes = validationSizes(knobs)
  const rand = seededRandom(seed)
  const chosen = []
  const short = []
  for (const area of [...new Set(tagged.map((r) => r.area))].sort()) {
    const pools = ['person', 'model'].map((kind) => shuffle(tagged.filter((r) => stratumOf(r, team) === `${area}|${kind}`), rand))
    const half = Math.ceil(sizes.per_area / 2)
    const take = pools.map((p) => Math.min(p.length, half))
    let spare = sizes.per_area - take[0] - take[1] // a half that has fewer rows than it should hand its quota to the other half
    for (let i = 0; i < 2 && spare > 0; i++) { const extra = Math.min(pools[i].length - take[i], spare); take[i] += extra; spare -= extra }
    const picked = pools.flatMap((p, i) => p.slice(0, take[i]))
    if (picked.length < sizes.per_area) short.push({ area, available: tagged.filter((r) => r.area === area).length, needed: sizes.per_area })
    chosen.push(...picked)
  }
  const doubled = new Set(shuffle(chosen.map((r) => r.key), rand).slice(0, sizes.double))
  return {
    items: chosen.map((r) => ({ key: r.key, unit: r.unit, date: r.date, summary: r.summary, double: doubled.has(r.key) })),
    sizes, short
  }
}

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

/** The kappa with a percentile interval from a bootstrap that resamples inside each stratum, seeded. */
export function kappaWithInterval (items, { resamples = DEFAULTS.resamples, seed = DEFAULTS.seed } = {}) {
  const point = weightedKappa(items)
  if (point.kappa === null) return { ...point, lower: null, upper: null, n: 0 }
  const rand = seededRandom(seed)
  const byStratum = new Map()
  for (const it of items) byStratum.set(it.stratum, [...(byStratum.get(it.stratum) ?? []), it])
  const draws = []
  for (let b = 0; b < resamples; b++) {
    const sample = []
    for (const group of byStratum.values()) for (let i = 0; i < group.length; i++) sample.push(group[Math.floor(rand() * group.length)])
    const k = weightedKappa(sample).kappa
    if (k !== null) draws.push(k)
  }
  draws.sort((x, y) => x - y)
  const at = (q) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(q * draws.length)))]
  const round = (x) => Math.round(x * 1000) / 1000
  return { kappa: round(point.kappa), observed: round(point.observed), lower: round(at(0.025)), upper: round(at(0.975)), n: items.length }
}

const FIELDS = {
  area: (x) => x.area,
  value_holder: (x) => x.value_holder,
  needs_person: (x, team) => String(requiresPerson(x, team))
}

/** The agreement of one field between two sources over keyed items `{ key, stratum, w, left, right }`. */
function fieldAgreement (items, field, team, knobs) {
  const pairs = items.map((it) => ({ a: field(it.left, team), b: field(it.right, team), w: it.w, stratum: it.stratum }))
  return kappaWithInterval(pairs, knobs)
}

const limitAgreements = (items, team, knobs) => Object.fromEntries((team.limits ?? []).map((l) => {
  const touches = (x) => String((x.limits ?? []).includes(l.id))
  const pairs = items.map((it) => ({ a: touches(it.left), b: touches(it.right), w: it.w, stratum: it.stratum }))
  return [l.id, kappaWithInterval(pairs, knobs)]
}))

const agreementBlock = (items, team, knobs) => ({
  area: fieldAgreement(items, FIELDS.area, team, knobs),
  value_holder: fieldAgreement(items, FIELDS.value_holder, team, knobs),
  needs_person: fieldAgreement(items, FIELDS.needs_person, team, knobs),
  limits: limitAgreements(items, team, knobs)
})

/**
 * The agreement between the extraction and the people (kappa of area, value holder, whether a person is needed and each limit, weighted by the strata of the sample), the
 * agreement between two people on the requests they both labeled, and, with a second run of the extraction, the agreement between the two runs.
 */
export function agreement (rows, labels, team, { families = {}, minKappa = DEFAULTS.minKappa, resamples = DEFAULTS.resamples, seed = DEFAULTS.seed, retest = null } = {}) {
  validateTeam(team)
  const hidden = hiddenAreas(rows, families)
  const tagged = keyRows(withAreas(rows, families, hidden)).filter((r) => !r.confidential && !hidden.has(r.area))
  const byKey = new Map(tagged.map((r) => [r.key, r]))
  const population = new Map()
  for (const r of tagged) { const k = stratumOf(r, team); population.set(k, (population.get(k) ?? 0) + 1) }
  const raters = [...new Set(labels.map((l) => l.rater))].sort()
  if (raters.length === 0) throw new Error('The labels file has no labels.')
  const labelOf = (rater, key) => labels.find((l) => l.rater === rater && l.key === key)
  const first = raters[0]
  const labeled = labels.filter((l) => l.rater === first && byKey.has(l.key))
  const sampleOfStratum = new Map()
  for (const l of labeled) { const k = stratumOf(byKey.get(l.key), team); sampleOfStratum.set(k, (sampleOfStratum.get(k) ?? 0) + 1) }
  const items = labeled.map((l) => {
    const row = byKey.get(l.key)
    const stratum = stratumOf(row, team)
    return { key: l.key, stratum, w: population.get(stratum) / sampleOfStratum.get(stratum), left: row, right: { area: l.area, value_holder: l.value_holder, limits: l.limits ?? [] } }
  })
  const knobs = { resamples, seed }
  const extraction = agreementBlock(items, team, knobs)
  let humans = null
  if (raters.length > 1) {
    const both = labeled.map((l) => [l, labelOf(raters[1], l.key)]).filter(([, b]) => b)
    humans = both.length ? agreementBlock(both.map(([a, b]) => ({ key: a.key, stratum: stratumOf(byKey.get(a.key), team), w: 1, left: a, right: b })), team, knobs) : null
  }
  const run = retest ? testRetest(rows, retest, team, { families, resamples, seed }) : null
  const kappas = { area: extraction.area.kappa, value_holder: extraction.value_holder.kappa, needs_person: extraction.needs_person.kappa, ...(run ? { retest_area: run.area.kappa, retest_needs_person: run.needs_person.kappa } : {}) }
  const missing = [...(run ? [] : ['retest']), ...(humans ? [] : ['second_rater'])]
  const failing = Object.entries(kappas).filter(([, k]) => !(k >= minKappa)).map(([name]) => name)
  return {
    validated: failing.length === 0 && missing.length === 0,
    min_kappa: minKappa, failing, missing,
    sample: { labeled: items.length, strata: Object.fromEntries([...population.entries()].map(([k, N]) => [k, { rows: N, labeled: sampleOfStratum.get(k) ?? 0 }])), raters },
    extraction_vs_people: extraction, between_people: humans, retest: run
  }
}

/**
 * The agreement between two runs of the extraction over the same units. Requests are paired by order inside a unit, and only when both runs found the same number
 * of requests there: when they differ, the unit is reported as unaligned and does not enter the kappa. The kappa is unweighted: every aligned request counts once.
 */
export function testRetest (rowsA, rowsB, team, { families = {}, resamples = DEFAULTS.resamples, seed = DEFAULTS.seed } = {}) {
  const group = (rows) => { const m = new Map(); for (const r of rows) m.set(r.unit, [...(m.get(r.unit) ?? []), r]); return m }
  const a = group(rowsA)
  const b = group(rowsB)
  const items = []
  let aligned = 0
  let unaligned = 0
  for (const [unit, listA] of a) {
    const listB = b.get(unit)
    if (!listB || listB.length !== listA.length) { unaligned++; continue }
    aligned++
    listA.forEach((x, i) => items.push({ stratum: 'all', w: 1, left: { ...x, area: areaTitle(x, families) }, right: { ...listB[i], area: areaTitle(listB[i], families) } }))
  }
  const knobs = { resamples, seed }
  return { aligned_units: aligned, unaligned_units: unaligned, ...agreementBlock(items, team, knobs) }
}

function main (argv) {
  const [command, rowsFile, ...rest] = argv
  const option = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback }
  if (!['sample', 'agree'].includes(command) || !rowsFile || !option('--team') || (command === 'agree' && !option('--labels'))) {
    console.error('Uso: node scripts/row-validation.mjs sample rows.jsonl --team team.json [--families f.json] --out sample.jsonl\n     node scripts/row-validation.mjs agree rows.jsonl --labels labels.jsonl --team team.json [--families f.json] [--retest rows2.jsonl] [--min-kappa 0.6] [--out validation.json]')
    process.exit(2)
  }
  const rows = readJsonl(rowsFile)
  const team = readJson(option('--team'))
  const families = option('--families') ? readJson(option('--families')) : {}
  try {
    if (command === 'sample') {
      const { items, sizes, short } = drawValidationSample(rows, team, { families })
      const text = items.map((i) => JSON.stringify(i)).join('\n') + '\n'
      if (option('--out')) writeFileSync(option('--out'), text); else process.stdout.write(text)
      console.error(`${items.length} pedidos para etiquetar (${sizes.per_area} por área), ${items.filter((i) => i.double).length} para una segunda persona`)
      for (const s of short) console.error(`Aviso: el área ${s.area} tiene ${s.available} filas abiertas y la muestra pide ${s.needed}.`)
      return
    }
    const result = agreement(rows, readJsonl(option('--labels')), team, { families, minKappa: option('--min-kappa') ? Number(option('--min-kappa')) : DEFAULTS.minKappa, retest: option('--retest') ? readJsonl(option('--retest')) : null })
    const text = `${JSON.stringify(result, null, 2)}\n`
    if (option('--out')) writeFileSync(option('--out'), text); else process.stdout.write(text)
    console.error(result.validated ? 'Validadas: todo campo supera el kappa mínimo.' : `No validadas. Bajo el mínimo: ${result.failing.join(', ') || 'ninguno'}. Falta: ${result.missing.join(', ') || 'nada'}.`)
    if (!result.validated) process.exit(1)
  } catch (error) { console.error(error.message); process.exit(1) }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
