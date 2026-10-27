#!/usr/bin/env node
// Measures how much a model agrees with the extracted rows when it routes requests reading only the descriptions of the areas and the profiles of the members.
//
//   node scripts/route-experiment.mjs rows.jsonl (--load load.json | --holdout [0.5] --purposes purposes.json [--stage tune|confirm]) --team team.json [--families f.json]
//        [--sample n] [--judge] [--judge-model m] [--labels labels.jsonl] [--validation validation.json] [--versus other-result.json] [--accept 0.8]
//        [--model claude-haiku-5-5] [--parallel 6] [--out result.json]
//
// For each sampled row the router answers an area, who attends and a one-line brief. The result is scored against the row without a judge: the area is the reference one, and a
// person is included exactly when the row needs one (`requiresPerson`). Those two rates are the AGREEMENT WITH THE ROWS, which the extraction wrote: they become accuracy only when people
// have validated the rows (`scripts/row-validation.mjs`), and until then the result says `validated: false`. They come next to the rates of routers with no model (`baselines`) and, with
// `--labels`, next to the agreement with the people who labeled a sample. With `--holdout` the descriptions are built with some units and measured on others. With `--judge` a second call
// scores the routing with four indicators of the job evaluation (`src/execute/judge.js`: 1.1, 1.2, 2.3 and 3.3), from -2 to +2, against the reference of the row; the result says when the
// judge is the same model as the router. `--accept` makes the command fail when the agreement is below it; without it nothing passes or fails: the threshold is the team's.
//
// A description set that routes badly is corrected only where the experiment shows a confusion of two cases or more, with the tuning set, and read once more with the confirmation set
// (docs/METODO-DE-REPARTO.md, section «Medir el reparto»).

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { DEFAULTS, analyze, propose, readJson, readJsonl, requiresPerson, seededRandom, shuffle, splitUnits, trainNaiveBayes, validateTeam, wilson, wilsonSampleSize, withAreas } from './area-method.mjs'
import { keyRows, referenceLabels, rowsByUnit, unitStrata } from './row-validation.mjs'
import { KPIS } from '../src/execute/judge.js'

// The four indicators that apply to a routing: the others judge a finished job.
export const ROUTING_KPIS = Object.freeze(['1.1', '1.2', '2.3', '3.3'])

/** The instructions of the router: the descriptions of the areas first (equal in every call, so a provider can cache them), then the profiles. */
export function routerPrompt (load, team) {
  const areas = load.areas.map((a) => `### ${a.title}\n${a.description}`).join('\n\n')
  const members = (load.members ?? []).map((m) => `### ${team.members.find((x) => x.email === m.email)?.name ?? m.email}\n${m.profile}`).join('\n\n')
  return `Repartes pedidos de un equipo. Para cada pedido eliges el área, quién lo atiende y escribes el encargo en una línea: qué se maximiza, qué puede quedar apenas suficiente y dónde se para para preguntar a una persona.\n\nÁreas:\n\n${areas}\n\nMiembros:\n\n${members}`
}

export function routerSchema (load, team) {
  return {
    type: 'object', additionalProperties: false, required: ['area', 'attends', 'brief'],
    properties: {
      area: { type: 'string', enum: load.areas.map((a) => a.title) },
      attends: { type: 'array', items: { type: 'string', enum: team.members.map((m) => m.name) }, minItems: 1 },
      brief: { type: 'string' }
    }
  }
}

export function judgeSchema () {
  const item = {
    type: 'array', minItems: ROUTING_KPIS.length, maxItems: ROUTING_KPIS.length,
    items: {
      type: 'object', additionalProperties: false, required: ['id', 'applies', 'score', 'quote', 'reason'],
      properties: {
        id: { type: 'string', enum: [...ROUTING_KPIS] }, applies: { type: 'boolean', description: 'false when this indicator cannot be observed in this routing (then it is not scored).' },
        score: { type: 'integer', enum: [-2, -1, 0, 1, 2] }, quote: { type: 'string', description: 'A direct quote of the request, the reference or the brief that supports the score; empty only when applies is false.' }, reason: { type: 'string' }
      }
    }
  }
  return { type: 'object', additionalProperties: false, required: ['indicators'], properties: { indicators: item } }
}

