// Piece B4 against real containers (drivers/docker-local): a machine that a dead worker left alive is destroyed when the next worker starts, an orderly
// shutdown during RUN destroys the machine, and a DESTROY that the driver refuses stays registered. Without Docker this test FAILS and says so: a
// skipped test did not pass (the rule of the repository).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { get } from '../db/index.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { makeEnv, until } from '../testing/helpers.js'
import { createWorker } from '../worker.js'
import { createExecuteHandler } from './handler.js'
import { machineHealth, nameMachine, openMachine, recordDestroy } from './machines.js'
import { fillCommand, runMachine, spawnStreaming } from './runners.js'

const DRIVER = fileURLToPath(new URL('../../drivers/docker-local/', import.meta.url))
const IMAGE = 'team-platform-agent:test-b4' // its own tag: the other test of the driver builds and tags its own image at the same time
const HOOKS = {
  machineCreate: `bash ${DRIVER}create.sh {job_id} {workdir}`,
  machineRun: `bash ${DRIVER}run.sh {job_id} {workdir} {machine}`,
  machineCollect: `bash ${DRIVER}collect.sh {job_id} {workdir} {machine}`,
  machineDestroy: `bash ${DRIVER}destroy.sh {job_id} {workdir} {machine}`
}
const TIMEOUT_MS = 180_000 // the bound of one order in this test; a hung container must not hang the run
const GRACE_MS = 1000

// A stand-in for Claude Code that prints its init and then keeps the session open for as long as the test needs.
const SLOW_CLAUDE = `#!/bin/sh
cat > /dev/null
echo '{"type":"system","subtype":"init","session_id":"sess-b4"}'
sleep 120
`

