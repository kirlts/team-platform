#!/usr/bin/env node
// Turns the written and spoken material of a team into one row per request, with the dimensions the routing method measures.
//
//   node scripts/request-rows.mjs units.jsonl --team team.json --out rows.jsonl [--model claude-haiku-5-5] [--parallel 6] [--cache DIR]
//
// `units.jsonl`: one text per line, `{ id, source, date, author, confidential, text }` (`confidential: true` for a recorded meeting: only abstract
// summaries come out of it). The model is reached through `claude -p` with the subscription of the account that runs the script, as the benchmark
// does (`bench/claude-cli-provider.mjs`), or through any provider with the shape of `src/analyze` (`providers.text.complete`).
// Each batch is cached in a file, so a cut does not repeat what is done. The text of the units stays where the units file is: the rows hold
// summaries only, and the script never writes a unit's text anywhere. `docs/METODO-DE-REPARTO.md` describes the fields.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readJson, readJsonl, validateTeam } from './area-method.mjs'

// A batch is about 18,000 characters: a text provider reads that in one call and the instructions stay a small part of what it reads.
export const BATCH_CHARS = 18000
// A unit longer than this is cut in pieces of this size, so one very long document does not fill a batch alone.
export const UNIT_CHARS = 9000

const scale = { type: 'number', minimum: 0, maximum: 1 }

/** The instructions of the extractor. The team supplies the names of its members and its limits; the rest is the same for every team. */
export function systemPrompt (team) {
  const names = team.members.map((m) => `${m.name}${m.role ? ` (${m.role.trim()})` : ''}`).join('; ')
  const limits = (team.limits ?? []).map((l) => `${l.id}: ${l.text}${l.person ? ' (la levanta una persona)' : ''}`).join('; ') || 'ninguno declarado'
  return `Extraes pedidos de textos de un equipo. Miembros: ${names}. Límites del equipo, restricciones de pasa o no pasa: ${limits}.

Un pedido es algo que alguien quiere que otro haga, cambie, decida, explique o deje de hacer. Una queja implica un pedido: escríbelo como lo que se quiere. Una corrección a cómo trabajó quien recibió un pedido también cuenta y lleva correction verdadero. No cuentes lo que alguien propone o informa por su cuenta. Un texto con varios pedidos da varias filas; uno sin pedidos da una lista vacía.

Por cada pedido devuelve:
- unit: el id entre corchetes del texto de donde sale.
- date: AAAA-MM-DD si el texto la dice; si no, la fecha de la unidad.
- who: el miembro que pide, o "other".
- to: el miembro a quien va, o "other".
- summary: una línea de 8 a 20 palabras que diga qué se pide y sobre qué. Sin nombres de terceros, sin números de identidad, teléfonos ni correos, sin citas textuales.
- intent: una a tres palabras con lo que se quiere lograr (por ejemplo: falla, ajuste, capacidad nueva, pregunta, decisión, regla de trabajo, operación). Reutiliza la misma palabra para lo mismo.
- object: una a tres palabras con la parte del sistema o del negocio sobre la que trata. Reutiliza la misma palabra para lo mismo.
- module: la parte concreta, una a tres palabras.
- understand_vs_create: de 0 a 1; 0 es comprender o aplicar lo conocido y 1 es crear algo que no existe. Usa decimales.
- severity: de 0 a 1; qué colapsa si se hace mal (0 es cosmético, 1 es dinero, personas afectadas o la continuidad del negocio).
- irreversibility: de 0 a 1; 0 se deshace en un minuto y 1 no se deshace.
- missing_value: de 0 a 1; cuánto del valor que hace falta para resolver lo tiene sólo una persona (preferencia, prioridad, dinero, juicio propio de su oficio).
- value_holder: el miembro que tiene ese valor, "model" si el modelo puede deducirlo o averiguarlo, o "nobody" si nada falta.
- limits: los ids de los límites del equipo que el pedido toca (lista vacía si ninguno).
- maximize: de 2 a 8 palabras con la cualidad que quien pide quiere maximizar; vacío si el texto no lo deja ver.
- sacrifice: de 2 a 8 palabras con lo que puede quedar apenas suficiente; vacío si el texto no lo deja ver.
- urgency: de 0 a 1; 0 no dicha y 1 ahora.
- correction: verdadero si corrige algo que ya se hizo mal.

Las escalas no son cajones: elige el punto que mejor describe el pedido. Si la unidad es confidencial (una reunión grabada), resume en abstracto, sin hechos concretos más allá de qué se pidió.`
}

