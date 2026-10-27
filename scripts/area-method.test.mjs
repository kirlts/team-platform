// The routing method over an invented corpus (bench/fixtures/area-method): the criteria, the proposal, the load file and the extraction and
// the routing experiment with a fake provider. Nothing here reaches a model or the network.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as method from './area-method.mjs'
import { cohenD, DEFAULTS, fitClauses, analyze, propose, readJson, readJsonl, recognition, requiresPerson, seededRandom, topPhrases, validateLoadFile, validateTeam } from './area-method.mjs'
import * as extraction from './request-rows.mjs'
import { batchUnits, extractRows, finishRows, rowsSchema, systemPrompt } from './request-rows.mjs'
const validation = await import('./row-validation.mjs').catch(() => ({})) // a module that older versions of the method did not have
import * as experiment from './route-experiment.mjs'
import { runExperiment, scoreRouting, routerPrompt } from './route-experiment.mjs'
import { parseTemplate } from '../src/analyze/templates.js'
import { initializeDatabase, openDatabase, get, all } from '../src/db/index.js'
import { loadConfig } from '../src/config.js'
import { createArea, createTemplate, updateArea } from '../src/domain/areas.js'
import { touchesPerson, VALUE_HOLDERS } from '../src/domain/assessment.js'
import { createMember, updateMember } from '../src/domain/members.js'

import { syntheticCorpus } from '../bench/fixtures/area-method/synthetic.mjs'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'fixtures', 'area-method')
const rows = readJsonl(path.join(fixtures, 'rows.jsonl'))
const team = readJson(path.join(fixtures, 'team.json'))
const purposes = readJson(path.join(fixtures, 'purposes.json'))

test('the team file is validated and a repeated name is refused', () => {
  assert.equal(validateTeam(team), team)
  assert.throws(() => validateTeam({ members: [{ name: 'A', email: 'a@x.org' }, { name: 'A', email: 'b@x.org' }] }), /Repeated member/)
  assert.throws(() => validateTeam({ members: [{ name: 'A', email: 'a@x.org' }], limits: [{ id: 'Bad Id', text: 'x' }] }), /lowercase/)
})

test('statistics helpers: standardized difference, seeded random and terms', () => {
  assert.ok(cohenD([0.1, 0.2, 0.15, 0.12], [0.8, 0.9, 0.85, 0.82]) < -5)
  assert.equal(cohenD([1], [2, 3]), 0)
  const a = seededRandom(3)
  const b = seededRandom(3)
  assert.deepEqual([a(), a(), a()], [b(), b(), b()])
  assert.deepEqual(topPhrases(['Texto exacto del botón', 'texto exacto del botón', 'vista limpia', 'texto exacto de la fila'], 2), ['texto exacto del botón', 'vista limpia'])
  assert.deepEqual(topPhrases(['', null]), [])
})

test('a request needs a person when the value is mostly a person\'s or a limit of a person is touched', () => {
  const base = { value_holder: 'model', holder: '', missing_value: 0.9, limits: [] }
  assert.equal(requiresPerson(base, team), false, 'a high missing_value does not decide: the holder does')
  assert.equal(requiresPerson({ ...base, value_holder: 'person', holder: 'Ana' }, team), true)
  assert.equal(requiresPerson({ ...base, value_holder: 'person', holder: 'Ana', missing_value: 0.1 }, team), true, 'no threshold')
  assert.equal(requiresPerson({ ...base, limits: ['money'] }, team), true)
  assert.equal(requiresPerson({ ...base, limits: ['customer_data'] }, team), false)
})

test('the text recognition is better than the majority class on a corpus of three areas', () => {
  const tagged = rows.map((r) => ({ ...r, area: r.object }))
  const r = recognition(tagged, (x) => x.area)
  assert.ok(r.lower > r.base, `${r.lower} vs ${r.base}`)
  assert.deepEqual(recognition(tagged, (x) => x.area), r, 'same seed, same report')
})

test('analyze keeps the three real areas and rejects the one that is too small', () => {
  const report = analyze(rows, team)
  const by = Object.fromEntries(report.areas.map((a) => [a.title, a]))
  for (const t of ['Pedidos y envíos', 'Catálogo y precios', 'Atención al cliente']) assert.equal(by[t].keep, true, `${t}: ${JSON.stringify(by[t].criteria)}`)
  assert.equal(by.Contabilidad.keep, false)
  assert.equal(by.Contabilidad.criteria.volume.pass, false)
  assert.ok(by.Contabilidad.merge_into, 'a rejected area names where it would merge')
  assert.equal(report.rows, rows.length)
  assert.deepEqual(analyze(rows, team), report, 'deterministic')
  assert.ok(by['Catálogo y precios'].profile.limits[0].id === 'money')
})

test('the families map joins objects into one area', () => {
  const report = analyze(rows, team, { families: { 'atención al cliente': 'Pedidos y envíos' } })
  assert.equal(report.areas.length, 3)
  assert.ok(report.areas.find((a) => a.title === 'Pedidos y envíos').profile.n > 40)
})

test('propose writes areas, templates and profiles that the product accepts, and needs a purpose for each area', () => {
  assert.throws(() => propose(rows, team, { purposes: {} }), /purpose sentence/)
  const { spec, skipped } = propose(rows, team, { purposes, actor: 'ana@tienda.example' })
  assert.equal(spec.actor, 'ana@tienda.example')
  assert.deepEqual(spec.areas.map((a) => a.title).sort(), ['Atención al cliente', 'Catálogo y precios', 'Pedidos y envíos'])
  assert.deepEqual(skipped.map((s) => s.title), ['Contabilidad'])
  for (const a of spec.areas) {
    assert.ok(a.description.length <= 1024)
    assert.match(a.description, /^Propósito: /)
    assert.match(a.description, /Se maximiza: /)
    assert.match(a.description, /Se sacrifica: /)
    assert.match(a.description, /Entorno: /)
  }
  const catalog = spec.areas.find((a) => a.title === 'Catálogo y precios')
  assert.match(catalog.description, /Límites: mover dinero o fijar un precio \(lo levanta una persona\)/)
  assert.deepEqual(catalog.templates.map((t) => t.name).sort(), ['Ajuste', 'Falla', 'Pregunta'], 'only the intents with 20 requests or more have their own template')
  const parsed = parseTemplate(catalog.templates[0].body_markdown)
  assert.deepEqual(parsed.fields.map((f) => f.name), ['request', 'value_missing', 'limits_touched', 'undo'])
  assert.ok(parsed.output.every((o) => o.type === 'boolean' && o.name.startsWith('touches_')), 'the limits of the area are booleans')
  assert.deepEqual(parsed.output.map((o) => o.name), ['touches_money'])
  assert.deepEqual(spec.members.map((m) => m.email), team.members.map((m) => m.email))
  const ana = spec.members.find((m) => m.email === 'ana@tienda.example').profile
  assert.match(ana, /^Soy la dueña/)
  assert.match(ana, /Esas decisiones son mías/)
  const agent = spec.members.find((m) => m.email === 'asistente@tienda.example').profile
  assert.match(agent, /No decido: mover dinero o fijar un precio y lo que no se deshace/)
  assert.doesNotThrow(() => validateLoadFile(spec))
})

