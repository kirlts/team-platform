// C3. No cap on steps: only the cap on spending. Martín, 2026-10-24: «No quiero tope de pasos mejor, solo tope de gasto» (a cap of 60 cut an implementation at step 105).
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo } from './ciclo.mjs'

const flag = (call, name) => call.args.includes(name)

describe('C3 ningún tope de pasos, sólo de gasto', () => {
  let c
  before(async () => { c = await iniciarCiclo() })
  after(async () => { await c.cerrar() })

  it('con EXECUTE_MAX_TURNS=0 la sesión no lleva tope de pasos y sí el de gasto, y el trabajo termina respondido', async () => {
    c.iniciar({ maxTurns: 0 })
    const id = await c.enviar('La pantalla de sedes queda en blanco.')
    await c.esperar(id)
    const call = c.llamadas().at(-1)
    assert.ok(!flag(call, '--max-turns'), 'la invocación lleva tope de pasos')
    assert.ok(flag(call, '--max-budget-usd'), 'el gasto sí tiene tope')
    assert.equal(c.estado(id), 'answered')
    await c.detener()
  })

  it('por omisión (sin ninguna variable) la sesión tampoco lleva tope de pasos', async () => {
    // The product as shipped: nothing is declared about steps.
    c.iniciar({}, {})
    const id = await c.enviar('La pantalla de agenda queda en blanco.')
    await c.esperar(id)
    const call = c.llamadas().at(-1)
    assert.ok(!flag(call, '--max-turns'), `la invocación lleva «--max-turns ${call.args[call.args.indexOf('--max-turns') + 1]}» (EXECUTE_MAX_TURNS omite 60; 0 es sin tope)`)
  })
})