// The anchors are the five levels of each indicator in `KPIS` (written for an unattended job): they are what a score of -2 to +2 means, and the judge of a routing reads them too.
const anchors = (k) => k.levels.map((text, i) => `  ${['+2', '+1', '0', '-1', '-2'][i]}: ${text}`).join('\n')
const judgeSystem = `Juzgas el reparto de un pedido de un equipo: un enrutador eligió el área, quién lo atiende y escribió el encargo. Puntúa cada indicador de -2 a +2 con las anclas que se dan (el 0 es el mínimo aceptable), contra la referencia que se da. Cita un fragmento textual del pedido, de la referencia o del encargo que sostenga cada puntaje. Un indicador que este reparto no deja observar lleva applies false y no se puntúa.\n${KPIS.filter((k) => ROUTING_KPIS.includes(k.id)).map((k) => `${k.id} ${k.name}: ${k.asks}\n${anchors(k)}`).join('\n')}`

/** The scores of a judgement that hold up: the indicator applies, it has a score and its quote is in the evidence the judge was given. The others are not scored and are counted. */
export function validJudgement (list, evidence) {
  const flat = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  const scores = {}
  const dropped = { not_observable: 0, quote_not_in_evidence: 0, repeated_or_unknown: 0 }
  for (const k of list ?? []) {
    if (!ROUTING_KPIS.includes(k.id) || id_seen(scores, k.id)) { dropped.repeated_or_unknown++; continue }
    if (k.applies !== true) { dropped.not_observable++; continue }
    if (!flat(k.quote) || !flat(evidence).includes(flat(k.quote))) { dropped.quote_not_in_evidence++; continue }
    scores[k.id] = k.score
  }
  return { scores, dropped }
}
const id_seen = (scores, id) => id in scores

const referenceText = (row, team) => `Pedido: ${row.summary} (lo pide ${row.who}).\nReferencia: área ${row.area}; lo que falta lo tiene ${row.value_holder === 'person' ? row.holder || 'una persona' : 'el modelo'}; límites que toca: ${(row.limits ?? []).join(', ') || 'ninguno'}; se maximiza: ${row.maximize || 'no se deduce'}; se sacrifica: ${row.sacrifice || 'no se deduce'}; exige a una persona: ${requiresPerson(row, team) ? 'sí' : 'no'}.`

/** A deterministic sample of `size` rows in a uniformly random order (Fisher-Yates with the seed). */
export function sampleRows (rows, size, seed = DEFAULTS.seed) {
  return shuffle(rows, seededRandom(seed)).slice(0, size)
}

/**
 * The sample to route. Rows whose area is not in the load file are first given to the area they would merge into (`merge`), and dropped only when that area is
 * not loaded either; this happens before the cut, so the sample has the size that was asked. Then it is stratified by area: every area gets `perArea` requests
 * (the count behind a Wilson interval of half width `halfWidth`, see `wilsonSampleSize`) or all it has, and the rest of `size` is drawn from what is left. Each
 * sampled request carries the weight of its area (rows of the area in the pool over rows sampled), so a rate describes the corpus and not the sample.
 * `warnings` says when the pool is smaller than `size`, when an area has fewer requests than `perArea`, and when `perArea` raised the size.
 */
