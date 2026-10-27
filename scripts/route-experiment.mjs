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

import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { DEFAULTS, analyze, propose, readJson, readJsonl, requiresPerson, seededRandom, shuffle, splitUnits, validateTeam, wilson, wilsonSampleSize, withAreas } from './area-method.mjs'
import { keyRows } from './row-validation.mjs'
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
    items: { type: 'object', additionalProperties: false, required: ['id', 'score', 'reason'], properties: { id: { type: 'string', enum: [...ROUTING_KPIS] }, score: { type: 'integer', enum: [-2, -1, 0, 1, 2] }, reason: { type: 'string' } } }
  }
  return { type: 'object', additionalProperties: false, required: ['indicators'], properties: { indicators: item } }
}

const judgeSystem = `Juzgas el reparto de un pedido de un equipo: un enrutador eligió el área, quién lo atiende y escribió el encargo. Puntúa cada indicador de -2 a +2 (+2 excepcional, +1 fuerte, 0 esperado: el mínimo aceptable, -1 bajo, -2 inaceptable), con una oración de razón, contra la referencia que se da.\n${KPIS.filter((k) => ROUTING_KPIS.includes(k.id)).map((k) => `${k.id} ${k.name}: ${k.asks}`).join('\n')}`

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
    person_extra: !needs && included.length > 0
  }
}

/**
 * The agreement that routers with no model would get on the same requests: always the area that is the largest in the construction rows, always the agent alone
 * (no person), and always the person who asks (the agent when the one who asks is not a person). A measure of the routing means nothing without them
 * (docs/METODO-DE-REPARTO.md, section «Medir el reparto»).
 */
export function baselines (sample, team, majorityArea) {
  const agent = team.members.find((m) => m.kind === 'agent')?.name ?? team.members[0].name
  const people = new Set(team.members.filter((m) => (m.kind ?? 'person') === 'person').map((m) => m.name))
  const total = sample.reduce((t, r) => t + (r.weight ?? 1), 0)
  const rate = (route) => total ? sample.filter((r) => scoreRouting(route(r), r, team)[route.field]).reduce((t, r) => t + (r.weight ?? 1), 0) / total : 0
  const area = (r) => ({ area: majorityArea, attends: [agent] })
  area.field = 'area_agrees'
  const alone = (r) => ({ area: r.area, attends: [agent] })
  alone.field = 'person_agrees'
  const asker = (r) => ({ area: r.area, attends: [people.has(r.who) ? r.who : agent] })
  asker.field = 'person_agrees'
  return { area_majority: { area: majorityArea, rate: rate(area) }, person_agent_alone: { rate: rate(alone) }, person_asker: { rate: rate(asker) } }
}

/**
 * Builds the descriptions and the profiles with the construction side of the rows and returns the held-out set to measure them on. `stage` is `tune` while the
 * descriptions are being corrected and `confirm` for the one reading that is reported; a unit is never on both sides.
 */
export function buildAndSplit (rows, team, { stage = 'tune', holdout, seed = 7, ...proposal } = {}) {
  if (!['tune', 'confirm'].includes(stage)) throw new Error('stage must be tune or confirm')
  const sets = splitUnits(rows, { holdout, seed })
  const { spec, skipped, report } = propose(sets.build, team, proposal)
  return { load: spec, skipped, report, test: sets[stage], buildUnits: new Set(sets.build.map((r) => r.unit)), buildRows: sets.build, sets: { build: sets.build.length, tune: sets.tune.length, confirm: sets.confirm.length }, stage }
}