test('the examples of an area never come from a confidential source', () => {
  const { spec } = propose(rows, team, { purposes })
  const confidential = rows.filter((r) => r.confidential).map((r) => r.summary)
  for (const a of spec.areas) for (const s of confidential) assert.ok(!a.description.includes(`«${s}»`), s)
})

test('fitClauses drops the clauses of highest rank and refuses when the required ones do not fit', () => {
  const clauses = [{ text: 'a'.repeat(50), drop: 0 }, { text: 'b'.repeat(40), drop: 2 }, { text: 'c'.repeat(40), drop: 3 }]
  assert.equal(fitClauses(clauses, 100), `${'a'.repeat(50)} ${'b'.repeat(40)}`)
  assert.throws(() => fitClauses(clauses, 10), /required clauses/)
})

test('validateLoadFile refuses a template that does not parse and a repeated area', () => {
  assert.throws(() => validateLoadFile({ areas: [{ title: 'A', description: 'd', templates: [{ name: 'x', body_markdown: 'sin encabezado' }] }] }), /Template x of A/)
  assert.throws(() => validateLoadFile({ areas: [{ title: 'A', description: 'd' }, { title: 'A', description: 'd' }] }), /Repeated area/)
})

test('the product creates what the load file describes', async () => {
  const { spec } = propose(rows, team, { purposes, actor: 'ana@tienda.example' })
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'area-method-'))
  const config = loadConfig({ DATA_DIR: dir, HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'silent', ADMIN_EMAIL: 'ana@tienda.example', ADMIN_PASSWORD: 'una clave larga de prueba 1' })
  await initializeDatabase(config)
  const db = openDatabase(config.dbFile, config.sqlite)
  const actor = get(db, "SELECT id FROM members WHERE email = 'ana@tienda.example'")?.id ?? createMember(db, { email: 'ana@tienda.example', name: 'Ana', role: 'editor' })
  for (const a of spec.areas) {
    const area = createArea(db, { title: a.title, description: a.description, position: a.position }, { actorId: actor })
    for (const t of a.templates) createTemplate(db, area.id, { body_markdown: t.body_markdown }, { actorId: actor })
  }
  updateMember(db, actor, { profile: spec.members[0].profile }, { actorId: actor })
  assert.equal(all(db, 'SELECT id FROM areas WHERE deleted_at IS NULL AND title IN (?, ?, ?)', 'Pedidos y envíos', 'Catálogo y precios', 'Atención al cliente').length, 3)
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM templates WHERE deleted_at IS NULL AND name IN (?, ?, ?)', 'Falla', 'Ajuste', 'Pregunta').n >= 3, true)
  assert.equal(get(db, 'SELECT profile FROM members WHERE id = ?', actor).profile, spec.members[0].profile)
})

// ---- extraction
const units = readJsonl(path.join(fixtures, 'units.jsonl'))

