// The routing method over an invented corpus (bench/fixtures/area-method): the criteria, the proposal, the load file and the extraction and
// the routing experiment with a fake provider. Nothing here reaches a model or the network.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
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
import { getProjectDescription } from '../src/domain/settings.js'
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
    assert.equal(a.confirmed, false)
  }
  const catalog = spec.areas.find((a) => a.title === 'Catálogo y precios')
  assert.match(catalog.description, /Límites: mover dinero o fijar un precio \(lo levanta una persona\)/)
  assert.deepEqual(catalog.templates.map((t) => t.name).sort(), ['Ajuste', 'Falla', 'Pregunta'], 'only the intents with 20 requests or more have their own template')
  const parsed = parseTemplate(catalog.templates[0].body_markdown)
  assert.deepEqual(parsed.fields.map((f) => f.name), ['request', 'value_missing', 'limits_touched', 'undo'])
  assert.ok(parsed.output.every((o) => o.type === 'boolean' && o.name.startsWith('touches_')), 'the limits of the area are booleans')
  assert.deepEqual(parsed.output.map((o) => o.name), ['touches_money', 'touches_irreversible'], 'the limits of a person are always there')
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

// A wiring test only: the rows a fake provider returns carry the vocabulary of the invented corpus and prove that the extraction validates and cleans, not that a model extracts well.
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
  assert.deepEqual(scoreRouting({ area: 'Catálogo y precios', attends: ['Ana'] }, row, team), { area_agrees: true, person_agrees: true, person_missing: false, person_extra: false, person_included: true, person_needed: true, person_right: true })
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
      if (req.schema.properties.indicators) return { json: { indicators: ['1.1', '1.2', '2.3', '3.3'].map((id) => ({ id, applies: true, score: 1, quote: 'Pedido', reason: 'bien' })) } }
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
  assert.deepEqual(Object.fromEntries(Object.entries(result.indicators).map(([id, v]) => [id, v.mean])), { '1.1': 1, '1.2': 1, '2.3': 1, '3.3': 1 })
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
  assert.ok(leaked.leaked_examples > 0 && leaked.from_build_units === null, 'the examples of the descriptions are in the measured sample')
  const built = experiment.buildAndSplit(rows, team, { stage: 'confirm', purposes })
  const clean = await runExperiment(built.test, built.load, team, { provider, size: built.test.length, held: { stage: built.stage, sets: built.sets }, buildUnits: built.buildUnits, buildRows: built.buildRows })
  assert.equal(clean.holdout.stage, 'confirm')
  assert.equal(clean.from_build_units, 0, 'no sampled request is from a construction unit')
  assert.ok(clean.leaked_examples >= 0 && clean.duplicate_of_build >= clean.leaked_examples, 'the sentences of a corpus repeat: identical text is counted apart')
})

// ---- B1 and B2 (reaudit): nothing counts until people have read the ORIGINAL text, and the gate is on the lower bound of the interval
const AREA_OF = (r) => r.object.charAt(0).toUpperCase() + r.object.slice(1)
const corpusUnits = readJsonl(path.join(fixtures, 'corpus-units.jsonl'))
const truthOf = (unit) => rows.filter((r) => r.unit === unit).map((r) => ({ area: AREA_OF(r), value_holder: r.value_holder, limits: r.limits }))

/**
 * What a careful person writes for a sample of units: the requests of the extraction itself, with the changes the test asks for. `every` changes the area of every n-th request;
 * `omit` adds a request the extraction did not find to every n-th unit; `invent` drops the last request of every n-th unit (so the extraction made one up).
 */
function labelsFor (items, { rater = 'p1', every = Infinity, only = null, omit = Infinity, invent = Infinity, random = null } = {}) {
  const others = ['Pedidos y envíos', 'Catálogo y precios', 'Atención al cliente']
  let n = 0
  return items.filter((i) => !only || only(i)).map((i, k) => {
    let requests = truthOf(i.unit).map((r) => {
      n++
      if (random) return { area: random.pick(others), value_holder: random.pick(['person', 'model']), limits: random.pick([[], ['money']]) }
      return n % every === 0 ? { ...r, area: others.find((a) => a !== r.area) } : r
    })
    if ((k + 1) % omit === 0) requests = [...requests, { area: 'Catálogo y precios', value_holder: 'model', limits: [] }]
    if ((k + 1) % invent === 0 && requests.length) requests = requests.slice(0, -1)
    return { unit: i.unit, rater, requests }
  })
}

test('B1 (reaudit): the sample sizes come from the interval count, not from a round number', () => {
  const sizes = validation.validationSizes()
  assert.equal(sizes.per_stratum, method.wilsonSampleSize(0.8, 0.15))
  assert.equal(sizes.per_stratum, 26)
  assert.equal(validation.validationSizes({ halfWidth: 0.1 }).per_stratum, method.wilsonSampleSize(0.8, 0.1))
})

test('B1 (reaudit): the sample is of units, to be read in the original text, and has a stratum for what the extraction left out and one for each limit', () => {
  const { items, sizes, short, stage } = validation.drawValidationSample(corpusUnits, rows, team, { seed: 3 })
  assert.equal(stage, 'all')
  for (const i of items) assert.deepEqual(Object.keys(i).sort(), ['date', 'double', 'source', 'stratum', 'unit'], 'no summary and no estimate of the extractor: the person reads the unit')
  const byStratum = items.reduce((m, i) => m.set(i.stratum, (m.get(i.stratum) ?? 0) + 1), new Map())
  assert.deepEqual([...byStratum.keys()].sort(), ['limit:customer_data', 'limit:money', 'none', 'zero'])
  for (const n of byStratum.values()) assert.equal(n, sizes.per_stratum)
  assert.deepEqual(short, [])
  assert.equal(items.filter((i) => i.double).length, sizes.double)
  const confidential = new Set(corpusUnits.filter((u) => u.confidential).map((u) => u.id))
  assert.ok(items.every((i) => !confidential.has(i.unit)))
  assert.ok(items.filter((i) => i.stratum === 'zero').every((i) => !rows.some((r) => r.unit === i.unit)), 'the zero stratum is made of messages with no row')
  assert.deepEqual(validation.drawValidationSample(corpusUnits, rows, team, { seed: 3 }).items, items)
  const withText = validation.drawValidationSample(corpusUnits, rows, team, { seed: 3, withText: true }).items
  assert.equal(withText[0].text, corpusUnits.find((u) => u.id === withText[0].unit).text)
})

test('B1 (reaudit): a rare limit gets its own stratum with all its cases', () => {
  const rare = rows.map((r, i) => (r.unit === 'u010' || r.unit === 'u050' || r.unit === 'u090' ? { ...r, limits: ['irreversible'] } : r))
  const { items, short } = validation.drawValidationSample(corpusUnits, rare, team, { seed: 3 })
  const picked = items.filter((i) => i.stratum === 'limit:irreversible').map((i) => i.unit).sort()
  assert.deepEqual(picked, ['u010', 'u050', 'u090'], 'the three units of the rare limit are all in the sample')
  assert.deepEqual(short.map((s) => s.stratum), ['limit:irreversible'], 'and the shortfall is announced')
})

test('B1 (reaudit): requests the extraction left out or made up are counted, and a message with no row can hide an omission', () => {
  const { items } = validation.drawValidationSample(corpusUnits, rows, team, { seed: 3 })
  const exact = validation.agreement(corpusUnits, rows, labelsFor(items), team, { resamples: 100 })
  assert.equal(exact.extraction_vs_people.exhaustiveness.omitted, 0)
  assert.equal(exact.extraction_vs_people.exhaustiveness.invented, 0)
  assert.equal(exact.extraction_vs_people.exhaustiveness.recall.value, 1)
  const missed = validation.agreement(corpusUnits, rows, labelsFor(items, { omit: 4 }), team, { resamples: 100 })
  const m = missed.extraction_vs_people.exhaustiveness
  assert.ok(m.omitted >= 20 && m.recall.value < 0.95, `${m.omitted} omitted, recall ${m.recall.value}`)
  assert.ok(m.recall.lower < m.recall.value && m.recall.value < m.recall.upper + 1e-9)
  const made = validation.agreement(corpusUnits, rows, labelsFor(items, { invent: 4 }), team, { resamples: 100 })
  assert.ok(made.extraction_vs_people.exhaustiveness.invented >= 15)
  assert.ok(made.extraction_vs_people.exhaustiveness.precision.value < 1)
  // the person finds a request in a message the extraction left with none
  const zero = items.filter((i) => i.stratum === 'zero')
  const hidden = labelsFor(items).map((l) => (zero.slice(0, 5).some((z) => z.unit === l.unit) ? { ...l, requests: [{ area: 'Catálogo y precios', value_holder: 'model', limits: [] }] } : l))
  assert.equal(validation.agreement(corpusUnits, rows, hidden, team, { resamples: 100 }).extraction_vs_people.exhaustiveness.omitted, 5)
})

