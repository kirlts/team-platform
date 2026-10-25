// C1. When a session starts the thread says «Claude empezó a trabajar» with the hour; when the job waits it says «En espera» with the reason.
// Measured 2026-10-25: messages waited with no sign in the thread because a fixed reservation of the day's budget held them.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo, ORDEN, until } from './ciclo.mjs'

describe('C1 aviso de inicio y de espera', () => {
  let c
  before(async () => { c = await iniciarCiclo({ execute: { deliverCommand: ORDEN.pasa } }) })
  after(async () => { await c.cerrar() })

  it('al arrancar la sesión el hilo dice «Claude empezó a trabajar» con la hora', async () => {
    c.iniciar()
    const sentAt = Date.now()
    const id = await c.enviar('La pantalla de agenda queda en blanco.')
    await c.esperar(id)
    const hilo = await c.hilo(id)
    const start = hilo.progress_notes.filter((n) => n.body === 'Claude empezó a trabajar')
    assert.equal(start.length, 1, JSON.stringify(hilo.progress_notes))
    const at = Date.parse(start[0].created_at)
    assert.ok(at >= sentAt - 1000 && at <= Date.now(), `la hora de inicio es de esta sesión: ${start[0].created_at}`)
    await c.detener()
  })

  it('un trabajo que espera dice «En espera» con el motivo, y al arrancar lo cierra y dice cuánto esperó', async () => {
    // 3 USD a day and 2 USD held by each session: the second session cannot start while the first one runs.
    process.env.FAKE_EXECUTE_SLEEP_MS = '1500'
    c.iniciar({ dailyBudgetUsd: 3, sessionReserveUsd: 2, deliverCommand: '' })
    const ids = await Promise.all([c.enviar('La ficha del paciente corta el nombre.'), c.enviar('El botón de reservas no responde en el teléfono.')])
    // While the first session works, the thread of the other one says why it waits.
    const waiting = await until(async () => {
      for (const id of ids) {
        const note = (await c.hilo(id)).progress_notes.find((n) => /^En espera/.test(n.body))
        if (note) return { id, note }
      }
      return null
    }, { timeoutMs: 15000 })
    assert.match(waiting.note.body, /^En espera: /)
    assert.match(waiting.note.body, /Motivo: las sesiones en curso tienen reservado el gasto que queda hoy\./)
    await Promise.all(ids.map((id) => c.esperar(id)))
    const notes = (await c.hilo(waiting.id)).progress_notes.map((n) => n.body)
    assert.ok(notes.some((n) => /^Estuvo en espera \d+ min$/.test(n)), `cuánto esperó: ${JSON.stringify(notes)}`)
    assert.ok(notes.includes('Claude empezó a trabajar'), 'y después empezó')
    assert.ok(!notes.some((n) => /^En espera/.test(n)), 'la fila de espera no queda diciendo «En espera» cuando ya trabajó')
    for (const id of ids) assert.ok((await c.respuestasDeClaude(id)).length >= 1, 'los dos mensajes terminaron respondidos')
  })
})
