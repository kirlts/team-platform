// C7. «Reintentar» gives an immediate visible sign and takes the error away while it retries.
// Martín, 2026-10-25 03:52. What the panel draws comes from two fields of the reply that told the failure: `retryable` (the button) and `retrying` («Reintentando»).
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo, ORDEN, until } from './ciclo.mjs'

describe('C7 Reintentar avisa al instante', () => {
  let c
  before(async () => { c = await iniciarCiclo() })
  after(async () => { await c.cerrar() })

  it('al apretar «Reintentar» el aviso pasa a «Reintentando» y el botón desaparece; al comprobarse llega la respuesta final', async () => {
    c.iniciar({ deliverCommand: ORDEN.fallaPrueba('src/agenda.test.js › la agenda carga con datos'), deliverRetries: 0 })
    const id = await c.enviar('La pantalla de agenda queda en blanco.')
    await c.esperar(id)
    const failed = (await c.hilo(id)).replies.at(-1)
    assert.equal(failed.retryable, true)
    assert.equal(failed.retrying, false)

    // The second delivery is held open by the host until the test says so, so the state «retrying» can be read while it lasts.
    const gate = join(c.env.dir, 'gate')
    c.config.execute.deliverCommand = `echo '##team phase deploy'; while [ ! -e ${gate} ]; do sleep 0.05; done; echo abc1234`
    const res = await c.post(`/api/messages/${id}/replies/${failed.id}/retry`, c.martin)
    assert.equal(res.statusCode, 202, res.body)
    const now = (await c.hilo(id)).replies.find((r) => r.id === failed.id)
    assert.equal(now.retrying, true, 'immediate: «Reintentando»')
    assert.equal(now.retryable, false, 'el botón ya no está: un segundo clic no encola otra entrega')
    assert.equal(String(now.replaced_by_job_id), String(JSON.parse(res.body).job_id))
    const again = await c.post(`/api/messages/${id}/replies/${failed.id}/retry`, c.martin)
    assert.equal(again.statusCode, 409, 'a second click enqueues nothing')

    writeFileSync(gate, '')
    await until(async () => (await c.hilo(id)).replies.some((r) => /En producción desde/.test(r.body)), { timeoutMs: 30000 })
    const done = (await c.hilo(id)).replies.find((r) => r.id === failed.id)
    assert.equal(done.retrying, false, 'terminado el reintento ya no figura como reintentando')
    assert.equal(done.retryable, false, 'ni se ofrece de nuevo un aviso que ya se reemplazó')
  })
})