test('B1 (reaudit): Cohen kappa of a known table, with weights, and an interval that resamples units', () => {
  const pair = (a, b, n) => Array.from({ length: n }, () => ({ a, b, w: 1 }))
  const table = [...pair('y', 'y', 20), ...pair('y', 'n', 5), ...pair('n', 'y', 10), ...pair('n', 'n', 15)]
  assert.ok(Math.abs(validation.weightedKappa(table).kappa - 0.4) < 1e-9, 'po 0.7, pe 0.5: kappa 0.4')
  const weighted = [{ a: 'y', b: 'y', w: 20 }, { a: 'y', b: 'n', w: 5 }, { a: 'n', b: 'y', w: 10 }, { a: 'n', b: 'n', w: 15 }]
  assert.ok(Math.abs(validation.weightedKappa(weighted).kappa - 0.4) < 1e-9, 'a weight of 20 is twenty copies')
  assert.equal(validation.weightedKappa(pair('y', 'y', 5)).kappa, 1)
  assert.equal(validation.weightedKappa([]).kappa, null)
  const withUnits = table.map((t, i) => ({ ...t, unit: `u${Math.floor(i / 5)}`, stratum: 'all' }))
  const byUnit = validation.kappaWithInterval(withUnits, { resamples: 300, seed: 1 })
  assert.ok(byUnit.lower < 0.4 && 0.4 < byUnit.upper)
  // five requests per unit that all agree or all differ: resampling units gives a wider interval than resampling requests
  const clustered = [...Array(10).keys()].flatMap((u) => Array.from({ length: 5 }, () => ({ unit: `c${u}`, stratum: 'all', w: 1, a: u < 6 ? 'y' : 'n', b: u < 3 || u > 7 ? 'y' : 'n' })))
  const singles = clustered.map((c, i) => ({ ...c, unit: `s${i}` }))
  const width = (items) => { const k = validation.kappaWithInterval(items, { resamples: 400, seed: 2 }); return k.upper - k.lower }
  assert.ok(width(clustered) > width(singles), 'requests of one unit are not independent')
})

const agreeing = (extra = {}) => {
  const { items } = validation.drawValidationSample(corpusUnits, rows, team, { seed: 3 })
  const rerun = rows.map((r, i) => (i % 40 === 0 ? { ...r, object: 'atención al cliente' } : r))
  const first = labelsFor(items, { every: 25 })
  const second = first.filter((l) => items.find((i) => i.unit === l.unit).double).map((l) => ({ ...l, rater: 'p2' })) // a second person who reads it the same way
  return { items, first, second, rerun, run: (labels, options = {}) => validation.agreement(corpusUnits, rows, labels, team, { resamples: 200, referenceRater: 'p1', retest: rerun, waive: ['limit:irreversible'], ...extra, ...options }) }
}

test('B2 (reaudit): the extraction is validated when people, a second person and a second run agree, with the lower bound of every kappa above the floor', () => {
  const { first, second, run } = agreeing()
  const done = run([...first, ...second])
  assert.equal(done.validated, true, JSON.stringify([done.failing, done.missing]))
  for (const r of done.rules.filter((x) => x.on === 'lower')) assert.ok(r.lower >= done.min_kappa, `${r.name}: ${r.lower}`)
  assert.ok(done.rules.length >= 12)
  assert.deepEqual(run([...first, ...second], { retest: null }).missing, ['retest'])
  assert.deepEqual(run(first).missing, ['second_rater'])
})

test('B2 (reaudit): a point kappa above the floor with an interval that reaches under it does not validate', () => {
  const { first, second, run } = agreeing()
  const noisy = labelsFor(validation.drawValidationSample(corpusUnits, rows, team, { seed: 3 }).items, { every: 4 })
  const result = run([...noisy, ...second])
  const area = result.rules.find((r) => r.name === 'area')
  assert.ok(area.kappa >= 0.6 && area.lower < 0.6, `kappa ${area.kappa}, lower ${area.lower}: the case of the gate`)
  assert.equal(result.validated, false)
  assert.ok(result.failing.includes('area'))
})

test('B2 (reaudit): with two raters the reference does not depend on whose name comes first', () => {
  const { first, second, run } = agreeing()
  assert.throws(() => run([...first, ...second], { referenceRater: null }), /--reference-rater/)
  const renamed = [...first.map((l) => ({ ...l, rater: 'zeta' })), ...second.map((l) => ({ ...l, rater: 'alfa' }))]
  const a = run(renamed, { referenceRater: 'zeta' })
  assert.equal(a.reference.rater, 'zeta')
  assert.deepEqual(a.extraction_vs_people.area, run([...first, ...second]).extraction_vs_people.area, 'the same reference whatever the names')
  assert.throws(() => run(renamed, { referenceRater: 'nadie' }), /has no labels/)
})

test('B2 (reaudit): a disagreement between two people with no adjudication leaves the unit out of the reference and stops the validation; an adjudicated label resolves it', () => {
  const { items, first, second, run } = agreeing()
  const double = items.filter((i) => i.double)
  const disputed = second.map((l, i) => (i < 4 ? { ...l, requests: l.requests.map((r) => ({ ...r, area: 'Atención al cliente', value_holder: 'person' })).concat([{ area: 'Atención al cliente', value_holder: 'model', limits: [] }]) } : l))
  const open = run([...first, ...disputed])
  assert.equal(open.reference.unadjudicated, 4)
  assert.ok(open.failing.includes('reference:unadjudicated'))
  assert.equal(open.validated, false)
  const adjudicated = disputed.slice(0, 4).map((l) => ({ unit: l.unit, rater: 'adjudicated', requests: first.find((f) => f.unit === l.unit).requests }))
  const resolved = run([...first, ...disputed, ...adjudicated])
  assert.equal(resolved.reference.unadjudicated, 0)
  assert.equal(resolved.reference.adjudicated, 4)
  assert.ok(double.length > 4)
})

test('B2 (reaudit): labels from a second person who answers at random are not a validation, even if the first copies the extraction', () => {
  const { items, first, run } = agreeing()
  const random = seededRandom(11)
  const chaos = labelsFor(items, { rater: 'p2', only: (i) => i.double, random: { pick: (list) => list[Math.floor(random() * list.length)] } })
  const result = run([...first, ...chaos])
  assert.equal(result.validated, false)
  assert.ok(result.failing.some((n) => n.startsWith('people:')), result.failing.join(','))
})

test('B2 (reaudit): the kappa of each limit with enough cases decides, and a limit with too few cases fails unless it is waived by name', () => {
  const { items, first, second, run } = agreeing()
  const wrongMoney = first.map((l) => ({ ...l, requests: l.requests.map((r) => ({ ...r, limits: r.limits.filter((x) => x !== 'money') })) }))
  const result = run([...wrongMoney, ...second])
  assert.ok(result.failing.includes('limit:money'), 'the people do not see the limit money where the extraction does')
  const unwaived = run([...first, ...second], { waive: [] })
  const rare = unwaived.rules.find((r) => r.name === 'limit:irreversible')
  assert.equal(rare.pass, false, 'no request of the sample touches it, so it cannot be measured')
  assert.equal(rare.positives, 0)
  assert.equal(unwaived.validated, false)
  const waived = run([...first, ...second], { waive: ['limit:irreversible'] })
  assert.equal(waived.rules.find((r) => r.name === 'limit:irreversible').waived, true)
  assert.equal(waived.validated, true, 'waived by name, and the output says so')
  assert.equal(items.length >= 104, true)
})

test('B2 (reaudit): the second run must pair the requests of all but a share of the units', () => {
  const { first, second, run } = agreeing()
  const shifted = rows.flatMap((r, i) => (i % 3 === 0 ? [] : [r])) // a third of the requests vanish: many units change their count
  const result = run([...first, ...second], { retest: shifted })
  const share = result.rules.find((r) => r.name === 'retest:unaligned_share')
  assert.ok(share.value > 0.2)
  assert.equal(share.pass, false)
  assert.equal(result.validated, false)
  assert.ok(result.retest.unaligned_share === share.value)
})

test('B2 (reaudit): the analyzer of the product is measured limit by limit against the people', () => {
  const { items, first } = agreeing()
  const truthLimits = new Map(first.map((l) => [l.unit, l.requests.flatMap((r) => r.limits)]))
  const analyses = first.map((l, i) => ({ unit: l.unit, guards_touched: i % 5 === 0 ? [] : [...new Set(truthLimits.get(l.unit))].map((id) => (id === 'money' ? 'mover dinero o fijar un precio' : id)) }))
  const result = validation.analyzerAgreement(first, analyses, team, { resamples: 100 })
  assert.equal(result.reference_rater, 'p1')
  assert.ok(result.limits.money.human_positive > 5)
  assert.ok(result.limits.money.recall.value < 1 && result.limits.money.recall.value > 0.5, 'a fifth of the answers missed the limit')
  assert.equal(result.limits.money.precision.value, 1)
  assert.equal(items.length >= 78, true)
})

test('B1 (reaudit): a run of the extraction with another number of requests in a unit is reported as unaligned', () => {
  const dropped = rows.filter((r, i) => i !== 1)
  const run = validation.testRetest(rows, dropped, team)
  assert.ok(run.unaligned_units >= 1)
  assert.equal(run.aligned_units + run.unaligned_units, new Set(rows.map((r) => r.unit)).size)
})

// ---- B3 (reaudit): the people and the experiment look at the same requests
test('B3 (reaudit): the sample of a stage is made of the units of that stage, the same ones the experiment measures', () => {
  const stageOf = method.splitUnits(rows, { holdout: 0.5, seed: 7 })
  const tuneUnits = new Set(stageOf.tune.map((r) => r.unit))
  const { items } = validation.drawValidationSample(corpusUnits, rows, team, { stage: 'tune', seed: 3 })
  assert.ok(items.length > 40)
  for (const i of items) if (rows.some((r) => r.unit === i.unit)) assert.ok(tuneUnits.has(i.unit), `${i.unit} is not a tune unit`)
  const confirm = validation.drawValidationSample(corpusUnits, rows, team, { stage: 'confirm', seed: 3 }).items
  assert.equal(items.filter((i) => confirm.some((c) => c.unit === i.unit)).length, 0, 'tune and confirm never share a unit')
  const built = experiment.buildAndSplit(validation.keyRows(rows), team, { stage: 'tune', purposes })
  assert.deepEqual(new Set(built.test.map((r) => r.unit)), tuneUnits)
})

