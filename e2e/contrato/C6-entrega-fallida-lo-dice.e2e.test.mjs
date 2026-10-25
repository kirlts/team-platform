// C6. Each failed delivery says so in the thread with the test that fell, and «Reintentar» is offered only when something can be retried.
// Measured 2026-10-25: deliveries failed in silence, and one failed because its script did not exist (exit 127).
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo, ORDEN } from './ciclo.mjs'

describe('C6 cada entrega fallida lo dice en el hilo', () => {
  process.env.LC_ALL = 'C' // the shell names the missing script in the language of the machine; the suite reads it in one
  let c
  before(async () => { c = await iniciarCiclo() })
  after(async () => { await c.cerrar() })
  const reset = async () => { await c.detener(); c.env.db.prepare("DELETE FROM jobs WHERE kind IN ('execute', 'deliver')").run() }

  it('una prueba que cae: el hilo dice qué prueba, dónde quedó el trabajo y ofrece «Reintentar»', async () => {
    c.iniciar({ deliverCommand: ORDEN.fallaPrueba('src/agenda.test.js › la agenda carga con datos'), deliverRetries: 0 })
    const id = await c.enviar('La pantalla de agenda queda en blanco.')
    await c.esperar(id)
    const hilo = await c.hilo(id)
    const notice = hilo.replies.at(-1)
    assert.match(notice.body, /^No quedó en producción: no pasó la verificación \(la agenda carga con datos\)\./)
    assert.ok(notice.body.includes(`tp/${id}`), 'dice en qué rama quedó lo hecho')
    assert.equal(notice.retryable, true, '«Reintentar» se ofrece: otra entrega puede salir bien')
    assert.equal(hilo.status, 'open', 'el mensaje llega a una persona, no queda enterrado como respondido')
  })

  it('un guion de entrega que no existe (código 127) no falla en silencio: el hilo lo dice con la salida', async () => {
    await reset()
    c.iniciar({ deliverCommand: ORDEN.inexistente })
    const id = await c.enviar('El botón de reservas no responde en el teléfono.')
    await c.esperar(id)
    assert.equal(c.trabajos(id, 'deliver').length, 1)
    const hilo = await c.hilo(id)
    const notice = hilo.replies.at(-1)
    assert.match(notice.body, /^La entrega falló dos veces por la máquina de entrega o por el plazo \(.*(not found|No such file).*\), no por el cambio, y todavía no está en producción\./s)
    assert.ok(notice.body.includes(`tp/${id}`))
    assert.equal(notice.retryable, true)
    assert.ok(!hilo.replies.some((r) => /En producción desde/.test(r.body)))
  })

  it('un fallo que no se arregla con otro intento (formato de la salida) lo dice y no ofrece «Reintentar»', async () => {
    await reset()
    process.env.FAKE_EXECUTE_MODE = 'invalid-output'
    c.iniciar({ deliverCommand: ORDEN.pasa })
    const id = await c.enviar('La ficha del paciente corta el nombre.')
    await c.esperar(id)
    const notice = (await c.hilo(id)).replies.at(-1)
    assert.match(notice.body, /^La sesión terminó, pero su resultado no tenía el formato pedido\./)
    assert.equal(notice.retryable, false)
  })

  it('un fallo del sistema (la sesión muere sin resultado) lo dice y sí ofrece «Reintentar»', async () => {
    await reset()
    process.env.FAKE_EXECUTE_MODE = 'exit'
    c.iniciar({ deliverCommand: ORDEN.pasa })
    const id = await c.enviar('La ficha del paciente corta el apellido.')
    await c.esperar(id)
    const notice = (await c.hilo(id)).replies.at(-1)
    assert.match(notice.body, /^No pude terminar este trabajo por un problema del sistema/)
    assert.equal(notice.retryable, true)
  })
})
