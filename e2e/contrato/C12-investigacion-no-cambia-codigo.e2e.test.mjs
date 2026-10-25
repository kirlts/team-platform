// C12. A request to investigate does not change code: Claude returns the report (and the attached PDF when it was asked for), nothing is delivered and nothing is closed.
// Martín, 2026-10-24 15:54 and 2026-10-25 05:06. The sender forwards the message to Claude with the reason written; the model says in `mode` what it understood.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo } from './ciclo.mjs'

const MOTIVO = 'Investiga por qué falla la agenda y dime qué recomiendas, en un PDF.'
const INFORME = 'Encontré que la agenda falla cuando la clínica no tiene profesionales activos.\n\nRecomiendo mostrar un aviso en la agenda vacía.'

describe('C12 una investigación no cambia código y devuelve el informe', () => {
  let c, marca
  before(async () => {
    c = await iniciarCiclo()
    marca = join(c.env.dir, 'se-entrego')
    c.asignado = 'Ed' // the message starts with a person and Ed forwards it to Claude
    c.iniciar({ deliverCommand: `touch ${marca}; echo abc1234` })
  })
  after(async () => { await c.cerrar() })

  async function investigar (extra, adjuntos = null) {
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ summary: INFORME, ...extra })
    if (adjuntos) process.env.FAKE_EXECUTE_ATTACHMENT_FILES = JSON.stringify(adjuntos); else delete process.env.FAKE_EXECUTE_ATTACHMENT_FILES
    const id = await c.enviar('La agenda queda en blanco en una clínica nueva.')
    const res = await c.post(`/api/messages/${id}/forward`, c.editor, { member_id: c.agentId, comment: MOTIVO })
    assert.equal(res.statusCode, 201, res.body)
    await c.esperar(id)
    return id
  }

  it('devuelve el informe y el PDF pedido; no entrega, no cierra y no deja una rama empujada', async () => {
    const id = await investigar({ mode: 'investigate', outcome: 'investigated', close: true, close_reason: 'ya está resuelto', attachments: [{ path: 'informe.pdf', name: 'Informe de la agenda.pdf' }] }, { 'informe.pdf': 'pdf' })
    const final = await c.ultimaDeClaude(id)
    assert.equal(final.body.split('\n\n').slice(0, 2).join('\n\n'), INFORME, 'the report is the closing reply')
    assert.deepEqual(final.attachments.map((a) => [a.name, a.mime]), [['Informe de la agenda.pdf', 'application/pdf']])
    assert.deepEqual(c.trabajos(id, 'deliver'), [], 'nothing to deliver')
    assert.ok(!existsSync(marca), 'the delivery order never ran')
    assert.notEqual(c.estado(id), 'closed', 'an investigation does not close the message by itself')
    assert.ok(!/Cerrado:/.test(final.body))
  })

  it('aunque la sesión diga outcome «done», con `mode` investigar nada se entrega', async () => {
    const id = await investigar({ mode: 'investigate', outcome: 'done' })
    assert.deepEqual(c.trabajos(id, 'deliver'), [])
    assert.ok(!existsSync(marca))
    assert.equal((await c.ultimaDeClaude(id)).kind, 'answer')
  })

  it('la sesión recibe la instrucción de no cambiar código ni empujar ramas cuando investiga, y de escribir el PDF que se le pide', async () => {
    const { stdin } = c.llamadas().at(-1)
    assert.match(stdin, /With `mode` `investigate` you change no code, create no branch and push nothing: the system delivers nothing and does not close the message/)
    assert.match(stdin, /When the reason asks for a PDF, write the file inside `\$TEAM_ATTACHMENTS_DIR`/)
    assert.match(stdin, new RegExp(`<forwarded>\\nforwarded by: Ed\\n\\nreason:\\n${MOTIVO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n</forwarded>`))
  })

  it('un trabajo normal sigue entregando: el control de las pruebas de arriba', async () => {
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ mode: 'resolve' })
    const id = await c.enviar('El botón Guardar no hace nada.')
    await c.post(`/api/messages/${id}/forward`, c.editor, { member_id: c.agentId, comment: 'Arréglalo.' })
    await c.esperar(id)
    assert.equal(c.trabajos(id, 'deliver').length, 1)
    assert.ok(existsSync(marca))
  })
})
