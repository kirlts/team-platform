// Hunt for the failures of the queue under a burst (2026-10-23): fifty messages at once, deliveries to production that overlap and a worker that
// spins while every slot is busy. Each case was reproduced before it was fixed.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { run } from '../db/index.js'
import { makeEnv, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

describe('queue under a burst', () => {
  let env
  before(async () => { env = await makeEnv({}) })
  after(async () => { await env.close() })

  it('a worker with every slot busy does not spin on the jobs that wait: it reads the queue a handful of times, not thousands', async () => {
    let reads = 0
    const queue = { ...env.queue, nextRunAt: () => { reads++; return env.queue.nextRunAt() } }
    const config = { ...env.config, worker: { ...env.config.worker, concurrency: 1 } }
    let running = 0
    const handlers = { extract: { run: async () => { running++; await sleep(700) } } }
    for (let i = 0; i < 3; i++) env.queue.enqueue('extract', {})
    const w = createWorker({ db: env.db, queue, events: env.events, config, handlers })
    w.start()
    await until(() => running === 1)
    reads = 0
    await sleep(500)
    await w.stop()
    assert.ok(reads < 20, `${reads} reads of the queue in 500 ms while one job runs and two wait`)
    run(env.db, "DELETE FROM jobs WHERE kind = 'extract'")
  })

  it('two deliveries to production never run at the same time, and sessions never take the slots of the analysis', async () => {
    env.config.execute.deliverConcurrency = 1
    env.config.execute.concurrency = 0
    env.config.worker.concurrency = 8
    for (let i = 0; i < 3; i++) env.queue.enqueue('deliver', { message_id: null })
    const first = env.queue.claim('w')
    assert.equal(first.kind, 'deliver')
    assert.equal(env.queue.claim('w'), null, 'the second delivery waits for the first')
    env.queue.complete(first)
    assert.equal(env.queue.claim('w').kind, 'deliver', 'and goes when it ends')
    run(env.db, "DELETE FROM jobs WHERE kind = 'deliver'")

    for (let i = 0; i < 8; i++) env.queue.enqueue('execute', { member_id: 0 })
    const taken = []
    for (let i = 0; i < 8; i++) { const j = env.queue.claim('w'); if (j) taken.push(j) }
    assert.equal(taken.length, 6, 'execute holds at most the slots minus two')
    const analysis = env.queue.enqueue('analyze', {})
    assert.equal(env.queue.claim('w').id, analysis, 'the analysis of a new input still has a slot while six sessions work')
    run(env.db, "DELETE FROM jobs WHERE kind IN ('execute', 'analyze')")
  })
})
