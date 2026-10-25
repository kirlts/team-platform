// C4. A test that fails in the delivery is not an end: Claude fixes it, whether it is its own or someone else's, and delivers again, until the budget.
// Martín, 2026-10-25 14:57. Measured 2026-10-25: deliveries that failed on a test that was not the change's ended in a notice and nobody fixed them.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo, ORDEN } from './ciclo.mjs'

describe('C4 una prueba que falla en la entrega no es un final', () => {
  let c
  before(async () => { c = await iniciarCiclo() })
  after(async () => { await c.cerrar() })

  it('tres entregas caen por una prueba ajena: Claude vuelve cada vez, y la cuarta llega a producción', async () => {
    const contador = join(c.env.dir, 'entregas')
    c.iniciar({ deliverCommand: ORDEN.fallaYLuegoPasa(contador, 3) })
    const id = await c.enviar('La pantalla de agenda queda en blanco.')
    await until(c, id)
    assert.equal(c.trabajos(id, 'execute').length, 4, 'one session per round: the first and three after each failed check')
    assert.deepEqual(c.trabajos(id, 'deliver').map((j) => j.status), ['failed', 'failed', 'failed', 'done'])
    const hilo = await c.hilo(id)
    const again = hilo.replies.filter((r) => /^No pasó la verificación: una prueba que no es del cambio .*\. Claude lo corrige y vuelve a entregar\.$/.test(r.body))
    assert.equal(again.length, 3, 'each failed delivery says which test fell and that Claude goes back')
    const final = hilo.replies.filter((r) => /En producción desde/.test(r.body))
    assert.equal(final.length, 1, 'one closing reply, and only after the green delivery')
    assert.equal(hilo.replies.at(-1).id, final[0].id)
    // The second, third and fourth sessions get the output of the delivery and the instruction that the test may be someone else's.
    const passes = c.llamadas().filter((x) => x.stdin.includes('<delivery_failure>'))
    assert.equal(passes.length, 3)
    for (const call of passes) {
      assert.match(call.stdin, /FALLA prueba: src\/ajena\.test\.js › una prueba que no es del cambio/)
      assert.match(call.stdin, /belongs to your change or is somebody else's/)
      assert.match(call.stdin, /not an end: it is your next task/)
    }
  })

  it('sigue hasta que se acaba el presupuesto del día, y entonces lo dice con la prueba que cayó', async () => {
    await c.detener()
    c.env.db.prepare("DELETE FROM jobs WHERE kind IN ('execute', 'deliver')").run()
    // Each fake session costs 1.2345 USD: with 3 USD a day, three rounds fit and the fourth finds the day spent.
    c.iniciar({ dailyBudgetUsd: 3, deliverCommand: ORDEN.fallaPrueba('src/ajena.test.js › una prueba que no es del cambio') })
    const id = await c.enviar('El botón de reservas no responde en el teléfono.')
    await until(c, id)
    assert.equal(c.trabajos(id, 'execute').length, 3, 'the rounds that the money allowed, and no more')
    const last = await c.ultimaDeClaude(id)
    assert.match(last.body, /^No quedó en producción: no pasó la verificación \(una prueba que no es del cambio\)\. Se alcanzó el tope de gasto de hoy y Claude no sigue\./)
    assert.ok(!(await c.hilo(id)).replies.some((r) => /En producción desde/.test(r.body)), 'it never says it is in production')
  })
})

const until = (c, id) => c.esperar(id, { timeoutMs: 90000 })
