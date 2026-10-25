// C17. Claude's screenshots do not anonymize the data of patients or professionals. Martín, 2026-10-24 15:21.
// What the worker hands to the session carries no variable, filter or instruction that masks, and what the session leaves in $TEAM_CAPTURES_DIR is stored and served byte for byte.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo, ORDEN } from './ciclo.mjs'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-image-bytes')]) // what the fake session writes
const FOTO = { path: 'ficha.png', alt: 'La ficha de una paciente con su nombre, su RUT y su teléfono', masked: false, place: '/pacientes/12', as: 'Clínica de prueba, recepción' }
const ENMASCARA = /mask|anonym|redact|blur|pseudonym|scrub|sanitiz|obscur/i

describe('C17 las capturas no anonimizan datos', () => {
  let c
  before(async () => { c = await iniciarCiclo() })
  after(async () => { await c.cerrar() })

  async function trabajo (execute) {
    await c.detener()
    c.env.db.prepare("DELETE FROM jobs WHERE kind IN ('execute', 'deliver')").run()
    process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify({ 'ficha.png': 'png' })
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ outcome: 'done', touches_screen: true, captures: [FOTO] })
    c.iniciar({ deliverCommand: ORDEN.pasa, ...execute })
    const id = await c.enviar('La ficha del paciente corta el nombre.')
    await c.esperar(id)
    return id
  }

  it('con el anfitrión que permite datos de personas (EXECUTE_CAPTURES_UNMASKED=allowed), la captura con datos reales llega a la respuesta tal como se tomó', async () => {
    const id = await trabajo({ captures: { max: 3, openZone: 'ninguna', unmasked: true } })
    const final = await c.ultimaDeClaude(id)
    assert.equal(final.attachments.length, 1, final.body)
    const res = await c.env.app.inject({ method: 'GET', url: `/api/replies/attachments/${final.attachments[0].id}`, headers: { cookie: c.martin } })
    assert.equal(res.statusCode, 200)
    assert.equal(createHash('sha256').update(res.rawPayload).digest('hex'), createHash('sha256').update(PNG).digest('hex'), 'the image served is the one the session took, byte for byte')
    assert.match(final.body, /\*\*Después\*\*: La ficha de una paciente con su nombre, su RUT y su teléfono\./)
  })

  it('lo que el servicio le pasa a la sesión no trae ninguna variable ni orden de enmascarar', async () => {
    const call = c.llamadas().at(-1)
    const env = c.entornoDe(call)
    const names = Object.keys(env).filter((k) => ENMASCARA.test(k) && k !== 'TEAM_CAPTURES_UNMASKED')
    assert.deepEqual(names, [], 'no variable of the environment asks for masking')
    assert.equal(env.TEAM_CAPTURES_UNMASKED, 'allowed')
    const prompt = call.stdin.replace(/masked false needs --zone ninguna\./, '')
    assert.doesNotMatch(prompt, /anonymi[sz]|redact|blur|pseudonym|scrub|hide (the )?(personal|patient|private)|mask (the|any|all)/i, 'the instruction does not tell the session to hide data')
    assert.ok(!call.args.some((a) => /--masked|--blur|--redact|--anonym/i.test(a)))
  })

  it('el texto de ayuda de la sesión no le dice que una captura sin máscara necesita la zona «ninguna» cuando el anfitrión la permite', async () => {
    // The environment says «allowed» and `team reply` accepts it, but the help the session reads says the opposite.
    const { stdin } = c.llamadas().at(-1)
    assert.ok(!/masked false needs --zone ninguna/.test(stdin), 'the help of `team` tells the session that an unmasked capture needs an open zone')
  })

  it('por omisión (sin ninguna variable del anfitrión) una captura con datos de personas llega a la respuesta', async () => {
    // The product as shipped: the platform's own default, with nothing declared about captures.
    const id = await trabajo({})
    const final = await c.ultimaDeClaude(id)
    assert.equal(final.attachments.length, 1, `la captura con datos reales no llegó (EXECUTE_CAPTURES_UNMASKED omite «denied»): ${final.body.split('\n').at(-1)}`)
  })
})
