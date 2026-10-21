// Property tests (fast-check, MIT) of the queue claim under concurrency (MASTER-SPEC section 7.3, docs/TEST.md
// layer 3): with N workers claiming at the same time, each on its own connection to the same database file, no job
// is claimed twice, every eligible job is claimed exactly once and the jobs that are not due are never touched.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import fc from 'fast-check'
import { all, openInitialized } from '../db/index.js'
import { createEvents } from '../events/index.js'
import { makeEnv } from '../testing/helpers.js'
import { createQueue } from './index.js'

const HOUR_MS = 60 * 60 * 1000 // unit conversion only: a job that is not due for an hour
const jobsArb = fc.array(fc.record({ priority: fc.integer({ min: 0, max: 3 }), due: fc.boolean() }), { minLength: 1, maxLength: 40 })

/** Enqueues the jobs and returns the ids of the ones that are due. */
function enqueueAll (env, jobs) {
  return jobs.flatMap((j) => {
    const id = env.queue.enqueue('analyze', {}, { priority: j.priority, runAt: j.due ? null : Date.now() + HOUR_MS })
    return j.due ? [id] : []
  })
}

test('queue claim: concurrent workers on separate connections never claim a job twice and claim every due job once', async () => {
  await fc.assert(fc.asyncProperty(jobsArb, fc.integer({ min: 1, max: 6 }), async (jobs, workerCount) => {
    const env = await makeEnv({ seed: false })
    const connections = []
    try {
      const due = enqueueAll(env, jobs)
      const claimed = await Promise.all(Array.from({ length: workerCount }, async (_, w) => {
        const db = openInitialized(env.config)
        connections.push(db)
        const queue = createQueue({ db, config: env.config, events: createEvents({ db }) })
        const mine = []
        for (;;) {
          const job = queue.claim(`worker-${w}`)
          if (!job) break
          mine.push(job.id)
          await new Promise((resolve) => setImmediate(resolve)) // the others claim while this one "works"
          queue.complete(job)
        }
        return mine
      }))
      const everyone = claimed.flat()
      assert.equal(new Set(everyone).size, everyone.length, 'a job was claimed twice')
      assert.deepEqual([...everyone].sort((a, b) => a - b), [...due].sort((a, b) => a - b))
      const untouched = all(env.db, "SELECT id FROM jobs WHERE status = 'queued'").length
      assert.equal(untouched, jobs.length - due.length, 'a job that is not due was claimed')
    } finally {
      connections.forEach((db) => db.close())
      await env.close()
    }
  }), { numRuns: 25 })
})

test('queue claim: separate processes claiming at the same time never claim a job twice', async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 10, max: 40 }), fc.integer({ min: 2, max: 3 }), async (jobCount, processCount) => {
    const env = await makeEnv({ seed: false })
    const script = path.join(env.dir, 'claim.mjs')
    try {
      for (let i = 0; i < jobCount; i++) env.queue.enqueue('analyze', { i })
      writeFileSync(script, `
        import { loadConfig } from ${JSON.stringify(new URL('../config.js', import.meta.url).href)}
        import { openInitialized } from ${JSON.stringify(new URL('../db/index.js', import.meta.url).href)}
        import { createQueue } from ${JSON.stringify(new URL('./index.js', import.meta.url).href)}
        import { createEvents } from ${JSON.stringify(new URL('../events/index.js', import.meta.url).href)}
        const config = loadConfig({ DATA_DIR: ${JSON.stringify(env.dir)} })
        const db = openInitialized(config)
        const queue = createQueue({ db, config, events: createEvents({ db }) })
        const ids = []
        // A pause between claims, as a real worker has: without it a tight loop hogs the write lock.
        for (;;) { const job = queue.claim('child-' + process.pid); if (!job) break; ids.push(job.id); await new Promise((r) => setTimeout(r, 5)); queue.complete(job) }
        console.log(JSON.stringify(ids))
      `)
      const runOne = () => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'inherit'] })
        let output = ''
        child.stdout.on('data', (d) => { output += d })
        child.on('close', (code) => (code === 0 ? resolve(JSON.parse(output)) : reject(new Error(`child exited with ${code}`))))
      })
      const everyone = (await Promise.all(Array.from({ length: processCount }, runOne))).flat()
      assert.equal(everyone.length, jobCount)
      assert.equal(new Set(everyone).size, jobCount, 'a job was claimed twice')
    } finally {
      rmSync(script, { force: true })
      await env.close()
    }
  }), { numRuns: 3 })
})
