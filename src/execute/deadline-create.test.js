// The deadline of the job against the machine hooks (2026-10-28, conformance case destroy-deadline on a loaded host). Without Docker: the host's "daemon" is a detached
// shell that makes the machine some time after CREATE was asked, so cutting CREATE leaves a machine that DESTROY cannot find yet, as `docker run -d` does.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { runMachine } from './runners.js'

describe('the deadline of the job during CREATE and DESTROY', () => {
  let dir
  before(() => { dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'deadline-create-')) })
  after(() => { rmSync(dir, { recursive: true, force: true }) })

  /** The hooks of a host whose machine appears `createS` seconds after CREATE starts and whose CREATE reports it `NAME_LAG_S` later (a real CREATE prints the name once the
   * machine exists; ending in the same instant as the detached "daemon" made DESTROY race the file's creation, 2026-10-28); DESTROY takes `destroyS` seconds and removes it if it is there. */
  const NAME_LAG_S = 0.3
  function host (name, { createS, destroyS = 0, execute = {} }) {
    const root = join(dir, name); mkdirSync(join(root, 'machines'), { recursive: true }); mkdirSync(join(root, 'w'), { recursive: true })
    const log = join(root, 'log')
    const config = loadConfig({ DATA_DIR: root, LOG_LEVEL: 'silent' }, {
      execute: {
        runner: 'machine', timeoutMs: 500, killGraceMs: 200, createSettleMs: 5000,
        machineCreate: `setsid sh -c 'sleep ${createS}; : > ${root}/machines/vm-{job_id}' </dev/null >/dev/null 2>&1 & echo "create" >> ${log}; sleep ${createS + NAME_LAG_S}; echo vm-{job_id}`,
        machineRun: `echo run >> ${log}; sleep 30`,
        machineDestroy: `echo "destroy {machine}" >> ${log}; sleep ${destroyS}; rm -f ${root}/machines/$(echo {machine}); echo "destroyed" >> ${log}`,
        ...execute
      }
    })
    return { root, config, log: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []), alive: () => readdirSync(join(root, 'machines')) }
  }
  const go = (h, jobId) => runMachine({ config: h.config, jobId, workdir: join(h.root, 'w'), args: ['-p'], prompt: 'p', env: {} })
  const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  it('a deadline that expires while CREATE runs waits for CREATE, skips RUN and destroys the machine CREATE named', async () => {
    const h = host('slow-create', { createS: 1.5 })
    const r = await go(h, 7)
    assert.equal(r.timedOut, true, 'the job still ends by its deadline')
    assert.equal(r.phase, 'create')
    assert.equal(r.machine, 'vm-7', 'the name CREATE printed, not the default team-job-7')
    assert.equal(r.destroy.code, 0)
    assert.deepEqual(h.log(), ['create', "destroy 'vm-7'", 'destroyed'], 'no RUN after the deadline')
    await settle(500)
    assert.deepEqual(h.alive(), [], 'no machine is left')
  })

  it('a CREATE that does not end within the settle time is cut, and DESTROY runs with the default name', async () => {
    const h = host('hung-create', { createS: 30, execute: { createSettleMs: 300 } })
    const t = Date.now()
    const r = await go(h, 8)
    assert.ok(Date.now() - t < 5000, 'cut after the deadline plus the settle time')
    assert.equal(r.timedOut, true)
    assert.equal(r.machine, 'team-job-8')
    assert.equal(r.destroy.code, 0)
    assert.deepEqual(h.log().filter((l) => l.startsWith('destroy ')), ["destroy 'team-job-8'"])
  })

  it('DESTROY is not cut by the deadline of the session', async () => {
    const h = host('slow-destroy', { createS: 0, destroyS: 1.2, execute: { machineRun: 'sleep 30' } })
    const r = await go(h, 9)
    assert.equal(r.timedOut, true, 'the session was cut by the deadline (500 ms)')
    assert.equal(r.destroy.code, 0, 'DESTROY took 1.2 s, longer than the deadline, and ended')
    assert.deepEqual(h.log().slice(-2), ["destroy 'vm-9'", 'destroyed'])
  })

  it('EXECUTE_DESTROY_TIMEOUT_MS and EXECUTE_CREATE_SETTLE_MS: the omissions and the declared values', () => {
    const base = { DATA_DIR: dir, LOG_LEVEL: 'silent' }
    const x = loadConfig(base).execute
    assert.equal(x.createSettleMs, 120000)
    assert.equal(x.destroyTimeoutMs, 3600000, 'a host with the default deadline keeps one hour for DESTROY')
    assert.equal(loadConfig({ ...base, EXECUTE_TIMEOUT_MS: '10000' }).execute.destroyTimeoutMs, 300000, 'a short deadline does not shorten DESTROY below five minutes')
    assert.equal(loadConfig({ ...base, EXECUTE_TIMEOUT_MS: '10000', EXECUTE_DESTROY_TIMEOUT_MS: '7000', EXECUTE_CREATE_SETTLE_MS: '0' }).execute.destroyTimeoutMs, 7000)
    assert.equal(loadConfig({ ...base, EXECUTE_CREATE_SETTLE_MS: '0' }).execute.createSettleMs, 0)
  })
})
