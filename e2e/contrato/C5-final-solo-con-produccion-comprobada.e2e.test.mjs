// C5. The final reply goes out only when the delivery is proved in production, with the real hour; never «lo verás apenas se publique».
// Measured 2026-10-25: a final reply promised «lo verá apenas se publique» before anything was published.
import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo, ORDEN, until } from './ciclo.mjs'

const PROMESA = /apenas se publique|lo ver[aá]s|lo ver[aá] |se publicar[aá]|cuando se publique|empieza al terminar|estar[aá] visible/i

describe('C5 la respuesta final sale con la entrega comprobada', () => {
  let c
  before(async () => { process.env.TZ = 'UTC'; c = await iniciarCiclo() })
  after(async () => { await c.cerrar() })

  it('mientras la entrega corre el hilo no tiene respuesta final; al comprobarse trae la hora real', async () => {
    const gate = join(c.env.dir, 'gate')
    c.iniciar({ deliverCommand: `echo '##team phase deploy'; while [ ! -e ${gate} ]; do sleep 0.05; done; echo abc1234` })
    const id = await c.enviar('La pantalla de agenda queda en blanco.')
    await until(() => c.env.db.prepare("SELECT phase FROM jobs WHERE message_id = ? AND kind = 'deliver'").get(id)?.phase === 'deliverDeploy', { timeoutMs: 20000 })
    const during = await c.hilo(id)
    const mine = during.replies.filter((r) => String(r.author_id) === String(c.agentId))
    assert.equal(mine.length, 1, 'only the first reply exists while the delivery runs')
    assert.ok(!mine.some((r) => /En producción/.test(r.body)))
    assert.ok(during.progress_notes.some((n) => n.body === 'Construido; entregando a producción.'), 'a notice, never the final reply')
    writeFileSync(gate, '')
    await c.esperar(id)
    const final = await c.ultimaDeClaude(id)
    const m = /En producción desde (\d\d):(\d\d) UTC\./.exec(final.body)
    assert.ok(m, `la hora real y su zona: ${final.body}`)
    const at = new Date(final.created_at)
    const minutes = (h, mm) => Number(h) * 60 + Number(mm)
    const diff = Math.abs(minutes(m[1], m[2]) - minutes(at.getUTCHours(), at.getUTCMinutes()))
    assert.ok(diff <= 1 || diff >= 1439, `la hora de la respuesta es la de la entrega (${m[1]}:${m[2]} contra ${final.created_at})`)
    assert.ok(!(await c.respuestasDeClaude(id)).some((r) => PROMESA.test(r.body)), 'nada del futuro en ninguna respuesta')
    await c.detener()
  })

  it('una entrega que no llega a producción no dice nunca «En producción»', async () => {
    c.iniciar({ deliverCommand: ORDEN.fallaPrueba(), deliverRetries: 0 })
    const id = await c.enviar('El botón de reservas no responde en el teléfono.')
    await c.esperar(id)
    const hilo = await c.hilo(id)
    assert.ok(!hilo.replies.some((r) => /En producción desde|Ya está en producción/.test(r.body)))
    assert.match((await c.ultimaDeClaude(id)).body, /^No quedó en producción: no pasó la verificación \(la agenda carga con datos\)\./)
    await c.detener()
  })

  it('la sesión recibe la prohibición de prometer publicación y la regla de que la respuesta sale después de producción', async () => {
    c.iniciar({ deliverCommand: ORDEN.pasa })
    const id = await c.enviar('La ficha del paciente corta el nombre.')
    await c.esperar(id)
    const { stdin } = c.llamadas().at(-1)
    assert.match(stdin, /only after the delivery finished and production confirmed it, with the real time/)
    assert.match(stdin, /write nothing about publishing or about when the person will see the change/)
    assert.match(stdin, /«lo verás apenas se publique»/, 'the forbidden phrase is named')
    assert.ok(!existsSync(join(c.env.dir, 'gate-never')), 'sanity')
    await c.detener()
  })
})