test('units are cut and batched, and the prompt and schema carry the team', () => {
  assert.equal(batchUnits(units).length, 2, 'one batch of open units and one of confidential units')
  assert.equal(batchUnits([{ id: 'x', text: 'a'.repeat(25000) }], { maxChars: 10000, unitChars: 9000 }).length, 3)
  assert.equal(batchUnits([{ id: 'x', text: '  ' }]).length, 0)
  assert.match(systemPrompt(team), /Ana \(Soy la dueña/)
  assert.match(systemPrompt(team), /money: mover dinero/)
  const schema = rowsSchema(team)
  const item = schema.properties.requests.items.properties
  assert.deepEqual(item.who.enum, ['Ana', 'Beto', 'Carla', 'Asistente', 'other'])
  assert.deepEqual(item.limits.items.enum, ['money', 'customer_data', 'irreversible'])
  assert.deepEqual(item.value_holder.enum, [...VALUE_HOLDERS], 'the vocabulary of the analyzer of the product')
  assert.deepEqual(item.holder.enum, ['Ana', 'Beto', 'Carla', ''], 'the name of the person goes apart, among the people of the team')
})

const fakeRow = (unit, extra = {}) => ({ unit, date: '2026-03-02', who: 'Beto', to: 'Asistente', summary: 'Arreglar la etiqueta de envío', intent: 'falla', object: 'pedidos y envíos', module: 'etiquetas',
  understand_vs_create: 0.3, severity: 0.5, irreversibility: 0.4, missing_value: 0.1, value_holder: 'model', holder: '', limits: ['customer_data', 'unknown_limit'], maximize: 'envío a tiempo', sacrifice: '', urgency: 0.6, correction: false, ...extra })

test('extraction validates and cleans what the model returns', async () => {
  const seen = []
  const provider = {
    async complete (req) {
      seen.push(req)
      return { json: { requests: [fakeRow('u1'), fakeRow('[u2]', { summary: 'Escribir a ana@tienda.example sobre 987654321' }), fakeRow('u3', { summary: 'Reclamo de garantía', confidential: false }), fakeRow('u9'), fakeRow('u1', { severity: 3 })] } }
    }
  }
  const result = await extractRows(units, team, { provider })
  assert.equal(result.batches, 2)
  assert.equal(seen[0].effort, 'low')
  assert.match(seen.map((r) => r.messages[0].content).join('\n'), /\[u3\] fuente: reunión semanal .* confidencial/)
  assert.deepEqual(result.rows.map((r) => r.unit), ['u1', 'u2', 'u3'], 'an unknown unit and a value out of range are dropped')
  assert.deepEqual(result.rows[0].limits, ['customer_data'], 'a limit the team does not have is dropped')
  assert.match(result.rows[1].summary, /\[correo\] sobre \[número\]/)
  assert.equal(result.redacted, 2)
  assert.equal(result.rows[2].confidential, true, 'the confidentiality of the unit travels to the row')
  assert.equal(result.failed, 0)
})

test('a failed batch is counted and does not stop the others', async () => {
  const provider = { async complete () { throw new Error('sin servicio') } }
  const result = await extractRows(units, team, { provider })
  assert.deepEqual([result.failed, result.rows.length], [2, 0])
})

test('finishRows ignores a row with a malformed date and keeps the date of the unit', () => {
  const out = finishRows([fakeRow('u1', { date: 'ayer' })], [{ id: 'u1', date: '2026-03-02', source: 's' }], team)
  assert.equal(out[0].date, '2026-03-02')
})

// ---- routing experiment
test('the routing is scored without a judge: area and people', () => {
  const row = { ...rows.find((r) => r.object === 'catálogo y precios' && r.limits.includes('money')), area: 'Catálogo y precios' }
  assert.deepEqual(scoreRouting({ area: 'Catálogo y precios', attends: ['Ana'] }, row, team), { area_agrees: true, person_agrees: true, person_missing: false, person_extra: false })
  assert.equal(scoreRouting({ area: 'Catálogo y precios', attends: ['Asistente'] }, row, team).person_missing, true)
  const simple = { ...rows.find((r) => r.object === 'atención al cliente' && r.limits.length === 0), area: 'Atención al cliente' }
  assert.equal(scoreRouting({ area: 'Atención al cliente', attends: ['Asistente', 'Ana'] }, simple, team).person_extra, true)
})

test('the experiment routes a sample through the provider and reports counts, confusions and indicators', async () => {
  const { spec } = propose(rows, team, { purposes })
  const prompts = []
  const provider = {
    async complete (req) {
      prompts.push(req)
      if (req.schema.properties.indicators) return { json: { indicators: ['1.1', '1.2', '2.3', '3.3'].map((id) => ({ id, score: 1, reason: 'bien' })) } }
      const text = req.messages[0].content
      // A wiring test only: the router is a pattern over the vocabulary of the invented corpus, so it also errs where the corpus is phrased with a neighbour's words.
      const area = /precio|descuento|ficha|fotos|stock|compatibilidad|oferta/i.test(text) ? 'Catálogo y precios' : /reclamo|garant|horario|frecuentes|correo|respuesta|cliente/i.test(text) ? 'Atención al cliente' : 'Pedidos y envíos'
      return { json: { area, attends: area === 'Catálogo y precios' ? ['Ana'] : ['Asistente'], brief: 'Maximiza lo pedido. Para si toca dinero.' } }
    }
  }
  const result = await runExperiment(rows, spec, team, { provider, size: 30, judge: true })
  assert.equal(result.n, 78, '26 requests for each of the three areas: asking for 30 is raised to the count that an interval needs')
  assert.deepEqual(result.sample.warnings.map((w) => w.kind), ['size_raised'])
  assert.ok(result.agreement_with_rows.area.rate > 0.5 && result.agreement_with_rows.area.rate < 1, `agreement ${result.agreement_with_rows.area.rate}: the corpus has confusions`)
  assert.deepEqual(result.indicators, { '1.1': 1, '1.2': 1, '2.3': 1, '3.3': 1 })
  assert.ok(Object.keys(result.confusions).length > 0, 'the confusions are reported')
  assert.match(routerPrompt(spec, team), /### Catálogo y precios\nPropósito: /)
  assert.match(prompts[0].system, /^Repartes pedidos/)
})

// ---- B3: what a confidential unit says never reaches an output
const SEEDED = ['zxqmargen-secreto-acme', 'zxqaviso-sindicato-previo', 'zxqresumen-reunion-despido', 'zxqmodulo-liquidaciones', 'zxqintencion-reservada']

/** The invented corpus with 15 of the 40 catalog rows marked confidential and carrying a unique phrase in every free-text field. */
function seededCorpus () {
  let seeded = 0
  return rows.map((r) => {
    if (r.object !== 'catálogo y precios' || seeded >= 15) return r
    seeded++
    return { ...r, confidential: true, maximize: SEEDED[0], sacrifice: SEEDED[1], summary: `${SEEDED[2]} ${seeded}`, module: SEEDED[3], intent: SEEDED[4] }
  })
}
const everything = (value) => JSON.stringify(value)

test('B3: no phrase seeded in a confidential row appears in the report, the load file or the skipped list', () => {
  const corpus = seededCorpus()
  const result = propose(corpus, team, { purposes, actor: 'ana@tienda.example' })
  const text = everything(result)
  for (const phrase of SEEDED) assert.ok(!text.includes(phrase), `${phrase} reached an output`)
  assert.ok(result.spec.areas.some((a) => a.title === 'Catálogo y precios'), 'the area still exists: 25 of its 40 rows are open')
})

test('B3: an area that exists only through confidential rows is not proposed and its title is written nowhere', () => {
  const extra = Array.from({ length: 30 }, (_, i) => ({ ...rows[0], unit: `c${i}`, object: 'despidos de personal', module: 'liquidaciones', summary: `Revisar el despido número ${i}`, confidential: true, maximize: 'trato digno', sacrifice: 'rapidez' }))
  const corpus = [...rows, ...extra]
  const result = propose(corpus, team, { purposes })
  assert.ok(!result.spec.areas.some((a) => /despidos/i.test(a.title)))
  assert.ok(!everything(result).match(/despido/i), 'neither the title nor a word of the rows is written')
  const hidden = result.report.areas.find((a) => /^Área confidencial/.test(a.title))
  assert.ok(hidden, 'its counts remain, under a neutral name')
  assert.equal(hidden.keep, false)
  assert.equal(hidden.public_support.pass, false)
  assert.ok(result.skipped.some((s) => s.title === hidden.title && s.failed.includes('public_support')))
})

test('B3: a profile does not name an area that is not proposed and does not quote a confidential row', () => {
  const corpus = seededCorpus()
  const { spec } = propose(corpus, team, { purposes })
  const profiles = spec.members.map((m) => m.profile).join('\n')
  assert.ok(!/Contabilidad/.test(profiles), 'Contabilidad is not an area of the load file')
  for (const phrase of SEEDED) assert.ok(!profiles.includes(phrase))
})

test('B3: a row or a unit without the confidential flag is refused', () => {
  const { confidential: _drop, ...open } = rows[0]
  assert.throws(() => analyze([open, ...rows.slice(1)], team), /confidential/)
  assert.throws(() => propose([open, ...rows.slice(1)], team, { purposes }), /confidential/)
  assert.throws(() => method.validateRows([{ ...rows[0], confidential: 'no' }]), /confidential/)
  const { confidential: _also, ...unit } = units[0]
  assert.throws(() => extraction.validateUnits([unit]), /confidential/)
  return assert.rejects(extractRows([unit], team, { provider: { async complete () { throw new Error('must not be called') } } }), /confidential/)
})

test('B3: a batch never mixes confidential and open units', () => {
  const mixed = [{ id: 'a', confidential: false, text: 'x'.repeat(100) }, { id: 'b', confidential: true, text: 'y'.repeat(100) }, { id: 'c', confidential: false, text: 'z'.repeat(100) }]
  const batches = batchUnits(mixed)
  assert.equal(batches.length, 2)
  for (const b of batches) assert.equal(new Set(b.map((u) => Boolean(u.confidential))).size, 1)
})

test('B3: the labels list hides what only a confidential row says', () => {
  const corpus = [...rows, { ...rows[0], unit: 'z1', object: 'despidos de personal', intent: 'reservada', confidential: true }]
  const listing = method.labels(corpus)
  assert.ok(!everything(listing).includes('despidos'))
  assert.ok(listing.objects.some((o) => o.confidential_only === true && o.n === 1))
})

test('B3: the privacy net also cleans intent and object, and leaves an ISO date alone', () => {
  const counter = { n: 0 }
  const [row] = finishRows([fakeRow('u1', { summary: 'Revisar el pedido del 2026-03-04', intent: 'llamar al 987654321', object: 'mail ana@tienda.example' })], [{ id: 'u1', date: '2026-03-02' }], team, counter)
  assert.match(row.summary, /2026-03-04/)
  assert.match(row.intent, /\[número\]/)
  assert.match(row.object, /\[correo\]/)
  assert.equal(counter.n, 2)
})

// ---- B4: the criterion «se reconoce por el texto»
const recognized = (corpus, options) => recognition(corpus, (r) => r.object, options)

test('B4: the Wilson interval stays inside [0, 1] and does not collapse at the extremes', () => {
  const three = method.wilson(3, 3)
  assert.ok(three.lower > 0.43 && three.lower < 0.45, `3 of 3 has a lower bound of ${three.lower}, not 1`)
  assert.equal(three.upper, 1)
  const none = method.wilson(0, 5)
  assert.equal(none.lower, 0)
  assert.ok(none.upper > 0.4)
  assert.deepEqual(method.wilson(0, 0), { p: 0, lower: 0, upper: 1, n: 0 })
  for (const [k, n] of [[1, 1], [0, 1], [7, 7], [1, 40]]) { const w = method.wilson(k, n); assert.ok(w.lower >= 0 && w.upper <= 1 && w.lower <= w.p && w.p <= w.upper) }
})

test('B4: a dominant area on text without signal is not recognized', () => {
  for (const sizes of [{ big: 140, middle: 40, small: 20 }, { big: 230, a: 10, b: 6, c: 4 }]) {
    for (const a of analyze(syntheticCorpus({ sizes, noise: 1, seed: 9 }), team).areas) assert.equal(a.criteria.recognized_by_text.pass, false, `${a.title}: ${JSON.stringify(a.criteria.recognized_by_text)}`)
  }
})

test('B4: three rows with three hits do not pass, and an area with real signal passes even when it has 12 rows', () => {
  const tiny = recognized(syntheticCorpus({ sizes: { a: 3, b: 3, c: 3 }, noise: 0, seed: 2 }))
  for (const c of Object.values(tiny.per_class)) assert.ok(c.recall_lower < 0.5 && c.precision_lower < 0.5, `3 hits of 3 keep a lower bound of ${c.recall_lower}, not 1`)
  for (const a of analyze(syntheticCorpus({ sizes: { a: 60, b: 40, c: 20, d: 12 }, noise: 0.5, seed: 3 }), team).areas) assert.equal(a.criteria.recognized_by_text.pass, true, `${a.title}: ${JSON.stringify(a.criteria.recognized_by_text)}`)
})

test('B4: the module does not count as text: a module that names the area does not make a silent summary recognizable', () => {
  for (const a of analyze(syntheticCorpus({ sizes: { a: 60, b: 40, c: 30 }, noise: 1, seed: 4, leak: true }), team).areas) assert.equal(a.criteria.recognized_by_text.pass, false, a.title)
})

test('B4: the folds are drawn by unit, so repeated requests of one message cannot sit on both sides', () => {
  const corpus = syntheticCorpus({ sizes: { a: 60, b: 60 }, noise: 1, seed: 5, perUnit: 6, unitWords: true }) // the 6 rows of a unit share the summary; the text says nothing about the area
  const byRow = recognized(corpus, { groupOf: (_r, i) => i }) // what the method did: the same summary in the training and the test side
  const byUnit = recognized(corpus)
  assert.ok(byRow.accuracy > 0.8, `by row the classifier remembers the summary: ${byRow.accuracy}`)
  assert.ok(byUnit.accuracy < 0.7, `by unit it has nothing to remember: ${byUnit.accuracy}`)
  const groups = corpus.map((r) => r.unit)
  const fold = method.foldsByGroup(groups, 5, 7)
  const seen = new Map()
  groups.forEach((g, i) => { assert.equal(seen.get(g) ?? fold[i], fold[i], `unit ${g} on two folds`); seen.set(g, fold[i]) })
  const load = [0, 1, 2, 3, 4].map((f) => fold.filter((x) => x === f).length)
  assert.ok(Math.max(...load) - Math.min(...load) <= 6, `balanced folds: ${load}`)
})

test('B4: the criterion needs the precision as well as the recall', () => {
  const r = recognized(syntheticCorpus({ sizes: { big: 140, middle: 40, small: 20 }, noise: 1, seed: 9 }))
  const big = r.per_class.big
  assert.ok(big.recall_lower > big.baseline, `an area that absorbs everything has recall ${big.recall_lower}`)
  assert.ok(big.precision_lower <= big.baseline, 'but its precision does not beat the share')
})

// ---- the definition of «exige a una persona» is the product's (src/domain/assessment.js)
test('a row needs a person exactly when the product says its work belongs to a person', async () => {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'area-method-person-'))
  const config = loadConfig({ DATA_DIR: dir, HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'silent', ADMIN_EMAIL: 'ana@tienda.example', ADMIN_PASSWORD: 'una clave larga de prueba 1' })
  await initializeDatabase(config)
  const db = openDatabase(config.dbFile, config.sqlite)
  const area = createArea(db, { title: 'Área de prueba', description: 'd' })
  const shown = updateArea(db, area.id, { guards: team.limits.map((l) => ({ text: l.text, mechanism: 'gancho', person: l.person })) })
  const idOf = Object.fromEntries(team.limits.map((l) => [l.id, shown.guards.find((g) => g.text === l.text).id]))
  const subsets = [[], ['money'], ['customer_data'], ['irreversible'], ['money', 'customer_data']]
  let compared = 0
  for (const value_holder of VALUE_HOLDERS) {
    for (const limits of subsets) {
      for (const missing_value of [0.1, 0.9]) {
        const row = { value_holder, holder: value_holder === 'person' ? 'Ana' : '', missing_value, limits }
        const product = touchesPerson(db, area.id, { guards: limits.map((id) => idOf[id]), estimates: { value_holder } })
        assert.equal(requiresPerson(row, team), product, JSON.stringify(row))
        compared++
      }
    }
  }
  assert.equal(compared, 20)
})

