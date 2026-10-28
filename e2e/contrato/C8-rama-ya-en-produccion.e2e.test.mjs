// C8. A branch that is already in production counts as delivered: nothing is delivered twice and the thread says so.
// Measured 2026-10-25: the night batch of the host put tp/117 in production, and its own delivery then ran against what was already there.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo } from './ciclo.mjs'

describe('C8 una rama que ya está en producción cuenta como entregada', () => {
  let c
  before(async () => { c = await iniciarCiclo() })
  after(async () => { await c.cerrar() })

  it('la orden de entrega no corre, el trabajo termina entregado y el hilo dice que ya estaba', async () => {
    const marca = join(c.env.dir, 'se-entrego')
    c.iniciar({ deliverCheckCommand: 'echo desarrollo', deliverCommand: `touch ${marca}; echo abc1234` })
    const id = await c.enviar('La pantalla de agenda queda en blanco.')
    await c.esperar(id)
    assert.ok(!existsSync(marca), 'the delivery order did not run: the branch was already served')
    assert.deepEqual(c.trabajos(id, 'deliver').map((j) => j.status), ['done'])
    const final = await c.ultimaDeClaude(id)
    assert.match(final.body, /En producción: el cambio ya estaba servido \(llegó por otro camino\) y no hizo falta entregarlo de nuevo\./)
    assert.equal(c.env.db.prepare('SELECT status FROM messages WHERE id = ?').get(id).status, 'closed', 'a branch already served closes the message')
    assert.equal(c.env.db.prepare('SELECT delivered FROM execute_runs WHERE message_id = ?').get(id).delivered, 1, 'counts as delivered')
    assert.ok(!(await c.hilo(id)).replies.some((r) => /^No quedó en producción/.test(r.body)))
  })

  it('una rama que la orden de comprobación no reconoce se entrega como siempre', async () => {
    await c.detener()
    const marca = join(c.env.dir, 'se-entrego-2')
    c.iniciar({ deliverCheckCommand: 'exit 1', deliverCommand: `touch ${marca}; echo abc1234` })
    const id = await c.enviar('El botón de reservas no responde en el teléfono.')
    await c.esperar(id)
    assert.ok(existsSync(marca), 'the delivery order ran')
    assert.match((await c.ultimaDeClaude(id)).body, /En producción desde/)
  })
})
