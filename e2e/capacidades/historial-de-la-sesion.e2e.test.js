// Capability «Historial de la sesión» (docs/CAPACIDADES-1.0.md): a person sends, the worker runs the session of Claude and the history of what it does is readable while it
// runs and after: each call to a tool in order with its plain class, the technical name and the detail, and the screenshot the session took with what it shows at once and
// its file when the thread holds it. It starts from a send through the API and asserts what the person reads from `GET /api/messages/:id/session` and from the thread.
// The session is the double of Claude; the same stream reaches the worker with the local runner and with a machine driver, and both cases are here.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo, until } from '../contrato/ciclo.mjs'

const HUESPED = fileURLToPath(new URL('../contrato/huesped.sh', import.meta.url))
const SHOT = { path: 'agenda.png', alt: 'La agenda del día con tres citas', masked: true, place: '/agenda', as: 'recepción' }
const ACTIONS = [['read', 'Read'], ['capture', 'Bash'], ['command', 'Bash'], ['subagent', 'Task'], ['edit', 'Edit']]

describe('Historial de la sesión', () => {
  let c
  before(async () => { c = await iniciarCiclo() })
  after(async () => { await c.cerrar() })

  const session = async (id, cookie = c.martin) => c.env.app.inject({ method: 'GET', url: `/api/messages/${id}/session`, headers: { cookie } })
  function sesion (extraEnv = {}) {
    process.env.FAKE_EXECUTE_MULTI = '1'
    process.env.FAKE_EXECUTE_LOOK = JSON.stringify(SHOT)
    process.env.FAKE_EXECUTE_CAPTURE_FILES = JSON.stringify({ 'agenda.png': 'png' })
    process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ outcome: 'done', touches_screen: true, captures: [SHOT] })
    Object.assign(process.env, extraEnv)
  }
  async function leer (id) {
    const res = await session(id)
    assert.equal(res.statusCode, 200, res.body)
    return res.json()
  }

  it('with the local runner: the steps come in order with their class, tool and detail, and the screenshot opens from the same file the closing reply attaches', async () => {
    sesion({ FAKE_EXECUTE_SLEEP_MS: '2500' })
    c.iniciar({})
    const id = await c.enviar('La agenda queda en blanco al abrir la semana.')
    // While the session still works the person already reads what it did, and the screenshot says what it shows although its file is not in the thread yet.
    const live = await until(async () => { const h = await leer(id).catch(() => null); return h && h.steps.length >= 5 && h }, { timeoutMs: 20000 })
    assert.equal(live.job_status, 'running')
    assert.deepEqual(live.steps.map((s) => [s.action, s.tool]), ACTIONS)
    const taking = live.steps.find((s) => s.action === 'capture')
    assert.equal(taking.capture.alt, SHOT.alt)
    assert.equal(taking.capture.attachment, null, 'the file only exists when the session ends')
    assert.equal(taking.detail, 'look /agenda --shot')

    await c.esperar(id)
    const done = await leer(id)
    assert.equal(done.job_status, 'done', JSON.stringify(c.env.db.prepare('SELECT last_error FROM jobs WHERE message_id = ?').all(id)))
    assert.deepEqual(done.steps.map((s) => [s.action, s.tool]), ACTIONS)
    assert.deepEqual(done.steps.map((s) => s.detail), ['/repo/src/screen.tsx', 'look /agenda --shot', 'npm test', 'Revisar estilos', '/repo/src/screen.tsx'])
    assert.deepEqual(done.steps.map((s) => s.failed), [false, false, true, false, false])
    assert.ok(done.steps.every((s) => s.ended_at), 'every call returned')
    const times = done.steps.map((s) => Date.parse(s.at))
    assert.deepEqual([...times].sort((a, b) => a - b), times)

    // The screenshot is now openable, and it is the file of the closing reply of the thread.
    const attachment = done.steps.find((s) => s.action === 'capture').capture.attachment
    assert.ok(attachment, 'the closing reply carries the file')
    const final = await c.ultimaDeClaude(id)
    assert.ok(final.attachments.some((a) => a.id === attachment.id), 'the same attachment the thread shows')
    const file = await c.env.app.inject({ method: 'GET', url: `/api/replies/attachments/${attachment.id}`, headers: { cookie: c.martin } })
    assert.equal(file.statusCode, 200)
    assert.equal(file.headers['content-type'], 'image/png')
    assert.equal(done.steps.filter((s) => s.capture).length, 1, 'the declared capture is the one look took, not a second step')
  })

  it('with a machine driver: the stream the machine prints reaches the worker and the history is the same', async () => {
    await c.detener()
    const log = join(c.env.dir, 'maquina.log')
    writeFileSync(log, '')
    sesion()
    c.iniciar({ runner: 'machine', machineCreate: `echo create {job_id} >> ${log}; echo vm-{job_id}`, machineRun: `sh ${HUESPED} {workdir} ${c.state} {job_id}`, machineCollect: `mkdir -p {workdir}/captures; cp ${c.state}/maquina-{job_id}/job/captures/* {workdir}/captures/; echo ${log}`, machineDestroy: `echo destroy {machine} >> ${log}` })
    const id = await c.enviar('La agenda queda en blanco al abrir el mes.')
    await c.esperar(id)
    const h = await leer(id)
    assert.deepEqual(h.steps.map((s) => [s.action, s.tool]), ACTIONS)
    assert.ok(h.steps.find((s) => s.action === 'capture').capture.attachment, 'the host copied the file back with COLLECT and the worker stored it when the session ended')
  })

  it('a message nobody runs has no history, and nobody reads it without a session', async () => {
    c.asignado = 'Ed'
    const id = await c.enviar('Una pregunta para una persona.')
    c.asignado = 'Claude'
    assert.equal((await session(id)).statusCode, 404)
    assert.equal((await c.env.app.inject({ method: 'GET', url: `/api/messages/${id}/session` })).statusCode, 401)
  })
})
