// The reference driver of the machine contract (drivers/docker-local/) against a real Docker daemon and the real `runMachine` of the worker, with a
// fake `claude` inside the container: the four hooks (create, run, collect, destroy), the codes 0, 75 and the others, `##team quota`, the last stdout
// line as value, a destroy that always runs and is idempotent, and the example `deliver.sh` with its `##team wait` marks.
// Without a Docker daemon it is skipped with its reason (src/testing/requires.js). When the change touches what it walks, the directed run demands the daemon
// (TEAM_REQUIRE_ENV=docker, scripts/test-dirigido.mjs) and then it FAILS without one: a skipped test did not pass.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { waitPlace, referenceOf } from './deliver.js'
import { fillCommand, runMachine, spawnStreaming, writeMachineFiles } from './runners.js'
import { requires } from '../testing/requires.js'

const DRIVER = fileURLToPath(new URL('../../drivers/docker-local/', import.meta.url))
const IMAGE = 'team-platform-agent:test'
const LABEL = 'team-platform.driver=docker-local'
const INSTANCE = `dt${process.pid}` // this run's own identity on the daemon: nobody else's containers are counted or touched
const INSTANCE_LABEL = `team-platform.instance=${INSTANCE}`
const nameOf = (id, instance = INSTANCE) => `tp-${instance}-job-${id}`
const HOOKS = {
  machineCreate: `bash ${DRIVER}create.sh {job_id} {workdir}`,
  machineRun: `bash ${DRIVER}run.sh {job_id} {workdir} {machine}`,
  machineCollect: `bash ${DRIVER}collect.sh {job_id} {workdir} {machine}`,
  machineDestroy: `bash ${DRIVER}destroy.sh {job_id} {workdir} {machine}`
}
const TIMEOUT_MS = 180_000 // the bound of one job in this test; a hung container must not hang the run
const GRACE_MS = 1000

// A stand-in for Claude Code, written as sh so that any image with a shell runs it. It leaves what a session leaves: a transcript under
// $CLAUDE_CONFIG_DIR/projects, a capture, a commit pushed to the branch, and the NDJSON on stdout.
const FAKE_CLAUDE = `#!/bin/sh
prompt="$(cat)"
mkdir -p "$CLAUDE_CONFIG_DIR/projects/-job"
{
  echo "prompt=$prompt"
  echo "cwd=$(pwd)"
  echo "uid=$(id -u)"
  echo "args=$*"
  echo "key=$ANTHROPIC_API_KEY"
  echo "home=$HOME"
  echo "team_url=$TEAM_URL"
  echo "team_on_path=$(command -v team)"
} > "$CLAUDE_CONFIG_DIR/projects/-job/sess-1.jsonl"
printf 'png' > "$TEAM_CAPTURES_DIR/shot.png"
echo '{"type":"system","subtype":"init","session_id":"sess-1"}'
if [ "$FAKE_MODE" = exit3 ]; then echo 'session not started' >&2; exit 3; fi
if [ -d "$TEAM_REPO_DIR/.git" ]; then
  cd "$TEAM_REPO_DIR" && echo change > change.txt && git add change.txt && git commit -q -m "change of the session" && git push -q origin "HEAD:refs/heads/$TEAM_BRANCH" >&2
fi
echo '{"type":"result","subtype":"success","is_error":false,"session_id":"sess-1","total_cost_usd":0}'
`