// ---- B2: what builds the descriptions is not what measures them
test('B2: the split is by unit, reproducible, and the tuning and confirmation sets are different', () => {
  const sets = method.splitUnits(rows, { holdout: 0.5, seed: 7 })
  const units = (list) => new Set(list.map((r) => r.unit))
  for (const [a, b] of [['build', 'tune'], ['build', 'confirm'], ['tune', 'confirm']]) assert.equal([...units(sets[a])].filter((u) => units(sets[b]).has(u)).length, 0, `${a} and ${b} share a unit`)
  assert.equal(sets.build.length + sets.tune.length + sets.confirm.length, rows.length)
  assert.ok(Math.abs(sets.tune.length - sets.confirm.length) < rows.length * 0.05)
  assert.ok(sets.build.length > rows.length * 0.4 && sets.build.length < rows.length * 0.6)
  assert.deepEqual(method.splitUnits(rows, { holdout: 0.5, seed: 7 }), sets)
  assert.notDeepEqual(method.splitUnits(rows, { holdout: 0.5, seed: 8 }).tune, sets.tune)
  assert.throws(() => method.splitUnits(rows.slice(0, 2), { holdout: 0.5 }), /too few/)
})

test('B2: nothing in the held-out rows reaches the descriptions or the profiles', () => {
  const sets = method.splitUnits(rows, { seed: 7 })
  const held = new Set([...sets.tune, ...sets.confirm].map((r) => r.unit))
  const marked = rows.map((r, i) => (held.has(r.unit) ? { ...r, summary: `zzfuga resumen ${i}`, maximize: 'zzfuga cualidad', sacrifice: 'zzfuga resto', module: 'zzfuga modulo' } : r))
  for (const stage of ['tune', 'confirm']) {
    const built = experiment.buildAndSplit(marked, team, { stage, purposes })
    const text = JSON.stringify(built.load)
    assert.ok(!text.includes('zzfuga'), `${stage}: a held-out row reached the load file`)
    assert.ok(built.test.length > 0 && built.test.every((r) => held.has(r.unit)))
    assert.ok(built.load.areas.length >= 3)
  }
  assert.deepEqual(experiment.buildAndSplit(marked, team, { stage: 'tune', purposes }).test.map((r) => r.unit), sets.tune.map((r) => r.unit))
})