export function drawSample (rows, load, { size = null, perArea = wilsonSampleSize(DEFAULTS.targetRate, DEFAULTS.halfWidth), merge = {}, seed = DEFAULTS.seed } = {}) {
  const titles = new Set(load.areas.map((a) => a.title))
  const discarded = []
  const pool = []
  // A request from a confidential unit is never routed: the router rewrites the request in its brief, and the words of a recorded meeting reach no output.
  const confidential = rows.filter((r) => r.confidential).length
  for (const r of rows.filter((r) => !r.confidential)) {
    const area = titles.has(r.area) ? r.area : (titles.has(merge[r.area]) ? merge[r.area] : null)
    if (area === null) discarded.push(r)
    else pool.push(area === r.area ? r : { ...r, area, area_before_merge: r.area })
  }
  const rand = seededRandom(seed)
  const groups = new Map()
  for (const r of shuffle(pool, rand)) groups.set(r.area, [...(groups.get(r.area) ?? []), r])
  const warnings = []
  const target = size ?? perArea * groups.size
  const chosen = []
  const leftover = []
  for (const [area, list] of [...groups.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    chosen.push(...list.slice(0, perArea))
    leftover.push(...list.slice(perArea))
    if (list.length < perArea) warnings.push({ kind: 'area_short', area, available: list.length, needed: perArea })
  }
  if (chosen.length > target) warnings.push({ kind: 'size_raised', requested: target, drawn: chosen.length })
  const fill = shuffle(leftover, rand).slice(0, Math.max(0, target - chosen.length))
  chosen.push(...fill)
  if (chosen.length < target) warnings.push({ kind: 'pool_short', requested: target, available: chosen.length })
  const poolSize = new Map([...groups.entries()].map(([a, l]) => [a, l.length]))
  const drawn = chosen.reduce((m, r) => m.set(r.area, (m.get(r.area) ?? 0) + 1), new Map())
  return { sample: chosen.map((r) => ({ ...r, weight: poolSize.get(r.area) / drawn.get(r.area) })), discarded: discarded.length, confidential, merged: pool.filter((r) => r.area_before_merge).length, warnings }
}

/**
 * Scores one routing against a reference row: the extraction's row, or a row rebuilt from the label of a person. `people` are the members of kind person.
 * `area_agrees` is whether the area is the reference one; `person_agrees` is whether a person is included exactly when the reference needs one: if the value is a
 * named person's, that person must be among those included (others do not count against); if the need comes from a limit and the value is the model's, any person
 * will do. `person_extra` only counts when no person was needed, and `person_missing` when one was needed and none was included.
 */
export function scoreRouting (route, row, team) {
  const people = new Set(team.members.filter((m) => (m.kind ?? 'person') === 'person').map((m) => m.name))
  const needs = requiresPerson(row, team)
  const included = route.attends.filter((n) => people.has(n))
  const holder = row.value_holder === 'person' ? row.holder : ''
  return {
    area_agrees: route.area === row.area,
    person_agrees: needs ? (people.has(holder) ? included.includes(holder) : included.length > 0) : included.length === 0,
    person_missing: needs && included.length === 0,
    person_extra: !needs && included.length > 0,
    // For the precision and the recall of the people: a router that includes everyone agrees on every request that needs a person, and `person_agrees` does not see the excess.
    person_included: included.length > 0,
    person_needed: needs,
    person_right: needs && (people.has(holder) ? included.includes(holder) : included.length > 0)
  }
}

/**
 * The agreement that routers with no model would get on the same requests: always the area that is the largest in the construction rows, always the agent alone
 * (no person), and always the person who asks (the agent when the one who asks is not a person). A measure of the routing means nothing without them
 * (docs/METODO-DE-REPARTO.md, section «Medir el reparto»).
 */
export function baselines (sample, team, majorityArea, reference = (r) => r, predictArea = null) {
  const agent = team.members.find((m) => m.kind === 'agent')?.name ?? team.members[0].name
  const people = new Set(team.members.filter((m) => (m.kind ?? 'person') === 'person').map((m) => m.name))
  const total = sample.reduce((t, r) => t + (r.weight ?? 1), 0)
  const rate = (route) => total ? sample.filter((r) => scoreRouting(route(r), reference(r), team)[route.field]).reduce((t, r) => t + (r.weight ?? 1), 0) / total : 0
  const area = (r) => ({ area: majorityArea, attends: [agent] })
  area.field = 'area_agrees'
  const alone = (r) => ({ area: r.area, attends: [agent] })
  alone.field = 'person_agrees'
  const asker = (r) => ({ area: r.area, attends: [people.has(r.who) ? r.who : agent] })
  asker.field = 'person_agrees'
  const everyone = (r) => ({ area: r.area, attends: [...people] })
  everyone.field = 'person_agrees'
  const out = { area_majority: { area: majorityArea, rate: rate(area) }, person_agent_alone: { rate: rate(alone) }, person_asker: { rate: rate(asker) }, person_all: { rate: rate(everyone) } }
  if (predictArea) {
    const reads = (r) => ({ area: predictArea(r.summary), attends: [agent] })
    reads.field = 'area_agrees'
    out.area_nb = { rate: rate(reads) }
  }
  return out
}

/**
 * Builds the descriptions and the profiles with the construction side of the rows and returns the held-out set to measure them on. `stage` is `tune` while the
 * descriptions are being corrected and `confirm` for the one reading that is reported; a unit is never on both sides.
 */
export function buildAndSplit (rows, team, { stage = 'tune', holdout, seed = 7, ...proposal } = {}) {
  if (!['tune', 'confirm'].includes(stage)) throw new Error('stage must be tune or confirm')
  const sets = splitUnits(rows, { holdout, seed })
  // The construction side is already the share that is left after holding out: its minimum is the interval count, not four times as much.
  const { spec, skipped, report } = propose(sets.build, team, { ...proposal, holdout: 0 })
  return { load: spec, skipped, report, test: sets[stage], buildUnits: new Set(sets.build.map((r) => r.unit)), buildRows: sets.build, sets: { build: sets.build.length, tune: sets.tune.length, confirm: sets.confirm.length }, stage }
}

/**
 * The sample when people have labeled units: exactly the requests of the labeled units of this pool, so that the router and the people look at the same requests. A unit counts when
 * the extraction wrote as many rows as the person listed requests (they are paired by order; the others are `unaligned` and left out). Every request carries its `label`
 * and the weight of its stratum (units of the pool in the stratum over labeled units in it). Confidential units are never routed.
 */
export function labeledSample (rows, reference, team, { merge = {} } = {}) {
  const open = rows.filter((r) => !r.confidential)
  const byUnit = rowsByUnit(open)
  const strata = unitStrata([...byUnit.keys()], byUnit, team)
  const population = new Map()
  for (const st of strata.values()) population.set(st, (population.get(st) ?? 0) + 1)
  const usable = [...reference.values()].filter((l) => byUnit.has(l.unit) && byUnit.get(l.unit).length === l.requests.length)
  const labeled = new Map()
  for (const l of usable) labeled.set(strata.get(l.unit), (labeled.get(strata.get(l.unit)) ?? 0) + 1)
  const sample = usable.flatMap((l) => byUnit.get(l.unit).map((row, i) => ({ ...row, label: { ...l.requests[i], area: merge[l.requests[i].area] ?? l.requests[i].area }, unit_reference: l, weight: population.get(strata.get(l.unit)) / labeled.get(strata.get(l.unit)) })))
  const outsideThePool = [...reference.values()].filter((l) => !byUnit.has(l.unit)).length
  const unaligned = [...reference.values()].filter((l) => byUnit.has(l.unit) && byUnit.get(l.unit).length !== l.requests.length).length
  return { sample, units: usable.length, unaligned, outsideThePool }
}

const labelRow = (row) => ({ ...row, area: row.label.area, value_holder: row.label.value_holder, holder: row.label.holder ?? '', limits: row.label.limits ?? [] })

/**
 * Runs the sample through the router (and the judge when asked). `provider.complete({ system, messages, schema, effort })`. With `reference` (the labels of people, from
 * `referenceLabels`) it routes the labeled requests and reports the agreement with the people next to the agreement with the rows, on the same requests; `unitTexts` (unit id to
 * `{ text, author }`) adds the same measure on the original text of the units that have a single request (`--raw`).
 */
export async function runExperiment (rows, load, team, { provider, families = {}, size = null, perArea, merge = {}, judge = false, parallel = 6, seed = 7, held = null, buildUnits = null, buildRows = null, reference = null, referenceRater = null, unitTexts = null, validation = null, models = {} } = {}) {
  validateTeam(team)
  const tagged = withAreas(rows, families)
  const labeledRun = reference ? labeledSample(tagged, reference, team, { merge }) : null
  const loaded = new Set(load.areas.map((a) => a.title))
  const drawn = labeledRun
    ? { sample: labeledRun.sample.flatMap((r) => (loaded.has(r.area) ? [r] : loaded.has(merge[r.area]) ? [{ ...r, area: merge[r.area], area_before_merge: r.area }] : [])), discarded: labeledRun.sample.filter((r) => !loaded.has(r.area) && !loaded.has(merge[r.area])).length, merged: labeledRun.sample.filter((r) => !loaded.has(r.area) && loaded.has(merge[r.area])).length, confidential: rows.filter((r) => r.confidential).length, warnings: [] }
    : drawSample(tagged, load, { size, merge, seed, ...(perArea ? { perArea } : {}) })
  const sample = drawn.sample
  if (labeledRun) {
    const perAreaNeeded = perArea ?? wilsonSampleSize(DEFAULTS.targetRate, DEFAULTS.halfWidth)
    const counts = sample.reduce((m, r) => m.set(r.area, (m.get(r.area) ?? 0) + 1), new Map())
    for (const [area, n] of [...counts.entries()].sort()) if (n < perAreaNeeded) drawn.warnings.push({ kind: 'area_short', area, available: n, needed: perAreaNeeded })
    if (labeledRun.unaligned) drawn.warnings.push({ kind: 'unaligned_units', units: labeledRun.unaligned })
    if (labeledRun.outsideThePool) drawn.warnings.push({ kind: 'labels_outside_the_pool', units: labeledRun.outsideThePool })
  }
  const system = routerPrompt(load, team)
  const schema = routerSchema(load, team)
  const out = []
  let next = 0
  const worker = async () => {
    while (next < sample.length) {
      const row = sample[next++]
      const route = (await provider.complete({ system, messages: [{ role: 'user', content: `Lo pide: ${row.who}\nPedido: ${row.summary}` }], schema, effort: 'low' })).json
      const result = { key: row.key, unit: row.unit, weight: row.weight, reference_area: row.area, area: route.area, attends: route.attends, brief: route.brief, ...scoreRouting(route, row, team) }
      if (row.label) { const l = scoreRouting(route, labelRow(row), team); result.label_area_agrees = l.area_agrees; result.label_person_agrees = l.person_agrees }
      if (judge) {
        // The judge reads the reference of the people when there is one: the extraction is not the truth it is measured against.
        const evidence = `${referenceText(row.label ? labelRow(row) : row, team)}\nReparto: área ${route.area}; atiende ${route.attends.join(', ')}; encargo: ${route.brief}`
        const j = (await provider.complete({ system: judgeSystem, messages: [{ role: 'user', content: evidence }], schema: judgeSchema(), effort: 'low' })).json
        const valid = validJudgement(j?.indicators, evidence)
        result.indicators = valid.scores
        result.judge_dropped = valid.dropped
      }
      out.push(result)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, sample.length)) }, worker))
  const referenceRows = withAreas(buildRows ?? rows, families)
  const predictArea = referenceRows.length ? trainNaiveBayes(referenceRows, (r) => r.area) : null // the construction rows when there is a split, the whole corpus otherwise
  const largest = [...referenceRows.reduce((m, r) => m.set(r.area, (m.get(r.area) ?? 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const withLabels = out.filter((r) => 'label_area_agrees' in r)
  const raw = labeledRun && unitTexts ? await routeRaw(sample, unitTexts, { provider, system, schema, team, load, parallel }) : null
  const labelled = labeledRun ? {
    n: withLabels.length, units: labeledRun.units, rater: referenceRater,
    area: rateOf(withLabels.filter((r) => r.label_area_agrees), withLabels), person: rateOf(withLabels.filter((r) => r.label_person_agrees), withLabels),
    baselines: baselines(sample.filter((r) => r.label), team, largest, labelRow, predictArea), raw
  } : null
  return {
    ...summarize(out),
    sample: { requested: size, drawn: sample.length, discarded: drawn.discarded, confidential_left_out: drawn.confidential, merged: drawn.merged, warnings: drawn.warnings },
    validated: validation?.validated === true,
    valid_for_acceptance: Boolean(labeledRun) && validation?.validated === true,
    baselines: baselines(sample, team, largest, (r) => r, predictArea),
    agreement_with_labels: labelled,
    judge: judge ? { model: models.judge ?? null, router_model: models.router ?? null, same_model: Boolean(models.judge && models.judge === models.router), dropped: out.reduce((t, r) => { for (const [k, n] of Object.entries(r.judge_dropped ?? {})) t[k] = (t[k] ?? 0) + n; return t }, {}), validated_against_people: false } : null,
    holdout: held,
    ...leakedExamples(sample, load, buildUnits, buildRows)
  }
}

/** The same measure on the ORIGINAL text of the units that have a single request: the router reads what a person wrote and not the summary the extractor wrote of it. */
async function routeRaw (sample, unitTexts, { provider, system, schema, team, load, parallel }) {
  const single = [...new Map(sample.filter((r) => r.label && sample.filter((x) => x.unit === r.unit).length === 1 && unitTexts.has(r.unit)).map((r) => [r.unit, r])).values()]
  const out = []
  let next = 0
  const worker = async () => {
    while (next < single.length) {
      const row = single[next++]
      const u = unitTexts.get(row.unit)
      const route = (await provider.complete({ system, messages: [{ role: 'user', content: `Lo pide: ${u.author ?? row.who}\nPedido: ${u.text}` }], schema, effort: 'low' })).json
      const l = scoreRouting(route, labelRow(row), team)
      out.push({ weight: row.weight, area_agrees: l.area_agrees, person_agrees: l.person_agrees })
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, single.length)) }, worker))
  return { n: out.length, area: rateOf(out.filter((r) => r.area_agrees), out), person: rateOf(out.filter((r) => r.person_agrees), out) }
}

