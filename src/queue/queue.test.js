import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { all, get, run } from '../db/index.js'
import { makeEnv } from '../testing/helpers.js'

/** Entorno con reloj y azar controlados. */
async function entorno (relojInicial = 1_000_000) {
  const reloj = { t: relojInicial }
  const env = await makeEnv({ seed: false })
  env.reloj = reloj
  const { createQueue } = await import('./index.js')
  env.q = createQueue({ db: env.db, config: env.config, events: env.events, now: () => reloj.t, random: () => 0 })
  return env
}

test('el reclamo respeta prioridad, luego run_at, luego id', async () => {
  const env = await entorno()
  const { q, reloj } = env
  const a = q.enqueue('analyze', {}, { priority: 0 })
  const b = q.enqueue('analyze', {}, { priority: 5 })
  const c = q.enqueue('analyze', {}, { priority: 0, runAt: reloj.t - 10 })
  const orden = [q.claim('w1').id, q.claim('w1').id, q.claim('w1').id]
  assert.deepEqual(orden, [b, c, a])
  assert.equal(q.claim('w1'), null)
  await env.close()
})

test('un trabajo con run_at futuro no se reclama hasta su hora', async () => {
  const env = await entorno()
  const { q, reloj } = env
  const id = q.enqueue('analyze', {}, { runAt: reloj.t + 5000 })
  assert.equal(q.claim('w'), null)
  assert.equal(q.nextRunAt(), reloj.t + 5000)
  reloj.t += 5000
  assert.equal(q.claim('w').id, id)
  await env.close()
})

test('reclamar suma un intento, fija arriendo y worker', async () => {
  const env = await entorno()
  const { q, reloj, config } = env
  q.enqueue('analyze', { x: 1 })
  const job = q.claim('w-7')
  assert.equal(job.status, 'running')
  assert.equal(job.attempts, 1)
  assert.equal(job.worker_id, 'w-7')
  assert.equal(job.lease_until, reloj.t + config.worker.leaseMs)
  await env.close()
})

test('barrera de intento: un worker con el intento viejo no cierra el trabajo de otro', async () => {
  const env = await entorno()
  const { q, reloj, config } = env
  q.enqueue('analyze', {})
  const viejo = q.claim('w1')
  reloj.t += config.worker.leaseMs + 1 // vence el arriendo
  const nuevo = q.claim('w2') // recupera y reclama: intento 2
  assert.equal(nuevo.id, viejo.id)
  assert.equal(nuevo.attempts, 2)
  assert.equal(q.complete(viejo), false) // intento 1: rechazado
  assert.equal(q.heartbeat(viejo), false)
  assert.equal(q.fail(viejo, new Error('x')).state, 'lost')
  assert.equal(q.complete(nuevo), true)
  assert.equal(q.getJob(nuevo.id).status, 'done')
  await env.close()
})

test('el latido renueva el arriendo y evita la recuperación', async () => {
  const env = await entorno()
  const { q, reloj, config } = env
  q.enqueue('analyze', {})
  const job = q.claim('w1')
  reloj.t += config.worker.leaseMs - 1
  assert.equal(q.heartbeat(job), true)
  reloj.t += config.worker.leaseMs - 1
  assert.equal(q.recoverExpiredLeases().recuperados, 0)
  assert.equal(q.getJob(job.id).status, 'running')
  await env.close()
})

test('fail reencola con retroceso exponencial hasta max_attempts y luego falla con el motivo', async () => {
  const env = await entorno()
  const { q, reloj, config } = env
  const id = q.enqueue('analyze', {})
  const esperas = []
  for (let intento = 1; intento <= config.worker.maxAttempts; intento++) {
    const job = q.claim('w')
    assert.equal(job.attempts, intento)
    const r = q.fail(job, new Error(`falla ${intento}`))
    if (intento < config.worker.maxAttempts) {
      assert.equal(r.state, 'requeued')
      esperas.push(r.delayMs)
      assert.equal(q.claim('w'), null) // todavía en espera
      reloj.t += r.delayMs
    } else {
      assert.equal(r.state, 'failed')
    }
  }
  // random = 0 → sin jitter: base × 2^(n−1) con tope.
  assert.deepEqual(esperas, [1000, 2000])
  const final = q.getJob(id)
  assert.equal(final.status, 'failed')
  assert.equal(final.last_error, `falla ${config.worker.maxAttempts}`)
  await env.close()
})

test('el retroceso respeta el tope y el jitter lo reduce', async () => {
  const env = await entorno()
  assert.equal(env.q.backoffMs(1), 1000)
  assert.equal(env.q.backoffMs(20), env.config.worker.retryMaxMs)
  const { createQueue } = await import('./index.js')
  const conJitter = createQueue({ db: env.db, config: env.config, events: env.events, random: () => 0.5 })
  assert.equal(conJitter.backoffMs(1), 500) // jitter completo: 1000 × (1 − 0,5)
  await env.close()
})

