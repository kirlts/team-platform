// scripts/host-conformance.mjs as a process, the way a host runs it: green against the reference driver with a real Docker daemon (as
// src/execute/drivers-docker-local.test.js does; without a Docker daemon that one case is skipped with its reason, or fails if the run demands the daemon: TEAM_REQUIRE_ENV=docker), and red, naming the case, against a driver
// broken on purpose, a usage error, a missing order and a driver that declares another contract version.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { requires } from '../src/testing/requires.js'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SCRIPT = join(ROOT, 'scripts', 'host-conformance.mjs')
const CASES = ['orders', 'version', 'sequence', 'ndjson', 'transcript', 'deliver', 'deliver-repeat', 'destroy-run-fails', 'destroy-deadline', 'destroy-slow-create', 'destroy-twice', 'destroy-shutdown', 'create-75', 'deliver-75', 'deliver-76']

/** Runs the script and resolves with { code, out, err }. Asynchronous so that nothing else in this process waits for it. */
function conformance (args, env = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SCRIPT, ...args], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''; let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('exit', (code) => resolveRun({ code, out, err }))
  })
}
const verdict = (out, id) => new RegExp(`^(ok  |FAIL) ${id}:`, 'm').exec(out)?.[1].trim() ?? null

describe('scripts/host-conformance.mjs', () => {
  const dirs = []
  const driverDir = (name) => { const d = mkdtempSync(join(ROOT, `.conformance-${name}-`)); dirs.push(d); return d }
  after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

  /** A driver with no Docker: the machine is a process on the host. `overrides` replaces any order. */
  function localDriver (name, overrides = {}) {
    const dir = driverDir(name)
    const scripts = {
      'create.sh': 'echo "creating" >&2\necho "local-$1"\n',
      'run.sh': 'export CLAUDE_CONFIG_DIR="$2/claude"\nmkdir -p "$CLAUDE_CONFIG_DIR"\nexec bash "$2/run.sh"\n',
      'collect.sh': 'echo "$2/claude/projects"\n',
      'destroy.sh': 'echo "destroying $3" >&2\nexit 0\n',
      'deliver.sh': 'echo "##team phase verify"\necho "##team phase deploy"\necho ref-fixed\n',
      ...overrides
    }
    for (const [file, body] of Object.entries(scripts)) { if (body === null) continue; writeFileSync(join(dir, file), `#!/usr/bin/env bash\n${body}`); chmodSync(join(dir, file), 0o755) }
    return dir
  }

  it('--help prints the cases and the requirements and exits 0; no driver, a missing directory and an unknown case exit 2', async () => {
    const help = await conformance(['--help'])
    assert.equal(help.code, 0)
    for (const id of CASES) assert.match(help.out, new RegExp(`^  ${id} `, 'm'), id)
    assert.match(help.out, /Requirements:/)
    assert.match(help.out, /TMPDIR/)
    assert.match(help.out, /Docker/)
    assert.equal((await conformance([])).code, 2)
    const missing = await conformance(['--driver', join(ROOT, 'drivers', 'no-such-driver')])
    assert.equal(missing.code, 2)
    assert.match(missing.err, /does not exist/)
    const unknown = await conformance(['--driver', 'drivers/docker-local', '--only', 'no-such-case'])
    assert.equal(unknown.code, 2)
    assert.match(unknown.err, /Unknown case: no-such-case/)
  })

  it('a driver without one of the five orders fails «orders», names the file, runs nothing else, and exits 1', async () => {
    const dir = localDriver('missing', { 'deliver.sh': null })
    const r = await conformance(['--driver', dir])
    assert.equal(r.code, 1, r.out + r.err)
    assert.match(r.out, /^FAIL orders: .*missing in .*: deliver\.sh/m)
    assert.equal(verdict(r.out, 'sequence'), null, 'nothing ran after the structure failed')
    assert.match(r.out, /NOT met/)
  })

  it('a driver that declares another major version of the contract fails «version» and exits 1', async () => {
    const r = await conformance(['--driver', localDriver('version'), '--only', 'version'], { EXECUTE_CONTRACT_VERSION: '2' })
    assert.equal(r.code, 1, r.out + r.err)
    assert.match(r.out, /^FAIL version: .*driver declares 2: the major versions differ/m)
    const same = await conformance(['--driver', localDriver('version-ok'), '--only', 'version'], { EXECUTE_CONTRACT_VERSION: '1.3' })
    assert.equal(same.code, 0, same.out + same.err)
    assert.match(same.out, /^contract_version: 1\.3 met/m)
  })

  it('a driver broken on purpose (its DESTROY refuses) exits 1 and names the cases that fail, while the ones it does meet stay green', async () => {
    const dir = localDriver('broken', { 'destroy.sh': 'echo "refusing to destroy anything" >&2\nexit 1\n' })
    const r = await conformance(['--driver', dir])
    assert.equal(r.code, 1, r.out + r.err)
    for (const id of ['sequence', 'destroy-run-fails', 'destroy-deadline', 'destroy-twice', 'destroy-shutdown']) assert.equal(verdict(r.out, id), 'FAIL', `${id} should fail:\n${r.out}`)
    assert.match(r.out, /^FAIL sequence: .*destroy ended with 1/m)
    assert.match(r.out, /^FAIL destroy-twice: .*ended with 1 and 1/m)
    for (const id of ['orders', 'ndjson', 'transcript', 'deliver', 'deliver-repeat', 'create-75', 'deliver-75', 'deliver-76']) assert.equal(verdict(r.out, id), 'ok', `${id} should pass:\n${r.out}`)
    assert.match(r.out, /contract_version: 1 NOT met: 6 of 15 cases failed \(sequence, destroy-twice, destroy-run-fails, destroy-deadline, destroy-slow-create, destroy-shutdown\)/)
  })

  it('a case leaves nothing behind: the job that a shutdown returned to the queue does not run inside the next case (it made «deliver-76» count a DELIVER of another message)', async () => {
    // «destroy-shutdown» ends with its execute job back in the queue (contract: attempt refunded). Before the flows cancelled their leftovers, the worker of the next flow claimed that job
    // and its delivery ran in the log of «deliver-76»: 6 failures out of 6 with this pair of cases (measured 2026-10-26).
    const r = await conformance(['--driver', localDriver('leftover'), '--only', 'destroy-shutdown,deliver-76'])
    assert.equal(r.code, 0, r.out + r.err)
    assert.equal(verdict(r.out, 'destroy-shutdown'), 'ok', r.out)
    assert.equal(verdict(r.out, 'deliver-76'), 'ok', r.out)
  })

  it('a driver whose DELIVER is not repeatable fails «deliver-repeat» and only that one', async () => {
    const dir = localDriver('not-repeatable', { 'deliver.sh': 'N="$(dirname "$0")/count"\necho x >> "$N"\necho "ref-$(wc -l < "$N" | tr -d " ")"\n' })
    const r = await conformance(['--driver', dir, '--only', 'deliver,deliver-repeat'])
    assert.equal(r.code, 1, r.out + r.err)
    assert.match(r.out, /^FAIL deliver-repeat: .*the references differ/m)
  })

  it('the reference driver docker-local passes every case against a real Docker daemon, twice at the same time on the same daemon, and the run says the contract_version it meets', { skip: requires('docker') }, async () => {
    try { execFileSync('docker', ['info'], { stdio: 'ignore' }) } catch {
      assert.fail('Docker does not answer (docker info failed): this test needs a Docker daemon and it was demanded (TEAM_REQUIRE_ENV=docker)')
    }
    // Both runs start from job 1 on the same daemon: before instances they named the same machines (tp-job-<id>) and destroyed each other's. The first fixes its
    // instance so that its leftovers can be asked for; the second takes the one the driver derives from its own state directory, which is the default every host gets.
    const instance = `cf${process.pid}`
    const [r, second] = await Promise.all([
      conformance(['--driver', 'drivers/docker-local'], { TP_DOCKER_INSTANCE: instance }),
      conformance(['--driver', 'drivers/docker-local'], { TP_DOCKER_INSTANCE: '' })
    ])
    for (const run of [r, second]) {
      assert.equal(run.code, 0, run.out + run.err)
      for (const id of CASES) assert.equal(verdict(run.out, id), 'ok', `${id}:\n${run.out}`)
      assert.match(run.out, /^contract_version: 1 met \(15 cases passed/m)
    }
    const leftover = execFileSync('docker', ['ps', '-a', '--filter', 'label=team-platform.driver=docker-local', '--filter', `label=team-platform.instance=${instance}`, '--format', '{{.Names}}'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    assert.deepEqual(leftover, [], 'no machine of the run is left')
  })
})
