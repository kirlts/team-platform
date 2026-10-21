import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { all, get, run } from '../db/index.js'
import { makeEnv } from '../testing/helpers.js'

/** Entorno con reloj y azar controlados. */
async function envVars (initialClock = 1_000_000) {
  const clockObj = { t: initialClock }
  const env = await makeEnv({ seed: false })
  env.clockObj = clockObj
  const { createQueue } = await import('./index.js')
  env.q = createQueue({ db: env.db, config: env.config, events: env.events, now: () => clockObj.t, random: () => 0 })
  return env
}

test('el reclamo respeta prioridad, luego run_at, luego id', async () => {
  const env = await envVars()
  const { q, clockObj } = env
  const a = q.enqueue('analyze', {}, { priority: 0 })
  const b = q.enqueue('analyze', {}, { priority: 5 })
  const c = q.enqueue('analyze', {}, { priority: 0, runAt: clockObj.t - 10 })
  const orderBy = [q.claim('w1').id, q.claim('w1').id, q.claim('w1').id]
  assert.deepEqual(orderBy, [b, c, a])
  assert.equal(q.claim('w1'), null)
  await env.close()
})

test('un trabajo con run_at futuro no se reclama hasta su hora', async () => {
  const env = await envVars()
  const { q, clockObj } = env
  const id = q.enqueue('analyze', {}, { runAt: clockObj.t + 5000 })
  assert.equal(q.claim('w'), null)
  assert.equal(q.nextRunAt(), clockObj.t + 5000)
  clockObj.t += 5000
  assert.equal(q.claim('w').id, id)
  await env.close()
})

test('reclamar suma un intento, fija arriendo y worker', async () => {
  const env = await envVars()
  const { q, clockObj, config } = env
  q.enqueue('analyze', { x: 1 })
  const job = q.claim('w-7')
  assert.equal(job.status, 'running')
  assert.equal(job.attempts, 1)
  assert.equal(job.worker_id, 'w-7')
  assert.equal(job.lease_until, clockObj.t + config.worker.leaseMs)
  await env.close()
})

test('barrera de intento: un worker con el intento viejo no cierra el trabajo de otro', async () => {
  const env = await envVars()
  const { q, clockObj, config } = env
  q.enqueue('analyze', {})
  const old = q.claim('w1')
  clockObj.t += config.worker.leaseMs + 1 // vence el arriendo
  const fresh = q.claim('w2') // recupera y reclama: intento 2
  assert.equal(fresh.id, old.id)
  assert.equal(fresh.attempts, 2)
  assert.equal(q.complete(old), false) // intento 1: rechazado
  assert.equal(q.heartbeat(old), false)
  assert.equal(q.fail(old, new Error('x')).state, 'lost')
  assert.equal(q.complete(fresh), true)
  assert.equal(q.getJob(fresh.id).status, 'done')
  await env.close()
})

test('el latido renueva el arriendo y evita la recuperación', async () => {
  const env = await envVars()
  const { q, clockObj, config } = env
  q.enqueue('analyze', {})
  const job = q.claim('w1')
  clockObj.t += config.worker.leaseMs - 1
  assert.equal(q.heartbeat(job), true)
  clockObj.t += config.worker.leaseMs - 1
  assert.equal(q.recoverExpiredLeases().recovered, 0)
  assert.equal(q.getJob(job.id).status, 'running')
  await env.close()
})

test('fail reencola con retroceso exponencial hasta max_attempts y luego falla con el motivo', async () => {
  const env = await envVars()
  const { q, clockObj, config } = env
  const id = q.enqueue('analyze', {})
  const waits = []
  for (let attemptNo = 1; attemptNo <= config.worker.maxAttempts; attemptNo++) {
    const job = q.claim('w')
    assert.equal(job.attempts, attemptNo)
    const r = q.fail(job, new Error(`falla ${attemptNo}`))
    if (attemptNo < config.worker.maxAttempts) {
      assert.equal(r.state, 'requeued')
      waits.push(r.delayMs)
      assert.equal(q.claim('w'), null) // todavía en espera
      clockObj.t += r.delayMs
    } else {
      assert.equal(r.state, 'failed')
    }
  }
  // random = 0 → sin jitter: base × 2^(n−1) con tope.
  assert.deepEqual(waits, [1000, 2000])
  const final = q.getJob(id)
  assert.equal(final.status, 'failed')
  assert.equal(final.last_error, `falla ${config.worker.maxAttempts}`)
  await env.close()
})

test('el retroceso respeta el tope y el jitter lo reduce', async () => {
  const env = await envVars()
  assert.equal(env.q.backoffMs(1), 1000)
  assert.equal(env.q.backoffMs(20), env.config.worker.retryMaxMs)
  const { createQueue } = await import('./index.js')
  const withJitter = createQueue({ db: env.db, config: env.config, events: env.events, random: () => 0.5 })
  assert.equal(withJitter.backoffMs(1), 500) // jitter completo: 1000 × (1 − 0,5)
  await env.close()
})

test('un error con retryable=false falla de inmediato sin gastar los demás intentos', async () => {
  const env = await envVars()
  const { q } = env
  q.enqueue('analyze', {})
  const job = q.claim('w')
  const e = Object.assign(new Error('definitivo'), { retryable: false })
  assert.equal(q.fail(job, e).state, 'failed')
  await env.close()
})