test('B3 (reaudit): with labels the experiment routes exactly the labeled requests and reports both agreements on them, with weights per stratum', async () => {
  const { spec } = propose(rows, team, { purposes })
  const built = experiment.buildAndSplit(validation.keyRows(rows), team, { stage: 'tune', purposes })
  const { items } = validation.drawValidationSample(corpusUnits, rows, team, { stage: 'tune', seed: 3 })
  const labels = labelsFor(items)
  const { reference } = validation.referenceLabels(labels)
  const routed = []
  const provider = { async complete (req) { routed.push(req.messages[0].content); const hit = built.test.find((r) => req.messages[0].content.includes(r.summary)); return { json: { area: hit ? AREA_OF(hit) : 'Pedidos y envíos', attends: ['Asistente'], brief: 'x' } } } }
  const result = await runExperiment(built.test, built.load, team, { provider, reference, referenceRater: 'p1', held: { stage: 'tune', sets: built.sets }, buildUnits: built.buildUnits })
  const expected = built.test.filter((r) => !r.confidential && reference.has(r.unit) && rows.filter((x) => x.unit === r.unit).length === reference.get(r.unit).requests.length && built.load.areas.some((a) => a.title === AREA_OF(r)))
  assert.equal(result.n, expected.length, 'the requests of the labeled units, no other')
  assert.equal(result.agreement_with_labels.n, result.n, 'and the people labeled every one of them')
  assert.equal(result.agreement_with_labels.rater, 'p1')
  assert.ok(result.agreement_with_labels.area.rate > 0.9 && result.agreement_with_rows.area.rate > 0.9)
  assert.ok(result.agreement_with_labels.baselines.area_majority.rate < 0.6)
  const strata = new Set(result.results.map((r) => r.weight))
  assert.ok(strata.size >= 2, 'the weights differ by stratum')
  assert.ok(Math.abs(result.results.reduce((t, r) => t + r.weight, 0) - built.test.filter((r) => !r.confidential && new Set(result.results.map((x) => x.unit)).has(r.unit) || false).length) < built.test.length, 'weights stay in scale')
  assert.equal(result.valid_for_acceptance, false, 'the rows are not validated')
  assert.ok(spec.areas.length >= 3)
})

test('B3 (reaudit): the original text of the labeled units can be routed too', async () => {
  const built = experiment.buildAndSplit(validation.keyRows(rows), team, { stage: 'tune', purposes })
  const { items } = validation.drawValidationSample(corpusUnits, rows, team, { stage: 'tune', seed: 3 })
  const { reference } = validation.referenceLabels(labelsFor(items))
  const seen = []
  const provider = { async complete (req) { seen.push(req.messages[0].content); return { json: { area: 'Pedidos y envíos', attends: ['Asistente'], brief: 'x' } } } }
  const unitTexts = new Map(corpusUnits.map((u) => [u.id, { text: u.text, author: u.author }]))
  const result = await runExperiment(built.test, built.load, team, { provider, reference, referenceRater: 'p1', unitTexts })
  assert.ok(result.agreement_with_labels.raw.n > 10)
  assert.ok(seen.some((s) => /Gracias\.|Hola equipo\.|Buen día\./.test(s)) || seen.some((s) => corpusUnits.some((u) => s.includes(u.text))), 'the router read the text the person wrote')
})

test('B3 (reaudit): --accept reads the lower bound against the best router with no model, and without labels it refuses or marks the result', () => {
  const rate = (k, n) => { const w = method.wilson(k, n); return { k, n, rate: k / n, lower: w.lower, upper: w.upper } }
  const labelled = { agreement_with_labels: { area: rate(60, 78), person: rate(70, 78), baselines: { area_majority: { area: 'x', rate: 0.34 }, person_agent_alone: { rate: 0.69 }, person_asker: { rate: 0.6 } } }, agreement_with_rows: {}, baselines: {} }
  const pass = experiment.acceptDecision(labelled, 0.7, {})
  assert.equal(pass.code, 1, 'a point rate of 0.77 with a lower bound of 0.66 does not meet 0.7')
  const strong = { ...labelled, agreement_with_labels: { ...labelled.agreement_with_labels, area: rate(75, 78), person: rate(78, 78) } }
  assert.equal(experiment.acceptDecision(strong, 0.7, {}).code, 0)
  const floor = experiment.acceptDecision({ ...strong, agreement_with_labels: { ...strong.agreement_with_labels, baselines: { ...strong.agreement_with_labels.baselines, person_agent_alone: { rate: 0.99 } } } }, 0.5, {})
  assert.equal(floor.code, 1, 'it must beat the best router with no model, not only the threshold')
  const none = { agreement_with_rows: { area: rate(70, 78), person: rate(70, 78) }, baselines: { area_majority: { rate: 0.3 }, person_agent_alone: { rate: 0.6 }, person_asker: { rate: 0.5 } }, agreement_with_labels: null }
  assert.equal(experiment.acceptDecision(none, 0.5, {}).code, 2, 'no labels: it does not compare')
  const allowed = experiment.acceptDecision(none, 0.5, { allowUnvalidated: true })
  assert.equal(allowed.valid, false)
})


test('B1 (reaudit): the experiment names its measures by what they measure, brings the trivial routers next to them and says whether the rows are validated', async () => {
  const { spec } = propose(rows, team, { purposes })
  const provider = { async complete () { return { json: { area: 'Pedidos y envíos', attends: ['Asistente'], brief: 'x' } } } } // always the same area and no person
  const result = await runExperiment(validation.keyRows(rows), spec, team, { provider, size: 60 })
  assert.equal(result.area_rate, undefined, 'the old name is gone')
  assert.equal(result.validated, false)
  assert.equal(result.valid_for_acceptance, false)
  assert.ok(result.agreement_with_rows.area.lower <= result.agreement_with_rows.area.rate && result.agreement_with_rows.area.rate <= result.agreement_with_rows.area.upper)
  assert.ok(result.baselines.person_agent_alone.rate > 0.5 && result.baselines.person_agent_alone.rate < 1)
  assert.equal(Math.round(result.agreement_with_rows.person.rate * 1000), Math.round(result.baselines.person_agent_alone.rate * 1000), 'a router that is the baseline obtains exactly the baseline')
  assert.equal(result.agreement_with_labels, null)
  assert.equal((await runExperiment(validation.keyRows(rows), spec, team, { provider, size: 60, validation: { validated: true } })).validated, true)
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
  assert.equal(drawn.discarded, tagged.filter((r) => r.object === 'contabilidad' && !r.confidential).length)
  assert.deepEqual(drawn.warnings, [])
  const small = experiment.drawSample(tagged, spec, { size: 1000, perArea: 20 })
  assert.equal(small.sample.length, tagged.filter((r) => !r.confidential && r.object !== 'contabilidad').length, 'every open request of a loaded area')
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
  const pool = tagged.filter((r) => counts.has(r.area) && !r.confidential)
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
  const big = { sizes: { A: 700, B: 700, C: min, D: min - 1 }, noise: 0.3, seed: 31 } // C is 1.3 % of the corpus
  const by = Object.fromEntries(analyze(syntheticCorpus(big), team, { holdout: 0 }).areas.map((a) => [a.title, a]))
  assert.equal(by.C.criteria.volume.pass, true, '26 rows of 2,000 pass: a 5 % share would have refused them')
  assert.equal(by.D.criteria.volume.pass, false, 'one row less does not')
  assert.equal(by.C.criteria.volume.min_rows, 26)
  const small = Object.fromEntries(analyze(syntheticCorpus({ sizes: { A: 30, B: 30 }, noise: 0.3, seed: 32 }), team, { holdout: 0 }).areas.map((a) => [a.title, a]))
  assert.equal(small.A.criteria.volume.pass, true, '30 rows of 60 pass because they are enough to measure, not because they are half')
  const wider = analyze(syntheticCorpus({ sizes: { A: 30, B: 30 }, noise: 0.3, seed: 32 }), team, { holdout: 0, halfWidth: 0.1 })
  assert.equal(wider.areas[0].criteria.volume.min_rows, method.wilsonSampleSize(0.8, 0.1))
  assert.equal(wider.areas[0].criteria.volume.pass, false, 'a tighter margin asks for more rows')
})

test('Reaudit D1: to be measured on a held-out set an area needs four times the rows, and the report says how many', () => {
  const report = analyze(syntheticCorpus({ sizes: { A: 120, B: 100, C: 26 }, noise: 0.3, seed: 34, leak: true }), team)
  const by = Object.fromEntries(report.areas.map((a) => [a.title, a]))
  assert.equal(by.A.criteria.volume.rows_needed_to_measure, 104, '26 divided by the quarter of the units that the confirmation set holds')
  assert.equal(by.A.criteria.volume.pass, true)
  assert.equal(by.B.criteria.volume.pass, false, '100 rows leave the confirmation set with 25: one short')
  assert.equal(by.C.criteria.volume.pass, false)
  assert.equal(analyze(syntheticCorpus({ sizes: { A: 120, B: 100, C: 26 }, noise: 0.3, seed: 34, leak: true }), team, { holdout: 0 }).areas.find((a) => a.title === 'C').criteria.volume.rows_needed_to_measure, 26, 'nothing held out: the interval count')
  assert.equal(analyze(rows, team).areas.find((a) => a.title === 'Atención al cliente').criteria.volume.pass, true, 'the invented corpus has more than 104 rows in each real area')
})

