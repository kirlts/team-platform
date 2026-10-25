// C14. Claude can close a message when that is right: the session asks (`close`), the system decides with its own conditions and the model cannot override them.
// Martín, 2026-10-24 15:39.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo, ORDEN, until } from './ciclo.mjs'

describe('C14 Claude cierra un mensaje cuando corresponde', () => {
  let c
  before(async () => { c = await iniciarCiclo(); c.iniciar({ deliverCommand: ORDEN.pasa }) })
  after(async () => { await c.cerrar() })
  const extra = (o) => { process.env.FAKE_EXECUTE_EXTRA = JSON.stringify(o) }

  it('una revisión que no necesita cambio y no deja nada al emisor cierra el mensaje, con «Cerrado: …» en la respuesta', async () => {
    extra({ outcome: 'investigated', close: true, close_reason: 'la agenda ya carga bien, no había nada que cambiar' })
    const id = await c.enviar('La pantalla de agenda queda en blanco.')
    await c.esperar(id)
    assert.equal(c.estado(id), 'closed')
    assert.match((await c.ultimaDeClaude(id)).body, /Cerrado: la agenda ya carga bien, no había nada que cambiar$/)
    assert.deepEqual(c.trabajos(id, 'deliver'), [])
  })

  it('un cambio cierra el mensaje sólo cuando la entrega llegó a producción', async () => {
    extra({ outcome: 'done', close: true, close_reason: 'el cambio está en producción y comprobado' })
    const id = await c.enviar('El botón de reservas no responde en el teléfono.')
    await c.esperar(id)
    assert.equal(c.estado(id), 'closed')
    const final = await c.ultimaDeClaude(id)
    assert.match(final.body, /En producción desde[\s\S]*Cerrado: el cambio está en producción y comprobado$/)
  })

  it('una entrega que falla no cierra el mensaje aunque la sesión lo pida', async () => {
    await c.detener()
    c.iniciar({ deliverCommand: ORDEN.fallaPrueba(), deliverRetries: 0 })
    extra({ outcome: 'done', close: true, close_reason: 'listo' })
    const id = await c.enviar('La ficha del paciente corta el nombre.')
    await c.esperar(id)
    assert.notEqual(c.estado(id), 'closed')
    await c.detener()
    c.iniciar({ deliverCommand: ORDEN.pasa })
  })

  it('si una persona respondió después de la primera respuesta de Claude, el mensaje no se cierra solo', async () => {
    process.env.FAKE_EXECUTE_SLEEP_MS = '1200'
    extra({ outcome: 'investigated', close: true, close_reason: 'no había nada que cambiar' })
    const id = await c.enviar('La ficha del paciente corta el apellido.')
    await until(async () => (await c.respuestasDeClaude(id)).length >= 1, { timeoutMs: 15000 })
    const res = await c.post(`/api/messages/${id}/replies`, c.editor, { body: 'Espera, falta mirar la sede de Viña.' })
    assert.equal(res.statusCode, 201, res.body)
    await c.esperar(id)
    assert.notEqual(c.estado(id), 'closed', 'a person is in the conversation')
    assert.ok(!/Cerrado:/.test((await c.ultimaDeClaude(id)).body))
    delete process.env.FAKE_EXECUTE_SLEEP_MS
  })

  it('un cambio de pantalla sin captura no se cierra solo: lo lee una persona', async () => {
    extra({ outcome: 'investigated', close: true, close_reason: 'listo', touches_screen: true })
    const id = await c.enviar('La ficha de sedes mezcla tamaños de letra.')
    await c.esperar(id)
    assert.notEqual(c.estado(id), 'closed')
  })

  it('con close en falso o sin motivo el mensaje queda respondido', async () => {
    extra({ outcome: 'investigated', close: false, close_reason: 'duda' })
    const a = await c.enviar('El texto del correo de confirmación tiene un error.')
    await c.esperar(a)
    assert.equal(c.estado(a), 'answered')
    extra({ outcome: 'investigated', close: true })
    const b = await c.enviar('El correo de recordatorio sale dos veces.')
    await c.esperar(b)
    assert.equal(c.estado(b), 'answered')
  })
})
