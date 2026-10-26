// C11. Progress notices in the thread every 20 minutes by default, configurable per template (UD-293).
// The clock of the notices is injected and moves only when the test moves it: the notice is born from the timer of the job, and its interval is
// exact under any load (with real timers of 40 ms a busy machine delayed the first notice into the next interval).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { until } from '../../src/testing/helpers.js'
import { iniciarCiclo } from './ciclo.mjs'

const MINUTO = 60_000
const periodicos = (hilo) => hilo.progress_notes.filter((n) => n.minutes !== null)

/** A clock that only moves with `advance`: its timers fire, in order, when the time reaches them. */
function relojManual () {
  let t = Date.now()
  let seq = 0
  const timers = new Map()
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return { id, unref () {} } },
    clearTimeout: (h) => { if (h) timers.delete(h.id) },
    pending: () => timers.size,
    advance (ms) {
      const end = t + ms
      for (;;) {
        const next = [...timers].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        timers.delete(next[0])
        t = next[1].at
        next[1].fn()
      }
      t = end
    }
  }
}

describe('C11 avisos de progreso cada 20 minutos, configurables por plantilla', () => {
  let c
  before(async () => { c = await iniciarCiclo() })
  after(async () => { await c.cerrar() })

  /** Starts a session held at its gate with the injected clock; returns what the test needs to move it and let it finish. */
  async function sesionRetenida (texto) {
    const clock = relojManual()
    const gate = join(process.env.FAKE_EXECUTE_STATE, 'gate')
    if (!existsSync(gate)) execFileSync('mkfifo', [gate])
    rmSync(join(process.env.FAKE_EXECUTE_STATE, 'gate-reached'), { force: true })
    process.env.FAKE_EXECUTE_GATE = gate
    c.iniciar({}, { progressClock: clock })
    const id = await c.enviar(texto)
    // The session is alive when it reached its gate: an event of the session, not a pause.
    await until(() => existsSync(join(process.env.FAKE_EXECUTE_STATE, 'gate-reached')))
    return { id, clock, soltar: () => writeFileSync(gate, 'go') }
  }
  const terminar = async (s) => { s.soltar(); delete process.env.FAKE_EXECUTE_GATE; await c.esperar(s.id); await c.detener() }

  it('por omisión la plantilla avisa cada 20 minutos', async () => {
    assert.deepEqual(c.env.db.prepare('SELECT DISTINCT progress_interval_min AS m FROM templates').all().map((r) => r.m), [20], 'every template of the product starts at 20')
    const s = await sesionRetenida('La pantalla de agenda queda en blanco.')
    assert.equal(s.clock.pending(), 1, 'one timer of the session')
    s.clock.advance(19 * MINUTO)
    assert.equal(periodicos(await c.hilo(s.id)).length, 0, 'nothing before minute 20')
    s.clock.advance(1 * MINUTO)
    s.clock.advance(20 * MINUTO)
    const hilo = await c.hilo(s.id)
    assert.deepEqual(periodicos(hilo).map((n) => n.minutes), [20, 40])
    assert.ok(hilo.replies.every((r) => !/herramientas/.test(r.body)), 'a notice is not a reply')
    assert.equal(hilo.reply_count, hilo.replies.length)
    await terminar(s)
  })

  it('una plantilla con otro intervalo avisa con ese intervalo', async () => {
    c.env.db.prepare('UPDATE templates SET progress_interval_min = 5').run()
    const s = await sesionRetenida('El botón de reservas no responde en el teléfono.')
    s.clock.advance(40 * MINUTO)
    assert.deepEqual(periodicos(await c.hilo(s.id)).map((n) => n.minutes), [5, 10, 15, 20, 25, 30, 35, 40])
    await terminar(s)
  })

  it('con intervalo 0 la plantilla no avisa', async () => {
    c.env.db.prepare('UPDATE templates SET progress_interval_min = 0').run()
    const s = await sesionRetenida('La ficha del paciente corta el nombre.')
    assert.equal(s.clock.pending(), 0, 'no timer is started')
    s.clock.advance(120 * MINUTO)
    assert.equal(periodicos(await c.hilo(s.id)).length, 0)
    await terminar(s)
  })
})