test('D1: the report says when it has nothing to route between', () => {
  const tiny = analyze(syntheticCorpus({ sizes: { a: 1, b: 1, c: 1 }, noise: 0.3, seed: 33 }), team)
  assert.ok(tiny.warnings.some((w) => w.kind === 'corpus_small'))
  assert.ok(tiny.warnings.some((w) => w.kind === 'single_area'))
  const alone = analyze(rows, { ...team, members: [team.members[0]] })
  assert.ok(alone.warnings.some((w) => w.kind === 'single_member'))
  assert.deepEqual(analyze(rows, team).warnings, [])
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
      const area = analyze(nullRows(a, b, 700 + t), team, { minRows: 3, holdout: 0, permutations: 199, repeats: 1 }).areas.find((x) => x.title === 'A')
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
    if (analyze(rowsAB, team, { holdout: 0, permutations: 199, repeats: 1 }).areas.find((x) => x.title === 'A').criteria.distinct_treatment.pass) found++
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
  const report = analyze(tied, team, { holdout: 0, permutations: 99, repeats: 1 })
  const against = report.areas.find((a) => a.title === 'Tied').criteria.distinct_treatment.against.Plain
  assert.equal(against.limit_differs, false, 'a tie of 20 and 20 does not decide the criterion')
})

// ---- D3: «two runs in a row» are two cuts of the data by date
test('D3: the same rows analyzed twice give the same report, so that is not a second run', () => {
  assert.deepEqual(analyze(rows, team), analyze(rows, team))
})

test('D3: an area that is kept in both windows is stable, one that appears late is not, and one that fails the volume in both merges', () => {
  const stable = method.analyzeWindows(rows, team, { holdout: 0 })
  assert.equal(stable.windows[0].rows + stable.windows[1].rows, rows.length)
  for (const t of ['Pedidos y envíos', 'Catálogo y precios', 'Atención al cliente']) assert.equal(stable.areas[t].stable_keep, true, `${t}: ${JSON.stringify(stable.areas[t])}`)
  assert.equal(stable.areas.Contabilidad.stable_keep, false)
  assert.equal(stable.areas.Contabilidad.volume_fail_both, true)
  const late = syntheticCorpus({ sizes: { Antigua: 120, Otra: 120 }, noise: 0.3, seed: 41, leak: true })
    .map((r, i) => ({ ...r, date: i % 2 ? '2026-03-10' : '2026-05-10' }))
    .map((r) => (r.object === 'Otra' ? { ...r, date: '2026-05-12', severity: r.severity * 0.3 + 0.65 } : r)) // «Otra» only exists from May, and it is treated differently
  const windows = method.analyzeWindows(late, team, { cut: '2026-04-15', holdout: 0, permutations: 99, repeats: 1 })
  assert.equal(windows.areas.Antigua.keep[1], true)
  assert.deepEqual(windows.areas.Otra.keep, [false, true])
  assert.equal(windows.areas.Otra.stable_keep, false, 'one window is not enough to create an area')
  assert.throws(() => method.analyzeWindows(late, team, { cut: '2027-01-01' }), /no rows/)
})

// ---- D4: comparing two versions, and a judge that is not the one that routes
test('D4: the exact McNemar test of a known case', () => {
  assert.ok(Math.abs(experiment.mcnemarExact(8, 2) - 0.1094) < 0.0005, '8 against 2 of 10 discordant pairs: p = 0.109')
  assert.equal(experiment.mcnemarExact(5, 5), 1)
  assert.equal(experiment.mcnemarExact(0, 0), 1)
  assert.ok(experiment.mcnemarExact(20, 3) < 0.001)
  assert.equal(experiment.mcnemarExact(3, 20), experiment.mcnemarExact(20, 3))
})

test('D4: a difference of one case is inside the noise and a clear one is not, and the pairs are units', () => {
  const mk = (flags) => ({ results: flags.map((f, i) => ({ key: `k${i}`, unit: `u${i}`, area_agrees: f[0], person_agrees: f[1] })) })
  const base = Array.from({ length: 60 }, () => [true, true])
  const oneCase = base.map((f, i) => (i === 0 ? [false, true] : f))
  assert.ok(experiment.compareRuns(mk(base), mk(oneCase)).area.p >= 1, 'one case of difference is not a signal')
  const clear = base.map((f, i) => (i < 15 ? [false, true] : f))
  const result = experiment.compareRuns(mk(base), mk(clear))
  assert.equal(result.paired, 60)
  assert.deepEqual([result.area.only_first, result.area.only_second], [15, 0])
  assert.ok(result.area.p < 0.001)
  assert.equal(experiment.compareRuns(mk(base), { results: [{ key: 'other', unit: 'other', area_agrees: true }] }).paired, 0, 'only the units both routed are compared')
  // two requests of one unit are one pair, and the unit is right only when both are
  const twins = { results: [{ unit: 'a', area_agrees: true }, { unit: 'a', area_agrees: false }, { unit: 'b', area_agrees: true }, { unit: 'b', area_agrees: true }] }
  const allRight = { results: [{ unit: 'a', area_agrees: true }, { unit: 'a', area_agrees: true }, { unit: 'b', area_agrees: true }, { unit: 'b', area_agrees: true }] }
  const pairs = experiment.compareRuns(twins, allRight)
  assert.equal(pairs.paired, 2)
  assert.deepEqual([pairs.area.only_first, pairs.area.only_second], [0, 1])
})

test('Reaudit D4: the interval of a rate counts units and not requests, and an example quoted anywhere is counted', async () => {
  const { spec } = propose(rows, team, { purposes })
  const provider = { async complete () { return { json: { area: 'Pedidos y envíos', attends: ['Asistente'], brief: 'x' } } } }
  const result = await runExperiment(validation.keyRows(rows), spec, team, { provider, size: 300, perArea: 10 })
  const a = result.agreement_with_rows.area
  assert.ok(a.units < a.n, `${a.n} requests in ${a.units} units: some messages carry two requests`)
  // the same rate over independent requests would be narrower: the interval is the one of the units
  const w = method.wilson(Math.round(a.rate * a.n), a.n)
  assert.ok(a.upper - a.lower >= w.upper - w.lower - 1e-9, 'never narrower than counting every request as independent')
  const repeated = rows.find((r) => result.results.length && rows.filter((x) => x.summary === r.summary).length > 3)
  assert.ok(repeated, 'the sentences of the invented corpus repeat across messages')
  const quoted = { areas: [{ title: 'X', description: `Entra: «${repeated.summary}».` }] }
  const sample = rows.filter((r) => r.summary === repeated.summary)
  assert.equal(experiment.leakedExamples(sample, quoted).leaked_examples, sample.length, 'identical text counts whatever its unit')
  assert.equal(experiment.leakedExamples(sample, quoted, new Set(), rows.slice(0, 1000)).duplicate_of_build, sample.length)
})


test('D4: the result says when the judge is the same model as the router', async () => {
  const { spec } = propose(rows, team, { purposes })
  const provider = { async complete (req) { return req.schema.properties.indicators ? { json: { indicators: ['1.1', '1.2', '2.3', '3.3'].map((id) => ({ id, applies: true, score: 0, quote: 'Pedido', reason: 'x' })) } } : { json: { area: 'Pedidos y envíos', attends: ['Asistente'], brief: 'x' } } } }
  const same = await runExperiment(rows, spec, team, { provider, judge: true, models: { router: 'm', judge: 'm' } })
  assert.equal(same.judge.same_model, true)
  assert.equal(same.judge.validated_against_people, false)
  const other = await runExperiment(rows, spec, team, { provider, judge: true, models: { router: 'm', judge: 'n' } })
  assert.equal(other.judge.same_model, false)
  assert.equal((await runExperiment(rows, spec, team, { provider })).judge, null)
})

test('Reaudit C6: an indicator the judge cannot observe, or whose quote is not in the evidence, is not scored and is not filled with 0', async () => {
  const { spec } = propose(rows, team, { purposes })
  const system = []
  const provider = { async complete (req) {
    if (!req.schema.properties.indicators) return { json: { area: 'Pedidos y envíos', attends: ['Asistente'], brief: 'x' } }
    system.push(req.system)
    return { json: { indicators: [
      { id: '1.1', applies: true, score: 2, quote: 'Pedido', reason: 'ok' },
      { id: '1.2', applies: false, score: 0, quote: '', reason: 'no se ve' },
      { id: '2.3', applies: true, score: 1, quote: 'una frase que no está en ninguna parte', reason: 'inventada' },
      { id: '3.3', applies: true, score: -1, quote: 'Pedido', reason: 'ok' }
    ] } }
  } }
  const result = await runExperiment(rows, spec, team, { provider, judge: true, size: 40, perArea: 5 })
  assert.deepEqual(result.indicators['1.1'], { mean: 2, n: result.n })
  assert.deepEqual(result.indicators['1.2'], { mean: null, n: 0 }, 'not observable: no mean, not a 0')
  assert.deepEqual(result.indicators['2.3'], { mean: null, n: 0 }, 'a quote that is not in the evidence does not count')
  assert.equal(result.indicators['3.3'].mean, -1)
  assert.equal(result.judge.dropped.not_observable, result.n)
  assert.equal(result.judge.dropped.quote_not_in_evidence, result.n)
  assert.match(system[0], /\+2: .*\n  \+1: .*\n  0: .*\n  -1: .*\n  -2: /, 'the five anchors of the indicator are in the prompt of the judge')
  assert.match(experiment.validJudgement([{ id: '9.9', applies: true, score: 0, quote: 'x' }], 'x').dropped.repeated_or_unknown.toString(), /1/)
})

