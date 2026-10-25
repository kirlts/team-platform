// C9. A job that touches a screen carries a screenshot or a video in the final reply, or says why it does not.
// Measured 2026-10-25: 12 of 12 replies of Claude carried no photo or video, and none said why.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { configDelTrabajador } from './anfitrion.mjs'
import { iniciarCiclo, ORDEN } from './ciclo.mjs'

const shot = (path, alt = 'La agenda del día con tres citas, «Agenda · 25 oct»') => ({ path, alt, masked: false, place: '/agenda', as: 'Clínica de prueba, recepción' })
const LUGAR = { zone: 'datos de personas' }

describe('C9 captura o video en la respuesta final', () => {
  let c
  before(async () => { c = await iniciarCiclo() })
  after(async () => { await c.cerrar() })

  /** Runs one job whose session says what `extra` says and leaves `files` in its captures directory; returns the thread. */
  async function trabajo ({ extra, files = {}, entrega = true, orden = ORDEN.pasa, texto = 'La pantalla de agenda queda en blanco.', antes = null }) {
    await c.detener()
    c.env.db.prepare("DELETE FROM jobs WHERE kind IN ('execute', 'deliver')").run()
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ outcome: 'done', ...extra })
    process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify(files)
    if (antes) { process.env.FAKE_EXECUTE_START_CAPTURES = JSON.stringify(antes); process.env.FAKE_EXECUTE_START_ZONE = LUGAR.zone } else { delete process.env.FAKE_EXECUTE_START_CAPTURES; delete process.env.FAKE_EXECUTE_START_ZONE }
    // The captures of the worker of the host, read from the file that declares it.
    c.iniciar({ deliverCommand: entrega ? orden : '', ...configDelTrabajador(c.env.dir, ['captures']).execute })
    const id = await c.enviar(texto)
    await c.esperar(id)
    return { id, hilo: await c.hilo(id), final: await c.ultimaDeClaude(id) }
  }

  it('toca pantalla y trae una captura: la respuesta final la lleva adjunta y dice qué muestra', async () => {
    const { final } = await trabajo({ extra: { touches_screen: true, captures: [shot('despues.png')] }, files: { 'despues.png': 'png' } })
    const images = final.attachments.filter((a) => a.kind === 'image')
    assert.equal(images.length, 1, JSON.stringify(final.attachments))
    assert.match(images[0].name, /^Después - /)
    assert.match(final.body, /\*\*Después\*\*: La agenda del día con tres citas, «Agenda · 25 oct»\. \/agenda, Clínica de prueba, recepción\./)
    assert.ok(!/No incluye captura/.test(final.body))
  })

  it('lo mismo cuando el trabajo termina sin pasar por la entrega', async () => {
    const { final } = await trabajo({ entrega: false, extra: { touches_screen: true, captures: [shot('despues.png')] }, files: { 'despues.png': 'png' } })
    assert.equal(final.attachments.filter((a) => a.kind === 'image').length, 1)
  })

  it('toca pantalla y trae el video del recorrido: se adjunta como video', async () => {
    const { final } = await trabajo({ entrega: false, extra: { touches_screen: true, captures: [shot('recorrido.webm', 'Recorrido · 0:12')] }, files: { 'recorrido.webm': 'webm' } })
    assert.deepEqual(final.attachments.map((a) => a.kind), ['video'])
  })

  it('la primera respuesta trae el «Antes» y la final el «Antes» y el «Después» tomado de producción', async () => {
    // With a «before», the «after» is the one the delivery takes from production at the same place (UD-268): the host prints it as a `##team capture` line.
    const png = "printf '\\211PNG\\r\\n\\032\\nimagen-de-produccion' > \"$TEAM_WORKDIR/captures/prod.png\""
    const line = `echo '##team capture ${JSON.stringify(shot('prod.png', 'La agenda en producción con tres citas'))}'`
    const { hilo, final } = await trabajo({ orden: `${png}; ${line}; echo abc1234`, antes: [shot('antes.png', 'La agenda en blanco')], extra: { touches_screen: true, captures: [shot('despues.png')] }, files: { 'antes.png': 'png', 'despues.png': 'png' } })
    const first = hilo.replies.find((r) => String(r.author_id) === String(c.agentId))
    assert.equal(first.attachments.length, 1)
    assert.match(first.attachments[0].name, /^Antes - /)
    assert.deepEqual(final.attachments.map((a) => a.name.split(' - ')[0]), ['Antes', 'Después'], JSON.stringify(final.attachments))
  })

  it('toca pantalla y no hay captura: la respuesta dice por qué, con las palabras de la sesión', async () => {
    const { final } = await trabajo({ extra: { touches_screen: true, no_capture_reason: 'el navegador no abrió en la máquina de trabajo' } })
    assert.equal(final.attachments.length, 0)
    assert.match(final.body, /No incluye captura ni video: el navegador no abrió en la máquina de trabajo\./)
  })

  it('toca pantalla, no hay captura y la sesión no dio motivo: dice que no dejó ninguna', async () => {
    const { final } = await trabajo({ extra: { touches_screen: true } })
    assert.match(final.body, /No incluye captura ni video: la sesión no dejó ninguna\./)
  })

  it('un trabajo que no toca pantalla no lleva el aviso de captura', async () => {
    const { final } = await trabajo({ extra: { touches_screen: false } })
    assert.ok(!/No incluye captura/.test(final.body))
  })

  it('una captura que la sesión sí tomó y el sistema rechazó se dice con su motivo verdadero: cuál y por qué', async () => {
    // The file is not an image: the session did take something and the system left it out, so «the session left none» would be false.
    const { final } = await trabajo({ extra: { touches_screen: true, captures: [shot('despues.png')] }, files: { 'despues.png': 'text' } })
    assert.equal(final.attachments.length, 0)
    assert.ok(!/la sesión no dejó ninguna/.test(final.body), final.body)
    assert.match(final.body, /No incluye captura ni video: la sesión tomó una captura y el sistema no la adjuntó: «La agenda del día con tres citas, «Agenda · 25 oct»» \(el archivo no es una imagen ni un video que se pueda adjuntar\)\./)
  })

  it('una captura con datos de personas que la instancia no permite adjuntar dice que ese es el motivo', async () => {
    await c.detener()
    c.env.db.prepare("DELETE FROM jobs WHERE kind IN ('execute', 'deliver')").run()
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ outcome: 'done', touches_screen: true, captures: [shot('despues.png')] })
    process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify({ 'despues.png': 'png' })
    c.iniciar({ deliverCommand: ORDEN.pasa, captures: { max: 8, openZone: 'ninguna', unmasked: false } })
    const id = await c.enviar('La ficha del paciente corta el nombre.')
    await c.esperar(id)
    const final = await c.ultimaDeClaude(id)
    assert.equal(final.attachments.length, 0)
    assert.match(final.body, /No incluye captura ni video: la sesión tomó una captura y el sistema no la adjuntó: «.*» \(muestra datos de personas sin ocultarlos y esta instancia no permite adjuntarlas\)\./)
  })

  it('la sesión recibe la regla: un cambio de pantalla no termina sin captura o video, y el esquema le pide declarar si toca pantalla', async () => {
    await trabajo({ extra: { touches_screen: false } })
    const call = c.llamadas().at(-1)
    assert.match(call.stdin, /never ends without at least one screenshot or the video/)
    const schema = JSON.parse(call.args[call.args.indexOf('--json-schema') + 1])
    assert.equal(schema.properties.touches_screen.type, 'boolean')
    assert.equal(schema.properties.no_capture_reason.type, 'string')
  })
})
