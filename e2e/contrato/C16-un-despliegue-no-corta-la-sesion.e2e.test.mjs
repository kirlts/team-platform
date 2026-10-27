// C16. A deployment does not cut a session of Claude in progress: the service restarts, the session and its machine stay, and the next attempt attaches to them.
// This is the default (EXECUTE_KEEP_SESSION_ON_SHUTDOWN=1); with 0 the shutdown destroys the machine (piece B4; src/execute/execute.test.js).
// Measured 2026-10-25, job 156: the session lived 17 minutes after a restart of the service, and a repetition would have started a second one.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import { iniciarCiclo, ORDEN, until } from './ciclo.mjs'

const HUESPED = fileURLToPath(new URL('./huesped.sh', import.meta.url))
const vivo = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

describe('C16 un despliegue no corta una sesión en curso', () => {
  let c, log
  before(async () => { c = await iniciarCiclo(); log = join(c.env.dir, 'maquina.log'); writeFileSync(log, '') })
  after(async () => { await c.cerrar() })
  const maquina = () => ({
    runner: 'machine', deliverCommand: ORDEN.pasa,
    machineCreate: `echo create {job_id} >> ${log}; echo vm-{job_id}`,
    machineRun: `sh ${HUESPED} {workdir} ${c.state} {job_id}`,
    machineDestroy: `echo destroy {machine} >> ${log}`
  })

  it('el servicio se detiene con la sesión trabajando: la sesión sigue, no se destruye la máquina y el siguiente servicio se engancha sin lanzar otra', async () => {
    process.env.FAKE_EXECUTE_SLEEP_MS = '3000'
    c.iniciar(maquina())
    const id = await c.enviar('La pantalla de agenda queda en blanco.')
    await until(() => c.llamadas().length === 1, { timeoutMs: 20000 })
    const pid = c.llamadas()[0].pid
    await until(async () => (await c.respuestasDeClaude(id)).length === 1, { timeoutMs: 20000 }) // the session already answered once

    await c.detener() // the deployment: the service goes down while the session works
    assert.ok(vivo(pid), 'the session is still alive after the service stopped')
    assert.ok(!/destroy/.test(readFileSync(log, 'utf8')), 'the machine was not destroyed')
    assert.equal(c.trabajos(id, 'execute')[0].status, 'queued', 'the job went back to the queue with its attempt refunded')

    c.iniciar(maquina()) // the new service
    await c.esperar(id, { timeoutMs: 60000 })
    assert.deepEqual(c.trabajos(id, 'execute').map((j) => j.status), ['done'])
    assert.equal(c.llamadas().length, 1, 'no second session was started: the new service attached to the first')
    const hilo = await c.hilo(id)
    assert.equal(hilo.replies.filter((r) => String(r.author_id) === String(c.agentId)).length, 2, 'the first reply and ONE closing reply')
    assert.match(hilo.replies.at(-1).body, /En producción desde/)
    assert.equal(hilo.progress_notes.filter((n) => n.body === 'Claude empezó a trabajar').length, 1, 'the start is told once')
    const steps = readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split(' ')[0])
    assert.equal(steps.filter((s) => s === 'destroy').length, 1, 'the machine is destroyed once')
    assert.equal(steps.at(-1), 'destroy', 'and only when the session ended')
    assert.ok(!vivo(pid), 'and the session is over')
  })
})