/** Runs the sample through the router (and the judge when asked). `provider.complete({ system, messages, schema, effort })`. */
export async function runExperiment (rows, load, team, { provider, families = {}, size = null, perArea, merge = {}, judge = false, parallel = 6, seed = 7, held = null, buildUnits = null, buildRows = null, labels = [], validation = null, models = {} } = {}) {
  validateTeam(team)
  const drawn = drawSample(withAreas(rows, families), load, { size, merge, seed, ...(perArea ? { perArea } : {}) })
  const sample = drawn.sample
  const system = routerPrompt(load, team)
  const schema = routerSchema(load, team)
  const out = []
  let next = 0
  const worker = async () => {
    while (next < sample.length) {
      const row = sample[next++]
      const route = (await provider.complete({ system, messages: [{ role: 'user', content: `Lo pide: ${row.who}\nPedido: ${row.summary}` }], schema, effort: 'low' })).json
      const result = { key: row.key, unit: row.unit, weight: row.weight, reference_area: row.area, area: route.area, attends: route.attends, brief: route.brief, ...scoreRouting(route, row, team) }
      if (judge) {
        const j = (await provider.complete({ system: judgeSystem, messages: [{ role: 'user', content: `${referenceText(row, team)}\nReparto: área ${route.area}; atiende ${route.attends.join(', ')}; encargo: ${route.brief}` }], schema: judgeSchema(), effort: 'low' })).json
        result.indicators = Object.fromEntries((j?.indicators ?? []).map((k) => [k.id, k.score]))
      }
      out.push(result)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, sample.length)) }, worker))
  const reference = withAreas(buildRows ?? rows, families)
  const largest = [...reference.reduce((m, r) => m.set(r.area, (m.get(r.area) ?? 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const labelled = humanReference(out, sample, labels, team)
  return {
    ...summarize(out),
    sample: { requested: size, drawn: sample.length, discarded: drawn.discarded, confidential_left_out: drawn.confidential, merged: drawn.merged, warnings: drawn.warnings },
    validated: validation?.validated === true,
    baselines: baselines(sample, team, largest),
    agreement_with_labels: labelled,
    judge: judge ? { model: models.judge ?? null, router_model: models.router ?? null, same_model: Boolean(models.judge && models.judge === models.router) } : null,
    holdout: held,
    leaked_examples: leakedExamples(sample, load, buildUnits)
  }
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
 * Compares two experiments on the requests they both routed (paired by `key`): the descriptions of A against the ones of B, or two routers. A difference between rates
 * is read with the paired test, not by eye (Miller 2024, arXiv:2411.00640, consulted 2026-10-27: the pairs share the question, so their differences have a smaller error
 * than two independent samples).
 */
export function compareRuns (a, b) {
  const byKey = new Map(b.results.filter((r) => r.key).map((r) => [r.key, r]))
  const pairs = a.results.filter((r) => r.key && byKey.has(r.key)).map((r) => [r, byKey.get(r.key)])
  const block = (field) => {
    const onlyA = pairs.filter(([x, y]) => x[field] && !y[field]).length
    const onlyB = pairs.filter(([x, y]) => !x[field] && y[field]).length
    return { only_first: onlyA, only_second: onlyB, p: Math.round(mcnemarExact(onlyA, onlyB) * 10000) / 10000 }
  }
  return { paired: pairs.length, area: block('area_agrees'), person: block('person_agrees') }
}

/**
 * The agreement with the labels of people, for the sampled requests that a person labeled (the first rater by name). The reference row is rebuilt from the label:
 * area, who holds the value, the limits it touches. It is the only measure of the routing that is not the extraction judged by itself.
 */
export function humanReference (results, sample, labels, team) {
  if (!labels.length) return null
  const rater = [...new Set(labels.map((l) => l.rater))].sort()[0]
  const byKey = new Map(labels.filter((l) => l.rater === rater).map((l) => [l.key, l]))
  const scored = results.filter((r) => byKey.has(r.key)).map((r) => {
    const l = byKey.get(r.key)
    const row = sample.find((x) => x.key === r.key)
    return { ...scoreRouting(r, { ...row, area: l.area, value_holder: l.value_holder, holder: l.holder ?? '', limits: l.limits ?? [] }, team), weight: r.weight }
  })
  return { rater, n: scored.length, area: rateOf(scored.filter((x) => x.area_agrees), scored), person: rateOf(scored.filter((x) => x.person_agrees), scored) }
}

/**
 * A rate of weighted items with its Wilson interval. With weights the interval uses the effective size of Kish (1965, Survey Sampling): (sum of weights)^2 over the sum of
 * squared weights, which is the plain count when every weight is 1.
 */
const rateOf = (hits, items) => {
  const w = (x) => x.weight ?? 1
  const total = items.reduce((t, x) => t + w(x), 0)
  const ok = hits.reduce((t, x) => t + w(x), 0)
  const effective = total ? (total * total) / items.reduce((t, x) => t + w(x) ** 2, 0) : 0
  const rate = total ? ok / total : 0
  const interval = wilson(rate * effective, effective)
  return { k: hits.length, n: items.length, rate: round3(rate), lower: round3(interval.lower), upper: round3(interval.upper) }
}
const round3 = (x) => Math.round(x * 1000) / 1000

/**
 * How many sampled requests may be one of the examples quoted in a description: a request that is measured must not be one of them. With `buildUnits` (the units the
 * descriptions were built from) a request counts only if its unit is one of them; without it every summary that is quoted counts, because the examples do not say which row they come from.
 */
export function leakedExamples (sample, load, buildUnits = null) {
  return sample.filter((r) => (!buildUnits || buildUnits.has(r.unit)) && load.areas.some((a) => a.description.includes(`«${r.summary}»`))).length
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
  const judged = results.filter((r) => r.indicators)
  const indicators = judged.length ? Object.fromEntries(ROUTING_KPIS.map((id) => [id, Math.round((judged.reduce((a, r) => a + (r.indicators[id] ?? 0), 0) / judged.length) * 100) / 100])) : null
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
      person_missing: results.filter((r) => r.person_missing).length, person_extra: results.filter((r) => r.person_extra).length
    },
    by_area: byArea, merge_suggestions: suggestions,
    confusions: Object.fromEntries(Object.entries(confusions).sort((a, b) => b[1] - a[1])), indicators, results
  }
}

async function main (argv) {
  const [rowsFile, ...rest] = argv
  const option = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback }
  const usage = 'Uso: node scripts/route-experiment.mjs rows.jsonl (--load load.json | --holdout [0.5] --purposes p.json [--stage tune|confirm]) --team team.json [--families f.json] [--sample n] [--judge] [--judge-model m] [--versus other-result.json] [--labels labels.jsonl] [--validation validation.json] [--accept 0.8] [--model claude-haiku-5-5] [--parallel 6] [--out result.json]'
  const holdout = rest.includes('--holdout')
  if (!rowsFile || !option('--team') || (holdout ? !option('--purposes') || option('--load') : !option('--load'))) { console.error(usage); process.exit(2) }
  const { createClaudeCliProviders } = await import('../bench/claude-cli-provider.mjs')
  const provider = createClaudeCliProviders({ model: option('--model', 'claude-haiku-5-5') }).text
  const rows = keyRows(readJsonl(rowsFile))
  const team = readJson(option('--team'))
  const families = option('--families') ? readJson(option('--families')) : {}
  let load
  let merge = {}
  let pool = rows
  let held = null
  let buildUnits = null
  let buildRows = null
  if (holdout) {
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
    labels: option('--labels') ? readJsonl(option('--labels')) : [], validation: option('--validation') ? readJson(option('--validation')) : null,
    models: { router: option('--model', 'claude-haiku-5-5'), judge: option('--judge-model', option('--model', 'claude-haiku-5-5')) }
  })
  if (option('--versus')) result.comparison = compareRuns(result, readJson(option('--versus')))
  const text = `${JSON.stringify(result, null, 2)}\n`
  if (option('--out')) writeFileSync(option('--out'), text); else process.stdout.write(text)
  const a = result.agreement_with_rows
  console.error(`acuerdo con las filas: área ${a.area.k}/${result.n}, persona ${a.person.k}/${result.n} (de más ${a.person_extra}, de menos ${a.person_missing}); sin modelo: área ${result.baselines.area_majority.rate.toFixed(2)}, persona ${result.baselines.person_agent_alone.rate.toFixed(2)}`)
  if (!result.validated) console.error('Las filas no están validadas por personas (row-validation.mjs): el número es el acuerdo con la extracción, no el acierto.')
  const accept = option('--accept')
  const reference = result.agreement_with_labels ?? a
  if (accept !== undefined && (reference.area.rate < Number(accept) || reference.person.rate < Number(accept))) process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