test('un error con retryable=false falla de inmediato sin gastar los demás intentos', async () => {
  const env = await entorno()
  const { q } = env
  q.enqueue('analyze', {})
  const job = q.claim('w')
  const e = Object.assign(new Error('definitivo'), { retryable: false })
  assert.equal(q.fail(job, e).state, 'failed')
  await env.close()
})

test('recuperar arriendos vencidos: reencola, o falla si agotó los intentos', async () => {
  const env = await entorno()
  const { q, reloj, config } = env
  const id = q.enqueue('analyze', {}, { maxAttempts: 2 })
  q.claim('w1')
  reloj.t += config.worker.leaseMs + 1
  assert.deepEqual(q.recoverExpiredLeases(), { recuperados: 1, fallidos: [] })
  assert.equal(q.getJob(id).status, 'queued')
  q.claim('w2') // intento 2 de 2
  reloj.t += config.worker.leaseMs + 1
  const r = q.recoverExpiredLeases()
  assert.deepEqual(r.fallidos, [id])
  assert.equal(q.getJob(id).status, 'failed')
  assert.match(q.getJob(id).last_error, /arriendo/)
  await env.close()
})

test('release devuelve el trabajo a la cola y reembolsa el intento', async () => {
  const env = await entorno()
  const { q } = env
  const id = q.enqueue('analyze', {})
  const job = q.claim('w')
  assert.equal(q.release(job), true)
  const fila = q.getJob(id)
  assert.equal(fila.status, 'queued')
  assert.equal(fila.attempts, 0)
  await env.close()
})

test('defer aplaza sin gastar el intento', async () => {
  const env = await entorno()
  const { q, reloj } = env
  const id = q.enqueue('analyze', {})
  const job = q.claim('w')
  assert.equal(q.defer(job, 4000), true)
  assert.equal(q.getJob(id).attempts, 0)
  assert.equal(q.claim('w'), null)
  reloj.t += 4000
  assert.equal(q.claim('w').id, id)
  await env.close()
})

test('cancelar un trabajo en curso lo saca de la cola y su dueño lo nota por la barrera', async () => {
  const env = await entorno()
  const { q } = env
  const id = q.enqueue('analyze', {})
  const job = q.claim('w')
  let avisado = null
  q.señales.on('cancelled', (j) => { avisado = j })
  assert.equal(q.cancel(id), true)
  assert.equal(avisado, id)
  assert.equal(q.heartbeat(job), false)
  assert.equal(q.progress(job, 10, 'x'), false)
  assert.equal(q.cancel(id), false) // ya no está en cola ni en curso
  await env.close()
})

test('retención: borra trabajos terminados y eventos con más de siete días, no los recientes', async () => {
  const env = await entorno()
  const { q, reloj, db, config, events } = env
  const viejo = q.enqueue('analyze', {})
  q.complete(q.claim('w'))
  events.publish({ kind: 'message', data: {} })
  reloj.t += config.worker.retentionDays * 24 * 3600 * 1000 + 1
  const reciente = q.enqueue('analyze', {})
  const r = q.sweepRetention()
  assert.equal(r.trabajos, 1)
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM jobs WHERE id = ?', viejo).n, 0)
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM jobs WHERE id = ?', reciente).n, 1)
  await env.close()
})

test('el progreso queda en job_events con el miembro dueño del input y exige el intento vigente', async () => {
  const env = await entorno()
  const { q, db } = env
  run(db, "INSERT INTO members (email, name, created_at) VALUES ('a@x.y', 'A', 1)")
  run(db, "INSERT INTO inputs (author_id, content_hash, created_at, updated_at) VALUES (1, 'h', 1, 1)")
  q.enqueue('analyze', {}, { inputId: 1 })
  const job = q.claim('w')
  assert.equal(q.progress(job, 40.4, 'leyendo'), true)
  const fila = get(db, "SELECT * FROM job_events WHERE kind = 'progress'")
  assert.equal(fila.member_id, 1)
  assert.equal(fila.percent, 40)
  assert.equal(fila.phrase, 'leyendo')
  await env.close()
})

test('dos procesos reclaman en paralelo sin un solo duplicado (M2 del informe 03)', async () => {
  const env = await makeEnv({ seed: false })
  const N = 100
  for (let i = 0; i < N; i++) env.queue.enqueue('analyze', { i })
  const guion = path.join(env.dir, 'reclamar.mjs')
  writeFileSync(guion, `
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
  const correr = () => new Promise((resolve, reject) => {
    const h = spawn(process.execPath, [guion], { stdio: ['ignore', 'pipe', 'inherit'] })
    let salida = ''
    h.stdout.on('data', (d) => { salida += d })
    h.on('close', (c) => (c === 0 ? resolve(JSON.parse(salida)) : reject(new Error(`salió con ${c}`))))
  })
  const [a, b] = await Promise.all([correr(), correr()])
  const todos = [...a, ...b]
  assert.equal(todos.length, N)
  assert.equal(new Set(todos).size, N) // ningún trabajo reclamado dos veces
  assert.ok(a.length > 0 && b.length > 0, 'los dos procesos deberían haber reclamado algo')
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM jobs WHERE status = 'done'").n, N)
  rmSync(guion)
  await env.close()
})
