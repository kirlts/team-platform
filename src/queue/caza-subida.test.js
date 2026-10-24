// Hunt for the failures of the worker under the path of a send (2026-10-24): a job that does not listen to its signal and a database that fails under it.
// Each case was reproduced before it was fixed. Nothing holds the worker, and nothing ends the process, which runs inside the API.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { get } from '../db/index.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'

const fast = { identity: { login: { ipMax: 1000 } }, worker: { retryBaseMs: 5, retryMaxMs: 20 } }

async function setup (opts = {}) {
  const env = await makeEnv({ ...opts, config: { ...fast, ...(opts.config ?? {}), worker: { ...fast.worker, ...(opts.config?.worker ?? {}) } } })
  await addMember(env, { email: 'ana@x.org' })
  env.ana = await login(env, 'ana@x.org')
  env.submit = async (text, files = []) => (await postInput(env, env.ana, { text }, files)).json()
  env.input = (id) => get(env.db, 'SELECT * FROM inputs WHERE id = ?', id)
  env.attempts = (jobId) => get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts
  return env
}


describe('the worker survives the database failing under it', () => {
  // Both failures below end the process when nobody catches them: the worker runs inside the API, so the API goes down with it.
  const watch = async (body) => {
    const seen = []
    const onError = (error) => seen.push(error)
    process.on('uncaughtException', onError)
    process.on('unhandledRejection', onError)
    try { await body() } finally { process.off('uncaughtException', onError); process.off('unhandledRejection', onError) }
    return seen
  }

  it('H-3821: a heartbeat that cannot write (a busy or full database) is not an uncaught exception; the next beat tries again', async () => {
    const env = await setup()
    const config = { ...env.config, worker: { ...env.config.worker, concurrency: 1, heartbeatMs: 20, leaseMs: 5000 } }
    let beats = 0
    const queue = { ...env.queue, heartbeat: (job) => { beats++; if (beats === 1) throw new Error('SQLITE_BUSY: database is locked'); return env.queue.heartbeat(job) } }
    let release
    const handlers = { extract: { run: () => new Promise((resolve) => { release = resolve }) } }
    const jobId = env.queue.enqueue('extract', {})
    const w = createWorker({ db: env.db, queue, events: env.events, config, handlers })
    const seen = await watch(async () => {
      w.start()
      await until(() => beats >= 3)
      release()
      await until(() => env.queue.getJob(jobId).status === 'done')
    })
    await w.stop()
    assert.deepEqual(seen.map((e) => e.message), [])
    await env.close()
  })

  it('H-3822: a failure that cannot even be recorded (the write that closes the job fails) does not end the process, and the job is recovered when its lease runs out', async () => {
    const env = await setup({ config: { worker: { heartbeatMs: 20, leaseMs: 150 } } })
    const config = { ...env.config, worker: { ...env.config.worker, concurrency: 1 } }
    let failing = true
    const queue = { ...env.queue, fail: (...args) => { if (failing) throw new Error('SQLITE_FULL: database or disk is full'); return env.queue.fail(...args) } }
    let runs = 0
    const handlers = { extract: { run: async () => { runs++; if (runs === 1) throw new Error('el trabajo falla') } } }
    const jobId = env.queue.enqueue('extract', {})
    const w = createWorker({ db: env.db, queue, events: env.events, config, handlers })
    const seen = await watch(async () => {
      w.start()
      await until(() => runs === 1 && w.active === 0)
      failing = false
      // The job is still `running` for this worker's id, but this worker no longer runs it: the sweep must not spare it for ever.
      await until(() => env.queue.getJob(jobId).status === 'done', { timeoutMs: 3000 })
    })
    await w.stop()
    assert.deepEqual(seen.map((e) => e.message), [])
    assert.equal(runs, 2, 'the second attempt ran')
    await env.close()
  })
})


describe('the worker is never held by a job that does not listen to its signal', () => {
  it('H-3803: a job that ignores the abort is failed at its time limit and gives its slot back; a stop does not wait for it forever', async () => {
    const env = await setup()
    const config = { ...env.config, worker: { ...env.config.worker, concurrency: 1, maxRuntimeMs: 60, abortGraceMs: 40, maxAttempts: 1 } }
    const handlers = { extract: { run: async () => new Promise(() => {}), onFailure: (job, error, outcome) => { handlers.seen = { message: error.message, state: outcome.state } } } }
    const jobId = env.queue.enqueue('extract', {}, { maxAttempts: 1 })
    const w = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers })
    w.start()
    await until(() => env.queue.getJob(jobId).status === 'failed', { timeoutMs: 2000 })
    assert.match(handlers.seen.message, /superó el tiempo máximo/)
    await until(() => w.active === 0, { timeoutMs: 1000 })
    await w.stop()
    // Shutdown: a job that ignores the abort goes back to the queue and `stop` returns.
    const config2 = { ...config, worker: { ...config.worker, maxRuntimeMs: 600000 } }
    const w2 = createWorker({ db: env.db, queue: env.queue, events: env.events, config: config2, handlers: { extract: { run: async () => new Promise(() => {}) } } })
    const third = env.queue.enqueue('extract', {}, { maxAttempts: 3 })
    w2.start()
    await until(() => env.queue.getJob(third).status === 'running')
    const stopped = await Promise.race([w2.stop().then(() => 'stopped'), new Promise((resolve) => setTimeout(() => resolve('hung'), 1500))])
    assert.equal(stopped, 'stopped')
    assert.equal(w2.active, 0)
    assert.equal(env.queue.getJob(third).status, 'queued', 'the job goes back to the queue and its attempt is refunded')
    await env.close()
  })
})