test('B2: without a hold-out the leak is counted, and with it the count is zero', async () => {
  const provider = { async complete (req) { return { json: { area: 'Catálogo y precios', attends: ['Asistente'], brief: 'x' + req.messages[0].content.length } } } }
  const whole = propose(rows, team, { purposes }).spec
  const leaked = await runExperiment(rows, whole, team, { provider, size: rows.length })
  assert.ok(leaked.leaked_examples > 0, 'the examples of the descriptions are in the measured sample')
  const built = experiment.buildAndSplit(rows, team, { stage: 'confirm', purposes })
  const clean = await runExperiment(built.test, built.load, team, { provider, size: built.test.length, held: { stage: built.stage, sets: built.sets }, buildUnits: built.buildUnits })
  assert.equal(clean.holdout.stage, 'confirm')
  assert.equal(clean.leaked_examples, 0)
})

// ---- B1: nothing counts until people have validated the rows
const AREA_OF = (r) => r.object.charAt(0).toUpperCase() + r.object.slice(1)

/** Labels that a careful person would write for the sample: the extraction's own values, with `flip` of every `every`-th label changed to another area. */
function labelsFor (items, { rater = 'p1', every = Infinity, only = null } = {}) {
  const byKey = new Map(validation.keyRows(rows).map((r) => [r.key, r]))
  const others = ['Pedidos y envíos', 'Catálogo y precios', 'Atención al cliente']
  return items.filter((i) => !only || only(i)).map((i, n) => {
    const r = byKey.get(i.key)
    const area = AREA_OF(r)
    const flipped = (n + 1) % every === 0
    return { key: i.key, rater, area: flipped ? others.find((a) => a !== area) : area, value_holder: r.value_holder, holder: r.holder, limits: r.limits }
  })
}

test('B1: the sample sizes come from the interval count, not from a round number', () => {
  const sizes = validation.validationSizes()
  assert.equal(sizes.per_area, method.wilsonSampleSize(0.8, 0.15))
  assert.equal(sizes.per_area, 26)
  assert.ok(method.wilson(Math.round(0.8 * 26), 26).upper - method.wilson(Math.round(0.8 * 26), 26).lower <= 0.3)
  assert.ok(method.wilson(Math.round(0.8 * 25), 25).upper - method.wilson(Math.round(0.8 * 25), 25).lower > 0.3, 'one less and the margin is not reached')
  assert.equal(validation.validationSizes({ halfWidth: 0.1 }).per_area, method.wilsonSampleSize(0.8, 0.1))
})