/**
 * The exact McNemar test (McNemar 1947, Psychometrika 12:153-157) of two ways of routing the same requests: `onlyA` requests that A gets right and B wrong, `onlyB` the
 * reverse. Under the hypothesis of no difference each discordant request is A's or B's with probability one half; the p-value is two-sided and exact.
 */
export function mcnemarExact (onlyA, onlyB) {
  const n = onlyA + onlyB
  if (n === 0) return 1
  const k = Math.min(onlyA, onlyB)
  let tail = 0
  let term = 0.5 ** n // P(X = 0)
  for (let i = 0; i <= k; i++) { tail += term; term = (term * (n - i)) / (i + 1) }
  return Math.min(1, 2 * tail)
}

/**
 * Compares two experiments on the units they both routed: the descriptions of A against the ones of B, or two routers. A difference between rates
 * is read with the paired test, not by eye (Miller 2024, arXiv:2411.00640, consulted 2026-10-27: the pairs share the question, so their differences have a smaller error
 * than two independent samples).
 */
export function compareRuns (a, b) {
  // The pairs are UNITS: a unit is right when all its requests are. The requests of one message are not independent, so they are not counted as separate pairs.
  const units = (run, field) => { const m = new Map(); for (const r of run.results.filter((x) => x.unit)) m.set(r.unit, (m.get(r.unit) ?? true) && r[field]); return m }
  const block = (field) => {
    const ua = units(a, field)
    const ub = units(b, field)
    const shared = [...ua.keys()].filter((u) => ub.has(u))
    const onlyA = shared.filter((u) => ua.get(u) && !ub.get(u)).length
    const onlyB = shared.filter((u) => !ua.get(u) && ub.get(u)).length
    return { only_first: onlyA, only_second: onlyB, p: Math.round(mcnemarExact(onlyA, onlyB) * 10000) / 10000, units: shared.length }
  }
  const area = block('area_agrees')
  const person = block('person_agrees')
  return { paired: area.units, area, person }
}

