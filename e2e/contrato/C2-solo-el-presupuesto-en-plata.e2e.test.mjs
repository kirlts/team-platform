// C2. No cap on how many Claude run at once: only the day's budget in money, with the reserve of each session measured from what the sessions cost.
// Measured 2026-10-25: a fixed reserve of 10 USD per session let four sessions run with 40 USD a day; the rest waited with no sign.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo, picoDeSesiones, until } from './ciclo.mjs'

const MODEL = 'claude-sonnet-5-5'
const SESIONES = 12 // more than QUEUE_CONCURRENCY (8): neither the queue slots nor a number of sessions may hold them

describe('C2 sólo el presupuesto diario en plata', () => {
  let c
  before(async () => { c = await iniciarCiclo() })
  after(async () => { await c.cerrar() })

  it('con 40 USD al día y trabajos de 1 USD medidos, arrancan todas las sesiones a la vez y ninguna espera', async () => {
    // Four finished jobs of 1 USD: what the platform measures to reserve for each new session.
    const day = 24 * 3600 * 1000
    for (let i = 0; i < 4; i++) {
      const at = Date.now() - day
      c.env.db.prepare("INSERT INTO jobs (kind, payload_json, status, run_at, created_at, finished_at, cost_usd, model) VALUES ('execute', '{}', 'done', ?, ?, ?, 1, ?)").run(at, at, at, MODEL)
    }
    process.env.FAKE_EXECUTE_SLEEP_MS = '4000'
    c.iniciar({ dailyBudgetUsd: 40 })
    const ids = await Promise.all(Array.from({ length: SESIONES }, (_, i) => c.enviar(`El módulo ${i + 1} de la agenda queda en blanco.`)))
    await Promise.all(ids.map((id) => c.esperar(id, { timeoutMs: 90000 })))
    assert.equal(picoDeSesiones(c.state), SESIONES, `sessions alive at once: the day allows ${SESIONES} and no number caps them`)
    for (const id of ids) {
      const hilo = await c.hilo(id)
      assert.ok(!hilo.progress_notes.some((n) => /^En espera|^Estuvo en espera/.test(n.body)), `el mensaje ${id} no esperó: ${JSON.stringify(hilo.progress_notes.map((n) => n.body))}`)
      assert.equal(hilo.status, 'answered')
    }
    await c.detener()
  })

  it('el límite es la plata: con el tope del día gastado el mensaje espera y el hilo lo dice', async () => {
    delete process.env.FAKE_EXECUTE_SLEEP_MS
    rmSync(join(c.state, 'calls.jsonl'), { force: true })
    c.env.db.prepare("DELETE FROM jobs WHERE kind = 'execute'").run()
    // Each fake session costs 1.2345 USD: two fit in 2 USD (the second starts with 0.77 left), the third finds the day spent.
    c.iniciar({ dailyBudgetUsd: 2 })
    const first = await c.enviar('El primer cambio de la agenda.')
    await c.esperar(first)
    const second = await c.enviar('El segundo cambio de la agenda.')
    await c.esperar(second)
    const third = await c.enviar('El tercer cambio de la agenda.')
    const reply = await until(async () => (await c.respuestasDeClaude(third)).find((r) => /^En espera: se alcanzó el tope de gasto de hoy\./.test(r.body)), { timeoutMs: 15000 })
    assert.match(reply.body, /Sigue mañana a las \d\d:\d\d\./)
    assert.equal(c.llamadas().length, 2, 'the third session did not start: nothing is spent past the day\'s cap')
  })
})