describe('drivers/docker-local', { skip: requires('docker') }, () => {
  let dir, repo, state, jobs, counter
  const machines = []
  const saved = {}
  const setEnv = (values) => { for (const [k, v] of Object.entries(values)) { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v } }
  const sh = (command, extra = {}) => spawnStreaming('/bin/sh', ['-c', command], { env: process.env, keepStdout: true, timeoutMs: TIMEOUT_MS, graceMs: GRACE_MS, ...extra })
  const jobId = () => { const id = `drvtest-${process.pid}-${++counter}`; machines.push(nameOf(id)); return id }
  const exists = (name) => { try { execFileSync('docker', ['inspect', name], { stdio: 'ignore' }); return true } catch { return false } }
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
  const lines = (stdout) => stdout.split('\n').map((l) => l.trim()).filter(Boolean)

  /** A job directory as the worker leaves it for a machine: the fake claude next to what `runMachine` writes. */
  function workdirOf (id) {
    const workdir = join(jobs, id)
    mkdirSync(workdir)
    writeFileSync(join(workdir, 'fake-claude'), FAKE_CLAUDE)
    chmodSync(join(workdir, 'fake-claude'), 0o755)
    mkdirSync(join(workdir, 'bin'))
    writeFileSync(join(workdir, 'bin', 'team'), '#!/bin/sh\nexit 0\n', { mode: 0o755 }) // the worker puts its `team` command here
    return workdir
  }
  const configFor = () => loadConfig({ DATA_DIR: dir, LOG_LEVEL: 'silent' }, { execute: { ...HOOKS, machineBin: '/job/fake-claude', timeoutMs: TIMEOUT_MS, killGraceMs: GRACE_MS } })
  const runJob = (id, workdir, extraEnv = {}) => runMachine({
    config: configFor(), jobId: id, workdir, args: ['-p', '--output-format', 'stream-json'], prompt: 'arregla la agenda',
    env: { TEAM_URL: 'http://host.docker.internal:3000', TEAM_JOB_ID: id, TEAM_MESSAGE_ID: '77', TEAM_BRANCH: 'tp/77', TEAM_AGENT_EMAIL: 'agente@ejemplo.org', ...extraEnv },
    onData: () => {}
  })

  before(() => {
    try { execFileSync('docker', ['info'], { stdio: 'ignore' }) } catch {
      assert.fail('Docker does not answer (docker info failed): this test needs a Docker daemon and it was demanded (TEAM_REQUIRE_ENV=docker)')
    }
    dir = mkdtempSync(join(tmpdir(), 'driver-docker-'))
    jobs = join(dir, 'jobs'); mkdirSync(jobs)
    state = join(dir, 'state')
    repo = join(dir, 'host-repo')
    counter = 0
    mkdirSync(repo)
    git('init', '-q', '-b', 'main')
    writeFileSync(join(repo, 'README'), 'host\n')
    git('add', 'README')
    git('-c', 'user.name=t', '-c', 'user.email=t@x.org', 'commit', '-q', '-m', 'base')
    // The same Dockerfile as the real image, without Claude Code (CLAUDE_PACKAGE empty): the session is the fake one.
    execFileSync('docker', ['build', '-q', '--build-arg', 'CLAUDE_PACKAGE=', '-t', IMAGE, DRIVER], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 600_000 })
    setEnv({ TP_DOCKER_IMAGE: IMAGE, TP_DOCKER_STATE: state, TP_DOCKER_INSTANCE: INSTANCE, TP_DOCKER_REPO: repo, TP_DOCKER_MAX_CONTAINERS: undefined, ANTHROPIC_API_KEY: 'valor-de-prueba', TP_DOCKER_PASS_ENV: undefined })
  })

  after(() => {
    for (const name of machines) { try { execFileSync('docker', ['rm', '-f', '-v', name], { stdio: 'ignore' }) } catch { /* it was destroyed by the test */ } }
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('create, run, collect and destroy through the worker: NDJSON on stdout, transcript out, change pushed, machine gone', async () => {
    const id = jobId()
    const workdir = workdirOf(id)
    const result = await runJob(id, workdir)
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.phase, 'run')
    assert.equal(result.machine, nameOf(id), 'the last stdout line of create is the machine')
    assert.equal(result.destroy.code, 0)
    assert.equal(result.collect.code, 0, result.collect?.stderr)
    assert.ok(!exists(result.machine), 'destroy removed the machine')
    // The transcript left the machine before it was destroyed, and `transcript_ref` is where it went.
    const ref = result.collect.ref
    assert.equal(ref, join(state, 'transcripts', id))
    const transcript = readFileSync(join(ref, '-job', 'sess-1.jsonl'), 'utf8')
    assert.match(transcript, /prompt=arregla la agenda/)
    assert.match(transcript, /cwd=\/job\/repo$/m, 'with a host repository the session starts in its clone')
    assert.match(transcript, /uid=(?!0$)\d+$/m, 'not as root')
    assert.match(transcript, /key=valor-de-prueba/, 'the key travels by name')
    assert.match(transcript, /home=\/job\/home/)
    assert.match(transcript, /team_url=http:\/\/host\.docker\.internal:3000/)
    assert.match(transcript, /team_on_path=\/job\/bin\/team/)
    // The capture came back into the worker's directory.
    assert.equal(readFileSync(join(workdir, 'captures', 'shot.png'), 'utf8'), 'png')
    // The branch of the message is in the host repository, with the session's commit.
    assert.equal(git('show', 'tp/77:change.txt'), 'change')
  })

  it('a deadline that expires while CREATE runs: CREATE ends, no session starts, DESTROY removes the machine CREATE named and none is left (2026-10-28)', async () => {
    const id = jobId()
    const workdir = workdirOf(id)
    // CREATE takes 3 s (a loaded host) and the deadline of the job is 1 s.
    const config = loadConfig({ DATA_DIR: dir, LOG_LEVEL: 'silent' }, { execute: { ...HOOKS, machineCreate: `sleep 3; ${HOOKS.machineCreate}`, machineBin: '/job/fake-claude', timeoutMs: 1000, killGraceMs: GRACE_MS } })
    const result = await runMachine({ config, jobId: id, workdir, args: ['-p'], prompt: 'p', env: { TEAM_BRANCH: 'tp/79', TEAM_AGENT_EMAIL: 'agente@ejemplo.org' }, onData: () => {} })
    assert.equal(result.timedOut, true, 'the job ends by its deadline')
    assert.equal(result.phase, 'create')
    assert.equal(result.machine, nameOf(id), 'DESTROY received the machine CREATE named')
    assert.equal(result.destroy.code, 0)
    assert.ok(!exists(nameOf(id)), 'no container is left, not even one in state Created')
    const left = execFileSync('docker', ['ps', '-a', '-q', '--filter', `label=${INSTANCE_LABEL}`, '--filter', `label=team-platform.job=${id}`], { encoding: 'utf8' }).trim()
    assert.equal(left, '')
  })

  it('the stdout of run.sh is only the NDJSON of the session', async () => {
    const id = jobId()
    const workdir = workdirOf(id)
    await writeMachineFiles({ workdir, args: ['-p'], prompt: 'hola', env: { TEAM_BRANCH: 'tp/78', TEAM_AGENT_EMAIL: 'agente@ejemplo.org' }, claudeBin: '/job/fake-claude' })
    const created = await sh(fillCommand(HOOKS.machineCreate, { job_id: id, workdir }))
    assert.equal(created.code, 0, created.stderr)
    const machine = lines(created.stdout).at(-1)
    try {
      const ran = await sh(fillCommand(HOOKS.machineRun, { job_id: id, workdir, machine }))
      assert.equal(ran.code, 0, ran.stderr)
      const out = lines(ran.stdout)
      assert.ok(out.length >= 2)
      for (const l of out) assert.doesNotThrow(() => JSON.parse(l), `not JSON: ${l}`)
      assert.equal(JSON.parse(out.at(-1)).type, 'result')
    } finally { await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir, machine })) }
  })

  it('a session that fails: its exit code comes through and the machine is destroyed anyway', async () => {
    const id = jobId()
    const result = await runJob(id, workdirOf(id), { FAKE_MODE: 'exit3' })
    assert.equal(result.code, 3)
    assert.equal(result.phase, 'run')
    assert.match(result.stderr, /session not started/)
    assert.equal(result.destroy.code, 0)
    assert.ok(!exists(nameOf(id)))
  })

  it('create answers 75 with `##team quota machines=N` when the declared cap is reached, and an image that does not exist is a plain failure', async () => {
    const first = jobId(); const second = jobId()
    const alive = Number(execFileSync('docker', ['ps', '-q', '--filter', `label=${LABEL}`, '--filter', `label=${INSTANCE_LABEL}`], { encoding: 'utf8' }).split('\n').filter(Boolean).length)
    const cap = String(alive + 1)
    const a = await sh(fillCommand(HOOKS.machineCreate, { job_id: first, workdir: dir }), { env: { ...process.env, TP_DOCKER_MAX_CONTAINERS: cap } })
    assert.equal(a.code, 0, a.stderr)
    const b = await sh(fillCommand(HOOKS.machineCreate, { job_id: second, workdir: dir }), { env: { ...process.env, TP_DOCKER_MAX_CONTAINERS: cap } })
    assert.equal(b.code, 75)
    assert.ok(new RegExp(`^##team quota machines=${cap}\\s*$`, 'm').test(b.stderr), b.stderr)
    assert.ok(!exists(nameOf(second)), 'the refused job has no machine')
    // The same job asking twice gets its own machine back, not a second one.
    const again = await sh(fillCommand(HOOKS.machineCreate, { job_id: first, workdir: dir }), { env: { ...process.env, TP_DOCKER_MAX_CONTAINERS: cap } })
    assert.equal(again.code, 0)
    assert.equal(lines(again.stdout).at(-1), nameOf(first))
    const missing = await sh(fillCommand(HOOKS.machineCreate, { job_id: second, workdir: dir }), { env: { ...process.env, TP_DOCKER_IMAGE: 'team-platform-agent:no-such-image' } })
    assert.equal(missing.code, 1)
    assert.match(missing.stderr, /does not exist/)
    const d = await sh(fillCommand(HOOKS.machineDestroy, { job_id: first, workdir: dir, machine: nameOf(first) }))
    assert.equal(d.code, 0)
  })

  it('destroy is idempotent and touches only machines of the driver', async () => {
    const id = jobId()
    const gone = await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: nameOf(id) }))
    assert.equal(gone.code, 0, 'a machine that does not exist is already destroyed')
    const foreign = `tp-job-foreign-${process.pid}`
    machines.push(foreign)
    execFileSync('docker', ['run', '-d', '--name', foreign, IMAGE], { stdio: 'ignore' })
    const refused = await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: foreign }))
    assert.equal(refused.code, 1)
    assert.ok(exists(foreign), 'a container without the label of the driver is not removed')
    const notOurs = await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: 'postgres' }))
    assert.equal(notOurs.code, 1, 'a name that is not tp-<instance>-job-* is refused before docker is asked')
  })

  it('collect: exit 3 and no reference when the session left no transcript', async () => {
    const id = jobId()
    const workdir = workdirOf(id)
    const created = await sh(fillCommand(HOOKS.machineCreate, { job_id: id, workdir }))
    const machine = lines(created.stdout).at(-1)
    try {
      const collected = await sh(fillCommand(HOOKS.machineCollect, { job_id: id, workdir, machine }))
      assert.equal(collected.code, 3)
      assert.equal(lines(collected.stdout).length, 0)
    } finally { await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir, machine })) }
  })

  describe('deliver.sh', () => {
    const deliver = (branch, env = {}) => sh(`bash ${DRIVER}deliver.sh 77 5 ${branch} ${dir}`, { env: { ...process.env, ...env } })

    it('0 with the commit as the last line when the branch exists, with the two phases', async () => {
      git('branch', '-f', 'tp/deliver-ok', 'main')
      const r = await deliver('tp/deliver-ok')
      assert.equal(r.code, 0, r.stderr)
      assert.deepEqual(lines(r.stdout), ['##team phase verify', '##team phase deploy', git('rev-parse', '--short', 'tp/deliver-ok')])
      assert.equal(referenceOf(r.stdout), git('rev-parse', '--short', 'tp/deliver-ok'))
      assert.equal((await deliver('tp/deliver-ok')).code, 0, 'it can run twice on the same branch')
    })

    it('a branch that was never pushed is a failure of the change (code 1, the reason on stderr)', async () => {
      const r = await deliver('tp/never-pushed')
      assert.equal(r.code, 1)
      assert.match(r.stderr, /did not push/)
    })

    it('without a repository it says 75 `in-machine`: the same fault in every try, so the job must not wait', async () => {
      const r = await deliver('tp/deliver-ok', { TP_DOCKER_REPO: '' })
      assert.equal(r.code, 75)
      assert.equal(waitPlace(r.stdout), 'in-machine')
    })

    it('refuses a branch name that is not tp/<id> or carries shell characters (code 2)', async () => {
      assert.equal((await deliver('main')).code, 2)
      assert.equal((await sh(`bash ${DRIVER}deliver.sh 77 5 'tp/a;b' ${dir}`)).code, 2)
    })
  })

  describe('instances on one daemon', () => {
    const otherEnv = (instance, extra = {}) => ({ env: { ...process.env, TP_DOCKER_INSTANCE: instance, ...extra } })
    const labelOf = (name, key) => execFileSync('docker', ['inspect', '-f', `{{index .Config.Labels "${key}"}}`, name], { encoding: 'utf8' }).trim()
    const bashName = (env, job) => execFileSync('bash', ['-c', `. ${DRIVER}common.sh && tp_machine_name ${job}`], { encoding: 'utf8', env }).trim()

    it('two instances with the same job id at the same time make two containers, and the destroy of one never touches the other', async () => {
      const id = jobId()
      const other = `${INSTANCE}b`
      const theirs = nameOf(id, other)
      machines.push(theirs)
      const [a, b] = await Promise.all([
        sh(fillCommand(HOOKS.machineCreate, { job_id: id, workdir: dir })),
        sh(fillCommand(HOOKS.machineCreate, { job_id: id, workdir: dir }), otherEnv(other))
      ])
      assert.equal(a.code, 0, a.stderr)
      assert.equal(b.code, 0, b.stderr)
      assert.equal(lines(a.stdout).at(-1), nameOf(id))
      assert.equal(lines(b.stdout).at(-1), theirs)
      assert.ok(exists(nameOf(id)) && exists(theirs), 'one container each')
      assert.equal(labelOf(nameOf(id), 'team-platform.instance'), INSTANCE)
      assert.equal(labelOf(theirs, 'team-platform.instance'), other)
      // The cap counts the machines of the instance that asks: a third instance with room for one is not refused by the two that are alive.
      const third = await sh(fillCommand(HOOKS.machineCreate, { job_id: id, workdir: dir }), otherEnv(`${INSTANCE}c`, { TP_DOCKER_MAX_CONTAINERS: '1' }))
      machines.push(nameOf(id, `${INSTANCE}c`))
      assert.equal(third.code, 0, third.stderr)
      // One instance asked to destroy a machine of the other: refused, by name and by label, and the container stays.
      const refused = await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: theirs }))
      assert.equal(refused.code, 1)
      assert.ok(exists(theirs), 'the machine of another instance is not removed')
      // The destroy of its own removes its own only.
      const d = await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: theirs }), otherEnv(other))
      assert.equal(d.code, 0, d.stderr)
      assert.ok(!exists(theirs) && exists(nameOf(id)), 'only the one of the instance that asked is gone')
      const mine = await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: nameOf(id) }))
      assert.equal(mine.code, 0, mine.stderr)
      await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: nameOf(id, `${INSTANCE}c`) }), otherEnv(`${INSTANCE}c`))
    })

    it('without TP_DOCKER_INSTANCE the instance comes from the state directory: the same one for the same directory, another for another', () => {
      const clean = { ...process.env, TP_DOCKER_INSTANCE: '' }
      const one = bashName({ ...clean, TP_DOCKER_STATE: join(dir, 'state-one') }, 5)
      assert.match(one, /^tp-[0-9a-f]{8}-job-5$/)
      assert.equal(bashName({ ...clean, TP_DOCKER_STATE: join(dir, 'state-one') }, 5), one)
      assert.notEqual(bashName({ ...clean, TP_DOCKER_STATE: join(dir, 'state-two') }, 5), one)
    })

    it('an instance that is not lower case letters and digits is a permanent fault of the setting (code 1) before docker is asked', async () => {
      for (const bad of ['Bad_1', 'a-b', 'x'.repeat(21)]) {
        const r = await sh(fillCommand(HOOKS.machineCreate, { job_id: jobId(), workdir: dir }), otherEnv(bad))
        assert.equal(r.code, 1, bad)
        assert.match(r.stderr, /TP_DOCKER_INSTANCE must be/)
      }
    })

    it('destroy also retires the machine the core registered before CREATE answered (team-job-<id>) and the one named before instances existed (tp-job-<id>, no instance label)', async () => {
      const id = jobId()
      const created = await sh(fillCommand(HOOKS.machineCreate, { job_id: id, workdir: dir }))
      assert.equal(created.code, 0, created.stderr)
      const byDefault = await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: `team-job-${id}` }))
      assert.equal(byDefault.code, 0, byDefault.stderr)
      assert.ok(!exists(nameOf(id)), 'the default name of the core reaches the machine this driver made for the job')

      const legacy = `tp-job-legacy-${process.pid}`
      machines.push(legacy)
      execFileSync('docker', ['run', '-d', '--name', legacy, '--label', LABEL, IMAGE, 'sleep', '120'], { stdio: 'ignore' })
      const old = await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: legacy }))
      assert.equal(old.code, 0, old.stderr)
      assert.ok(!exists(legacy), 'a machine of the driver without an instance label is the register\'s to retire')

      const stranger = `tp-job-stranger-${process.pid}`
      machines.push(stranger)
      execFileSync('docker', ['run', '-d', '--name', stranger, '--label', LABEL, '--label', `team-platform.instance=${INSTANCE}z`, IMAGE, 'sleep', '120'], { stdio: 'ignore' })
      const refused = await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: stranger }))
      assert.equal(refused.code, 1)
      assert.ok(exists(stranger), 'a machine that belongs to another instance is not removed, whatever its name')
    })
  })

  it('the hooks live where the docs say and are executable', () => {
    for (const f of ['create.sh', 'run.sh', 'collect.sh', 'destroy.sh', 'deliver.sh']) assert.ok(existsSync(join(DRIVER, f)), f)
    assert.ok(readdirSync(DRIVER).includes('Dockerfile'))
  })
})
