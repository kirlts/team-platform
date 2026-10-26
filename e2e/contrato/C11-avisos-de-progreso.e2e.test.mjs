// C11. Progress notices in the thread every 20 minutes by default, configurable per template (UD-293).
// The minute is shortened (`progressUnitMs`), never the logic: the notice is born from the clock of the job.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo } from './ciclo.mjs'

const UNIDAD_MS = 40 // one «minute» of the suite
const periodicos = (hilo) => hilo.progress_notes.filter((n) => n.minutes !== null)

describe('C11 avisos de progreso cada 20 minutos, configurables por plantilla', () => {
  let c
  before(async () => { c = await iniciarCiclo({ progressUnitMs: UNIDAD_MS }) })
  after(async () => { await c.cerrar() })

  it('por omisión la plantilla avisa cada 20 minutos', async () => {
    assert.deepEqual(c.env.db.prepare('SELECT DISTINCT progress_interval_min AS m FROM templates').all().map((r) => r.m), [20], 'every template of the product starts at 20')
    process.env.FAKE_EXECUTE_SLEEP_MS = '2600'
    c.iniciar()
    const id = await c.enviar('La pantalla de agenda queda en blanco.')
    await c.esperar(id)
    const hilo = await c.hilo(id)
    const notes = periodicos(hilo)
    // 20 «minutes» of 40 ms are 800 ms: the session lasts about 2.9 s, so three notices fit and a fourth does not.
    // A busy machine delays the timers: the notice that comes late is still the one of the interval. What this checks is that the first is the notice of
    // minute 20 and not the one of minute 40, so it must say between 19 and the midpoint of the two (30), and that notices keep coming while it lasts.
    assert.ok(notes.length >= 1 && notes.length <= 5, `notices: ${notes.length}`)
    assert.ok(notes[0].minutes >= 19 && notes[0].minutes < 30, `the first says about 20 min: ${notes[0].minutes}`)
    assert.ok(hilo.replies.every((r) => !/herramientas/.test(r.body)), 'a notice is not a reply')
    assert.equal(hilo.reply_count, hilo.replies.length)
    await c.detener()
  })

  it('una plantilla con otro intervalo avisa con ese intervalo', async () => {
    c.env.db.prepare('UPDATE templates SET progress_interval_min = 5').run()
    process.env.FAKE_EXECUTE_SLEEP_MS = '2600'
    c.iniciar()
    const id = await c.enviar('El botón de reservas no responde en el teléfono.')
    await c.esperar(id)
    const notes = periodicos(await c.hilo(id))
    assert.ok(notes.length >= 8, `with 5 min (200 ms) the same session leaves many more notices than with 20: ${notes.length}`)
    assert.ok(notes[0].minutes >= 4 && notes[0].minutes <= 8, `the first says about 5 min: ${notes[0].minutes}`)
    await c.detener()
  })

  it('con intervalo 0 la plantilla no avisa', async () => {
    c.env.db.prepare('UPDATE templates SET progress_interval_min = 0').run()
    process.env.FAKE_EXECUTE_SLEEP_MS = '1500'
    c.iniciar()
    const id = await c.enviar('La ficha del paciente corta el nombre.')
    await c.esperar(id)
    assert.equal(periodicos(await c.hilo(id)).length, 0)
  })
})
