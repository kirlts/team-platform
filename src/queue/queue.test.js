import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { all, get, run } from '../db/index.js'
import { makeEnv } from '../testing/helpers.js'

/** Environment with controlled clock and randomness. */
async function envVars (initialClock = 1_000_000) {
  const clockObj = { t: initialClock }
  const env = await makeEnv({ seed: false })
  env.clockObj = clockObj
  const { createQueue } = await import('./index.js')
  env.q = createQueue({ db: env.db, config: env.config, events: env.events, now: () => clockObj.t, random: () => 0 })
  return env
}

test('the claim respects priority, then run_at, then id', async () => {
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

test('a job with a future run_at is not claimed until its time', async () => {
  const env = await envVars()
  const { q, clockObj } = env
  const id = q.enqueue('analyze', {}, { runAt: clockObj.t + 5000 })
  assert.equal(q.claim('w'), null)
  assert.equal(q.nextRunAt(), clockObj.t + 5000)
  clockObj.t += 5000
  assert.equal(q.claim('w').id, id)
  await env.close()
})

test('claiming adds an attempt, sets the lease and the worker', async () => {
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

test('attempt fence: a worker with the old attempt does not close another one\'s job', async () => {
  const env = await envVars()
  const { q, clockObj, config } = env
  q.enqueue('analyze', {})
  const old = q.claim('w1')
  clockObj.t += config.worker.leaseMs + 1 // the lease expires
  const fresh = q.claim('w2') // recovers and claims: attempt 2
  assert.equal(fresh.id, old.id)
  assert.equal(fresh.attempts, 2)
  assert.equal(q.complete(old), false) // attempt 1: rejected
  assert.equal(q.heartbeat(old), false)
  assert.equal(q.fail(old, new Error('x')).state, 'lost')
  assert.equal(q.complete(fresh), true)
  assert.equal(q.getJob(fresh.id).status, 'done')
  await env.close()
})

test('the heartbeat renews the lease and prevents recovery', async () => {
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

test('fail respects the Retry-After the provider declares as the floor of the backoff, capped at retryMaxMs', async () => {
  const env = await envVars()
  const { q, config } = env
  q.enqueue('analyze', {})
  const e = Object.assign(new Error('429'), { retryAfterMs: 20_000 })
  const r = q.fail(q.claim('w'), e)
  assert.equal(r.state, 'requeued')
  assert.ok(r.delayMs >= 20_000 && r.delayMs <= config.worker.retryMaxMs, `wait ${r.delayMs}`)
  q.enqueue('analyze', {})
  const big = Object.assign(new Error('429'), { retryAfterMs: 10 * config.worker.retryMaxMs })
  const job2 = q.claim('w')
  assert.equal(q.fail(job2, big).delayMs, config.worker.retryMaxMs)
  await env.close()
})

test('fail requeues with exponential backoff up to max_attempts and then fails with the reason', async () => {
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
      assert.equal(q.claim('w'), null) // still waiting
      clockObj.t += r.delayMs
    } else {
      assert.equal(r.state, 'failed')
    }
  }
  // random = 0 → no jitter: base × 2^(n−1) with cap.
  assert.deepEqual(waits, [1000, 2000])
  const final = q.getJob(id)
  assert.equal(final.status, 'failed')
  assert.equal(final.last_error, `falla ${config.worker.maxAttempts}`)
  await env.close()
})

test('the backoff respects the cap and the jitter reduces it', async () => {
  const env = await envVars()
  assert.equal(env.q.backoffMs(1), 1000)
  assert.equal(env.q.backoffMs(20), env.config.worker.retryMaxMs)
  const { createQueue } = await import('./index.js')
  const withJitter = createQueue({ db: env.db, config: env.config, events: env.events, random: () => 0.5 })
  assert.equal(withJitter.backoffMs(1), 500) // full jitter: 1000 × (1 − 0.5)
  await env.close()
})

test('an error with retryable=false fails immediately without spending the remaining attempts', async () => {
  const env = await envVars()
  const { q } = env
  q.enqueue('analyze', {})
  const job = q.claim('w')
  const e = Object.assign(new Error('definitivo'), { retryable: false })
  assert.equal(q.fail(job, e).state, 'failed')
  await env.close()
})

test('recovering expired leases: requeues, or fails if the attempts ran out', async () => {
  const env = await envVars()
  const { q, clockObj, config } = env
  const id = q.enqueue('analyze', {}, { maxAttempts: 2 })
  q.claim('w1')
  clockObj.t += config.worker.leaseMs + 1
  assert.deepEqual(q.recoverExpiredLeases(), { recovered: 1, failedIds: [] })
  assert.equal(q.getJob(id).status, 'queued')
  q.claim('w2') // attempt 2 of 2
  clockObj.t += config.worker.leaseMs + 1
  const r = q.recoverExpiredLeases()
  assert.deepEqual(r.failedIds, [id])
  assert.equal(q.getJob(id).status, 'failed')
  assert.match(q.getJob(id).last_error, /arriendo/)
  await env.close()
})

test('release returns the job to the queue and refunds the attempt', async () => {
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

test('defer postpones without spending the attempt', async () => {
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

test('cancelling a running job takes it off the queue and its owner notices through the fence', async () => {
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
  assert.equal(q.cancel(id), false) // no longer queued or running
  await env.close()
})

test('retention: deletes finished jobs and events older than seven days, not recent ones', async () => {
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

test('progress is left in job_events with the member who owns the input and requires the current attempt', async () => {
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

test('two processes claim in parallel without a single duplicate (M2 of report 03)', async () => {
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
    // A work pause between claims, as in a real worker: without it a process in a tight loop hogs the write lock
    // (SQLite is not fair) and the other exhausts its busy_timeout with synchronous=FULL.
    for (;;) { const j = q.claim('hijo-' + process.pid); if (!j) break; ids.push(j.id); await new Promise((r) => setTimeout(r, 15)); q.complete(j) }
    console.log(JSON.stringify(ids))
  `)
  const runIt = () => new Promise((resolve, reject) => {
    const h = spawn(process.execPath, [scriptPath], { stdio: ['ignore', 'pipe', 'inherit'] })
    let outText = ''
    h.stdout.on('data', (d) => { outText += d })
    h.on('close', (c) => (c === 0 ? resolve(JSON.parse(outText)) : reject(new Error(`exited with ${c}`))))
  })
  const [a, b] = await Promise.all([runIt(), runIt()])
  const everyone = [...a, ...b]
  assert.equal(everyone.length, N)
  assert.equal(new Set(everyone).size, N) // no job claimed twice
  assert.ok(a.length > 0 && b.length > 0, 'both processes should have claimed something')
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM jobs WHERE status = 'done'").n, N)
  rmSync(scriptPath)
  await env.close()
})
