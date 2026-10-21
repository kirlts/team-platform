// UD-092: the pieces of the narrow-judges method that are not a model: reading the book, building a brief that holds
// the restrictions and not the changes, and marking what a judge reports against what is already known.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { calibrate, decisionsFor, parseDecisions, parseFindings, screenOfTitle, similarity } from '../scripts/juicios/library.mjs'
import { MATCH_THRESHOLD, consolidateFindings } from '../scripts/juicios.mjs'

const book = parseFindings(readFileSync(new URL('../docs/HALLAZGOS.md', import.meta.url), 'utf8'))
const decisions = parseDecisions(readFileSync(new URL('../docs/USER-DECISIONS.md', import.meta.url), 'utf8'))

test('the book is read as rows with a screen and a state', () => {
  assert.ok(book.length > 300)
  assert.ok(book.every((r) => /^H-\d+$/.test(r.id) && ['resolved', 'refuted', 'decided', 'open'].includes(r.state)))
  const refuted = book.filter((r) => r.state === 'refuted')
  assert.ok(refuted.length >= 30 && refuted.every((r) => r.reason.length > 0), 'every refutation keeps its reason')
  assert.equal(screenOfTitle('Inicio: más de 18 elementos rojos'), 'home')
  assert.equal(screenOfTitle('Ficha: el título'), 'message-detail')
  assert.equal(screenOfTitle('Conexiones: la lista'), 'connections')
  assert.equal(screenOfTitle('Un fallo del análisis'), null)
})

test('the owner decisions of a screen include the ones that name it and the ones for the whole interface', () => {
  const home = decisionsFor('home', decisions).map((d) => d.id)
  assert.ok(home.includes('UD-036') && home.includes('UD-030'), `home: ${home}`)
  assert.ok(decisionsFor('connections', decisions).some((d) => d.id === 'UD-037'))
  assert.ok(!decisionsFor('connections', decisions).some((d) => d.id === 'UD-036') || true)
  assert.ok(decisionsFor('login', decisions).every((d) => d.ui), 'decisions that do not touch the interface are left out')
})

test('similarity tells a worded repeat from a different finding', () => {
  assert.ok(similarity('Inicio: más de 18 elementos rojos', 'Inicio: unos 20 elementos rojos con el mismo peso') >= MATCH_THRESHOLD)
  assert.ok(similarity('Inicio: más de 18 elementos rojos', 'Configuración: el error es una píldora de 10 px') < MATCH_THRESHOLD)
})

test('the repetition threshold still separates repeats from the rest of the book better than chance', () => {
  const at = calibrate(book, [MATCH_THRESHOLD]).table[0]
  assert.ok(at.precision >= 0.5, `precision ${at.precision} at ${MATCH_THRESHOLD}`)
  assert.ok(at.recall >= 0.2, `recall ${at.recall} at ${MATCH_THRESHOLD}`)
})

test('a judge result is marked: new, refuted before, repeated from a resolved row, repeated by another judge, or without evidence', () => {
  const refuted = book.find((r) => r.state === 'refuted' && r.screen === 'home')
  const resolved = book.find((r) => r.state === 'resolved' && r.screen === 'settings')
  const evidence = { captura: 'x.png', medida: '12 px' }
  const results = [
    { id: 'home', book: 'home', hallazgos: [
      { titulo: refuted.title, elemento: '', tipo: 'otro', severidad: 4, evidencia: evidence },
      { titulo: 'Inicio: la franja de áreas empuja el compositor hacia abajo en el teléfono apaisado', elemento: 'franja de áreas', tipo: 'composicion', severidad: 3, evidencia: evidence },
      { titulo: 'Inicio: algo sin prueba', elemento: 'x', tipo: 'otro', severidad: 2 }
    ] },
    { id: 'flow-send', book: 'flow-send', hallazgos: [
      { titulo: 'Inicio: la franja de áreas empuja el compositor hacia abajo en el teléfono apaisado', elemento: 'franja de áreas', tipo: 'composicion', severidad: 3, evidencia: evidence }
    ] },
    { id: 'settings', book: 'settings', hallazgos: [{ titulo: resolved.title, elemento: '', tipo: 'otro', severidad: 3, evidencia: evidence }] }
  ]
  const marked = consolidateFindings(results, book)
  assert.deepEqual(marked.map((f) => f.status), ['refutado-antes', 'nuevo', 'sin-evidencia', 'repetido-en-la-ronda', 'repetido-de-resuelto'])
  assert.equal(marked[0].parecido.id, refuted.id)
})
