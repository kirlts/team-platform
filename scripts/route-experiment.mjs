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
import { readJson, readJsonl, requiresPerson, seededRandom, validateTeam, withAreas } from './area-method.mjs'
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

/** Scores one routing against its row without a judge. `people` are the names of the members of kind person. */
export function scoreRouting (route, row, team) {
  const people = new Set(team.members.filter((m) => (m.kind ?? 'person') === 'person').map((m) => m.name))
  const needs = requiresPerson(row, team)
  const included = route.attends.filter((n) => people.has(n))
  const holder = row.value_holder === 'person' ? row.holder : ''
  return {
    area_match: route.area === row.area,
    person_match: needs ? (people.has(holder) ? included.includes(holder) : included.length > 0) : included.length === 0,
    person_missing: needs && included.length === 0,
    person_extra: !needs && included.length > 0
  }
}

/** Runs the sample through the router (and the judge when asked). `provider.complete({ system, messages, schema, effort })`. */
export async function runExperiment (rows, load, team, { provider, families = {}, size = SAMPLE, judge = false, parallel = 6, seed = 7 } = {}) {
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
      const result = { unit: row.unit, reference_area: row.area, area: route.area, attends: route.attends, brief: route.brief, ...scoreRouting(route, row, team) }
      if (judge) {
        const j = (await provider.complete({ system: judgeSystem, messages: [{ role: 'user', content: `${referenceText(row, team)}\nReparto: área ${route.area}; atiende ${route.attends.join(', ')}; encargo: ${route.brief}` }], schema: judgeSchema(), effort: 'low' })).json
        result.indicators = Object.fromEntries((j?.indicators ?? []).map((k) => [k.id, k.score]))
      }
      out.push(result)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, sample.length)) }, worker))
  return summarize(out)
}

/** The counts of an experiment: area match, person match, missing and extra people, the confusions and the indicator means. */
export function summarize (results) {
  const n = results.length
  const count = (f) => results.filter(f).length
  const confusions = {}
  for (const r of results) if (!r.area_match) { const k = `${r.reference_area} -> ${r.area}`; confusions[k] = (confusions[k] ?? 0) + 1 }
  const judged = results.filter((r) => r.indicators)
  const indicators = judged.length ? Object.fromEntries(ROUTING_KPIS.map((id) => [id, Math.round((judged.reduce((a, r) => a + (r.indicators[id] ?? 0), 0) / judged.length) * 100) / 100])) : null
  return {
    n, area_match: count((r) => r.area_match), person_match: count((r) => r.person_match), person_missing: count((r) => r.person_missing), person_extra: count((r) => r.person_extra),
    area_rate: n ? count((r) => r.area_match) / n : 0, person_rate: n ? count((r) => r.person_match) / n : 0,
    confusions: Object.fromEntries(Object.entries(confusions).sort((a, b) => b[1] - a[1])), indicators, results
  }
}

async function main (argv) {
  const [rowsFile, ...rest] = argv
  const option = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback }
  if (!rowsFile || !option('--load') || !option('--team')) {
    console.error('Uso: node scripts/route-experiment.mjs rows.jsonl --load load.json --team team.json [--families f.json] [--sample 60] [--judge] [--accept 0.8] [--model claude-haiku-5-5] [--parallel 6] [--out result.json]')
    process.exit(2)
  }
  const { createClaudeCliProviders } = await import('../bench/claude-cli-provider.mjs')
  const provider = createClaudeCliProviders({ model: option('--model', 'claude-haiku-5-5') }).text
  const result = await runExperiment(readJsonl(rowsFile), readJson(option('--load')), readJson(option('--team')), {
    provider, families: option('--families') ? readJson(option('--families')) : {}, size: Number(option('--sample', SAMPLE)), judge: rest.includes('--judge'), parallel: Number(option('--parallel', 6))
  })
  const text = `${JSON.stringify(result, null, 2)}\n`
  if (option('--out')) writeFileSync(option('--out'), text); else process.stdout.write(text)
  console.error(`área ${result.area_match}/${result.n}, persona ${result.person_match}/${result.n} (de más ${result.person_extra}, de menos ${result.person_missing})`)
  const accept = option('--accept')
  if (accept !== undefined && (result.area_rate < Number(accept) || result.person_rate < Number(accept))) process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
