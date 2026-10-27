#!/usr/bin/env node
// Measures how well a model routes requests when it reads only the descriptions of the areas and the profiles of the members.
//
//   node scripts/route-experiment.mjs rows.jsonl --load load.json --team team.json [--families f.json] [--sample 60] [--judge]
//                                     [--accept 0.8] [--model claude-haiku-5-5] [--parallel 6] [--out result.json]
//
// For each sampled row the router answers an area, who attends and a one-line brief. The result is scored against the row without a judge:
// the area is the reference one, and a person is included exactly when the row needs one (`requiresPerson`). With `--judge` a second call
// scores the routing with four indicators of the job evaluation (`src/execute/judge.js`: 1.1, 1.2, 2.3 and 3.3), from -2 to +2, against the
// reference of the row. `--accept` makes the command fail when the area match or the person match is
// below it; without it the numbers are reported and nothing passes or fails: the threshold is the team's.
//
// A description set that routes badly is corrected only where the experiment shows a confusion of two cases or more, and the same sample is run
// again (docs/METODO-DE-REPARTO.md, section «Medir el reparto»).

import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { DEFAULTS, propose, readJson, readJsonl, requiresPerson, seededRandom, splitUnits, validateTeam, wilson, withAreas } from './area-method.mjs'
import { keyRows } from './row-validation.mjs'
import { KPIS } from '../src/execute/judge.js'

// Default sample: 60 routed requests. A proportion measured on 60 has a margin of about 0.13 at 95 %, enough to tell 0.5 from 0.8 and not enough to tell 0.8 from 0.85.
export const SAMPLE = 60
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

/** A deterministic sample of `size` rows, spread by area as they are in the corpus. */
export function sampleRows (rows, size = SAMPLE, seed = 7) {
  const rand = seededRandom(seed)
  return [...rows].sort(() => rand() - 0.5).slice(0, size)
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
  const rate = (route) => sample.length ? sample.filter((r) => scoreRouting(route(r), r, team)[route.field]).length / sample.length : 0
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
export async function runExperiment (rows, load, team, { provider, families = {}, size = SAMPLE, judge = false, parallel = 6, seed = 7, held = null, buildUnits = null, buildRows = null, labels = [], validation = null, models = {} } = {}) {
  validateTeam(team)
  const sample = sampleRows(withAreas(rows, families), size, seed).filter((r) => load.areas.some((a) => a.title === r.area))
  const system = routerPrompt(load, team)
  const schema = routerSchema(load, team)
  const out = []
  let next = 0
  const worker = async () => {
    while (next < sample.length) {
      const row = sample[next++]
      const route = (await provider.complete({ system, messages: [{ role: 'user', content: `Lo pide: ${row.who}\nPedido: ${row.summary}` }], schema, effort: 'low' })).json
      const result = { key: row.key, unit: row.unit, reference_area: row.area, area: route.area, attends: route.attends, brief: route.brief, ...scoreRouting(route, row, team) }
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
    validated: validation?.validated === true,
    baselines: baselines(sample, team, largest),
    agreement_with_labels: labelled,
    judge: judge ? { model: models.judge ?? null, router_model: models.router ?? null, same_model: Boolean(models.judge && models.judge === models.router) } : null,
    holdout: held,
    leaked_examples: leakedExamples(sample, load, buildUnits)
  }
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
    return scoreRouting(r, { ...row, area: l.area, value_holder: l.value_holder, holder: l.holder ?? '', limits: l.limits ?? [] }, team)
  })
  return { rater, n: scored.length, area: rateOf(scored.filter((x) => x.area_agrees).length, scored.length), person: rateOf(scored.filter((x) => x.person_agrees).length, scored.length) }
}

const rateOf = (k, n) => { const w = wilson(k, n); return { k, n, rate: n ? round3(k / n) : 0, lower: round3(w.lower), upper: round3(w.upper) } }
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
 * Each carries its Wilson interval. The confusions, the people missing and the people in excess are counted apart, and the indicators are the mean of each one.
 */
export function summarize (results) {
  const n = results.length
  const count = (f) => results.filter(f).length
  const confusions = {}
  for (const r of results) if (!r.area_agrees) { const k = `${r.reference_area} -> ${r.area}`; confusions[k] = (confusions[k] ?? 0) + 1 }
  const judged = results.filter((r) => r.indicators)
  const indicators = judged.length ? Object.fromEntries(ROUTING_KPIS.map((id) => [id, Math.round((judged.reduce((a, r) => a + (r.indicators[id] ?? 0), 0) / judged.length) * 100) / 100])) : null
  return {
    n,
    agreement_with_rows: { area: rateOf(count((r) => r.area_agrees), n), person: rateOf(count((r) => r.person_agrees), n), person_missing: count((r) => r.person_missing), person_extra: count((r) => r.person_extra) },
    confusions: Object.fromEntries(Object.entries(confusions).sort((a, b) => b[1] - a[1])), indicators, results
  }
}

async function main (argv) {
  const [rowsFile, ...rest] = argv
  const option = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback }
  const usage = 'Uso: node scripts/route-experiment.mjs rows.jsonl (--load load.json | --holdout [0.5] --purposes p.json [--stage tune|confirm]) --team team.json [--families f.json] [--sample 60] [--judge] [--judge-model m] [--labels labels.jsonl] [--validation validation.json] [--accept 0.8] [--model claude-haiku-5-5] [--parallel 6] [--out result.json]'
  const holdout = rest.includes('--holdout')
  if (!rowsFile || !option('--team') || (holdout ? !option('--purposes') || option('--load') : !option('--load'))) { console.error(usage); process.exit(2) }
  const { createClaudeCliProviders } = await import('../bench/claude-cli-provider.mjs')
  const provider = createClaudeCliProviders({ model: option('--model', 'claude-haiku-5-5') }).text
  const rows = keyRows(readJsonl(rowsFile))
  const team = readJson(option('--team'))
  const families = option('--families') ? readJson(option('--families')) : {}
  let load
  let pool = rows
  let held = null
  let buildUnits = null
  let buildRows = null
  if (holdout) {
    const fraction = option('--holdout') && !option('--holdout').startsWith('--') ? Number(option('--holdout')) : undefined
    const built = buildAndSplit(rows, team, { stage: option('--stage', 'tune'), holdout: fraction, families, purposes: readJson(option('--purposes')) })
    load = built.load
    pool = built.test
    held = { stage: built.stage, sets: built.sets }
    buildUnits = built.buildUnits
    buildRows = built.buildRows
  } else {
    load = readJson(option('--load'))
    console.error('Sin --holdout, las descripciones se miden con las mismas filas con que se escribieron: el resultado no vale como medida.')
  }
  const result = await runExperiment(pool, load, team, {
    provider, families, size: Number(option('--sample', SAMPLE)), judge: rest.includes('--judge'), parallel: Number(option('--parallel', 6)), held, buildUnits, buildRows,
    labels: option('--labels') ? readJsonl(option('--labels')) : [], validation: option('--validation') ? readJson(option('--validation')) : null,
    models: { router: option('--model', 'claude-haiku-5-5'), judge: option('--judge-model', option('--model', 'claude-haiku-5-5')) }
  })
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
