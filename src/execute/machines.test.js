// The register of machines of the `execute` job (plan 2026, piece B4: nothing is left alive without being attended). Without Docker: the orders
// of the host are small shell commands that write down what they were called with. The test against real containers is machines-docker-local.test.js.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { get } from '../db/index.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { addMember, login, makeEnv, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { createExecuteHandler } from './handler.js'
import { adoptParked, machineHealth, nameMachine, openMachine, orphanMachines, parkMachine, pruneExecuteMachines, recordDestroy, sweepMachines } from './machines.js'
import { runMachine } from './runners.js'

describe('the register of machines', () => {
  let env, log, refuse, configOf, vault
  const reads = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [])
  const row = (id) => get(env.db, 'SELECT * FROM execute_machines WHERE id = ?', id)
  /** A job as the queue holds it while a worker runs it: `running`, the attempt counted, a lease in force. */
  const runningJob = () => {
    const id = env.queue.enqueue('execute', {})
    const job = env.queue.claim('worker-live')
    assert.equal(job.id, id)
    return job
  }

  before(async () => {
    env = await makeEnv()
    log = join(env.dir, 'destroy.log')
    refuse = join(env.dir, 'refuse-destroy') // while this file exists, the DESTROY order exits 7 with a reason on stderr
    // The order of the host: it writes down the markers it received and fails while `refuse` exists.
    const destroy = `printf '%s|%s|%s\\n' {job_id} {machine} {workdir} >> '${log}'; if [ -e '${refuse}' ]; then echo 'permission denied by the host' >&2; exit 7; fi`
    configOf = (execute = {}) => loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent' }, { execute: { runner: 'machine', machineCreate: 'true', machineRun: 'true', machineDestroy: destroy, timeoutMs: 20000, killGraceMs: 200, ...execute } })
    vault = createVault(loadMasterKey({ dataDir: env.dir }))
  })
  after(async () => { await env.close() })

  it('a machine with no job, or whose job is not running under a live lease, is an orphan; the newest machine of a running job is not', () => {
    const now = Date.now()
    const live = runningJob()
    const mine = openMachine(env.db, { jobId: live.id, attempt: live.attempts, machine: 'm-live', workdir: '/w/live', now })
    assert.deepEqual(orphanMachines(env.db, { now }).map((r) => r.id).filter((id) => id === mine), [], 'a running job with its lease in force owns its machine')
    // The lease expired: nobody renews it, the owner is gone.
    assert.deepEqual(orphanMachines(env.db, { now: live.lease_until + 1 }).map((r) => r.id).filter((id) => id === mine), [mine])
    // An earlier row of the same job (a DESTROY that failed in the attempt before) has no owner even while the job runs.
    const older = openMachine(env.db, { jobId: live.id, attempt: live.attempts - 1 || 1, machine: 'm-old', workdir: '/w/old', now })
    const newest = openMachine(env.db, { jobId: live.id, attempt: live.attempts, machine: 'm-new', workdir: '/w/new', now })
    const ids = orphanMachines(env.db, { now }).map((r) => r.id)
    assert.ok(ids.includes(mine) && ids.includes(older), 'the older rows of the job are orphans')
    assert.ok(!ids.includes(newest), 'the newest one stays with its running job')
    // The job ends (done): its machine is an orphan if it was not destroyed.
    env.queue.complete(live)
    assert.ok(orphanMachines(env.db, { now }).map((r) => r.id).includes(newest))
    // A job that was purged from the queue leaves no owner either.
    const gone = openMachine(env.db, { jobId: 999999, attempt: 1, machine: 'm-gone', workdir: '/w/gone', now })
    assert.ok(orphanMachines(env.db, { now }).map((r) => r.id).includes(gone))
    // A closed row is never an orphan.
    recordDestroy(env.db, gone, { code: 0 })
    assert.ok(!orphanMachines(env.db, { now }).map((r) => r.id).includes(gone))
    for (const r of orphanMachines(env.db, { now })) recordDestroy(env.db, r.id, { code: 0 })
  })

  it('the sweep calls DESTROY with the markers that were registered and closes the row; a row open is what /health counts', async () => {
    const id = openMachine(env.db, { jobId: 4001, attempt: 1, machine: 'team-job-4001', workdir: '/w/4001' })
    nameMachine(env.db, id, 'named-by-create')
    assert.equal(machineHealth(env.db).open, 1)
    const r = await sweepMachines({ db: env.db, config: configOf(), concurrency: 4 })
    assert.deepEqual(r, { destroyed: 1, failed: 0 })
    assert.ok(reads().includes('4001|named-by-create|/w/4001'), reads().join('\n'))
    assert.ok(row(id).destroyed_at > 0)
    assert.deepEqual(machineHealth(env.db), { open: 0, failed: [] })
  })

  it('a DESTROY that fails is registered with its reason and stays open: it is not read as «no machine», and it waits for the next start', async () => {
    writeFileSync(refuse, '')
    const id = openMachine(env.db, { jobId: 4002, attempt: 1, machine: 'team-job-4002', workdir: '/w/4002' })
    const first = await sweepMachines({ db: env.db, config: configOf(), concurrency: 4 })
    assert.deepEqual(first, { destroyed: 0, failed: 1 })
    assert.equal(row(id).destroyed_at, null)
    assert.equal(row(id).destroy_attempts, 1)
    assert.match(row(id).destroy_error, /exit 7: permission denied by the host/)
    const health = machineHealth(env.db)
    assert.equal(health.failed.length, 1)
    assert.deepEqual([health.failed[0].job_id, health.failed[0].machine, health.failed[0].attempts], ['4002', 'team-job-4002', 1])
    // When a lease expires only the machines not tried yet are called: a host that keeps failing is not asked on every beat.
    const calls = reads().length
    const beat = await sweepMachines({ db: env.db, config: configOf(), concurrency: 4, untriedOnly: true })
    assert.deepEqual(beat, { destroyed: 0, failed: 0 })
    assert.equal(reads().length, calls, 'no order ran')
    // The next start tries again, and when the host answers 0 the row closes and the error is gone.
    rmSync(refuse, { force: true })
    const start = await sweepMachines({ db: env.db, config: configOf(), concurrency: 4 })
    assert.deepEqual(start, { destroyed: 1, failed: 0 })
    assert.equal(row(id).destroy_error, null)
    assert.equal(row(id).destroy_attempts, 2)
    assert.deepEqual(machineHealth(env.db), { open: 0, failed: [] })
  })

  it('/health turns degraded while a DESTROY has failed, for the anonymous probe too, and says which machine', async () => {
    await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    const cookie = await login(env, 'ana@x.org')
    const healthy = (await env.app.inject({ url: '/health', headers: { cookie } })).json()
    assert.equal(healthy.status, 'ok')
    assert.deepEqual(healthy.machines, { open: 0, destroy_failed: 0, failed: [] })
    writeFileSync(refuse, '')
    const id = openMachine(env.db, { jobId: 4003, attempt: 1, machine: 'team-job-4003', workdir: '/w/4003' })
    await sweepMachines({ db: env.db, config: configOf(), concurrency: 1 })
    assert.equal((await env.app.inject({ url: '/health' })).json().status, 'degraded')
    const detail = (await env.app.inject({ url: '/health', headers: { cookie } })).json()
    assert.equal(detail.machines.destroy_failed, 1)
    assert.match(detail.machines.failed[0].error, /permission denied/)
    rmSync(refuse, { force: true })
    await sweepMachines({ db: env.db, config: configOf(), concurrency: 1 })
    assert.equal(row(id).destroy_error, null)
    assert.equal((await env.app.inject({ url: '/health' })).json().status, 'ok')
  })

  it('the worker destroys the orphans when it starts, through the handler of the job, and not the machine of a job that runs', async () => {
    const orphan = openMachine(env.db, { jobId: 4004, attempt: 1, machine: 'team-job-4004', workdir: '/w/4004' })
    const live = runningJob()
    const owned = openMachine(env.db, { jobId: live.id, attempt: live.attempts, machine: 'team-job-owned', workdir: '/w/owned' })
    const config = configOf()
    const handler = createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault, getProviders: env.modules.getProviders })
    const worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers: { execute: handler } })
    worker.start()
    try {
      await until(() => row(orphan).destroyed_at, { timeoutMs: 10000 })
      assert.equal(row(owned).destroyed_at, null, 'the machine of a job that runs under a live lease is left alone')
      assert.ok(reads().some((l) => l.startsWith('4004|team-job-4004|')))
      assert.ok(!reads().some((l) => l.includes('team-job-owned')))
    } finally {
      await worker.stop()
      env.queue.complete(live)
      recordDestroy(env.db, owned, { code: 0 })
    }
  })

  it('runMachine writes the machine down BEFORE create, names it after, and closes it with DESTROY; a create that failed half way is destroyed and closed', async () => {
    const order = []
    const sequence = join(env.dir, 'sequence.log')
    const config = configOf({
      machineCreate: `echo create >> '${sequence}'; echo created-machine; exit \${CREATE_EXIT:-0}`,
      machineRun: `echo run >> '${sequence}'`,
      machineDestroy: `echo "destroy {machine}" >> '${sequence}'`
    })
    let id
    const track = {
      begin: (machine) => { order.push('begin'); writeFileSync(join(env.dir, 'begin.flag'), ''); id = openMachine(env.db, { jobId: 4005, attempt: 1, machine, workdir: '/w/4005' }); return id },
      named: (handle, machine) => { order.push(`named ${machine}`); nameMachine(env.db, handle, machine) },
      destroyed: (handle, done) => { order.push(`destroyed ${done.code}`); recordDestroy(env.db, handle, done) }
    }
    const workdir = join(env.dir, 'job-4005'); mkdirSync(workdir, { recursive: true })
    const ok = await runMachine({ config, jobId: 4005, workdir, args: ['-p'], prompt: 'p', env: {}, track })
    assert.equal(ok.code, 0)
    assert.deepEqual(order, ['begin', 'named created-machine', 'destroyed 0'])
    assert.equal(readFileSync(sequence, 'utf8').split('\n').filter(Boolean)[0], 'create', 'begin ran first: the register was written before the order that creates')
    assert.equal(row(id).machine, 'created-machine')
    assert.ok(row(id).destroyed_at > 0)
    // CREATE fails half way (it printed a name and exited 1): DESTROY runs for that machine and the row closes.
    order.length = 0
    process.env.CREATE_EXIT = '1'
    try {
      const half = await runMachine({ config, jobId: 4005, workdir, args: ['-p'], prompt: 'p', env: {}, track })
      assert.equal(half.phase, 'create')
      assert.equal(half.destroy.code, 0)
      assert.deepEqual(order, ['begin', 'named created-machine', 'destroyed 0'])
      assert.ok(row(id).destroyed_at > 0)
    } finally { delete process.env.CREATE_EXIT }
  })

  it('an orderly shutdown during RUN runs DESTROY (and skips COLLECT); the machine is not left for the next attempt', async () => {
    const seen = join(env.dir, 'shutdown.log')
    const workdir = join(env.dir, 'job-4006'); mkdirSync(workdir, { recursive: true })
    const config = configOf({
      machineCreate: 'echo m-4006',
      machineRun: `echo started >> '${seen}'; echo '{"type":"system"}'; sleep 30`,
      machineCollect: `echo collect >> '${seen}'`,
      machineDestroy: `printf "destroy %s\\n" {machine} >> '${seen}'`
    })
    const controller = new AbortController()
    const handles = []
    const track = {
      begin: (machine) => { const id = openMachine(env.db, { jobId: 4006, attempt: 1, machine, workdir }); handles.push(id); return id },
      named: (handle, machine) => nameMachine(env.db, handle, machine),
      destroyed: (handle, done) => recordDestroy(env.db, handle, done)
    }
    const running = runMachine({ config, jobId: 4006, workdir, args: ['-p'], prompt: 'p', env: {}, signal: controller.signal, track, onData: () => controller.abort('shutdown') })
    const result = await running
    const lines = readFileSync(seen, 'utf8').split('\n').filter(Boolean)
    assert.deepEqual(lines, ['started', 'destroy m-4006'], 'DESTROY ran, COLLECT did not')
    assert.equal(result.destroy.code, 0)
    assert.equal(result.detached, undefined, 'nothing stays alive for the next attempt')
    assert.ok(row(handles[0]).destroyed_at > 0)
  })

  it('a machine kept on purpose by a shutdown is respected while its job is still to run, adopted by the next attempt, and destroyed when its job is not coming back', async () => {
    const now = Date.now()
    const id = env.queue.enqueue('execute', {})
    const job = env.queue.claim('worker-park')
    const parked = openMachine(env.db, { jobId: id, attempt: job.attempts, machine: 'vm-park', workdir: '/w/park', now })
    parkMachine(env.db, parked)
    env.queue.release(job) // the shutdown: the job goes back to the queue
    assert.ok(!orphanMachines(env.db, { now }).map((r) => r.id).includes(parked), 'its job is queued: the machine waits for the attempt that re-attaches')
    // The next attempt: a new row, and CREATE names the same machine, so the parked row continues under it.
    const again = env.queue.claim('worker-park-2')
    const fresh = openMachine(env.db, { jobId: id, attempt: again.attempts, machine: 'team-job-default', workdir: '/w/park2', now })
    assert.ok(!orphanMachines(env.db, { now }).map((r) => r.id).includes(parked), 'while the new attempt runs, the parked row still has an owner')
    nameMachine(env.db, fresh, 'vm-park')
    adoptParked(env.db, { jobId: id, machine: 'vm-park', exceptId: fresh })
    assert.equal(row(parked), undefined, 'adopted: one machine, one row')
    assert.deepEqual(orphanMachines(env.db, { now }).map((r) => r.id).filter((x) => x === fresh), [])
    recordDestroy(env.db, fresh, { code: 0 })
    env.queue.complete(again)
    // A parked machine whose job is not coming back (failed, cancelled, purged) is an orphan; and one the next attempt does not name again is released.
    const id2 = env.queue.enqueue('execute', {})
    const job2 = env.queue.claim('worker-park-3')
    const lost = openMachine(env.db, { jobId: id2, attempt: job2.attempts, machine: 'vm-lost', workdir: '/w/lost', now })
    parkMachine(env.db, lost)
    env.queue.release(job2)
    const next2 = env.queue.claim('worker-park-4')
    const other = openMachine(env.db, { jobId: id2, attempt: next2.attempts, machine: 'vm-other', workdir: '/w/other', now })
    adoptParked(env.db, { jobId: id2, machine: 'vm-other', exceptId: other })
    assert.equal(row(lost).parked, 0, 'the next attempt named another machine: the parked one is not coming back')
    const swept = await sweepMachines({ db: env.db, config: configOf(), concurrency: 2 })
    assert.equal(swept.failed, 0)
    assert.ok(row(lost).destroyed_at > 0, 'and the sweep destroys it')
    assert.equal(row(other).destroyed_at, null, 'while the machine of the job that is still to run is left alone')
    const id3 = openMachine(env.db, { jobId: 999998, attempt: 1, machine: 'vm-purged', workdir: '/w/p', now })
    parkMachine(env.db, id3)
    assert.ok(orphanMachines(env.db, { now }).map((r) => r.id).includes(id3), 'a parked machine whose job was purged has no owner')
    for (const r of orphanMachines(env.db, { now })) recordDestroy(env.db, r.id, { code: 0 })
    recordDestroy(env.db, other, { code: 0 })
    env.queue.complete(next2)
  })

  it('the destroyed rows go with the runs and an open one is never deleted', () => {
    const old = openMachine(env.db, { jobId: 4007, attempt: 1, machine: 'old', workdir: '/w', now: 1000 })
    const open = openMachine(env.db, { jobId: 4008, attempt: 1, machine: 'open', workdir: '/w', now: 1000 })
    recordDestroy(env.db, old, { code: 0 })
    assert.equal(pruneExecuteMachines(env.db, { now: Date.now(), retentionDays: 1 }), 1)
    assert.equal(row(old), undefined)
    assert.ok(row(open))
    recordDestroy(env.db, open, { code: 0 })
  })
})