/**
 * A rate of weighted items with its Wilson interval. The observations are the UNITS, not the requests: the requests of a message share text and author and are not independent.
 * The effective size is that of Kish (1965, Survey Sampling), (sum of weights)^2 over the sum of squared weights, taken over the weight of each unit; it is the plain count
 * when every unit has one request of weight 1.
 */
const rateOf = (hits, items) => {
  const w = (x) => x.weight ?? 1
  const total = items.reduce((t, x) => t + w(x), 0)
  const ok = hits.reduce((t, x) => t + w(x), 0)
  const byUnit = new Map()
  items.forEach((x, i) => byUnit.set(x.unit ?? `#${i}`, (byUnit.get(x.unit ?? `#${i}`) ?? 0) + w(x)))
  const effective = total ? (total * total) / [...byUnit.values()].reduce((t, v) => t + v * v, 0) : 0
  const rate = total ? ok / total : 0
  const interval = wilson(rate * effective, effective)
  return { k: hits.length, n: items.length, units: byUnit.size, rate: round3(rate), lower: round3(interval.lower), upper: round3(interval.upper) }
}
const round3 = (x) => Math.round(x * 1000) / 1000

/**
 * What of the sample the descriptions may have seen. `leaked_examples` counts the sampled requests whose text is quoted in a description, whatever their unit: a request that
 * reads as one of the examples is not new to the router. `duplicate_of_build` counts those whose text is identical to some request of the construction side (the same sentence
 * in another message: the corpora of a team repeat themselves). `from_build_units` counts the ones whose unit is a construction unit, which the split makes 0.
 */
