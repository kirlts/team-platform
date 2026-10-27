// The driver of Fly Machines (drivers/fly-machines/) against a double of the Fly Machines API (src/execute/fly-api-double.js) whose machines are Docker containers of
// the driver's own image, and the real `runMachine` of the worker, with a fake `claude` inside the machine. Nothing is spent in Fly. What this test cannot say is
// whether the real API behaves as the double does: the double reproduces what was measured on 2026-10-27 and the real run is `node scripts/host-conformance.mjs
// --driver drivers/fly-machines` (README of the driver). Without a Docker daemon it is skipped with its reason (src/testing/requires.js); where the change touches what it walks the directed run demands the daemon (TEAM_REQUIRE_ENV=docker) and then it FAILS without one.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomFillSync } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { requires } from '../testing/requires.js'
import { fillCommand, runMachine, spawnStreaming, writeMachineFiles } from './runners.js'
import { TOKEN, startFlyDouble } from './fly-api-double.js'

const DRIVER = fileURLToPath(new URL('../../drivers/fly-machines/', import.meta.url))
const IMAGE = 'team-platform-agent:fly-test'
const INSTANCE = `ft${process.pid}` // TP_FLY_INSTANCE of this run
const nameOf = (id, instance = INSTANCE) => `tp-${instance}-job-${id}`
const HOOKS = {
  machineCreate: `bash ${DRIVER}create.sh {job_id} {workdir}`,
  machineRun: `bash ${DRIVER}run.sh {job_id} {workdir} {machine}`,
  machineCollect: `bash ${DRIVER}collect.sh {job_id} {workdir} {machine}`,
  machineDestroy: `bash ${DRIVER}destroy.sh {job_id} {workdir} {machine}`
}
const TIMEOUT_MS = 240_000 // the bound of one job in this test; a hung machine must not hang the run
const GRACE_MS = 1000

// A stand-in for Claude Code, written as sh. It leaves what a session leaves: a transcript under $CLAUDE_CONFIG_DIR/projects, a capture, a commit pushed to
// the branch, and the NDJSON on stdout. FAKE_MODE: exit3 (dies), slow (waits 3 s between its first line and its result), bigout (3 MB of output).
const FAKE_CLAUDE = `#!/bin/sh
prompt="$(cat)"
mkdir -p "$CLAUDE_CONFIG_DIR/projects/-job"
echo launch >> /job/launches
{
  echo "prompt=$prompt"
  echo "cwd=$(pwd)"
  echo "uid=$(id -u)"
  echo "key=$ANTHROPIC_API_KEY"
  echo "home=$HOME"
  echo "team_on_path=$(command -v team)"
  echo "big=$(sha256sum /job/big.bin 2>/dev/null | cut -d' ' -f1)"
} > "$CLAUDE_CONFIG_DIR/projects/-job/sess-1.jsonl"
printf 'png' > "$TEAM_CAPTURES_DIR/shot.png"
echo '{"type":"system","subtype":"init","session_id":"sess-1"}'
echo 'a warning of the session' >&2
if [ "$FAKE_MODE" = exit3 ]; then echo 'session not started' >&2; exit 3; fi
if [ "$FAKE_MODE" = slow ]; then sleep 3; fi
if [ "$FAKE_MODE" = bigout ]; then
  pad="$(head -c 1000 /dev/zero | tr '\\0' a)"
  i=0; while [ $i -lt 3000 ]; do echo "{\\"type\\":\\"assistant\\",\\"n\\":$i,\\"pad\\":\\"$pad\\"}"; i=$((i+1)); done
fi
if [ -d "$TEAM_REPO_DIR/.git" ]; then
  cd "$TEAM_REPO_DIR" && echo change > change.txt && git add change.txt && git commit -q -m "change of the session" && git push -q origin "HEAD:refs/heads/$TEAM_BRANCH" >&2
fi
echo '{"type":"result","subtype":"success","is_error":false,"session_id":"sess-1","total_cost_usd":0}'
`

