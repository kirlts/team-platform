// The version of the host contract (plan 2026, piece A6): one constant, published in /health, declared by the driver with EXECUTE_CONTRACT_VERSION, printed by the worker when
// it starts and refused when the major versions differ. The real worker process is started, not a function that stands in for it.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../config.js'
import { makeEnv, tempDir } from '../testing/helpers.js'
import { CONTRACT_VERSION, checkContractVersion, majorOf } from './contract-version.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Runs `node <script>` in the repository and resolves with its code and output once it exits or, if `stayAlive`, once `until` shows up in the output (then it is stopped). */
function runProcess (script, env, { until = null, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', script], { cwd: root, env: { ...process.env, LOG_LEVEL: 'info', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let stoppedByUs = false
    const look = () => { if (until && until.test(output) && !stoppedByUs) { stoppedByUs = true; child.kill('SIGTERM') } }
    child.stdout.on('data', (d) => { output += d; look() })
    child.stderr.on('data', (d) => { output += d; look() })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, output, stoppedByUs }) })
  })
}

describe('contract_version', () => {
  const dirs = []
  after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

  it('is a single constant, an integer, and the one /health publishes (to anyone, anonymous included)', async () => {
    assert.equal(CONTRACT_VERSION, 1)
    const env = await makeEnv()
    try {
      const health = (await env.app.inject({ url: '/health' })).json()
      assert.equal(health.contract_version, CONTRACT_VERSION)
      assert.equal(health.status, 'ok')
      const prefixed = (await env.app.inject({ url: `${env.config.apiPrefix}/health` })).json()
      assert.equal(prefixed.contract_version, CONTRACT_VERSION)
    } finally { await env.close() }
  })

  it('EXECUTE_CONTRACT_VERSION is optional: empty is not declared, and a malformed one is a configuration error', () => {
    assert.equal(loadConfig({ DATA_DIR: '/data' }).execute.contractVersion, '')
    assert.equal(loadConfig({ DATA_DIR: '/data', EXECUTE_CONTRACT_VERSION: '1' }).execute.contractVersion, '1')
    assert.throws(() => loadConfig({ DATA_DIR: '/data', EXECUTE_CONTRACT_VERSION: 'uno' }), /EXECUTE_CONTRACT_VERSION: «uno» is not a version/)
    assert.throws(() => loadConfig({ DATA_DIR: '/data', EXECUTE_CONTRACT_VERSION: '1.' }), /is not a version/)
  })

  it('compares the major version only: 1 and 1.4 meet contract 1, 2 does not, and no declaration is not checked', () => {
    assert.equal(majorOf('1.4.2'), 1)
    assert.equal(checkContractVersion('1').ok, true)
    assert.equal(checkContractVersion('1.4').ok, true)
    assert.equal(checkContractVersion('2').ok, false)
    assert.equal(checkContractVersion('0.9').ok, false)
    assert.match(checkContractVersion('2').line, /core 1, driver declares 2.*major versions differ/)
    const none = checkContractVersion('')
    assert.deepEqual([none.ok, none.declared], [true, null])
    assert.equal(checkContractVersion(undefined).ok, true)
  })

  describe('the separate worker process', () => {
    const dataDir = () => { const d = tempDir(); dirs.push(d); return d }
    const init = async (d) => {
      const r = await runProcess('src/db/init.js', { DATA_DIR: d, WORKER_MODE: 'external' })
      assert.equal(r.code, 0, r.output)
    }

    it('prints the core\'s version and the declared one when it starts, and keeps running', async () => {
      const d = dataDir(); await init(d)
      const r = await runProcess('src/worker.js', { DATA_DIR: d, WORKER_MODE: 'external', EXECUTE_CONTRACT_VERSION: '1' }, { until: /worker running/ })
      assert.ok(r.stoppedByUs, `it did not reach «worker running»: ${r.output}`)
      assert.match(r.output, /contract_version: core 1, driver declares 1/)
      assert.match(r.output, /"declared_contract_version":"1"/)
    })

    it('without a declaration it starts anyway and says that nothing was checked', async () => {
      const d = dataDir(); await init(d)
      const r = await runProcess('src/worker.js', { DATA_DIR: d, WORKER_MODE: 'external', EXECUTE_CONTRACT_VERSION: '' }, { until: /worker running/ })
      assert.ok(r.stoppedByUs, `it did not reach «worker running»: ${r.output}`)
      assert.match(r.output, /contract_version: core 1, driver declares none \(not checked\)/)
    })

    it('does not start when the driver declares another major version: exit code other than 0 and a message that says so', async () => {
      const d = dataDir(); await init(d)
      const r = await runProcess('src/worker.js', { DATA_DIR: d, WORKER_MODE: 'external', EXECUTE_CONTRACT_VERSION: '2' })
      assert.equal(r.stoppedByUs, false)
      assert.notEqual(r.code, 0, r.output)
      assert.match(r.output, /driver declares 2: the major versions differ/)
      assert.doesNotMatch(r.output, /worker running/)
    })
  })
})