export function leakedExamples (sample, load, buildUnits = null, buildRows = null) {
  const quoted = (r) => load.areas.some((a) => a.description.includes(`«${r.summary}»`))
  const built = buildRows ? new Set(buildRows.map((r) => r.summary)) : null
  return { leaked_examples: sample.filter(quoted).length, duplicate_of_build: built ? sample.filter((r) => built.has(r.summary)).length : null, from_build_units: buildUnits ? sample.filter((r) => buildUnits.has(r.unit)).length : null }
}

/**
 * The counts of an experiment. The two rates are called what they measure: the agreement of the router with the rows that the extraction wrote, not its accuracy.
 * Each carries its Wilson interval and is weighted so that it describes the corpus. `by_area` gives the same per area, which is where a small area shows what a
 * global rate hides. `merge_suggestions` lists the pairs where the router confuses an area with another in more requests than it gets right.
 */
export function summarize (results) {
  const n = results.length
  const confusions = {}
  for (const r of results) if (!r.area_agrees) { const k = `${r.reference_area} -> ${r.area}`; confusions[k] = (confusions[k] ?? 0) + 1 }
  // An indicator is the mean of the jobs that scored it. One the judge could not observe, or whose quote is not in the evidence, is not scored and is not filled with 0.
  const judged = results.filter((r) => r.indicators)
  const indicators = judged.length ? Object.fromEntries(ROUTING_KPIS.map((id) => {
    const scored = judged.filter((r) => typeof r.indicators[id] === 'number')
    return [id, { mean: scored.length ? Math.round((scored.reduce((a, r) => a + r.indicators[id], 0) / scored.length) * 100) / 100 : null, n: scored.length }]
  })) : null
  const areas = [...new Set(results.map((r) => r.reference_area))].sort()
  const byArea = Object.fromEntries(areas.map((area) => {
    const mine = results.filter((r) => r.reference_area === area)
    return [area, rateOf(mine.filter((r) => r.area_agrees), mine)]
  }))
  const suggestions = Object.entries(confusions)
    .map(([k, count]) => { const [from, into] = k.split(' -> '); return { from, into, confused: count, right: byArea[from]?.k ?? 0 } })
    .filter((s) => s.confused > s.right)
  return {
    n,
    agreement_with_rows: {
      area: rateOf(results.filter((r) => r.area_agrees), results), person: rateOf(results.filter((r) => r.person_agrees), results),
      person_missing: results.filter((r) => r.person_missing).length, person_extra: results.filter((r) => r.person_extra).length,
      person_precision: rateOf(results.filter((r) => r.person_right), results.filter((r) => r.person_included)),
      person_recall: rateOf(results.filter((r) => r.person_right), results.filter((r) => r.person_needed))
    },
    by_area: byArea, merge_suggestions: suggestions,
    confusions: Object.fromEntries(Object.entries(confusions).sort((a, b) => b[1] - a[1])), indicators, results
  }
}