describe('drivers/fly-machines', { skip: requires('docker') }, () => {
  let dir, repo, state, jobs, counter, flyApi
  const saved = {}
  const setEnv = (values) => { for (const [k, v] of Object.entries(values)) { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v } }
  const sh = (command, extra = {}) => spawnStreaming('/bin/sh', ['-c', command], { env: process.env, keepStdout: true, timeoutMs: TIMEOUT_MS, graceMs: GRACE_MS, ...extra })
  const jobId = () => `flytest-${process.pid}-${++counter}`
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
  // onData of the worker receives stdout and stderr; the lines of the NDJSON are the ones that are JSON objects.
  const jsonLines = (text) => lines(text).filter((l) => l.startsWith('{')).map((l) => JSON.parse(l))
  const lines = (stdout) => stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  const inMachine = (machine, ...command) => execFileSync('docker', ['exec', [...flyApi.machines.values()].find((m) => m.name === machine).container, ...command], { encoding: 'utf8' })

  function workdirOf (id, { big = 0 } = {}) {
    const workdir = join(jobs, id)
    mkdirSync(workdir)
    writeFileSync(join(workdir, 'fake-claude'), FAKE_CLAUDE)
    chmodSync(join(workdir, 'fake-claude'), 0o755)
    mkdirSync(join(workdir, 'bin'))
    writeFileSync(join(workdir, 'bin', 'team'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    if (big) { const data = Buffer.alloc(big); randomFillSync(data); writeFileSync(join(workdir, 'big.bin'), data) }
    return workdir
  }
  const configFor = () => loadConfig({ DATA_DIR: dir, LOG_LEVEL: 'silent' }, { execute: { ...HOOKS, machineBin: '/job/fake-claude', timeoutMs: TIMEOUT_MS, killGraceMs: GRACE_MS } })
  const runJob = (id, workdir, extraEnv = {}, onData = () => {}) => runMachine({
    config: configFor(), jobId: id, workdir, args: ['-p', '--output-format', 'stream-json'], prompt: 'arregla la agenda',
    env: { TEAM_JOB_ID: id, TEAM_MESSAGE_ID: '77', TEAM_BRANCH: 'tp/77', TEAM_AGENT_EMAIL: 'agente@ejemplo.org', ...extraEnv }, onData
  })

  before(async () => {
    try { execFileSync('docker', ['info'], { stdio: 'ignore' }) } catch {
      assert.fail('Docker does not answer (docker info failed): this test needs a Docker daemon and it was demanded (TEAM_REQUIRE_ENV=docker)')
    }
    dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'driver-fly-'))
    jobs = join(dir, 'jobs'); mkdirSync(jobs)
    state = join(dir, 'state')
    repo = join(dir, 'host-repo')
    counter = 0
    mkdirSync(repo)
    git('init', '-q', '-b', 'main')
    writeFileSync(join(repo, 'README'), 'host\n')
    git('add', 'README')
    git('-c', 'user.name=t', '-c', 'user.email=t@x.org', 'commit', '-q', '-m', 'base')
    execFileSync('docker', ['build', '-q', '--build-arg', 'CLAUDE_PACKAGE=', '-t', IMAGE, DRIVER], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 600_000 })
    flyApi = await startFlyDouble()
    setEnv({
      TP_FLY_API: flyApi.url, TP_FLY_APP: flyApi.app, FLY_API_TOKEN: TOKEN, TP_FLY_TOKEN_FILE: undefined, TP_FLY_IMAGE: IMAGE, TP_FLY_STATE: state, TP_FLY_INSTANCE: INSTANCE, TP_FLY_REPO: repo,
      TP_FLY_MAX_MACHINES: undefined, TP_FLY_MAX_LIFE_S: '600', TP_FLY_EXEC_GAP_MS: '0', TP_FLY_POLL_WAIT_S: undefined, TP_FLY_PASS_ENV: undefined, ANTHROPIC_API_KEY: 'valor-de-prueba'
    })
  })

  after(async () => {
    await flyApi?.close()
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('create, run, collect and destroy through the worker: NDJSON on stdout, transcript out, change brought back, machine gone', async () => {
    const id = jobId()
    const workdir = workdirOf(id)
    let streamed = ''
    const result = await runJob(id, workdir, {}, (chunk) => { streamed += chunk })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.phase, 'run')
    assert.equal(result.machine, nameOf(id), 'the last stdout line of create is the machine')
    assert.equal(result.destroy.code, 0)
    assert.equal(result.collect.code, 0, result.collect?.stderr)
    assert.ok(![...flyApi.machines.values()].some((m) => m.name === result.machine), 'destroy removed the machine')
    const events = jsonLines(streamed)
    assert.equal(events.at(0).subtype, 'init')
    assert.equal(events.at(-1).type, 'result')
    assert.match(result.stderr, /a warning of the session/, 'the stderr of the session goes to stderr')
    // The machine as the API was asked to make it.
    const create = flyApi.calls.find((c) => c.method === 'POST' && c.path.endsWith('/machines') && c.body.name === result.machine)
    assert.deepEqual(create.body.config.init.exec, ['sleep', '600'], 'its only process ends after the declared life')
    assert.equal(create.body.config.auto_destroy, true)
    assert.deepEqual(create.body.config.restart, { policy: 'no' })
    assert.deepEqual(create.body.config.guest, { cpu_kind: 'shared', cpus: 1, memory_mb: 256 })
    assert.equal(create.body.config.metadata.team_platform_driver, 'fly-machines')
    assert.equal(create.body.config.metadata.team_platform_instance, INSTANCE)
    // The transcript left the machine before it was destroyed, and `transcript_ref` is where it went.
    const ref = result.collect.ref
    assert.equal(ref, join(state, 'transcripts', id))
    const transcript = readFileSync(join(ref, 'projects', '-job', 'sess-1.jsonl'), 'utf8')
    assert.match(transcript, /prompt=arregla la agenda/)
    assert.match(transcript, /cwd=\/job\/repo$/m, 'with a host repository the session starts in its clone')
    assert.match(transcript, /uid=(?!0$)\d+$/m, 'not as root')
    assert.match(transcript, /key=valor-de-prueba/, 'the key reached the session')
    assert.match(transcript, /home=\/job\/home/)
    assert.match(transcript, /team_on_path=\/job\/bin\/team/)
    assert.equal(readFileSync(join(workdir, 'captures', 'shot.png'), 'utf8'), 'png')
    assert.equal(git('show', 'tp/77:change.txt'), 'change', 'the branch of the message is in the host repository')
    // The key never travelled in a command line of the worker's machine nor in the arguments of an exec that is not the upload of the session's environment.
    assert.ok(!JSON.stringify(flyApi.calls.filter((c) => !c.path.endsWith('/exec'))).includes('valor-de-prueba'))
  })

  it('the output of the session arrives while it runs, not at its end', async () => {
    const id = jobId()
    const seen = []
    const started = Date.now()
    const result = await runJob(id, workdirOf(id), { FAKE_MODE: 'slow' }, (chunk) => seen.push({ at: Date.now(), text: String(chunk) }))
    assert.equal(result.code, 0, result.stderr)
    const first = seen.find((s) => s.text.includes('"subtype":"init"'))
    const last = seen.find((s) => s.text.includes('"type":"result"'))
    assert.ok(first && last, 'both lines arrived')
    assert.ok(last.at - first.at >= 2000, `the first line arrived ${last.at - first.at} ms before the last (the session waits 3 s between them)`)
    assert.ok(first.at - started < last.at - started)
  })

  it('a job directory and an output larger than one exec call carry through intact', async () => {
    const id = jobId()
    const workdir = workdirOf(id, { big: 300_000 })
    const sum = createHash('sha256').update(readFileSync(join(workdir, 'big.bin'))).digest('hex')
    let received = ''
    const result = await runJob(id, workdir, { FAKE_MODE: 'bigout' }, (chunk) => { received += chunk })
    assert.equal(result.code, 0, result.stderr)
    assert.match(readFileSync(join(result.collect.ref, 'projects', '-job', 'sess-1.jsonl'), 'utf8'), new RegExp(`big=${sum}`), '300 KB uploaded in chunks of 12,000 characters arrived with the same sha256')
    const rows = jsonLines(received)
    assert.equal(rows.length, 3002, '3000 lines of output and the two of the session')
    const numbers = rows.filter((e) => e.type === 'assistant').map((e) => e.n)
    assert.deepEqual(numbers, Array.from({ length: 3000 }, (_, i) => i), 'in order, none lost, none repeated')
    assert.ok(received.length > 3_000_000)
  })

  it('RUN is repeatable: a second RUN follows the session that is alive and does not start another', async () => {
    const id = jobId()
    const workdir = workdirOf(id)
    const created = await sh(fillCommand(HOOKS.machineCreate, { job_id: id, workdir }))
    assert.equal(created.code, 0, created.stderr)
    const machine = lines(created.stdout).at(-1)
    try {
      await writeMachineFiles({ workdir, args: ['-p'], prompt: 'hola', env: { TEAM_BRANCH: 'tp/79', TEAM_AGENT_EMAIL: 'agente@ejemplo.org' }, claudeBin: '/job/fake-claude' })
      const first = await sh(fillCommand(HOOKS.machineRun, { job_id: id, workdir, machine }))
      assert.equal(first.code, 0, first.stderr)
      const second = await sh(fillCommand(HOOKS.machineRun, { job_id: id, workdir, machine }))
      assert.equal(second.code, 0, second.stderr)
      assert.match(second.stderr, /already launched/)
      assert.equal(second.stdout, first.stdout, 'the second RUN sees the session from its first line')
      assert.equal(lines(inMachine(machine, 'cat', '/job/launches')).length, 1, 'the session was started once')
    } finally { await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir, machine })) }
  })

  it('a session that fails: its exit code comes through and the machine is destroyed anyway', async () => {
    const id = jobId()
    const result = await runJob(id, workdirOf(id), { FAKE_MODE: 'exit3' })
    assert.equal(result.code, 3)
    assert.match(result.stderr, /session not started/)
    assert.equal(result.destroy.code, 0)
    assert.ok(![...flyApi.machines.values()].some((m) => m.name === nameOf(id)))
  })

  it('a call of the API cut with 408 is asked again with the same offsets and loses nothing', async () => {
    const id = jobId()
    let cut = 0
    flyApi.inject((key, body) => { const isPoll = key.endsWith('/exec') && body?.command?.[1]?.endsWith('poll.mjs'); if (isPoll && cut === 0) { cut += 1; return true } return false }, 408, { error: 'deadline_exceeded' })
    let streamed = ''
    const result = await runJob(id, workdirOf(id), {}, (chunk) => { streamed += chunk })
    assert.equal(cut, 1)
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(jsonLines(streamed).map((e) => e.type), ['system', 'result'], 'both lines, once each')
  })

  it('create: 75 with `##team quota machines=N` at the declared cap, 75 for a refusal of Fly for lack of room or rate, 1 for a wrong request, and the same job gets its machine back', async () => {
    const first = jobId(); const second = jobId(); const third = jobId()
    const alive = [...flyApi.machines.values()].length
    const env = { ...process.env, TP_FLY_MAX_MACHINES: String(alive + 1) }
    const a = await sh(fillCommand(HOOKS.machineCreate, { job_id: first, workdir: dir }), { env })
    assert.equal(a.code, 0, a.stderr)
    const b = await sh(fillCommand(HOOKS.machineCreate, { job_id: second, workdir: dir }), { env })
    assert.equal(b.code, 75)
    assert.ok(new RegExp(`^##team quota machines=${alive + 1}\\s*$`, 'm').test(b.stderr), b.stderr)
    assert.ok(![...flyApi.machines.values()].some((m) => m.name === nameOf(second)), 'the refused job has no machine')
    const again = await sh(fillCommand(HOOKS.machineCreate, { job_id: first, workdir: dir }), { env })
    assert.equal(again.code, 0)
    assert.equal(lines(again.stdout).at(-1), nameOf(first))
    assert.equal([...flyApi.machines.values()].filter((m) => m.name === nameOf(first)).length, 1, 'no second machine')

    flyApi.inject(/^POST .*\/machines$/, 429, { error: 'rate limit exceeded' }, { headers: { 'retry-after': '0' }, times: 20 })
    const limited = await sh(fillCommand(HOOKS.machineCreate, { job_id: second, workdir: dir }))
    assert.equal(limited.code, 75, limited.stderr)
    flyApi.clearInjected()
    flyApi.inject(/^POST .*\/machines$/, 412, { error: 'failed_precondition: could not reserve resource for machine: insufficient memory available to fulfill request' })
    const full = await sh(fillCommand(HOOKS.machineCreate, { job_id: second, workdir: dir }))
    assert.equal(full.code, 75, full.stderr)
    flyApi.inject(/^POST .*\/machines$/, 422, { error: 'invalid_argument: image not found' })
    const wrong = await sh(fillCommand(HOOKS.machineCreate, { job_id: third, workdir: dir }))
    assert.equal(wrong.code, 1, 'a request that is wrong is not a «not now»')
    assert.match(wrong.stderr, /image not found/)
    const down = await sh(fillCommand(HOOKS.machineCreate, { job_id: third, workdir: dir }), { env: { ...process.env, TP_FLY_API: 'http://127.0.0.1:1' } })
    assert.equal(down.code, 75, 'an API that does not answer is a «not now»')
    const d = await sh(fillCommand(HOOKS.machineDestroy, { job_id: first, workdir: dir, machine: nameOf(first) }))
    assert.equal(d.code, 0)
  })

  it('a machine ends by itself after the declared life, with no worker and no destroy', async () => {
    const id = jobId()
    const created = await sh(fillCommand(HOOKS.machineCreate, { job_id: id, workdir: dir }), { env: { ...process.env, TP_FLY_MAX_LIFE_S: '3' } })
    assert.equal(created.code, 0, created.stderr)
    const machine = [...flyApi.machines.values()].find((m) => m.name === nameOf(id))
    assert.deepEqual(machine.config.init.exec, ['sleep', '3'])
    // `docker wait` returns when the container stops: the event, not a timer of the test.
    execFileSync('docker', ['wait', machine.container], { stdio: 'ignore', timeout: 60_000 })
    const listed = await sh(`curl -s -H "authorization: Bearer ${TOKEN}" "${flyApi.url}/v1/apps/${flyApi.app}/machines?metadata.team_platform_job=${id}"`)
    assert.equal(listed.stdout.trim(), '[]', 'Fly no longer lists it')
  })

  it('destroy is idempotent and touches only machines this driver made', async () => {
    const id = jobId()
    const gone = await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: nameOf(id) }))
    assert.equal(gone.code, 0, 'a machine that does not exist is already destroyed')
    // A machine of the same app that the driver did not make (no metadata): it is not found by the driver, so it is left alone.
    const foreign = await sh(`curl -s -X POST -H "authorization: Bearer ${TOKEN}" -H 'content-type: application/json' -d '{"name":"${nameOf(id)}","config":{"image":"${IMAGE}","init":{"exec":["sleep","60"]}}}' "${flyApi.url}/v1/apps/${flyApi.app}/machines"`)
    assert.match(foreign.stdout, /"id"/)
    const left = await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: nameOf(id) }))
    assert.equal(left.code, 0)
    assert.ok([...flyApi.machines.values()].some((m) => m.name === nameOf(id)), 'a machine without the metadata of the driver is not removed')
    const notOurs = await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: 'postgres' }))
    assert.equal(notOurs.code, 1, 'a name that is not the one of the job is refused before the API is asked')
  })

  it('two instances on the same app with the same job id make two machines, count their own, and the destroy of one never touches the other', async () => {
    const id = jobId()
    const other = `${INSTANCE}b`
    const asOther = (extra = {}) => ({ env: { ...process.env, TP_FLY_INSTANCE: other, TP_FLY_STATE: join(dir, 'state-other'), ...extra } })
    const [a, b] = await Promise.all([
      sh(fillCommand(HOOKS.machineCreate, { job_id: id, workdir: dir })),
      sh(fillCommand(HOOKS.machineCreate, { job_id: id, workdir: dir }), asOther())
    ])
    assert.equal(a.code, 0, a.stderr)
    assert.equal(b.code, 0, b.stderr)
    assert.equal(lines(a.stdout).at(-1), nameOf(id))
    assert.equal(lines(b.stdout).at(-1), nameOf(id, other))
    const named = (name) => [...flyApi.machines.values()].filter((m) => m.name === name).length
    assert.equal(named(nameOf(id)), 1)
    assert.equal(named(nameOf(id, other)), 1)
    // The cap counts the machines of the instance that asks.
    const capped = await sh(fillCommand(HOOKS.machineCreate, { job_id: jobId(), workdir: dir }), asOther({ TP_FLY_MAX_MACHINES: '1' }))
    assert.equal(capped.code, 75, 'the other instance has one machine and a cap of one')
    const untouched = await sh(fillCommand(HOOKS.machineCreate, { job_id: jobId(), workdir: dir }), asOther({ TP_FLY_INSTANCE: `${INSTANCE}c`, TP_FLY_MAX_MACHINES: '1' }))
    assert.equal(untouched.code, 0, 'a third instance sees none of the two machines alive')
    const refused = await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: nameOf(id, other) }))
    assert.equal(refused.code, 1, 'the name of another instance is not a machine of this one')
    assert.equal(named(nameOf(id, other)), 1)
    const d = await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: nameOf(id, other) }), asOther())
    assert.equal(d.code, 0, d.stderr)
    assert.equal(named(nameOf(id, other)), 0)
    assert.equal(named(nameOf(id)), 1, 'only the machine of the instance that asked is gone')
    const mine = await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: `team-job-${id}` }))
    assert.equal(mine.code, 0, 'the default name of the core reaches the machine of the job of this instance')
    assert.equal(named(nameOf(id)), 0)
    const bad = await sh(fillCommand(HOOKS.machineCreate, { job_id: id, workdir: dir }), asOther({ TP_FLY_INSTANCE: 'Bad_1' }))
    assert.equal(bad.code, 1)
    assert.match(bad.stderr, /TP_FLY_INSTANCE must be/)
  })

  it('collect: exit 3 and no reference when the session left no transcript', async () => {
    const id = jobId()
    const workdir = workdirOf(id)
    await writeMachineFiles({ workdir, args: ['-p'], prompt: 'hola', env: { TEAM_BRANCH: 'tp/80' }, claudeBin: '/job/fake-claude' })
    const created = await sh(fillCommand(HOOKS.machineCreate, { job_id: id, workdir }))
    const machine = lines(created.stdout).at(-1)
    try {
      const collected = await sh(fillCommand(HOOKS.machineCollect, { job_id: id, workdir, machine }))
      assert.equal(collected.code, 3, collected.stderr)
      assert.equal(lines(collected.stdout).length, 0)
    } finally { await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir, machine })) }
  })

  it('exec() refuses what the machine agent refuses with a 200: a request over the limit is an error, not a success', async () => {
    const id = jobId()
    const created = await sh(fillCommand(HOOKS.machineCreate, { job_id: id, workdir: dir }))
    assert.equal(created.code, 0, created.stderr)
    const { exec, loadSettings } = await import('../../drivers/fly-machines/lib/fly.mjs')
    const machine = [...flyApi.machines.values()].find((m) => m.name === nameOf(id))
    try {
      await assert.rejects(() => exec(loadSettings(), machine.id, ['bash', '-c', 'true', '_', 'a'.repeat(20_000)]), /refused by the machine agent/)
      assert.equal((await exec(loadSettings(), machine.id, ['bash', '-c', 'exit 7'])).code, 7)
    } finally { await sh(fillCommand(HOOKS.machineDestroy, { job_id: id, workdir: dir, machine: nameOf(id) })) }
  })

  it('the example delivery: 0 with the commit when the branch is in the host repository, 1 when it is not, 75 in-machine without a repository', async () => {
    const ok = await sh(`bash ${DRIVER}deliver.sh 77 1 tp/77 ${dir}`)
    assert.equal(ok.code, 0, ok.stderr)
    assert.match(lines(ok.stdout).at(-1), /^[0-9a-f]{7,}$/)
    const again = await sh(`bash ${DRIVER}deliver.sh 77 1 tp/77 ${dir}`)
    assert.equal(lines(again.stdout).at(-1), lines(ok.stdout).at(-1), 'repeatable on the same branch')
    const missing = await sh(`bash ${DRIVER}deliver.sh 99 1 tp/99 ${dir}`)
    assert.equal(missing.code, 1)
    const unset = await sh(`bash ${DRIVER}deliver.sh 77 1 tp/77 ${dir}`, { env: { ...process.env, TP_FLY_REPO: '' } })
    assert.equal(unset.code, 75)
    assert.match(unset.stdout, /##team wait in-machine/)
  })
})
