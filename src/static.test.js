// Static prohibitions of the core (docs/TEST.md): what cannot be written in this code. Each one cites
// the restriction it protects.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { lex } from './testing/lex.js'
import { englishIn, englishInPanel, spanishComments, spanishIn, spanishNamesAndLogs } from './testing/language.js'

const src = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(src, '..')
// The modules of other agents (analyze, extract, providers, telemetry) are verified in their own suites.
const OWN = ['config.js', 'server.js', 'worker.js', 'log.js', 'db', 'queue', 'api', 'events', 'identity', 'domain', 'testing']

function listFiles (roots = OWN) {
  const found = []
  const walk = (p) => {
    if (statSync(p).isDirectory()) readdirSync(p).forEach((f) => walk(path.join(p, f)))
    else if (/\.(m?js)$/.test(p)) found.push(p)
  }
  roots.forEach((r) => walk(path.join(src, r)))
  // The core tests live next to their code and in the root of src.
  readdirSync(src).filter((f) => f.endsWith('.test.js')).forEach((f) => found.push(path.join(src, f)))
  return [...new Set(found)]
}

const isTest = (f) => f.endsWith('.test.js') || f.includes(`${path.sep}testing${path.sep}`)

test('HP-008 · code identifiers are in English (UD-005, §4.7)', () => {
  // Spanish words that were once used as identifiers and renamed; they act as a net against recurrence.
  const spanish = new Set(`miembro miembros trabajo trabajos adjunto adjuntos mensaje mensajes plantilla plantillas propuesta respuesta respuestas
    archivo archivos ruta rutas cola estado valor texto correo clave sesion sesiones fila filas nombre cuerpo campo campos limite limites salida
    entrada entorno servidor equipo usuario intento intentos paso pasos resultado resultados sistema sitio origen destino contexto contenido
    tamano linea lineas lista mapa modulo modulos opcion opciones orden pagina parche perfil razon registro reloj retorno segundos siguiente
    trozo vista vistas vigente vencidos ultimo ultima temporal todos nuevo nueva viejo vieja otro otra ahora antes hasta donde sin dos tres
    abrir cerrar crear borrar enviar recibir buscar guardar leer escribir esperar reclamado latido arriendo cupo presupuesto copia gancho firma`.split(/\s+/))
  const bad = []
  for (const f of listFiles()) {
    for (const t of lex(readFileSync(f, 'utf8'))) {
      if (t.type !== 'ident') continue
      if (/[^\x00-\x7F]/.test(t.value) || spanish.has(t.value.toLowerCase())) bad.push(`${path.relative(root, f)}: ${t.value}`)
    }
  }
  assert.deepEqual([...new Set(bad)], [])
})

test('HP-003 · no code decides with the text a person writes (§1.2, §4.2)', () => {
  const humanText = new Set(['text', 'body', 'title', 'message', 'description', 'responsibilities', 'domains', 'reply'])
  const methods = new Set(['test', 'match', 'matchAll', 'includes', 'startsWith', 'endsWith', 'search', 'indexOf', 'localeCompare'])
  const findings = []
  for (const f of listFiles(['domain', 'api', 'identity', 'queue', 'events']).filter((x) => !isTest(x))) {
    const tokens = lex(readFileSync(f, 'utf8')).filter((t) => t.type !== 'comment')
    tokens.forEach((t, i) => {
      if (t.type === 'ident' && humanText.has(t.value) && tokens[i + 1]?.value === '.' && methods.has(tokens[i + 2]?.value) && tokens[i + 3]?.value === '(') {
        findings.push(`${path.relative(root, f)}: ${t.value}.${tokens[i + 2].value}(`)
      }
    })
  }
  assert.deepEqual(findings, [])
})

test('HP-005 · messages are only born from publishing a confirmed proposal (§4.4, UD-003)', () => {
  const inserters = listFiles().filter((f) => !isTest(f) && /INSERT INTO messages\b/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(src, f))
  assert.deepEqual(inserters, [path.join('domain', 'proposals.js')])
})