/**
 * The experiment measures the PROCEDURE, not the configuration that is loaded: the families of objects are drawn from the labels of the whole corpus, and the file that is loaded was
 * built with all the rows while the experiment builds with the construction side. This lists what differs between the areas that were measured and the ones in the loaded file.
 */
export function configDifferences (measured, loaded) {
  const a = new Map(measured.areas.map((x) => [x.title, x]))
  const b = new Map(loaded.areas.map((x) => [x.title, x]))
  return {
    only_in_measured: [...a.keys()].filter((t) => !b.has(t)).sort(),
    only_in_loaded: [...b.keys()].filter((t) => !a.has(t)).sort(),
    description_differs: [...a.keys()].filter((t) => b.has(t) && a.get(t).description !== b.get(t).description).sort()
  }
}

/**
 * The confirmation set is read once. The first reading writes its date in the state file; a second one is refused unless the person asks for it (`again`), and then the result
 * says it is a repeated reading: a confirmation that is read until it looks good is not one. Any other stage is free.
 */
export function confirmGate (statePath, { stage, again = false, now = () => new Date().toISOString() } = {}) {
  if (stage !== 'confirm') return { allowed: true, repeated: false }
  let state = null
  try { state = JSON.parse(readFileSync(statePath, 'utf8')) } catch { /* never read */ }
  if (state && !again) return { allowed: false, repeated: true, first_read_at: state.first_read_at, message: `El conjunto de confirmación ya se leyó el ${state.first_read_at} (${state.reads} vez/veces). Una lectura más pide --again y queda marcada.` }
  const next = { first_read_at: state?.first_read_at ?? now(), reads: (state?.reads ?? 0) + 1, last_read_at: now() }
  writeFileSync(statePath, `${JSON.stringify(next)}\n`)
  return { allowed: true, repeated: Boolean(state), first_read_at: next.first_read_at, reads: next.reads }
}

/**
 * Whether the result meets `--accept`. The threshold is read against the LOWER bound of the Wilson interval, and no lower than the best router with no model (always the largest
 * area; always the agent alone or always the one who asks): a rate that does not beat them proves nothing, and a point value that only touches the threshold passes half of the time
 * when the truth is the threshold. Without the labels of people the only reference is the extraction itself: code 2, unless `allowUnvalidated`, which compares against the rows and
 * says the result is not valid.
 */
export function acceptDecision (result, accept, { allowUnvalidated = false } = {}) {
  const labelled = result.agreement_with_labels
  if (!labelled && !allowUnvalidated) return { code: 2, valid: false, message: '--accept necesita --labels: sin etiquetas de personas sólo hay acuerdo con la extracción. Con --allow-unvalidated se compara contra las filas y el resultado queda marcado como no válido.' }
  const ref = labelled ?? { area: result.agreement_with_rows.area, person: result.agreement_with_rows.person, baselines: result.baselines }
  const floorArea = Math.max(accept, ref.baselines.area_majority.rate, ref.baselines.area_nb?.rate ?? 0)
  const floorPerson = Math.max(accept, ref.baselines.person_agent_alone.rate, ref.baselines.person_asker.rate, ref.baselines.person_all?.rate ?? 0)
  const passes = ref.area.lower >= floorArea && ref.person.lower >= floorPerson
  const valid = Boolean(labelled) && result.valid_for_acceptance !== false
  return { code: passes ? 0 : 1, valid, message: `--accept: límite inferior de área ${ref.area.lower.toFixed(2)} (piso ${floorArea.toFixed(2)}) y de persona ${ref.person.lower.toFixed(2)} (piso ${floorPerson.toFixed(2)})${labelled ? '' : ' contra las filas: resultado no válido'}${labelled && result.valid_for_acceptance === false ? '; las filas no están validadas' : ''}` }
}