test('Reaudit D5: the baselines include everyone and a classifier of the words, and the people are measured by precision and recall', async () => {
  const { spec } = propose(rows, team, { purposes })
  const provider = { async complete () { return { json: { area: 'Catálogo y precios', attends: ['Ana', 'Beto', 'Carla'], brief: 'x' } } } } // everyone attends every request
  const result = await runExperiment(rows, spec, team, { provider, size: 120, perArea: 20 })
  assert.ok(result.baselines.area_nb.rate > 0.6 && result.baselines.area_nb.rate <= 1, 'the naive Bayes of the summaries is a baseline to beat')
  assert.ok(Math.abs(result.baselines.person_all.rate - result.agreement_with_rows.person.rate) < 0.01, 'always everyone is exactly the router that attends everyone')
  const p = result.agreement_with_rows
  assert.ok(p.person_recall.rate > 0.99, 'everyone is included, so no one is missing')
  assert.ok(p.person_precision.rate < p.person_recall.rate, 'but the precision shows the excess that person_agrees hides')
  assert.ok(p.person_precision.rate < 0.5)
})

// ---- Reauditoría D2 and D3: what the experiment measures, and a confirmation that is read once
test('Reaudit D2: the experiment lists what differs between the areas it measured and the ones in the file that is loaded', () => {
  const whole = propose(rows, team, { purposes }).spec
  const built = experiment.buildAndSplit(validation.keyRows(rows), team, { stage: 'tune', purposes }).load
  const same = experiment.configDifferences(whole, whole)
  assert.deepEqual(same, { only_in_measured: [], only_in_loaded: [], description_differs: [] })
  const diff = experiment.configDifferences(built, whole)
  assert.ok(diff.description_differs.length > 0, 'the descriptions were built with half of the rows and differ from the loaded ones')
  const fewer = { ...whole, areas: whole.areas.slice(1) }
  assert.deepEqual(experiment.configDifferences(whole, fewer).only_in_measured, [whole.areas[0].title])
})

test('Reaudit D3: the confirmation set is read once and a second reading is refused or marked', () => {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'area-method-confirm-'))
  const file = path.join(dir, 'rows.jsonl.confirm.json')
  assert.deepEqual(experiment.confirmGate(file, { stage: 'tune' }), { allowed: true, repeated: false }, 'tuning is free and writes nothing')
  assert.equal(existsSync(file), false)
  const first = experiment.confirmGate(file, { stage: 'confirm', now: () => '2026-10-27T10:00:00Z' })
  assert.equal(first.allowed, true)
  assert.equal(first.reads, 1)
  const second = experiment.confirmGate(file, { stage: 'confirm' })
  assert.equal(second.allowed, false)
  assert.match(second.message, /ya se leyó el 2026-10-27T10:00:00Z/)
  const again = experiment.confirmGate(file, { stage: 'confirm', again: true, now: () => '2026-10-28T09:00:00Z' })
  assert.equal(again.allowed, true)
  assert.equal(again.repeated, true)
  assert.equal(again.reads, 2)
  assert.equal(again.first_read_at, '2026-10-27T10:00:00Z', 'the first reading is not forgotten')
})


// ---- Marco: limits with their mechanism, a draft until the team confirms, one quality to maximize, an environment of facts
const noMechanism = { ...team, limits: team.limits.map(({ mechanism: _m, ...l }) => l) }

test('Marco 3: a limit carries its mechanism, and nothing says the system enforces it when no mechanism is declared', () => {
  const { spec, warnings } = propose(rows, noMechanism, { purposes })
  const text = JSON.stringify(spec)
  assert.ok(!/lo hace cumplir el sistema/.test(text), 'the old claim is gone')
  const naming = spec.areas.filter((a) => a.description.includes('datos personales de clientes'))
  assert.ok(naming.length >= 1)
  for (const a of naming) assert.match(a.description, /datos personales de clientes \(sin mecanismo declarado\)/, a.title)
  assert.deepEqual(warnings.map((w) => w.kind), spec.areas.map(() => 'guard_without_mechanism'))
  const withMechanism = propose(rows, team, { purposes })
  for (const a of withMechanism.spec.areas.filter((x) => x.description.includes('datos personales de clientes'))) assert.match(a.description, /datos personales de clientes \(lo sostiene: el asistente trabaja con una credencial que no lee la tabla de clientes\)/, a.title)
  assert.deepEqual(withMechanism.warnings, [])
  assert.throws(() => validateTeam({ ...team, limits: [{ id: 'x', text: 't', mechanism: 7 }] }), /mechanism/)
})

test('Marco 2: the load file carries the limits of the team as the guards of every area', () => {
  const { spec } = propose(rows, team, { purposes })
  for (const a of spec.areas) {
    assert.deepEqual(a.guards.map((g) => g.text), team.limits.map((l) => l.text), `${a.title}: every limit of the team, not only the ones the area touched`)
    assert.deepEqual(a.guards.map((g) => g.person), [true, false, true])
    assert.equal(a.guards[1].mechanism, 'el asistente trabaja con una credencial que no lee la tabla de clientes')
    assert.equal(a.guards[0].mechanism, '')
  }
  const broken = structuredClone(spec)
  broken.areas[0].guards[0] = { text: '', person: 'sí' }
  assert.throws(() => validateLoadFile(broken), /needs a text[\s\S]*boolean "person"[\s\S]*mechanism/)
  assert.throws(() => validateLoadFile({ ...spec, version: 1 }), /version/)
})

test('Marco 4: an area is a draft until the team confirms it, and it maximizes one quality', () => {
  const { spec } = propose(rows, team, { purposes })
  for (const a of spec.areas) {
    assert.equal(a.confirmed, false)
    const maximize = a.description.match(/Se maximiza: ([^.]*)\./)[1]
    assert.ok(!maximize.includes(';'), `one quality: ${maximize}`)
    assert.ok(a.candidates.maximize.length >= 2 && a.candidates.maximize.length <= 3)
    assert.ok(a.candidates.maximize.includes(maximize), 'the quality in the text is the first of the candidates')
  }
  const unconfirmed = structuredClone(spec)
  delete unconfirmed.areas[0].confirmed
  assert.throws(() => validateLoadFile(unconfirmed), /confirmed/)
})

test('Marco 13: the environment is a fact of the team and not a statistic of the corpus', () => {
  const { spec } = propose(rows, team, { purposes })
  for (const a of spec.areas) {
    const environment = a.description.match(/Entorno: ([^.]*)\./)[1]
    assert.ok(!/%|\d/.test(environment), `no frequencies in the environment: ${environment}`)
  }
  assert.match(spec.areas.find((a) => a.title === 'Pedidos y envíos').description, /Entorno: todos los despachos salen de una sola bodega/)
  const plain = propose(rows, team, { purposes: Object.fromEntries(Object.entries(purposes).map(([k, v]) => [k, v.purpose])) }).spec
  for (const a of plain.areas) assert.ok(!a.description.includes('Entorno'), 'without an environment of the team the clause is not invented from the corpus')
})

test('menor: a border with a neighbour is named only from two confusions', () => {
  const { spec, report } = propose(rows, team, { purposes })
  const confusions = Object.entries(report.partition.confusion)
  assert.ok(confusions.some(([, n]) => n >= 2), 'the invented corpus has confusions of two cases or more')
  for (const a of spec.areas) {
    const clause = a.description.match(/No entra: lo propio de (.*?) \(va a su área\)/)?.[1] ?? ''
    for (const other of spec.areas.map((x) => x.title).filter((t) => t !== a.title && clause.includes(t))) assert.ok((report.partition.confusion[`${a.title} -> ${other}`] ?? 0) >= 2, `${a.title} -> ${other}`)
  }
  const none = propose(rows, team, { purposes, minBorderConfusions: 1000 }).spec
  for (const a of none.areas) assert.ok(!a.description.includes('No entra'), 'no pair reaches 1,000 confusions')
})

// ---- Marco 1: the loader applies the load file, and applying it twice leaves the same state
const { applyLoadFile } = await import('./apply-load-file.mjs').catch(() => ({}))

async function freshDatabase (label) {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), `area-method-${label}-`))
  const config = loadConfig({ DATA_DIR: dir, HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'silent', ADMIN_EMAIL: 'ana@tienda.example', ADMIN_PASSWORD: 'una clave larga de prueba 1' })
  await initializeDatabase(config)
  const db = openDatabase(config.dbFile, config.sqlite)
  for (const m of team.members) if (!get(db, 'SELECT 1 AS ok FROM members WHERE email = ?', m.email)) createMember(db, { email: m.email, name: m.name, role: 'editor', kind: m.kind })
  return db
}
const confirmed = (spec) => ({ ...spec, areas: spec.areas.map((a) => ({ ...a, confirmed: true, confirmed_by: 'ana@tienda.example' })) })
const snapshot = (db) => JSON.stringify({
  areas: all(db, 'SELECT title, description, position, guards_json FROM areas WHERE deleted_at IS NULL ORDER BY title'),
  templates: all(db, 'SELECT area_id, name, body_markdown FROM templates WHERE deleted_at IS NULL ORDER BY area_id, name'),
  members: all(db, 'SELECT email, profile FROM members ORDER BY email')
})

