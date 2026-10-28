#!/usr/bin/env node
// Turns the written and spoken material of a team into one row per request, with the dimensions the routing method measures.
//
//   node scripts/request-rows.mjs units.jsonl --team team.json --out rows.jsonl [--model claude-haiku-5-5] [--provider ./module.mjs] [--parallel 6] [--cache DIR] [--partial]
//
// `units.jsonl`: one text per line, `{ id, source, date, author, confidential, text }` (`confidential: true` for a recorded meeting: only abstract
// summaries come out of it). The model is reached through `claude -p` with the subscription of the account that runs the script, as the benchmark
// does (`bench/claude-cli-provider.mjs`), or through any provider with the shape of `src/analyze` (`providers.text.complete`).
// Each batch is cached in a file, so a cut does not repeat what is done. The text of the units stays where the units file is: the rows hold
// summaries only, and the script never writes a unit's text anywhere. `docs/METODO-DE-REPARTO.md` describes the fields.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readJson, readJsonl, validateTeam } from './area-method.mjs'
import { VALUE_HOLDERS } from '../src/domain/assessment.js'

// A batch is about 18,000 characters: a text provider reads that in one call and the instructions stay a small part of what it reads.
export const BATCH_CHARS = 18000
// A unit longer than this is cut in pieces of this size, so one very long document does not fill a batch alone.
export const UNIT_CHARS = 9000

// The version of the extraction: change it when the instructions, the schema or the cleaning of the rows change in a way that makes old rows differ.
// Every row records it with the model that wrote it, and the cache of a batch is named by a hash that includes the instructions, so an old cache is never taken for a new run.
export const EXTRACTOR_VERSION = '1.1.0'

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
- value_holder: "person" si el valor que falta lo tiene una persona del equipo, "model" si el modelo puede deducirlo o averiguarlo o si nada falta.
- holder: el nombre de la persona del equipo que tiene ese valor; vacío si value_holder es "model".
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
          required: ['unit', 'date', 'who', 'to', 'summary', 'intent', 'object', 'module', 'understand_vs_create', 'severity', 'irreversibility', 'missing_value', 'value_holder', 'holder', 'limits', 'maximize', 'sacrifice', 'urgency', 'correction'],
          properties: {
            unit: text, date: text, who: { type: 'string', enum: members }, to: { type: 'string', enum: members }, summary: text, intent: text, object: text, module: text,
            understand_vs_create: scale, severity: scale, irreversibility: scale, missing_value: scale,
            // The vocabulary of the product's analyzer (`VALUE_HOLDERS`: person or model); the name of the person goes apart, in `holder`.
            value_holder: { type: 'string', enum: [...VALUE_HOLDERS] },
            holder: { type: 'string', enum: [...team.members.filter((m) => (m.kind ?? 'person') === 'person').map((m) => m.name), ''] },
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
  // The model hands the id back inside brackets and `finishRows` strips brackets and spaces before looking it up, so an id with a space or a bracket (`msg 12`, `a[1]`) would never be found
  // and all its rows would be dropped as an unknown unit (reaudit 3, D5). The characters allowed are the ones of a file name or a message id: letters, digits, dot, underscore, colon and hyphen.
  const badId = units.filter((u) => !/^[A-Za-z0-9._:-]+$/.test(String(u?.id ?? '')))
  if (badId.length) throw new Error(`Unit ids may only hold letters, digits and . _ : - (no spaces or brackets); ${badId.length} do not, first ${JSON.stringify(String(badId[0]?.id ?? ''))}.`)
  // The split by unit and the key of a request rest on the id: two units with the same one would be one.
  const seen = new Set()
  const repeated = [...new Set(units.filter((u) => (seen.has(u.id) ? true : (seen.add(u.id), false))).map((u) => u.id))]
  if (repeated.length) throw new Error(`Unit ids must be unique; repeated: ${repeated.slice(0, 5).join(', ')}${repeated.length > 5 ? ` and ${repeated.length - 5} more` : ''}.`)
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
// A run of 7 digits or more (with spaces, dots or hyphens inside): the shortest identity number or phone of the countries of the team is 7 digits (reaudit 3 measured that `22345678` and `2234567` went through the earlier pattern, which wanted 9 characters).
const PERSONAL = [[/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]', () => true], [/\+?\d[\d\s.-]{5,}\d/g, '[número]', (m) => !ISO_DATE.test(m)]]
const clean = (text, counter) => PERSONAL.reduce((t, [re, to, applies]) => t.replace(re, (m) => { if (!applies(m)) return m; counter.n++; return to }), String(text ?? ''))

/**
 * The name of the cache file of a batch: a hash of everything that decides what the model answers (the units of the batch, the instructions, the schema, the provider
 * and the model). Another text, another provider or another model never finds the file of an earlier run, whatever the position of the batch.
 */
export function cacheName (batch, { system, schema, provider = '', model = '' }) {
  const hash = createHash('sha256').update(JSON.stringify({ batch, system, schema, provider, model, version: EXTRACTOR_VERSION })).digest('hex').slice(0, 24)
  return `batch-${hash}.json`
}

/** Validates the rows of one batch against the team and the units, and attaches the unit's source and confidentiality. Drops what has no known unit. */
export function finishRows (requests, batch, team, counter = { n: 0 }, meta = {}) {
  const byId = new Map(batch.map((u) => [u.id, u]))
  const limits = new Set((team.limits ?? []).map((l) => l.id))
  const people = new Set(team.members.filter((m) => (m.kind ?? 'person') === 'person').map((m) => m.name))
  const inRange = (x) => typeof x === 'number' && x >= 0 && x <= 1
  return requests.flatMap((r) => {
    const unit = byId.get(String(r.unit).replace(/[[\]\s]/g, ''))
    // A row that does not validate is not kept, and it is not lost without a trace: the reason is counted and the script prints it.
    const drop = (reason) => { counter.dropped ??= {}; counter.dropped[reason] = (counter.dropped[reason] ?? 0) + 1; return [] }
    if (!unit) return drop('unknown_unit')
    if (!r.summary) return drop('no_summary')
    if (!VALUE_HOLDERS.includes(r.value_holder)) return drop('bad_value_holder')
    if (!['understand_vs_create', 'severity', 'irreversibility', 'missing_value', 'urgency'].every((k) => inRange(r[k]))) return drop('out_of_range')
    const holder = r.value_holder === 'person' && people.has(r.holder) ? r.holder : ''
    return [{ ...r, holder, unit: unit.id, date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : (unit.date ?? ''), summary: clean(r.summary, counter), intent: clean(r.intent, counter), object: clean(r.object, counter), module: clean(r.module, counter), maximize: clean(r.maximize, counter), sacrifice: clean(r.sacrifice, counter),
      limits: (r.limits ?? []).filter((id) => limits.has(id)), source: unit.source ?? '', confidential: unit.confidential === true, model: meta.model ?? '', script_version: EXTRACTOR_VERSION }]
  })
}

/**
 * The provider of the model. By default `claude -p` with the subscription of the account that runs the script. With `--provider ./module.mjs` any module whose default export is a
 * provider (`{ complete({ system, messages, schema, effort }) }` returning `{ json }`) or a function `(model) => provider`: that is how a team with direct access to an API uses the method.
 */
export async function loadProvider (modulePath, model) {
  if (modulePath) {
    const mod = (await import(pathToFileURL(modulePath).href)).default
    const provider = typeof mod === 'function' ? await mod(model) : mod
    if (typeof provider?.complete !== 'function') throw new Error(`${modulePath} must export a provider with complete({ system, messages, schema, effort }).`)
    return provider
  }
  const { createClaudeCliProviders } = await import('../bench/claude-cli-provider.mjs')
  return createClaudeCliProviders({ model }).text
}

/** Runs the extraction. `provider` has `complete({ system, messages, schema, effort })`. Returns `{ rows, batches, redacted, failed }`. */
export async function extractRows (units, team, { provider, model = provider?.model ?? '', parallel = 6, cacheDir = null, onBatch = () => {} } = {}) {
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
      const file = cacheDir ? join(cacheDir, cacheName(batches[i], { system, schema, provider: provider?.name ?? '', model })) : null
      // A cache file that a cut left half written is not a result: it is read as absent and the batch is asked again.
      let cached = null
      if (file && existsSync(file)) { try { cached = JSON.parse(readFileSync(file, 'utf8')) } catch { cached = null } }
      if (Array.isArray(cached)) { results[i] = cached; continue }
      try {
        const r = await provider.complete({ system, messages: [{ role: 'user', content: batches[i].map(unitBlock).join('\n\n') }], schema, effort: 'low' })
        results[i] = finishRows(r.json?.requests ?? [], batches[i], team, counter, { model })
        if (file) { writeFileSync(`${file}.tmp`, JSON.stringify(results[i])); renameSync(`${file}.tmp`, file) } // written whole or not at all
      } catch (error) { failed++; results[i] = []; onBatch({ index: i, error: error.message }) }
      onBatch({ index: i, rows: results[i].length })
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, batches.length)) }, worker))
  return { rows: results.flat(), batches: batches.length, redacted: counter.n, failed, dropped: counter.dropped ?? {} }
}