async function main (argv) {
  const [rowsFile, ...rest] = argv
  const option = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback }
  const usage = 'Uso: node scripts/route-experiment.mjs rows.jsonl (--load load.json | --holdout [0.5] --purposes p.json [--stage tune|confirm]) --team team.json [--families f.json] [--sample n] [--judge] [--judge-model m] [--versus other-result.json] [--labels labels.jsonl --reference-rater name [--units units.jsonl --raw]] [--validation validation.json] [--again] [--compare-load load.json] [--accept 0.8 [--allow-unvalidated]] [--model claude-haiku-5-5] [--parallel 6] [--out result.json]'
  const holdout = rest.includes('--holdout')
  if (!rowsFile || !option('--team') || (holdout ? !option('--purposes') || option('--load') : !option('--load'))) { console.error(usage); process.exit(2) }
  const { createClaudeCliProviders } = await import('../bench/claude-cli-provider.mjs')
  const provider = createClaudeCliProviders({ model: option('--model', 'claude-haiku-5-5') }).text
  const rows = keyRows(readJsonl(rowsFile))
  const team = readJson(option('--team'))
  const families = option('--families') ? readJson(option('--families')) : {}
  const referenceInfo = option('--labels') ? referenceLabels(readJsonl(option('--labels')), { referenceRater: option('--reference-rater') ?? null }) : null
  let load
  let merge = {}
  let pool = rows
  let held = null
  let buildUnits = null
  let buildRows = null
  let confirm = null
  if (holdout) {
    confirm = confirmGate(`${rowsFile}.confirm.json`, { stage: option('--stage', 'tune'), again: rest.includes('--again') })
    if (!confirm.allowed) { console.error(confirm.message); process.exit(2) }
    const fraction = option('--holdout') && !option('--holdout').startsWith('--') ? Number(option('--holdout')) : undefined
    const built = buildAndSplit(rows, team, { stage: option('--stage', 'tune'), holdout: fraction, families, purposes: readJson(option('--purposes')) })
    load = built.load
    merge = Object.fromEntries(built.skipped.filter((x) => x.merge_into).map((x) => [x.title, x.merge_into]))
    pool = built.test
    held = { stage: built.stage, sets: built.sets }
    buildUnits = built.buildUnits
    buildRows = built.buildRows
  } else {
    load = readJson(option('--load'))
    // The areas the analysis would merge into another are measured against the one they merge into.
    merge = Object.fromEntries(analyze(rows, team, { families }).areas.filter((x) => !x.keep && x.merge_into).map((x) => [x.title, x.merge_into]))
    console.error('Sin --holdout, las descripciones se miden con las mismas filas con que se escribieron: el resultado no vale como medida.')
  }
  const result = await runExperiment(pool, load, team, {
    provider, families, size: option('--sample') ? Number(option('--sample')) : null, merge, judge: rest.includes('--judge'), parallel: Number(option('--parallel', 6)), held, buildUnits, buildRows,
    reference: referenceInfo?.reference ?? null, referenceRater: referenceInfo?.main ?? null,
    unitTexts: rest.includes('--raw') && option('--units') ? new Map(readJsonl(option('--units')).map((u) => [u.id, { text: u.text, author: u.author }])) : null,
    validation: option('--validation') ? readJson(option('--validation')) : null,
    models: { router: option('--model', 'claude-haiku-5-5'), judge: option('--judge-model', option('--model', 'claude-haiku-5-5')) }
  })
  if (confirm) result.confirm_read = { repeated: confirm.repeated, first_read_at: confirm.first_read_at ?? null, reads: confirm.reads ?? null }
  if (holdout && option('--compare-load')) result.config_differences = configDifferences(load, readJson(option('--compare-load')))
  if (option('--versus')) result.comparison = compareRuns(result, readJson(option('--versus')))
  const text = `${JSON.stringify(result, null, 2)}\n`
  if (option('--out')) writeFileSync(option('--out'), text); else process.stdout.write(text)
  const a = result.agreement_with_rows
  if (result.judge?.same_model) console.error('El juez es el mismo modelo que enruta: los indicadores se leen con esa reserva (--judge-model).')
  console.error(`acuerdo con las filas: área ${a.area.k}/${result.n}, persona ${a.person.k}/${result.n} (de más ${a.person_extra}, de menos ${a.person_missing}); sin modelo: área ${result.baselines.area_majority.rate.toFixed(2)}, persona ${result.baselines.person_agent_alone.rate.toFixed(2)}`)
  if (!result.validated) console.error('Las filas no están validadas por personas (row-validation.mjs): el número es el acuerdo con la extracción, no el acierto.')
  if (option('--accept') !== undefined) {
    const decision = acceptDecision(result, Number(option('--accept')), { allowUnvalidated: rest.includes('--allow-unvalidated') })
    console.error(decision.message)
    if (decision.code) process.exit(decision.code)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