test('B1: the sample is stratified, blind and never takes a confidential row', () => {
  const { items, sizes, short } = validation.drawValidationSample(rows, team, { seed: 3 })
  const byKey = new Map(validation.keyRows(rows).map((r) => [r.key, r]))
  for (const i of items) {
    assert.deepEqual(Object.keys(i).sort(), ['date', 'double', 'key', 'summary', 'unit'], 'no estimate of the extractor travels with the request')
    assert.equal(byKey.get(i.key).confidential, false)
  }
  const perArea = items.reduce((m, i) => m.set(AREA_OF(byKey.get(i.key)), (m.get(AREA_OF(byKey.get(i.key))) ?? 0) + 1), new Map())
  for (const a of ['Pedidos y envíos', 'Catálogo y precios', 'Atención al cliente']) assert.equal(perArea.get(a), sizes.per_area)
  assert.deepEqual(short.map((s) => s.area), ['Contabilidad'], 'an area with fewer rows than the sample needs is announced')
  assert.equal(items.filter((i) => i.double).length, sizes.double)
  const needs = (key) => method.requiresPerson(byKey.get(key), team)
  const catalog = items.filter((i) => AREA_OF(byKey.get(i.key)) === 'Catálogo y precios')
  assert.ok(catalog.filter((i) => needs(i.key)).length >= 10, 'the requests that need a person are not left to chance')
  assert.deepEqual(validation.drawValidationSample(rows, team, { seed: 3 }).items, items)
})

test('B1: Cohen kappa of a known table, with weights', () => {
  const pair = (a, b, n) => Array.from({ length: n }, () => ({ a, b, w: 1 }))
  const table = [...pair('y', 'y', 20), ...pair('y', 'n', 5), ...pair('n', 'y', 10), ...pair('n', 'n', 15)]
  assert.ok(Math.abs(validation.weightedKappa(table).kappa - 0.4) < 1e-9, 'po 0.7, pe 0.5: kappa 0.4')
  const weighted = [{ a: 'y', b: 'y', w: 20 }, { a: 'y', b: 'n', w: 5 }, { a: 'n', b: 'y', w: 10 }, { a: 'n', b: 'n', w: 15 }]
  assert.ok(Math.abs(validation.weightedKappa(weighted).kappa - 0.4) < 1e-9, 'a weight of 20 is twenty copies')
  assert.equal(validation.weightedKappa(pair('y', 'y', 5)).kappa, 1)
  assert.equal(validation.weightedKappa([]).kappa, null)
  const ci = validation.kappaWithInterval(table.map((t, i) => ({ ...t, stratum: i % 2 })), { resamples: 300, seed: 1 })
  assert.ok(ci.lower < 0.4 && 0.4 < ci.upper && ci.lower > 0 && ci.upper < 0.7, JSON.stringify(ci))
})

test('B1: the extraction is validated only when people, a second person and a second run agree', () => {
  const { items } = validation.drawValidationSample(rows, team, { seed: 3 })
  const first = labelsFor(items, { every: 10 }) // one label in ten differs: a careful person against a good extraction
  const second = labelsFor(items, { rater: 'p2', only: (i) => i.double })
  const rerun = rows.map((r, i) => (i % 15 === 0 ? { ...r, object: 'atención al cliente' } : r))
  const complete = validation.agreement(rows, [...first, ...second], team, { retest: rerun, resamples: 200 })
  assert.equal(complete.validated, true, JSON.stringify([complete.failing, complete.missing]))
  assert.ok(complete.extraction_vs_people.area.kappa >= 0.6 && complete.extraction_vs_people.area.kappa < 1)
  assert.ok(complete.extraction_vs_people.area.lower < complete.extraction_vs_people.area.kappa)
  assert.ok(complete.between_people.area.kappa > 0.7 && complete.between_people.area.kappa < 1, `between people ${complete.between_people.area.kappa}`)
  assert.ok(complete.retest.aligned_units > 0 && complete.retest.area.kappa < 1)
  const noRetest = validation.agreement(rows, [...first, ...second], team, { resamples: 100 })
  assert.deepEqual([noRetest.validated, noRetest.missing], [false, ['retest']])
  const noSecond = validation.agreement(rows, first, team, { retest: rerun, resamples: 100 })
  assert.deepEqual([noSecond.validated, noSecond.missing], [false, ['second_rater']])
  const careless = validation.agreement(rows, [...labelsFor(items, { every: 2 }), ...second], team, { retest: rerun, resamples: 100 })
  assert.equal(careless.validated, false)
  assert.ok(careless.failing.includes('area'), 'half of the labels differ: the area does not agree')
})

test('B1: a run of the extraction with another number of requests in a unit is reported as unaligned', () => {
  const dropped = rows.filter((r, i) => i !== 1)
  const run = validation.testRetest(rows, dropped, team)
  assert.ok(run.unaligned_units >= 1)
  assert.equal(run.aligned_units + run.unaligned_units, new Set(rows.map((r) => r.unit)).size)
})

test('B1: the experiment names its measures by what they measure, brings the trivial routers next to them and says whether the rows are validated', async () => {
  const { spec } = propose(rows, team, { purposes })
  const provider = { async complete (req) { return { json: { area: 'Pedidos y envíos', attends: ['Asistente'], brief: 'x' } } } } // always the same area and no person
  const result = await runExperiment(validation.keyRows(rows), spec, team, { provider, size: 60 })
  assert.equal(result.area_rate, undefined, 'the old name is gone')
  assert.equal(result.area_match, undefined)
  assert.equal(result.validated, false)
  assert.ok(result.agreement_with_rows.area.lower <= result.agreement_with_rows.area.rate && result.agreement_with_rows.area.rate <= result.agreement_with_rows.area.upper)
  assert.equal(result.baselines.area_majority.area.length > 0, true)
  assert.ok(result.baselines.person_agent_alone.rate > 0.5 && result.baselines.person_agent_alone.rate < 1)
  assert.ok(result.baselines.person_asker.rate >= 0 && result.baselines.person_asker.rate <= 1)
  // a router that is the baseline «always the agent alone» obtains exactly the baseline
  assert.equal(result.agreement_with_rows.person.rate, Math.round(result.baselines.person_agent_alone.rate * result.n) / result.n > 0 ? result.agreement_with_rows.person.rate : 0)
  assert.equal(Math.round(result.agreement_with_rows.person.rate * 1000), Math.round(result.baselines.person_agent_alone.rate * 1000))
  assert.equal(result.agreement_with_labels, null)
  const ok = await runExperiment(validation.keyRows(rows), spec, team, { provider, size: 60, validation: { validated: true } })
  assert.equal(ok.validated, true)
})