async function main (argv) {
  const [unitsFile, ...rest] = argv
  const option = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback }
  if (!unitsFile || !option('--team') || !option('--out')) {
    console.error('Uso: node scripts/request-rows.mjs units.jsonl --team team.json --out rows.jsonl [--model claude-haiku-5-5] [--provider ./module.mjs] [--parallel 6] [--cache DIR] [--partial]')
    process.exit(2)
  }
  const model = option('--model', 'claude-haiku-5-5')
  const provider = await loadProvider(option('--provider'), model)
  const cacheDir = option('--cache', null)
  if (cacheDir) mkdirSync(cacheDir, { recursive: true })
  const { rows, batches, redacted, failed, dropped } = await extractRows(readJsonl(unitsFile), readJson(option('--team')), {
    provider, model, parallel: Number(option('--parallel', 6)), cacheDir, onBatch: (e) => console.error(e.error ? `lote ${e.index}: ${e.error}` : `lote ${e.index}: ${e.rows} pedidos`)
  })
  if (failed && !rest.includes('--partial')) {
    console.error(`${failed} lotes fallaron: no se escribe ${option('--out')}. Con --partial se escribe lo que se obtuvo; el caché guarda los lotes hechos y una segunda corrida repite sólo los fallidos.`)
    process.exit(1)
  }
  writeFileSync(`${option('--out')}.tmp`, rows.map((r) => `${JSON.stringify(r)}\n`).join(''))
  renameSync(`${option('--out')}.tmp`, option('--out'))
  console.error(`${batches} lotes, ${rows.length} pedidos, ${redacted} datos reemplazados, ${failed} lotes fallidos`)
  const lost = Object.entries(dropped)
  if (lost.length) console.error(`Filas descartadas por no validar: ${lost.map(([reason, n]) => `${n} ${reason}`).join(', ')}`)
  if (failed) process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