test('Marco 1: the loader creates what the file describes, with its guards, and a second application changes nothing', async () => {
  const db = await freshDatabase('loader')
  const { spec } = propose(rows, team, { purposes, actor: 'ana@tienda.example' })
  const first = applyLoadFile(db, confirmed(spec))
  assert.equal(first.created.areas, 3)
  assert.ok(first.created.templates >= 3)
  assert.equal(first.updated.members, spec.members.length)
  const guards = all(db, "SELECT title, guards_json FROM areas WHERE title = 'Catálogo y precios'")
  assert.deepEqual(JSON.parse(guards[0].guards_json).map((g) => [g.text, g.person]), [['mover dinero o fijar un precio', true], ['datos personales de clientes', false], ['lo que no se deshace', true]])
  assert.equal(JSON.parse(guards[0].guards_json)[1].mechanism, 'el asistente trabaja con una credencial que no lee la tabla de clientes')
  assert.equal(JSON.parse(guards[0].guards_json).every((g) => Number.isInteger(g.id)), true, 'the product gave each guard its id')
  const before = snapshot(db)
  const auditBefore = get(db, 'SELECT COUNT(*) AS n FROM audit_log').n
  const second = applyLoadFile(db, confirmed(spec))
  assert.deepEqual(second.created, { areas: 0, templates: 0 })
  assert.deepEqual(second.updated, { areas: 0, guards: 0, templates: 0, members: 0 })
  assert.equal(snapshot(db), before, 'the same state')
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM audit_log').n, auditBefore, 'and no line of audit for what did not change')
})

test('Marco 1: a changed description updates by title; guards and templates of the area that the file does not name stay', async () => {
  const db = await freshDatabase('update')
  const { spec } = propose(rows, team, { purposes, actor: 'ana@tienda.example' })
  applyLoadFile(db, confirmed(spec))
  const catalog = all(db, "SELECT id FROM areas WHERE title = 'Catálogo y precios'")[0].id
  updateArea(db, catalog, { guards: [...JSON.parse(get(db, 'SELECT guards_json FROM areas WHERE id = ?', catalog).guards_json), { text: 'lo que el panel agregó a mano', mechanism: 'x', person: false }] })
  createTemplate(db, catalog, { body_markdown: '---\nname: "A mano"\ndescription: "d"\nfields:\n  - { name: request, label: "Qué", required: true }\n---\n## Método\nx\n\n## Formato de salida\nx\n\n## Salida\nx\n' })
  const edited = confirmed(spec)
  edited.areas.find((a) => a.title === 'Catálogo y precios').description = `${edited.areas.find((a) => a.title === 'Catálogo y precios').description} Nota.`
  const result = applyLoadFile(db, edited)
  assert.equal(result.updated.areas, 1)
  assert.equal(result.created.areas, 0)
  assert.equal(all(db, "SELECT id FROM areas WHERE title = 'Catálogo y precios' AND deleted_at IS NULL").length, 1, 'updated, not duplicated')
  assert.match(get(db, 'SELECT description FROM areas WHERE id = ?', catalog).description, /Nota\.$/)
  assert.ok(JSON.parse(get(db, 'SELECT guards_json FROM areas WHERE id = ?', catalog).guards_json).some((g) => g.text === 'lo que el panel agregó a mano'), 'a guard the file does not name stays')
  assert.ok(all(db, 'SELECT name FROM templates WHERE area_id = ? AND deleted_at IS NULL', catalog).some((t) => t.name === 'A mano'), 'a template the file does not name stays')
})

test('Marco 4: the loader refuses an area the team has not confirmed, and writes nothing', async () => {
  const db = await freshDatabase('unconfirmed')
  const { spec } = propose(rows, team, { purposes, actor: 'ana@tienda.example' })
  const before = snapshot(db)
  assert.throws(() => applyLoadFile(db, spec), /has not confirmed: .*Atención al cliente/)
  assert.equal(snapshot(db), before)
  const partial = confirmed(spec)
  partial.areas[0].confirmed = false
  assert.throws(() => applyLoadFile(db, partial), /has not confirmed/)
  const only = applyLoadFile(db, partial, { onlyConfirmed: true })
  assert.equal(only.created.areas, 2)
  assert.deepEqual(only.skipped, [partial.areas[0].title])
})

test('Marco 3: the loader reports a guard without a mechanism and can refuse it; the file needs an actor and members that exist', async () => {
  const db = await freshDatabase('mechanism')
  const { spec } = propose(rows, noMechanism, { purposes, actor: 'ana@tienda.example' })
  assert.throws(() => applyLoadFile(db, confirmed(spec), { requireMechanism: true }), /without a mechanism/)
  assert.equal(get(db, "SELECT COUNT(*) AS n FROM areas WHERE title = 'Catálogo y precios'").n, 0, 'refused before writing')
  const result = applyLoadFile(db, confirmed(spec))
  assert.equal(result.warnings.length, 3, 'one warning per area')
  const noActor = propose(rows, team, { purposes }).spec
  assert.throws(() => applyLoadFile(db, confirmed(noActor)), /needs an "actor"/)
  const ghost = confirmed(propose(rows, team, { purposes, actor: 'ana@tienda.example' }).spec)
  ghost.members.push({ email: 'nadie@tienda.example', profile: 'x' })
  assert.throws(() => applyLoadFile(db, ghost), /do not exist|Members that do not exist/)
})

// ---- D7: the document and the scripts say the same
import { readFileSync } from 'node:fs'
import { AXES, KPIS, QUADRANTS } from '../src/execute/judge.js'

const methodDoc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'METODO-DE-REPARTO.md'), 'utf8')
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const decimal = (text) => Number(String(text).replace(/\./g, '').replace(',', '.'))
const camel = (flag) => flag.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())

test('D7: every file the document names exists', () => {
  const named = [...new Set([...methodDoc.matchAll(/`((?:scripts|src|bench|docs|panel)\/[A-Za-z0-9_./-]+\.(?:mjs|js|md|json|jsonl))`/g)].map((m) => m[1]))]
  assert.ok(named.length >= 10, `${named.length} files named`)
  const missing = named.filter((f) => !existsSync(path.join(root, f)))
  assert.deepEqual(missing, [])
})

test('D7: every default in the table of knobs is the one in the code', () => {
  const rowsOfTable = [...methodDoc.matchAll(/^\| `(--[a-z-]+)`(?: \([^)]*\))? \| ([^|]+) \|/gm)].map((m) => [m[1], m[2].trim()])
  assert.ok(rowsOfTable.length >= 16)
  const checked = []
  for (const [flag, value] of rowsOfTable) {
    const key = camel(flag)
    if (!/^[\d.,]+$/.test(value)) continue
    const expected = key === 'minRows' ? method.wilsonSampleSize(DEFAULTS.targetRate, DEFAULTS.halfWidth) : DEFAULTS[key]
    assert.equal(expected, decimal(value), `${flag}: the document says ${value}, the code ${expected}`)
    checked.push(flag)
  }
  assert.ok(checked.length >= 15, checked.join(' '))
  // and every flag of the table is read by a script
  const sources = ['area-method.mjs', 'route-experiment.mjs', 'row-validation.mjs'].map((f) => readFileSync(path.join(root, 'scripts', f), 'utf8')).join('\n')
  for (const [flag] of rowsOfTable) assert.ok(sources.includes(`'${flag}'`) || sources.includes(camel(flag)), `${flag} is in no script`)
})

test('D7: the profile cap of the document is the cap of the product, and propose imposes it', () => {
  assert.equal(method.MEMBER_PROFILE_MAX, loadConfig({ ADMIN_EMAIL: 'a@b.org', ADMIN_PASSWORD: 'una clave larga de prueba 1' }).members.profileMaxLength)
  assert.match(methodDoc, /4\.000 caracteres/)
  const roleOf = (n) => `Soy la dueña. ${'x'.repeat(n)}`
  const big = { ...team, members: team.members.map((m) => (m.kind === 'person' ? { ...m, role: roleOf(3900) } : m)) }
  const { spec } = propose(rows, big, { purposes })
  for (const m of spec.members) assert.ok(m.profile.length <= 4000, `${m.email}: ${m.profile.length}`)
  assert.ok(spec.members.find((m) => m.email === 'ana@tienda.example').profile.startsWith('Soy la dueña. xxx'), 'the role stays and the optional phrases go first')
  const huge = { ...team, members: team.members.map((m, i) => (i === 0 ? { ...m, role: roleOf(5000) } : m)) }
  assert.throws(() => propose(rows, huge, { purposes }), /does not fit in 4000 characters/)
})

test('D7: the axes, the indicators and the goals of the document are the ones of the judge', () => {
  for (const a of AXES) assert.ok(methodDoc.includes(a.name), a.name)
  const lower = methodDoc.toLowerCase()
  for (const k of KPIS) assert.ok(lower.includes(`${k.id} ${k.name.toLowerCase()}`), `${k.id} ${k.name}`)
  const quadrant = { generate: 'Generar', choose: 'Elegir', negotiate: 'Negociar', execute: 'Ejecutar' }
  for (const [id, goals] of Object.entries(QUADRANTS)) {
    const row = methodDoc.match(new RegExp(`^\\| ${quadrant[id]} \\| [^|]+ \\| (\\d) \\| (\\d) \\| (\\d) \\| (\\d) \\|`, 'm'))
    assert.deepEqual(row.slice(1).map(Number), [goals[1], goals[2], goals[3], goals[4]], quadrant[id])
  }
  assert.ok(KPIS.every((k) => k.levels.length === 5), 'five anchors per indicator, as the document says')
})