test('B1: with labels from people the experiment also reports the agreement with them', async () => {
  const { spec } = propose(rows, team, { purposes })
  const { items } = validation.drawValidationSample(rows, team, { seed: 3 })
  const labels = labelsFor(items)
  const byKey = new Map(validation.keyRows(rows).map((r) => [r.key, r]))
  const provider = { async complete (req) { const text = req.messages[0].content; const row = items.find((i) => text.includes(i.summary)); const r = row && byKey.get(row.key); return { json: { area: r ? AREA_OF(r) : 'Pedidos y envíos', attends: ['Asistente'], brief: 'x' } } } }
  const result = await runExperiment(validation.keyRows(rows).filter((r) => items.some((i) => i.key === r.key)), spec, team, { provider, size: items.length, labels })
  assert.ok(result.agreement_with_labels.n > 50)
  assert.ok(result.agreement_with_labels.area.rate > 0.9)
  assert.equal(result.agreement_with_labels.rater, 'p1')
})

// ---- D5: the sample of the experiment
test('D5: the shuffle is uniform: the first element stays in place one time in ten', () => {
  const items = Array.from({ length: 10 }, (_, i) => i)
  let stays = 0
  const repetitions = 20000
  for (let seed = 1; seed <= repetitions; seed++) if (experiment.sampleRows(items, 10, seed)[0] === 0) stays++
  const share = stays / repetitions
  assert.ok(Math.abs(share - 0.1) < 0.012, `the first element stays with probability ${share}, 0.1 expected (a sort with a random comparator gives 0.19)`)
})

test('D5: the sample has the size that was asked, filtered before the cut, and tells when it cannot', () => {
  const { spec } = propose(rows, team, { purposes })
  const tagged = method.withAreas(rows)
  const drawn = experiment.drawSample(tagged, spec, { size: 100, perArea: 20 })
  assert.equal(drawn.sample.length, 100, 'Contabilidad is not loaded, and the cut still gives 100')
  assert.equal(drawn.discarded, 4)
  assert.deepEqual(drawn.warnings, [])
  const small = experiment.drawSample(tagged, spec, { size: 1000, perArea: 20 })
  assert.equal(small.sample.length, tagged.length - 4)
  assert.deepEqual(small.warnings.map((w) => w.kind), ['pool_short'])
  const short = experiment.drawSample(tagged, spec, { perArea: 200 })
  assert.ok(short.warnings.some((w) => w.kind === 'area_short' && w.needed === 200))
})

test('D5: the requests of an area that merges are measured against the area it merges into, and are not discarded', () => {
  const { spec } = propose(rows, team, { purposes })
  const tagged = method.withAreas(rows)
  const result = experiment.drawSample(tagged, spec, { size: 400, perArea: 20, merge: { Contabilidad: 'Catálogo y precios' } })
  assert.equal(result.discarded, 0)
  assert.equal(result.merged, 4)
  assert.equal(result.sample.filter((r) => r.area_before_merge === 'Contabilidad').every((r) => r.area === 'Catálogo y precios'), true)
})

test('D5: the sample is stratified by area and every request carries the weight of its area', () => {
  const { spec } = propose(rows, team, { purposes })
  const tagged = method.withAreas(rows)
  const { sample } = experiment.drawSample(tagged, spec, { size: 60, perArea: 15 })
  assert.equal(sample.length, 60)
  const counts = sample.reduce((m, r) => m.set(r.area, (m.get(r.area) ?? 0) + 1), new Map())
  for (const n of counts.values()) assert.ok(n >= 15)
  const pool = tagged.filter((r) => counts.has(r.area))
  assert.ok(Math.abs(sample.reduce((t, r) => t + r.weight, 0) - pool.length) < 1e-6, 'the weights add up to the pool')
})

test('D5: the weighted rate describes the corpus: a router right only in the small area does not look good', async () => {
  const { spec } = propose(rows, team, { purposes })
  const byText = new Map(method.withAreas(rows).map((r) => [r.summary, r.area]))
  const provider = { async complete (req) { return { json: { area: 'Catálogo y precios', attends: ['Asistente'], brief: 'x' } } } } // the same area for every request
  const result = await runExperiment(rows, spec, team, { provider, size: 60, perArea: 20 })
  const share = rows.filter((r) => r.object === 'catálogo y precios').length / rows.filter((r) => r.object !== 'contabilidad').length
  assert.ok(Math.abs(result.agreement_with_rows.area.rate - share) < 0.02, `weighted ${result.agreement_with_rows.area.rate} vs the share ${share}`)
  assert.ok(result.by_area['Catálogo y precios'].rate === 1 && result.by_area['Pedidos y envíos'].rate === 0)
  assert.ok(byText.size > 0)
})

test('D3: the router that confuses an area with another more than it gets it right proposes a merge', async () => {
  const { spec } = propose(rows, team, { purposes })
  const provider = { async complete (req) { return { json: { area: 'Pedidos y envíos', attends: ['Asistente'], brief: 'x' } } } }
  const result = await runExperiment(rows, spec, team, { provider, size: 60, perArea: 20 })
  assert.ok(result.merge_suggestions.some((s) => s.into === 'Pedidos y envíos' && s.from === 'Catálogo y precios' && s.confused > s.right))
  assert.ok(!result.merge_suggestions.some((s) => s.from === 'Pedidos y envíos'))
})

// ---- D6: the extraction is reproducible, or says why not
const oneUnit = (text) => [{ id: 'u1', source: 's', date: '2026-03-02', author: 'Ana', confidential: false, text }]
const answering = (summary, counter = { calls: 0 }) => ({ async complete () { counter.calls++; return { json: { requests: [fakeRow('u1', { summary })] } } } })

test('D6: the cache is named by the content of the batch, the provider and the model, so another run never reads the file of an earlier one', async () => {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'area-method-cache-'))
  const counter = { calls: 0 }
  const a = await extractRows(oneUnit('texto A'), team, { provider: answering('resumen A', counter), model: 'modelo-1', cacheDir: dir })
  assert.equal(a.rows[0].summary, 'resumen A')
  const again = await extractRows(oneUnit('texto A'), team, { provider: answering('resumen A', counter), model: 'modelo-1', cacheDir: dir })
  assert.equal(counter.calls, 1, 'the same batch, provider and model reuse the file')
  assert.equal(again.rows[0].summary, 'resumen A')
  const otherText = await extractRows(oneUnit('texto COMPLETAMENTE DISTINTO'), team, { provider: answering('resumen B', counter), model: 'modelo-1', cacheDir: dir })
  assert.equal(otherText.rows[0].summary, 'resumen B', 'another text does not get the summary of the first')
  const otherModel = await extractRows(oneUnit('texto A'), team, { provider: answering('resumen C', counter), model: 'modelo-2', cacheDir: dir })
  assert.equal(otherModel.rows[0].summary, 'resumen C', 'another model does not get the rows of the first')
  assert.equal(counter.calls, 3)
})