/** The JSON schema the extractor must answer: members, limits and the scales are checked by the grammar. */
export function rowsSchema (team) {
  const members = [...team.members.map((m) => m.name), 'other']
  const text = { type: 'string' }
  return {
    type: 'object', additionalProperties: false, required: ['requests'],
    properties: {
      requests: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['unit', 'date', 'who', 'to', 'summary', 'intent', 'object', 'module', 'understand_vs_create', 'severity', 'irreversibility', 'missing_value', 'value_holder', 'limits', 'maximize', 'sacrifice', 'urgency', 'correction'],
          properties: {
            unit: text, date: text, who: { type: 'string', enum: members }, to: { type: 'string', enum: members }, summary: text, intent: text, object: text, module: text,
            understand_vs_create: scale, severity: scale, irreversibility: scale, missing_value: scale,
            value_holder: { type: 'string', enum: [...team.members.map((m) => m.name), 'model', 'nobody'] },
            limits: { type: 'array', items: (team.limits ?? []).length ? { type: 'string', enum: team.limits.map((l) => l.id) } : { type: 'string' } },
            maximize: text, sacrifice: text, urgency: scale, correction: { type: 'boolean' }
          }
        }
      }
    }
  }
}

/** Every unit says whether it is confidential. A unit without the field is refused: «open» by default is how a recorded meeting reaches the rows. */
export function validateUnits (units) {
  const bad = units.map((u, i) => [u, i]).filter(([u]) => typeof u?.confidential !== 'boolean')
  if (bad.length) throw new Error(`Every unit needs a boolean "confidential"; ${bad.length} do not (first at line ${bad[0][1] + 1}).`)
  return units
}

/**
 * Cuts long units and groups the pieces in batches of about `maxChars` characters. A batch never mixes confidential and open units: the model would be able
 * to attribute a request to the wrong unit and the check only knows that the id exists.
 */
export function batchUnits (units, { maxChars = BATCH_CHARS, unitChars = UNIT_CHARS } = {}) {
  const pieces = [...units.filter((u) => !u.confidential), ...units.filter((u) => u.confidential)].flatMap((u) => {
    const text = String(u.text ?? '').trim()
    return text.length ? Array.from({ length: Math.ceil(text.length / unitChars) }, (_, i) => ({ ...u, text: text.slice(i * unitChars, (i + 1) * unitChars) })) : []
  })
  const batches = []
  let current = []
  let size = 0
  for (const p of pieces) {
    if (current.length && (size + p.text.length > maxChars || Boolean(current[0].confidential) !== Boolean(p.confidential))) { batches.push(current); current = []; size = 0 }
    current.push(p)
    size += p.text.length
  }
  if (current.length) batches.push(current)
  return batches
}

const unitBlock = (u) => `[${u.id}] fuente: ${u.source ?? ''} | fecha de la unidad: ${u.date ?? ''} | autor por omisión: ${u.author ?? ''}${u.confidential ? ' | confidencial' : ''}\n${u.text}`

// Privacy net for what the model wrote: an address, or a run of digits that can be an identity number or a phone, is replaced and counted.
// It decides nothing about a request; it only keeps personal data out of the rows if the instructions were not followed. It does not detect names
// of people or companies: the rows of a confidential meeting are read by a person before `propose` (docs/METODO-DE-REPARTO.md, section 2).
// An ISO date (2026-03-04) is not a number to hide.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const PERSONAL = [[/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]', () => true], [/\+?\d[\d\s.-]{7,}\d/g, '[número]', (m) => !ISO_DATE.test(m)]]
const clean = (text, counter) => PERSONAL.reduce((t, [re, to, applies]) => t.replace(re, (m) => { if (!applies(m)) return m; counter.n++; return to }), String(text ?? ''))