// ---- Reauditoría B4: no word of a confidential unit in ANY output of the three scripts
test('B4 (reaudit): seeded phrases never appear in an output of analyze, propose, windows, validation or the experiment', async () => {
  const marks = ['zqxA', 'zqxB', 'zqxC', 'zqxD', 'zqxE', 'zqxF']
  let n = 0
  const corpus = rows.map((r, i) => {
    if (i % 5 !== 0) return r // one row in five becomes confidential: enough of them land in every held-out set
    n++
    return { ...r, confidential: true, summary: `${marks[0]} resumen ${n}`, maximize: `${marks[1]} cualidad`, sacrifice: `${marks[2]} resto`, module: `${marks[3]} modulo`, intent: `${marks[4]} intencion`, who: r.who, holder: r.holder }
  })
  const confidentialUnits = new Set(corpus.filter((r) => r.confidential).map((r) => r.unit))
  const clean = (label, value) => { const text = JSON.stringify(value); for (const m of marks) assert.ok(!text.includes(m), `${m} in ${label}`) }
  // all units of a confidential row are confidential: keep the unit whole so that no open row shares its words
  const whole = corpus.map((r) => (confidentialUnits.has(r.unit) && !r.confidential ? { ...r, confidential: true, summary: `${marks[0]} hermano`, maximize: `${marks[1]} cualidad` } : r))
  const result = propose(whole, team, { purposes, actor: 'ana@tienda.example' })
  clean('propose', result)
  clean('analyze', analyze(whole, team, { permutations: 99, repeats: 1 }))
  clean('windows', method.analyzeWindows(whole, team, { permutations: 99, repeats: 1 }))
  clean('labels', method.labels(whole))
  clean('validation sample', validation.drawValidationSample(corpusUnits.map((u) => (confidentialUnits.has(u.id) ? { ...u, confidential: true } : u)), whole, team))
  const echo = { async complete (req) { return { json: { area: 'Catálogo y precios', attends: ['Asistente'], brief: req.messages[0].content } } } }
  const keyed = validation.keyRows(whole)
  const whole2 = await runExperiment(keyed, result.spec, team, { provider: echo, size: 200 })
  clean('experiment on the whole corpus', whole2)
  assert.ok(whole2.sample.confidential_left_out > 0, 'the confidential requests were left out and counted')
  for (const stage of ['tune', 'confirm']) {
    const built = experiment.buildAndSplit(keyed, team, { stage, purposes })
    clean(`buildAndSplit ${stage}`, { load: built.load, skipped: built.skipped, report: built.report })
    const run = await runExperiment(built.test, built.load, team, { provider: echo, size: 100, held: { stage, sets: built.sets } })
    clean(`experiment ${stage}`, run)
    assert.ok(built.test.some((r) => r.confidential), `${stage}: the held-out set has confidential rows, so the test is not empty`)
  }
})

test('B1 (reaudit): a row that does not validate is counted by reason and not lost in silence', async () => {
  const provider = { async complete () { return { json: { requests: [fakeRow('u1'), fakeRow('u9'), fakeRow('u1', { summary: '' }), fakeRow('u1', { severity: 3 }), fakeRow('u1', { value_holder: 'nobody' }), fakeRow('u1', { urgency: -1 })] } } } }
  const result = await extractRows(oneUnit('texto A'), team, { provider, model: 'm' })
  assert.equal(result.rows.length, 1)
  assert.deepEqual(result.dropped, { unknown_unit: 1, no_summary: 1, out_of_range: 2, bad_value_holder: 1 })
  const counter = { n: 0 }
  finishRows([fakeRow('u1', { summary: '' })], [{ id: 'u1' }], team, counter)
  assert.deepEqual(counter.dropped, { no_summary: 1 })
})

test('Reaudit D6: the judge is compared with people, indicator by indicator, with a kappa that weighs a near miss less than a far one', () => {
  const jobs = Array.from({ length: 26 }, (_, i) => i)
  const person = jobs.flatMap((job) => ['1.1', '2.3'].map((id) => ({ job, id, score: ((job + (id === '2.3' ? 2 : 0)) % 5) - 2 })))
  const same = validation.judgeAgreement(person, person)
  assert.equal(same.indicators['1.1'].kappa, 1)
  assert.equal(same.indicators['1.1'].within_one, 1)
  const near = person.map((l) => ({ ...l, score: Math.max(-2, Math.min(2, l.score + (l.job % 2 ? 1 : 0))) }))
  const far = person.map((l) => ({ ...l, score: -l.score }))
  const kNear = validation.judgeAgreement(person, near).indicators['1.1'].kappa
  const kFar = validation.judgeAgreement(person, far).indicators['1.1'].kappa
  assert.ok(kNear > 0.6 && kNear < 1, `a judge that is one point off in half of the jobs: ${kNear}`)
  assert.ok(kFar < kNear, 'a judge that inverts the scale is worse')
  assert.ok(validation.judgeAgreement(person.slice(0, 40), person.slice(2)).unpaired > 0, 'a score that only one of them gave is counted and left out')
})

test('Reaudit D7: AC1 is printed next to kappa and does not fall when one category is almost all', () => {
  const pair = (a, b, n) => Array.from({ length: n }, () => ({ a, b, w: 1 }))
  const rare = [...pair('n', 'n', 90), ...pair('y', 'y', 2), ...pair('y', 'n', 4), ...pair('n', 'y', 4)] // 92 % agreement, the category y is rare
  const kappa = validation.weightedKappa(rare).kappa
  const ac1 = validation.weightedAC1(rare)
  assert.ok(kappa < 0.35, `kappa ${kappa}: the prevalence drags it down`)
  assert.ok(ac1 > 0.85, `AC1 ${ac1}: the agreement is high and it says so`)
  assert.equal(validation.weightedAC1(pair('y', 'y', 5)), 1)
  const items = rare.map((p, i) => ({ ...p, unit: `u${i}`, stratum: 'all' }))
  assert.equal(typeof validation.kappaWithInterval(items, { resamples: 50 }).ac1, 'number')
})

// ---- Reauditoría D8: the extraction does not trust a half-written file, a repeated id or a partial result
test('Reaudit D8: a cache file that a cut left half written is read as absent and the batch is asked again', async () => {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'area-method-cut-'))
  const counter = { calls: 0 }
  await extractRows(oneUnit('texto A'), team, { provider: answering('resumen A', counter), model: 'm', cacheDir: dir })
  const file = path.join(dir, readdirSync(dir)[0])
  writeFileSync(file, '[{"unit":"u1","summ') // the cut
  const again = await extractRows(oneUnit('texto A'), team, { provider: answering('resumen A', counter), model: 'm', cacheDir: dir })
  assert.equal(counter.calls, 2)
  assert.equal(again.rows[0].summary, 'resumen A')
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'a file is written whole and renamed: no half file stays')
  assert.doesNotThrow(() => JSON.parse(readFileSync(file, 'utf8')))
})

test('Reaudit D8: two units with the same id are refused', () => {
  assert.throws(() => extraction.validateUnits([{ id: 'a', confidential: false }, { id: 'b', confidential: false }, { id: 'a', confidential: true }]), /unique.*a/)
})

test('Reaudit D8: a provider from a module, so that a team with an API of its own can use the method', async () => {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'area-method-provider-'))
  const file = path.join(dir, 'provider.mjs')
  writeFileSync(file, "export default (model) => ({ model, async complete () { return { json: { requests: [] } } } })\n")
  const provider = await extraction.loadProvider(file, 'mi-modelo')
  assert.equal(provider.model, 'mi-modelo')
  assert.deepEqual((await provider.complete({})).json, { requests: [] })
  const broken = path.join(dir, 'broken.mjs')
  writeFileSync(broken, 'export default { nothing: true }\n')
  await assert.rejects(extraction.loadProvider(broken, 'm'), /must export a provider/)
})

// ---- Reauditoría, minor findings
test('Reaudit M1: an area that would merge into one that is not kept is announced', () => {
  // the real area «Catálogo y precios» written in two ways: each half is too small and merges into the other
  const split = rows.map((r) => (r.object === 'catálogo y precios' && r.unit.charCodeAt(r.unit.length - 1) % 2 ? { ...r, object: 'precios y catálogo' } : r))
  const report = analyze(split, team, { permutations: 99, repeats: 1 })
  const warning = report.warnings.find((w) => w.kind === 'merge_target_not_kept')
  assert.ok(warning, JSON.stringify(report.warnings))
  assert.ok(warning.areas.some((a) => /atálogo|recios/.test(a.area)))
  assert.equal(analyze(rows, team).warnings.some((w) => w.kind === 'merge_target_not_kept'), false)
})

test('Reaudit M4 and M6: a profile names one quality, and the positions have no holes when an area is left out', () => {
  const { spec, skipped } = propose(rows, team, { purposes })
  assert.ok(skipped.length >= 1)
  assert.deepEqual(spec.areas.map((a) => a.position), spec.areas.map((_, i) => i + 1))
  for (const m of spec.members) { const maximize = m.profile.match(/Maximizo: ([^.]*)\./)?.[1]; if (maximize) assert.ok(!maximize.includes(';'), `${m.email}: ${maximize}`) }
})