test('HP-007 · no schema column stores a key or a secret in plain text (§4.6)', () => {
  const sql = readdirSync(path.join(src, 'db', 'migrations')).map((f) => readFileSync(path.join(src, 'db', 'migrations', f), 'utf8')).join('\n')
  const columns = [...sql.matchAll(/^\s{2}([a-z_]+)\s+(?:TEXT|INTEGER|REAL)\b/gm)].map((m) => m[1])
  assert.ok(columns.length > 80)
  const suspicious = columns.filter((c) => /(api_?key|secret|passphrase|private)/i.test(c) || (/token/i.test(c) && !/_tokens$/.test(c)) || (/password/i.test(c) && c !== 'password_hash'))
  assert.deepEqual(suspicious, [])
})

test('HP-011 · every production dependency has a license compatible with MIT (§4.10, UD-004)', () => {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const allowed = /^(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|BlueOak-1\.0\.0|Python-2\.0|PSF-2\.0|Zlib|CC0-1\.0|Unlicense|MIT-0)$/
  // Declared exception: `sharp` (extractors) ships libvips as optional per-platform binaries, with license
  // LGPL-3.0-or-later. It is linked dynamically and can be replaced with another libvips; the decision to keep it or
  // to change the image library belongs to whoever owns the extractors and to Martín (UD-004). See the final report.
  const EXCEPTIONS = [/^node_modules\/@img\/sharp-/]
  const incompatible = []
  let reviewed = 0
  for (const [location, p] of Object.entries(lock.packages)) {
    if (!location || p.dev || (p.optional && p.devOptional)) continue
    if (EXCEPTIONS.some((e) => e.test(location))) continue
    reviewed++
    // «A OR B» holds if some alternative is compatible; «A AND B» requires all of them.
    const license = String(p.license ?? '').replace(/[()]/g, '')
    const isCompatible = license !== '' && license.split(/\s+OR\s+/).some((alt) => alt.split(/\s+AND\s+/).every((l) => allowed.test(l.trim())))
    if (!isCompatible) incompatible.push(`${location}: ${p.license ?? 'no license declared'}`)
  }
  assert.ok(reviewed > 50)
  assert.deepEqual(incompatible, [])
})

test('HP-006 · one container and one volume are enough: compose.yml declares a single service (§4.5)', () => {
  const compose = readFileSync(path.join(root, 'compose.yml'), 'utf8').split('\n')
  const startAt = compose.findIndex((l) => /^services:\s*$/.test(l))
  assert.ok(startAt >= 0)
  const services = []
  for (const line of compose.slice(startAt + 1)) {
    if (/^\S/.test(line) && !/^\s*#/.test(line)) break // another top-level key (volumes:)
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (m) services.push(m[1])
  }
  assert.deepEqual(services, ['team-platform'])
})

// UD-015: the code is written in English (comments, test names, log messages) and what a person sees in the panel in Spanish.
const describeHits = (list) => list.map((b) => `${b.file}:${b.line} ${b.words}`)

test('HP-008 · code comments are written in English (UD-015, §4.7)', () => {
  assert.deepEqual(describeHits(spanishComments()), [])
})

test('HP-008 · test names and log messages are written in English (UD-015, §4.7)', () => {
  assert.deepEqual(describeHits(spanishNamesAndLogs()), [])
})

test('HP-008 · visible panel text is written in Spanish (UD-015, §4.7)', () => {
  assert.deepEqual(describeHits(englishInPanel()), [])
})

test('HP-008 · the language detectors flag what they must and nothing else', () => {
  // Spanish function words and accents are flagged; quoted text, backticks and identifiers are not.
  assert.deepEqual(spanishIn('the queue is claimed with a lease'), [])
  assert.deepEqual(spanishIn('the job is claimed por the worker'), ['por'])
  assert.deepEqual(spanishIn('El valor para el campo'), ['para'])
  assert.deepEqual(spanishIn('lists the «campos que faltan» and `sin valor` as written'), [])
  assert.deepEqual(spanishIn('listaDeCosas stays an identifier'), [])
  assert.deepEqual(spanishIn('conexión closed'), ['conexión'])
  assert.deepEqual(englishIn('Guardar los cambios'), [])
  assert.deepEqual(englishIn('Save the changes for you'), ['the', 'for', 'you'])
})