describe('B4 against drivers/docker-local', () => {
  let env, dir, state, jobs, counter, vault
  const machines = []
  const saved = {}
  const setEnv = (values) => { for (const [k, v] of Object.entries(values)) { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v } }
  const exists = (name) => { try { execFileSync('docker', ['inspect', name], { stdio: 'ignore' }); return true } catch { return false } }
  const configFor = () => loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent' }, { execute: { runner: 'machine', ...HOOKS, machineBin: '/job/slow-claude', timeoutMs: TIMEOUT_MS, killGraceMs: GRACE_MS } })
  const row = (id) => get(env.db, 'SELECT * FROM execute_machines WHERE id = ?', id)
  const sh = (command) => spawnStreaming('/bin/sh', ['-c', command], { env: process.env, keepStdout: true, timeoutMs: TIMEOUT_MS, graceMs: GRACE_MS })
  /** A job id the driver accepts, and the name of its default machine registered for the final cleanup. */
  const jobId = () => { const id = `b4test-${process.pid}-${++counter}`; machines.push(`tp-job-${id}`); return id }
  function workdirOf (id) {
    const workdir = join(jobs, id)
    mkdirSync(workdir)
    writeFileSync(join(workdir, 'slow-claude'), SLOW_CLAUDE)
    chmodSync(join(workdir, 'slow-claude'), 0o755)
    mkdirSync(join(workdir, 'bin'))
    writeFileSync(join(workdir, 'bin', 'team'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    return workdir
  }

  before(async () => {
    try { execFileSync('docker', ['info'], { stdio: 'ignore' }) } catch {
      assert.fail('Docker does not answer (docker info failed): this test needs a Docker daemon and does not skip without one')
    }
    env = await makeEnv()
    vault = createVault(loadMasterKey({ dataDir: env.dir }))
    dir = mkdtempSync(join(tmpdir(), 'machines-docker-'))
    jobs = join(dir, 'jobs'); mkdirSync(jobs)
    state = join(dir, 'state')
    counter = 0
    execFileSync('docker', ['build', '-q', '--build-arg', 'CLAUDE_PACKAGE=', '-t', IMAGE, DRIVER], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 600_000 })
    setEnv({ TP_DOCKER_IMAGE: IMAGE, TP_DOCKER_STATE: state, TP_DOCKER_REPO: '', TP_DOCKER_MAX_CONTAINERS: undefined, ANTHROPIC_API_KEY: 'valor-de-prueba', TP_DOCKER_PASS_ENV: undefined })
  })

  after(async () => {
    for (const name of machines) { try { execFileSync('docker', ['rm', '-f', '-v', name], { stdio: 'ignore' }) } catch { /* it was destroyed by the test */ } }
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    await env?.close()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('a container left alive with its row by a worker that died is destroyed when the next worker starts', async () => {
    const id = jobId()
    // What the dead worker left: the machine CREATE made and the row it had written before. The job itself is gone from the queue.
    const created = await sh(fillCommand(HOOKS.machineCreate, { job_id: id, workdir: workdirOf(id) }))
    assert.equal(created.code, 0, created.stderr)
    const machine = created.stdout.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
    assert.ok(exists(machine), 'the container is alive before the worker starts')
    const rowId = openMachine(env.db, { jobId: 777001, attempt: 1, machine: `tp-job-${id}`, workdir: join(jobs, id) })
    nameMachine(env.db, rowId, machine)
    assert.deepEqual(machineHealth(env.db).open, 1)

    const config = configFor()
    const handler = createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault, getProviders: env.modules.getProviders })
    const worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers: { execute: handler } })
    worker.start()
    try {
      await until(() => row(rowId).destroyed_at, { timeoutMs: 60_000 })
    } finally { await worker.stop() }
    assert.ok(!exists(machine), 'the worker destroyed the container when it started')
    assert.deepEqual(machineHealth(env.db), { open: 0, failed: [] })
  })

  it('an orderly shutdown while RUN is running destroys the container and closes the row', async () => {
    const id = jobId()
    const workdir = workdirOf(id)
    const controller = new AbortController()
    let handle = null
    const track = {
      begin: (machine) => { handle = openMachine(env.db, { jobId: 777002, attempt: 1, machine, workdir }); return handle },
      named: (h, machine) => nameMachine(env.db, h, machine),
      destroyed: (h, done) => recordDestroy(env.db, h, done)
    }
    let alive = false
    const result = await runMachine({
      config: configFor(), jobId: id, workdir, args: ['-p', '--output-format', 'stream-json'], prompt: 'espera', env: { TEAM_JOB_ID: id, TEAM_MESSAGE_ID: '88', TEAM_BRANCH: 'tp/88' },
      signal: controller.signal, track,
      onData: () => { if (!alive) { alive = true; assert.ok(exists(`tp-job-${id}`), 'the session is running in its container'); controller.abort('shutdown') } }
    })
    assert.ok(alive, 'the session started before the shutdown')
    assert.equal(result.destroy.code, 0, result.destroy.stderr)
    assert.equal(result.collect, undefined, 'no COLLECT on an abort')
    assert.ok(!exists(`tp-job-${id}`), 'the container is gone')
    assert.ok(row(handle).destroyed_at > 0)
    assert.equal(machineHealth(env.db).open, 0)
  })

  it('a DESTROY that the driver refuses (a container that is not its own) stays registered with the reason; it is not taken for «no machine»', async () => {
    const foreign = `tp-job-foreign-b4-${process.pid}`
    machines.push(foreign)
    execFileSync('docker', ['run', '-d', '--name', foreign, IMAGE, 'sleep', '120'], { stdio: 'ignore' })
    const rowId = openMachine(env.db, { jobId: 777003, attempt: 1, machine: foreign, workdir: dir })
    const config = configFor()
    const handler = createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault, getProviders: env.modules.getProviders })
    const failed = await handler.sweepMachines()
    assert.deepEqual(failed, { destroyed: 0, failed: 1 })
    assert.ok(exists(foreign), 'the container of someone else is not touched')
    assert.equal(row(rowId).destroyed_at, null)
    assert.match(row(rowId).destroy_error, /exit 1: .*is not a machine of this driver/s)
    assert.equal(machineHealth(env.db).failed.length, 1)
    // The row is closed by hand here: the foreign container is not this driver's to destroy.
    recordDestroy(env.db, rowId, { code: 0 })
  })
})