/** Validates the rows of one batch against the team and the units, and attaches the unit's source and confidentiality. Drops what has no known unit. */
export function finishRows (requests, batch, team, counter = { n: 0 }) {
  const byId = new Map(batch.map((u) => [u.id, u]))
  const limits = new Set((team.limits ?? []).map((l) => l.id))
  const inRange = (x) => typeof x === 'number' && x >= 0 && x <= 1
  return requests.flatMap((r) => {
    const unit = byId.get(String(r.unit).replace(/[[\]\s]/g, ''))
    if (!unit || !r.summary || !['understand_vs_create', 'severity', 'irreversibility', 'missing_value', 'urgency'].every((k) => inRange(r[k]))) return []
    return [{ ...r, unit: unit.id, date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : (unit.date ?? ''), summary: clean(r.summary, counter), intent: clean(r.intent, counter), object: clean(r.object, counter), module: clean(r.module, counter), maximize: clean(r.maximize, counter), sacrifice: clean(r.sacrifice, counter),
      limits: (r.limits ?? []).filter((id) => limits.has(id)), source: unit.source ?? '', confidential: unit.confidential === true }]
  })
}

/** Runs the extraction. `provider` has `complete({ system, messages, schema, effort })`. Returns `{ rows, batches, redacted, failed }`. */
export async function extractRows (units, team, { provider, parallel = 6, cacheDir = null, onBatch = () => {} } = {}) {
  validateTeam(team)
  validateUnits(units)
  const batches = batchUnits(units)
  const system = systemPrompt(team)
  const schema = rowsSchema(team)
  const counter = { n: 0 }
  const results = new Array(batches.length)
  let failed = 0
  let next = 0
  const worker = async () => {
    while (next < batches.length) {
      const i = next++
      const file = cacheDir ? join(cacheDir, `batch-${String(i).padStart(4, '0')}.json`) : null
      if (file && existsSync(file)) { results[i] = JSON.parse(readFileSync(file, 'utf8')); continue }
      try {
        const r = await provider.complete({ system, messages: [{ role: 'user', content: batches[i].map(unitBlock).join('\n\n') }], schema, effort: 'low' })
        results[i] = finishRows(r.json?.requests ?? [], batches[i], team, counter)
        if (file) writeFileSync(file, JSON.stringify(results[i]))
      } catch (error) { failed++; results[i] = []; onBatch({ index: i, error: error.message }) }
      onBatch({ index: i, rows: results[i].length })
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, batches.length)) }, worker))
  return { rows: results.flat(), batches: batches.length, redacted: counter.n, failed }
}

async function main (argv) {
  const [unitsFile, ...rest] = argv
  const option = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback }
  if (!unitsFile || !option('--team') || !option('--out')) {
    console.error('Uso: node scripts/request-rows.mjs units.jsonl --team team.json --out rows.jsonl [--model claude-haiku-5-5] [--parallel 6] [--cache DIR]')
    process.exit(2)
  }
  const { createClaudeCliProviders } = await import('../bench/claude-cli-provider.mjs')
  const provider = createClaudeCliProviders({ model: option('--model', 'claude-haiku-5-5') }).text
  const cacheDir = option('--cache', null)
  if (cacheDir) mkdirSync(cacheDir, { recursive: true })
  const { rows, batches, redacted, failed } = await extractRows(readJsonl(unitsFile), readJson(option('--team')), {
    provider, parallel: Number(option('--parallel', 6)), cacheDir, onBatch: (e) => console.error(e.error ? `lote ${e.index}: ${e.error}` : `lote ${e.index}: ${e.rows} pedidos`)
  })
  writeFileSync(option('--out'), '')
  for (const r of rows) appendFileSync(option('--out'), `${JSON.stringify(r)}\n`)
  console.error(`${batches} lotes, ${rows.length} pedidos, ${redacted} datos reemplazados, ${failed} lotes fallidos`)
  if (failed) process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