test('recuperar arriendos vencidos: reencola, o falla si agotó los intentos', async () => {
  const env = await envVars()
  const { q, clockObj, config } = env
  const id = q.enqueue('analyze', {}, { maxAttempts: 2 })
  q.claim('w1')
  clockObj.t += config.worker.leaseMs + 1
  assert.deepEqual(q.recoverExpiredLeases(), { recovered: 1, failedIds: [] })
  assert.equal(q.getJob(id).status, 'queued')
  q.claim('w2') // intento 2 de 2
  clockObj.t += config.worker.leaseMs + 1
  const r = q.recoverExpiredLeases()
  assert.deepEqual(r.failedIds, [id])
  assert.equal(q.getJob(id).status, 'failed')
  assert.match(q.getJob(id).last_error, /arriendo/)
  await env.close()
})

test('release devuelve el trabajo a la cola y reembolsa el intento', async () => {
  const env = await envVars()
  const { q } = env
  const id = q.enqueue('analyze', {})
  const job = q.claim('w')
  assert.equal(q.release(job), true)
  const dbRow = q.getJob(id)
  assert.equal(dbRow.status, 'queued')
  assert.equal(dbRow.attempts, 0)
  await env.close()
})

test('defer aplaza sin gastar el intento', async () => {
  const env = await envVars()
  const { q, clockObj } = env
  const id = q.enqueue('analyze', {})
  const job = q.claim('w')
  assert.equal(q.defer(job, 4000), true)
  assert.equal(q.getJob(id).attempts, 0)
  assert.equal(q.claim('w'), null)
  clockObj.t += 4000
  assert.equal(q.claim('w').id, id)
  await env.close()
})

test('cancelar un trabajo en curso lo saca de la cola y su dueño lo nota por la barrera', async () => {
  const env = await envVars()
  const { q } = env
  const id = q.enqueue('analyze', {})
  const job = q.claim('w')
  let notified = null
  q.signals.on('cancelled', (j) => { notified = j })
  assert.equal(q.cancel(id), true)
  assert.equal(notified, id)
  assert.equal(q.heartbeat(job), false)
  assert.equal(q.progress(job, 10, 'x'), false)
  assert.equal(q.cancel(id), false) // ya no está en cola ni en curso
  await env.close()
})

test('retención: borra trabajos terminados y eventos con más de siete días, no los recientes', async () => {
  const env = await envVars()
  const { q, clockObj, db, config, events } = env
  const old = q.enqueue('analyze', {})
  q.complete(q.claim('w'))
  events.publish({ kind: 'message', data: {} })
  clockObj.t += config.worker.retentionDays * 24 * 3600 * 1000 + 1
  const recent = q.enqueue('analyze', {})
  const r = q.sweepRetention()
  assert.equal(r.jobs, 1)
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM jobs WHERE id = ?', old).n, 0)
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM jobs WHERE id = ?', recent).n, 1)
  await env.close()
})

test('el progreso queda en job_events con el miembro dueño del input y exige el intento vigente', async () => {
  const env = await envVars()
  const { q, db } = env
  run(db, "INSERT INTO members (email, name, created_at) VALUES ('a@x.y', 'A', 1)")
  run(db, "INSERT INTO inputs (author_id, content_hash, created_at, updated_at) VALUES (1, 'h', 1, 1)")
  q.enqueue('analyze', {}, { inputId: 1 })
  const job = q.claim('w')
  assert.equal(q.progress(job, 40.4, 'leyendo'), true)
  const dbRow = get(db, "SELECT * FROM job_events WHERE kind = 'progress'")
  assert.equal(dbRow.member_id, 1)
  assert.equal(dbRow.percent, 40)
  assert.equal(dbRow.phrase, 'leyendo')
  await env.close()
})

test('dos procesos reclaman en paralelo sin un solo duplicado (M2 del informe 03)', async () => {
  const env = await makeEnv({ seed: false })
  const N = 100
  for (let i = 0; i < N; i++) env.queue.enqueue('analyze', { i })
  const scriptPath = path.join(env.dir, 'reclamar.mjs')
  writeFileSync(scriptPath, `
    import { loadConfig } from ${JSON.stringify(new URL('../config.js', import.meta.url).href)}
    import { openInitialized } from ${JSON.stringify(new URL('../db/index.js', import.meta.url).href)}
    import { createQueue } from ${JSON.stringify(new URL('./index.js', import.meta.url).href)}
    import { createEvents } from ${JSON.stringify(new URL('../events/index.js', import.meta.url).href)}
    const config = loadConfig({ DATA_DIR: ${JSON.stringify(env.dir)} })
    const db = openInitialized(config)
    const q = createQueue({ db, config, events: createEvents({ db }) })
    const ids = []
    // Una pausa de trabajo entre reclamos, como en un worker real: sin ella un proceso en bucle cerrado acapara el candado
    // de escritura (SQLite no es justo) y el otro agota su busy_timeout con synchronous=FULL.
    for (;;) { const j = q.claim('hijo-' + process.pid); if (!j) break; ids.push(j.id); await new Promise((r) => setTimeout(r, 15)); q.complete(j) }
    console.log(JSON.stringify(ids))
  `)
  const runIt = () => new Promise((resolve, reject) => {
    const h = spawn(process.execPath, [scriptPath], { stdio: ['ignore', 'pipe', 'inherit'] })
    let outText = ''
    h.stdout.on('data', (d) => { outText += d })
    h.on('close', (c) => (c === 0 ? resolve(JSON.parse(outText)) : reject(new Error(`salió con ${c}`))))
  })
  const [a, b] = await Promise.all([runIt(), runIt()])
  const everyone = [...a, ...b]
  assert.equal(everyone.length, N)
  assert.equal(new Set(everyone).size, N) // ningún trabajo reclamado dos veces
  assert.ok(a.length > 0 && b.length > 0, 'los dos procesos deberían haber reclamado algo')
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM jobs WHERE status = 'done'").n, N)
  rmSync(scriptPath)
  await env.close()
})
