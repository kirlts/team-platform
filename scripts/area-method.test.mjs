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
import { runExperiment, scoreRouting, routerPrompt, SAMPLE } from './route-experiment.mjs'
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
  assert.deepEqual(spec.areas.map((a) => a.title), ['Pedidos y envíos', 'Catálogo y precios', 'Atención al cliente'])
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
  assert.deepEqual(catalog.templates.map((t) => t.name), ['Ajuste'], 'only the intent with 20 requests or more has its own template')
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
  assert.deepEqual(scoreRouting({ area: 'Catálogo y precios', attends: ['Ana'] }, row, team), { area_match: true, person_match: true, person_missing: false, person_extra: false })
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
      const area = /precio|descuento|ficha|fotos|stock|compatibilidades/i.test(text) ? 'Catálogo y precios' : /reclamo|garant|horario|frecuentes|correo/i.test(text) ? 'Atención al cliente' : 'Pedidos y envíos'
      return { json: { area, attends: area === 'Catálogo y precios' ? ['Ana'] : ['Asistente'], brief: 'Maximiza lo pedido. Para si toca dinero.' } }
    }
  }
  const result = await runExperiment(rows, spec, team, { provider, size: 30, judge: true })
  assert.equal(result.n, 30)
  assert.ok(result.area_rate > 0.7, `area rate ${result.area_rate}`)
  assert.deepEqual(result.indicators, { '1.1': 1, '1.2': 1, '2.3': 1, '3.3': 1 })
  assert.equal(typeof result.confusions, 'object')
  assert.match(routerPrompt(spec, team), /### Catálogo y precios\nPropósito: /)
  assert.match(prompts[0].system, /^Repartes pedidos/)
  assert.equal(SAMPLE, 60)
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