test('Reaudit M7: the p-values of a pair do not change when another area is added', () => {
  const two = syntheticCorpus({ sizes: { A: 40, B: 40 }, noise: 0.5, seed: 61 })
  const three = [...syntheticCorpus({ sizes: { Z: 40 }, noise: 0.5, seed: 62 }).map((r) => ({ ...r, unit: `z${r.unit}` })), ...two] // the new area comes first, so its pairs are tested first
  const pOf = (list) => analyze(list, team, { holdout: 0, minRows: 3, permutations: 99, repeats: 1 }).areas.find((a) => a.title === 'A').criteria.distinct_treatment.against.B.dimensions
  assert.deepEqual(pOf(two), pOf(three))
})

test('Reaudit M3: the loader needs a confirmation by an active person and reports what it overwrites', async () => {
  const db = await freshDatabase('confirmer')
  const { spec } = propose(rows, team, { purposes, actor: 'ana@tienda.example' })
  const noBody = confirmed(spec)
  delete noBody.areas[0].confirmed_by
  assert.throws(() => applyLoadFile(db, noBody), /confirmed_by/)
  const robot = confirmed(spec)
  robot.areas[0].confirmed_by = 'asistente@tienda.example'
  assert.throws(() => applyLoadFile(db, robot), /active person/, 'an agent does not confirm')
  applyLoadFile(db, confirmed(spec))
  const edited = confirmed(spec)
  edited.areas[0].description = `${edited.areas[0].description} Otra frase.`
  edited.members[0].profile = `${edited.members[0].profile} Y esto.`
  const result = applyLoadFile(db, edited)
  assert.deepEqual(result.changes.map((c) => [c.kind, c.fields.join()]), [['area', 'description'], ['member', 'profile']])
})

// ---- Reauditoría de coherencia: B5, C2, I4, I7
test('Coherence B5: the template says what the product does with a limit of a person, and never tells the session to stop', () => {
  const { spec } = propose(rows, team, { purposes })
  const templates = spec.areas.flatMap((a) => a.templates)
  assert.ok(templates.length >= 3)
  for (const t of templates) {
    assert.ok(!/Se detiene|Para y consulta|se detiene/.test(t.body_markdown), t.name)
    assert.match(t.body_markdown, /deja el trabajo en la rama; la entrega espera a una persona: mover dinero o fijar un precio y lo que no se deshace/)
    assert.match(t.body_markdown, /nombra el límite y el riesgo, propone una alternativa/)
  }
})

test('Coherence C2: «se maximiza» and «se sacrifica» are written the same way in the description and in the template', () => {
  const { spec } = propose(rows, team, { purposes })
  for (const a of spec.areas) {
    assert.match(a.description, /Se maximiza: /)
    assert.match(a.description, /Se sacrifica: /)
    for (const t of a.templates) {
      assert.ok(!/Se cuida|Puede quedar apenas suficiente|Maximiza:|Acepta:/.test(t.body_markdown), `${a.title} / ${t.name}`)
      assert.match(t.body_markdown, /Se maximiza: /)
      assert.match(t.body_markdown, /Se sacrifica: /)
    }
  }
})

test('Coherence I4: the limits of a person head the list of an area even if its requests rarely touch them', () => {
  const rare = rows.map((r) => ({ ...r, limits: r.limits.filter((l) => l !== 'money') })) // nobody touches money in the corpus
  const { spec } = propose(rare, team, { purposes })
  for (const a of spec.areas) assert.match(a.description, /Límites: mover dinero o fijar un precio \(lo levanta una persona\); lo que no se deshace \(lo levanta una persona\)/, a.title)
})

test('Coherence I7: an area needs a quality to maximize and something to sacrifice, from the corpus or from the team', () => {
  const silent = rows.map((r) => ({ ...r, maximize: '', sacrifice: '' }))
  assert.throws(() => propose(silent, team, { purposes }), /a quality to maximize[\s\S]*purposes.json as "maximize"/)
  const written = Object.fromEntries(Object.entries(purposes).map(([k, v]) => [k, { ...v, maximize: 'que cada cosa quede exacta', sacrifice: 'la rapidez' }]))
  const { spec } = propose(silent, team, { purposes: written })
  for (const a of spec.areas) assert.match(a.description, /Se maximiza: que cada cosa quede exacta\. Se sacrifica: la rapidez\./)
  const broken = structuredClone(propose(rows, team, { purposes }).spec)
  broken.areas[0].description = broken.areas[0].description.replace('Se sacrifica: ', 'Algo: ')
  assert.throws(() => validateLoadFile(broken), /Se sacrifica/)
})

// ---- Reauditoría de coherencia C11: the limits of the light model come from a script, with the criterion of the measurement
const lightLimits = await import('./light-limits.mjs')
test('Coherence C11: the limits of the light model are the middle value between what it closed and what it did not, and only with enough jobs and ranges that do not cross', () => {
  const job = (closed, create, irreversibility, certainty) => ({ job: `j${Math.random()}`, closed, understand_vs_create: create, irreversibility, certainty })
  const closed = Array.from({ length: 12 }, (_, i) => job(true, 0.1 + i * 0.03, 0.1 + i * 0.02, 0.9 - i * 0.01)) // closed up to 0.43 / 0.32; certainty from 0.79
  const failed = Array.from({ length: 10 }, (_, i) => job(false, 0.65 + i * 0.03, 0.55 + i * 0.03, 0.55 - i * 0.02)) // failed from 0.65 / 0.55; certainty up to 0.55
  const result = lightLimits.deriveLightLimits([...closed, ...failed])
  assert.equal(result.limits.create, 0.54, '(0.43 + 0.65) / 2')
  assert.equal(result.limits.irreversibility, 0.44, '(0.32 + 0.55) / 2 = 0.435')
  assert.equal(result.limits.certainty, 0.67, '(0.79 + 0.55) / 2')
  assert.equal(lightLimits.asVariable(result.limits), 'create=0.54 irreversibility=0.44 certainty=0.67')
  const few = lightLimits.deriveLightLimits([...closed.slice(0, 5), ...failed.slice(0, 5)])
  assert.deepEqual(few.limits, { create: 1, irreversibility: 1, certainty: 0 }, 'ten jobs: the origin values stay')
  assert.match(few.detail.create.reason, /10 judged jobs, 20 needed/)
  const crossed = lightLimits.deriveLightLimits([...closed, ...failed, job(true, 0.8, 0.1, 0.9), job(false, 0.2, 0.1, 0.9)])
  assert.equal(crossed.limits.create, 1)
  assert.match(crossed.detail.create.reason, /the ranges cross/)
  assert.equal(crossed.detail.irreversibility.fixed, false, 'it also crosses: 0.1 failed against 0.32 closed')
  assert.equal(lightLimits.deriveLightLimits(closed.concat(closed)).detail.create.fixed, false, 'every job closed: nothing to separate')
})

test('Coherence: the description of the project is loaded when the team has confirmed it, once, and the cap is the product\'s', async () => {
  assert.equal(method.PROJECT_DESCRIPTION_MAX, loadConfig({ ADMIN_EMAIL: 'a@b.org', ADMIN_PASSWORD: 'una clave larga de prueba 1' }).project.descriptionMaxChars)
  const db = await freshDatabase('project')
  const { spec } = propose(rows, team, { purposes, actor: 'ana@tienda.example' })
  const withProject = { ...confirmed(spec), project: { description: 'Propósito: una tienda de repuestos que despacha sin errores. Se maximiza: el pedido exacto. Se sacrifica: la velocidad de publicación.', confirmed: true, confirmed_by: 'ana@tienda.example' } }
  const first = applyLoadFile(db, withProject)
  assert.equal(first.updated.project, 1)
  assert.equal(getProjectDescription(db), withProject.project.description)
  assert.ok(get(db, "SELECT 1 AS ok FROM audit_log WHERE action = 'settings.project.update'"))
  const second = applyLoadFile(db, withProject)
  assert.equal(second.unchanged.project, 1)
  assert.equal(second.updated.project ?? 0, 0)
  assert.throws(() => applyLoadFile(db, { ...withProject, project: { ...withProject.project, confirmed: false } }), /not confirmed the description/)
  assert.throws(() => validateLoadFile({ ...withProject, project: { description: '', confirmed: true } }), /needs a description/)
  assert.throws(() => validateLoadFile({ ...withProject, project: { description: 'x'.repeat(method.PROJECT_DESCRIPTION_MAX + 1), confirmed: true } }), /limit is/)
})

test('Coherence: the anchors are printed from the judge and the example of the document is what propose writes', async () => {
  const { anchorsMarkdown } = await import('./anchors.mjs')
  const all = anchorsMarkdown()
  for (const k of KPIS) { assert.ok(all.includes(`**${k.id} ${k.name}.**`)); for (const level of k.levels) assert.ok(all.includes(level), `${k.id}: ${level}`) }
  assert.ok(!anchorsMarkdown('2.3').includes('1.1'))
  const area = propose(rows, team, { purposes }).spec.areas.find((a) => a.title === 'Catálogo y precios')
  assert.ok(methodDoc.includes(area.description), 'the description in section 14 is the one propose writes for the invented corpus')
  assert.ok(methodDoc.includes(`(${area.description.length} caracteres)`))
  for (const candidate of area.candidates.maximize) assert.ok(methodDoc.includes(`«${candidate}»`), candidate)
})
