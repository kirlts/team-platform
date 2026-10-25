// C13. An idea is built and shown with «Publicar»; nothing reaches production without the approval of a person; the analyzer's judgement of the spirit of the message is a boolean the system obeys.
// Martín, 2026-10-25 16:53 and 16:56.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo } from './ciclo.mjs'

describe('C13 una idea se construye y se muestra con «Publicar»', () => {
  let c, marca, ideaId
  before(async () => {
    c = await iniciarCiclo()
    marca = join(c.env.dir, 'se-entrego')
    c.iniciar({ deliverCommand: `touch ${marca}; echo abc1234` })
  })
  after(async () => { await c.cerrar() })

  it('con la Guardia de la idea no se encola ninguna entrega, el hilo dice «Lista para ver» y trae «Publicar»', async () => {
    c.estimates = { idea: 0.9, idea_guard: true, idea_reason: 'lo dijo como una posibilidad' }
    const id = ideaId = await c.enviar('Una página de la clínica con la esfera de la IA de venta y videos.')
    await c.esperar(id)
    await new Promise((resolve) => setTimeout(resolve, 600)) // declared courtesy: a delivery that was wrongly queued starts in less than this
    assert.deepEqual(c.trabajos(id, 'deliver'), [], 'no delivery to production')
    assert.ok(!existsSync(marca), 'the delivery order never ran')
    const hilo = await c.hilo(id)
    const ready = hilo.replies.filter((r) => r.publishable)
    assert.equal(ready.length, 1, '«Publicar» is on exactly one reply')
    assert.match(ready[0].body, /^Lista para ver\. No está en producción: queda esperando el visto de una persona del mensaje, que la publica con «Publicar»\./)
    assert.equal(hilo.pending_delivery.state, 'held')
    assert.ok(!hilo.replies.some((r) => /En producción desde/.test(r.body)))
  })

  it('una persona que publica corre la entrega normal, y entonces la respuesta dice «En producción»', async () => {
    const id = ideaId
    const res = await c.post(`/api/messages/${id}/deliver`, c.martin)
    assert.equal(res.statusCode, 202, res.body)
    await c.esperar(id)
    assert.ok(existsSync(marca), 'only now the delivery ran')
    const hilo = await c.hilo(id)
    assert.ok(hilo.replies.some((r) => /En producción desde/.test(r.body)))
    assert.equal(hilo.replies.filter((r) => r.publishable).length, 0, '«Publicar» is gone once it is published')
  })

  it('un pedido decidido, que el análisis no marca como idea, se entrega como siempre y no trae «Publicar»', async () => {
    c.estimates = { idea: 0.1, idea_guard: false, idea_reason: 'describe una falla concreta' }
    const id = await c.enviar('El botón Guardar de la ficha no hace nada desde ayer.')
    await c.esperar(id)
    assert.equal(c.trabajos(id, 'deliver').length, 1)
    assert.equal((await c.hilo(id)).replies.filter((r) => r.publishable).length, 0)
  })

  it('el sistema obedece el booleano del análisis y no lee las palabras: el mismo texto con la Guardia apagada se entrega', async () => {
    c.estimates = { idea: 0.9, idea_guard: false, idea_reason: 'el análisis juzgó que es un pedido' }
    const id = await c.enviar('Una página de la clínica con la esfera de la IA de venta y videos.')
    await c.esperar(id)
    assert.equal(c.trabajos(id, 'deliver').length, 1)
  })

  it('la sesión recibe, como contexto, que construye para mostrar y que no debe escribir que está publicado', async () => {
    c.estimates = { idea: 0.9, idea_guard: true, idea_reason: 'lo dijo como una posibilidad' }
    const id = await c.enviar('Un tablero con las citas de la semana, como idea.')
    await c.esperar(id)
    const { stdin } = c.llamadas().at(-1)
    assert.match(stdin, /<exploration>\nThis message is mostly an idea to explore/)
    assert.match(stdin, /Nothing you build goes to production on its own: the system keeps the branch until a person of the message sees it and publishes it\./)
    assert.match(stdin, /Do not write that it is published or when it will be: it is ready to see\./)
  })
})