test('D6: every row records the model and the version of the script that wrote it', async () => {
  const result = await extractRows(oneUnit('texto A'), team, { provider: answering('resumen A'), model: 'modelo-1' })
  assert.equal(result.rows[0].model, 'modelo-1')
  assert.equal(result.rows[0].script_version, extraction.EXTRACTOR_VERSION)
  assert.match(extraction.EXTRACTOR_VERSION, /^\d+\.\d+\.\d+$/)
})

// ---- D1: the volume is derived from the interval, not from a share
test('D1: the minimum of rows of an area is the count of the interval and not a share of the corpus', () => {
  const min = method.wilsonSampleSize(DEFAULTS.targetRate, DEFAULTS.halfWidth)
  assert.equal(min, 26)
  const big = { sizes: { A: 700, B: 700, C: min, D: min - 1 }, noise: 0.3, seed: 31 } // c is 1.3 % of the corpus
  const by = Object.fromEntries(analyze(syntheticCorpus(big), team).areas.map((a) => [a.title, a]))
  assert.equal(by.C.criteria.volume.pass, true, '26 rows of 2,000 pass: a 5 % share would have refused them')
  assert.equal(by.D.criteria.volume.pass, false, 'one row less does not')
  assert.equal(by.C.criteria.volume.min_rows, 26)
  const small = Object.fromEntries(analyze(syntheticCorpus({ sizes: { A: 30, B: 30 }, noise: 0.3, seed: 32 }), team).areas.map((a) => [a.title, a]))
  assert.equal(small.A.criteria.volume.pass, true, '30 rows of 60 pass because they are enough to measure, not because they are half')
  const wider = analyze(syntheticCorpus({ sizes: { A: 30, B: 30 }, noise: 0.3, seed: 32 }), team, { halfWidth: 0.1 })
  assert.equal(wider.areas[0].criteria.volume.min_rows, method.wilsonSampleSize(0.8, 0.1))
  assert.equal(wider.areas[0].criteria.volume.pass, false, 'a tighter margin asks for more rows')
})

test('D1: the report says when it has nothing to route between', () => {
  const tiny = analyze(syntheticCorpus({ sizes: { a: 1, b: 1, c: 1 }, noise: 0.3, seed: 33 }), team)
  assert.ok(tiny.warnings.some((w) => w.kind === 'corpus_small'))
  assert.ok(tiny.warnings.some((w) => w.kind === 'single_area'))
  const alone = analyze(rows, { ...team, members: [team.members[0]] })
  assert.ok(alone.warnings.some((w) => w.kind === 'single_member'))
  assert.deepEqual(analyze(rows, team).warnings, [])
  const thin = analyze(syntheticCorpus({ sizes: { A: 30, B: 30 }, noise: 0.3, seed: 32 }), team)
  assert.ok(thin.warnings.some((w) => w.kind === 'confirmation_short'))
})

// ---- D2: the treatment criterion with several dimensions compared at once
test('D2: Holm adjusts a list of p-values and never lowers one', () => {
  assert.deepEqual(method.holm([0.01, 0.04, 0.03]).map((x) => +x.toFixed(4)), [0.03, 0.06, 0.06])
  assert.deepEqual(method.holm([0.5]), [0.5])
  assert.deepEqual(method.holm([0.4, 0.4, 0.4, 0.4, 0.4]), [1, 1, 1, 1, 1])
  for (const p of [[0.001, 0.02, 0.2], [0.04, 0.04]]) method.holm(p).forEach((adj, i) => assert.ok(adj >= p[i] && adj <= 1))
})

test('D2: two areas drawn from the same distribution are not called distinct, whatever their sizes', () => {
  const nullRows = (a, b, seed) => syntheticCorpus({ sizes: { A: a, B: b }, noise: 0.5, seed })
  for (const [a, b] of [[5, 40], [20, 40], [3, 40]]) {
    let distinct = 0
    const trials = 60
    for (let t = 1; t <= trials; t++) {
      const area = analyze(nullRows(a, b, 700 + t), team, { minRows: 3, permutations: 199, repeats: 1 }).areas.find((x) => x.title === 'A')
      if (area.criteria.distinct_treatment.pass) distinct++
    }
    // The fixed 0.5 rule called 5 against 40 distinct in 83 % of the null trials (the audit measured 4,000 repetitions); with Holm the rate is near alpha.
    assert.ok(distinct / trials <= 0.15, `${a} against ${b}: ${distinct}/${trials} null trials called distinct`)
  }
})

test('D2: a real difference in one dimension is found', () => {
  let found = 0
  const trials = 30
  for (let t = 1; t <= trials; t++) {
    const rowsAB = syntheticCorpus({ sizes: { A: 40, B: 40 }, noise: 0.5, seed: 800 + t }).map((r) => (r.object === 'B' ? { ...r, severity: Math.min(1, r.severity * 0.3 + 0.65) } : r))
    if (analyze(rowsAB, team, { permutations: 199, repeats: 1 }).areas.find((x) => x.title === 'A').criteria.distinct_treatment.pass) found++
  }
  assert.ok(found / trials >= 0.9, `${found}/${trials}`)
})

test('D2: the permutation p-value is never zero and the same seed gives the same test', () => {
  const a = rows.filter((r) => r.object === 'catálogo y precios')
  const b = rows.filter((r) => r.object === 'atención al cliente')
  const first = method.compareGroups(a, b, { rand: seededRandom(1), permutations: 99 })
  assert.deepEqual(method.compareGroups(a, b, { rand: seededRandom(1), permutations: 99 }), first)
  for (const d of Object.values(first.dimensions)) assert.ok(d.p >= 1 / 100 && d.p_adjusted >= d.p)
})

test('D2: two limits tied for the first place leave the area with no dominant limit', () => {
  const mk = (limits, n, base) => Array.from({ length: n }, (_, i) => ({ ...rows[0], unit: `${base}${i}`, object: base, summary: `${base} pedido ${i}`, limits: limits[i % limits.length] }))
  const tied = [...mk([['money'], ['customer_data']], 40, 'tied'), ...mk([['money']], 40, 'plain')]
  const report = analyze(tied, team, { permutations: 99, repeats: 1 })
  const against = report.areas.find((a) => a.title === 'Tied').criteria.distinct_treatment.against.Plain
  assert.equal(against.limit_differs, false, 'a tie of 20 and 20 does not decide the criterion')
})
