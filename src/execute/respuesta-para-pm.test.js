// UD-276: the reply of the thread is the summary and the lines of the system; the technical output is kept apart.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { clockTime, deliveredBody, heldBody } from './deliver.js'
import { detailEntries, replyBody, failureBody } from './handler.js'

// The shape of the closing output that gave the reply of message 115 its blocks (2026-10-24).
const template = { output: [
  { name: 'zone', label: 'Zona tocada' }, { name: 'cause', label: 'Causa' }, { name: 'fix', label: 'Arreglo' },
  { name: 'verification', label: 'Verificación' }, { name: 'branch', label: 'Rama' }, { name: 'files', label: 'Archivos tocados' }
] }
const output = {
  outcome: 'investigated', zone: 'ninguna', cause: 'Capacidad nueva: PanelDeFotos sube por JSON base64, tope 20 MB.', fix: 'Ninguno',
  verification: 'cd plataforma/panel-clinica && npx vitest run src/pages/equipo.render.test.tsx: 22 pruebas pasan', branch: 'tp/103',
  files: ['plataforma/panel-clinica/src/pages/equipo.tsx', 'plataforma/src/routes/fotos.js'],
  summary: 'Hoy las fotos se suben solo desde el panel.\n\nSumar la subida desde la ficha es posible y queda a su decisión.'
}
const TECHNICAL = /\*\*(Resultado|Zona tocada|Causa|Arreglo|Verificación|Rama|Archivos tocados|Entrega)\*\*|```|tp\/103|PanelDeFotos|npx vitest|equipo\.tsx|investigated/

describe('the reply is for a person, not for the log', () => {
  it('replyBody is the summary', () => {
    assert.equal(replyBody(output), output.summary)
  })

  it('a delivery in green: the summary, the production note and the lines of the system', () => {
    const body = deliveredBody({ output: { ...output, outcome: 'done' }, template, ref: 'abc1234', language: 'es-419', at: Date.UTC(2026, 9, 25, 14, 28), lines: ['**Antes**: Ficha. Equipo > Ficha, Clínica Sur, doctor.', 'Cerrado: Ya está en producción y no queda nada por revisar.'] })
    assert.doesNotMatch(body, TECHNICAL)
    assert.equal(body, `Hoy las fotos se suben solo desde el panel.\n\nSumar la subida desde la ficha es posible y queda a su decisión. En producción desde ${clockTime(Date.UTC(2026, 9, 25, 14, 28))}.\n\n**Antes**: Ficha. Equipo > Ficha, Clínica Sur, doctor.\n\nCerrado: Ya está en producción y no queda nada por revisar.`)
  })

  it('a held delivery: the summary and the reason, no field and no outcome', () => {
    const body = heldBody({ output: { ...output, outcome: 'done' }, template, reason: 'el cambio toca pagos.', language: 'es-419' })
    assert.doesNotMatch(body, TECHNICAL)
    assert.equal(body, 'Hoy las fotos se suben solo desde el panel.\n\nSumar la subida desde la ficha es posible y queda a su decisión.\n\nCambio listo para revisar: el cambio toca pagos. Todavía no llega a producción.')
  })

  it('a failure notice carries no «Resultado»', () => {
    assert.doesNotMatch(failureBody({ code: 'execute_budget' }, 'es-419'), /Resultado|blocked/)
  })

  it('the technical part is kept with the template labels, lists as lines, and without what the system reads', () => {
    const entries = detailEntries({ ...output, captures: [{ path: 'a.png' }], close: true, close_reason: 'x', mode: 'investigate', decision_check: { a: 1 }, attachments: [], empty: '' }, template)
    assert.deepEqual(entries.map(([label]) => label), ['Resultado', 'Zona tocada', 'Causa', 'Arreglo', 'Verificación', 'Rama', 'Archivos tocados'])
    assert.equal(entries.find(([label]) => label === 'Archivos tocados')[1], 'plataforma/panel-clinica/src/pages/equipo.tsx\nplataforma/src/routes/fotos.js')
    assert.equal(entries.find(([label]) => label === 'Rama')[1], 'tp/103')
  })
})
