// C10. Claude treats each person as their profile says; Martín, with «tú». Measured 2026-10-25: a closing reply addressed Martín as «usted».
// The system cannot read the prose of the model (RULES 4); what it guarantees is what the session receives: the profile of the sender, whole, and the rule of how to use it.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo, ORDEN } from './ciclo.mjs'

const sender = (stdin) => /<sender>\n([\s\S]*?)\n<\/sender>/.exec(stdin)?.[1]

describe('C10 Claude trata a cada persona como dice su perfil', () => {
  let c
  before(async () => { c = await iniciarCiclo({ martinProfile: 'Trátame de tú. Soy quien decide el producto.' }); c.iniciar({ deliverCommand: ORDEN.pasa }) })
  after(async () => { await c.cerrar() })

  it('a Martín la sesión le llega con su perfil entero («de tú») y la regla de tratar como el perfil dice', async () => {
    const id = await c.enviar('La pantalla de agenda queda en blanco.')
    await c.esperar(id)
    const { stdin } = c.llamadas().at(-1)
    assert.equal(sender(stdin), 'Martín\n\nTrátame de tú. Soy quien decide el producto.')
    assert.match(stdin, /Address the sender the way their profile says \(the `sender` block\); with no instruction, in Spanish use «tú» and never «usted»\./)
    assert.match(stdin, /reply language: Spanish \(Latin America\)/)
  })

  it('a quien pide «de usted» la sesión le llega ese perfil, y la regla no lo pisa con «tú»', async () => {
    const cookie = await c.personaNueva('ana@x.org', 'Ana', 'Trátame de usted, por favor. Soy la gerente.')
    const id = await c.enviar('El botón de reservas no responde en el teléfono.', { cookie })
    await c.esperar(id)
    const { stdin } = c.llamadas().at(-1)
    assert.equal(sender(stdin), 'Ana\n\nTrátame de usted, por favor. Soy la gerente.')
    assert.doesNotMatch(sender(stdin), /tú/)
    assert.match(stdin, /Address the sender the way their profile says/)
  })

  it('también cuando el análisis manda el trabajo al modelo ligero: su instrucción mínima trae el perfil y la misma regla', async () => {
    c.estimates = { understand_vs_create: 0.1, irreversibility: 0.1, certainty: 0.9 }
    const id = await c.enviar('El rótulo del botón Guardar dice Gurdar.')
    await c.esperar(id)
    const call = c.llamadas().at(-1)
    assert.equal(call.args[call.args.indexOf('--model') + 1], 'claude-haiku-5-5', 'this job ran on the light model')
    assert.equal(sender(call.stdin), 'Martín\n\nTrátame de tú. Soy quien decide el producto.')
    assert.match(call.stdin, /«tú»[^.]*never «usted»|«tú» and never «usted»/)
    c.estimates = null
  })
})
