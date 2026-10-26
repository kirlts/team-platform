// C18. A message with Claude as recipient does not stay dead on a failure of the environment: when the service starts again (the deploy that brings the fix) it is
// launched again on its own, with a row in the thread, and a failure that another try does not fix is not.
// Martín, 2026-10-25: six deliveries (#118-#123) stayed failed for hours (exit 127, the script was not in the image) until he asked for them to be launched again.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo, ORDEN, until } from './ciclo.mjs'

describe('C18 nada queda sin atender', () => {
  process.env.LC_ALL = 'C'
  let c
  before(async () => { c = await iniciarCiclo() })
  after(async () => { await c.cerrar() })
  const reset = async () => { await c.detener(); c.env.db.prepare("DELETE FROM jobs WHERE kind IN ('execute', 'deliver')").run() }

  it('una entrega caída por el entorno (127) llega a producción al arrancar el servicio con el arreglo, sin que nadie apriete «Reintentar»', async () => {
    c.iniciar({ deliverCommand: ORDEN.inexistente })
    const id = await c.enviar('El botón de reservas no responde en el teléfono.')
    await c.esperar(id)
    assert.equal((await c.hilo(id)).replies.at(-1).retryable, true, 'quedó fallida, con «Reintentar» a la vista')

    await c.detener() // the deploy that brings the fix
    c.iniciar({ deliverCommand: ORDEN.pasa })
    await until(async () => (await c.hilo(id)).replies.some((r) => /En producción desde/.test(r.body)), { timeoutMs: 60000 })
    const hilo = await c.hilo(id)
    assert.ok(hilo.progress_notes.some((n) => /^Retomado solo tras fallar por el entorno de entrega, al arrancar el servicio\.$/.test(n.body)), 'el hilo dice que se retomó solo y por qué')
    assert.equal(c.trabajos(id, 'deliver').length, 2)
  })

  it('un fallo que otro intento no arregla (formato de la salida) no se relanza al arrancar', async () => {
    await reset()
    process.env.FAKE_EXECUTE_MODE = 'invalid-output'
    c.iniciar({ deliverCommand: ORDEN.pasa })
    const id = await c.enviar('La ficha del paciente corta el nombre.')
    await c.esperar(id)
    await c.detener()
    c.iniciar({ deliverCommand: ORDEN.pasa })
    await new Promise((resolve) => setTimeout(resolve, 1500)) // declared courtesy: time for the start to act, if it were going to
    assert.equal(c.trabajos(id, 'execute').length, 1, 'no se encoló otro trabajo')
    assert.ok(!(await c.hilo(id)).progress_notes.some((n) => /^Retomado solo/.test(n.body)))
  })
})
