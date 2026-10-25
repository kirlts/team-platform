// C13. An idea is built and shown; nothing reaches production without the approval of a person; the analyzer's judgement of the spirit of the message is a boolean the system obeys.
// Martín, 2026-10-25 16:53 and 16:56, and UD-307 after him: no «Publicar» button, a person writes in the thread what they want and the model reads it (`review`).
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo, until } from './ciclo.mjs'

describe('C13 una idea se construye y se muestra; sólo una persona la publica', () => {
  let c, marca, ideaId
  before(async () => {
    c = await iniciarCiclo()
    marca = join(c.env.dir, 'se-entrego')
    c.iniciar({ deliverCommand: `touch ${marca}; echo abc1234` })
  })
  after(async () => { await c.cerrar() })


  it('con la Guardia de la idea no se encola ninguna entrega y el hilo dice «Lista para ver»', async () => {
    c.estimates = { idea: 0.9, idea_guard: true, idea_reason: 'lo dijo como una posibilidad' }
    const id = ideaId = await c.enviar('Una página de la clínica con la esfera de la IA de venta y videos.')
    await c.esperar(id)
    await new Promise((resolve) => setTimeout(resolve, 600)) // declared courtesy: a delivery that was wrongly queued starts in less than this
    assert.deepEqual(c.trabajos(id, 'deliver'), [], 'no delivery to production')
    assert.ok(!existsSync(marca), 'the delivery order never ran')
    const hilo = await c.hilo(id)
    assert.match(hilo.replies.at(-1).body, /^Lista para ver\. No está en producción: respóndeme en este hilo qué quieres que haga con esto\./)
    assert.equal(hilo.pending_delivery.state, 'held')
    assert.ok(hilo.replies.every((r) => !('publishable' in r)), 'no «Publicar» button: a person writes what they want')
    assert.ok(!hilo.replies.some((r) => /En producción desde/.test(r.body)))
  })

  it('una respuesta que sigue explorando no entrega', async () => {
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ review: 'none', summary: 'Sigo explorando.' })
    const res = await c.post(`/api/messages/${ideaId}/replies`, c.martin, { body: 'Agrega otra opción con fondo claro.' })
    assert.equal(res.statusCode, 201, res.body)
    await until(() => c.trabajos(ideaId, 'execute').length === 2 && c.trabajos(ideaId, 'execute').every((j) => j.status === 'done'), { timeoutMs: 30000 })
    await new Promise((resolve) => setTimeout(resolve, 600))
    assert.deepEqual(c.trabajos(ideaId, 'deliver'), [])
    assert.ok(!existsSync(marca))
  })

  it('la respuesta de una persona que quiere publicarla llama a Claude con el hilo, y entonces corre la entrega y la respuesta dice «En producción»', async () => {
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ review: 'approve', summary: 'Entendido: lo publico.' })
    const res = await c.post(`/api/messages/${ideaId}/replies`, c.martin, { body: 'Se ve bien, adelante.' })
    assert.equal(res.statusCode, 201, res.body)
    await until(() => c.trabajos(ideaId, 'deliver').length === 1 && c.trabajos(ideaId, 'deliver')[0].status === 'done', { timeoutMs: 30000 })
    assert.ok(existsSync(marca), 'only now the delivery ran')
    assert.ok((await c.hilo(ideaId)).replies.some((r) => /En producción desde/.test(r.body)))
    const mention = JSON.parse(c.trabajos(ideaId, 'execute').at(-1).payload_json)
    assert.ok(mention.mention, 'the session that decided ran as a mention, with the whole thread')
    delete process.env.FAKE_EXECUTE_EXTRA
  })

  it('un pedido decidido, que el análisis no marca como idea, se entrega como siempre', async () => {
    c.estimates = { idea: 0.1, idea_guard: false, idea_reason: 'describe una falla concreta' }
    const id = await c.enviar('El botón Guardar de la ficha no hace nada desde ayer.')
    await c.esperar(id)
    assert.equal(c.trabajos(id, 'deliver').length, 1)
    assert.ok(!(await c.hilo(id)).replies.some((r) => /Lista para ver/.test(r.body)))
  })

  it('el sistema obedece el booleano del análisis y no lee las palabras: el mismo texto con la Guardia apagada se entrega', async () => {
    c.estimates = { idea: 0.9, idea_guard: false, idea_reason: 'el análisis juzgó que es un pedido' }
    const id = await c.enviar('Una página de la clínica con la esfera de la IA de venta y videos.')
    await c.esperar(id)
    assert.equal(c.trabajos(id, 'deliver').length, 1)
  })

  it('la sesión recibe, como contexto, que muestra y espera lo que le digan en el hilo, y que no debe escribir que está publicado', async () => {
    c.estimates = { idea: 0.9, idea_guard: true, idea_reason: 'lo dijo como una posibilidad' }
    const id = await c.enviar('Un tablero con las citas de la semana, como idea.')
    await c.esperar(id)
    const { stdin } = c.llamadas().at(-1)
    assert.match(stdin, /<exploration>\nThis message is mostly an idea to explore/)
    assert.match(stdin, /Nothing you build goes to production on its own\. Show what you did and wait for what they tell you in the thread/)
    assert.match(stdin, /Do not write that it is published or when it will be: it is ready to see\./)
  })
})
