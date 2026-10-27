// Piece B4 with a worker killed without warning: the worker is a real process (`node src/worker.js`, WORKER_MODE=external) with drivers/docker-local against a real
// Docker daemon. RUN is running, the process gets SIGKILL, another worker starts and nothing is left alive: the container is destroyed (or taken over by the next
// attempt of the job) and `GET /health` says `machines.open` is 0 again. Without Docker this test FAILS and says so: a skipped test did not pass.
// It is a `.docker.test.js`: run it with `npm run test:sigkill`. The directed selection leaves those out because its containers (tp-job-<job id>) live for seconds and the tests
// of the driver that run beside it count the machines of the daemon.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import { updateMember } from '../domain/members.js'
import { setProjectDescription } from '../domain/settings.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const DRIVER = fileURLToPath(new URL('../../drivers/docker-local/', import.meta.url))
const IMAGE = 'team-platform-agent:test-b4k' // its own tag: the other tests of the driver build and tag theirs at the same time
const LABEL = 'team-platform.driver=docker-local'
// A stand-in for Claude Code that prints its init and keeps the session open for as long as the test needs.
const SLOW_CLAUDE = `#!/bin/sh
cat > /dev/null
echo '{"type":"system","subtype":"init","session_id":"sess-kill"}'
sleep 300
`
// Short lease and heartbeat so that the lease of the killed worker expires within the test; the product values are in src/config.js (30 s and 10 s).
const LEASE_MS = 3000 // a test bound
const HEARTBEAT_MS = 500 // a test bound, below the lease as the configuration demands

describe('B4 with SIGKILL of a real worker process', () => {
  let env, dir, editor, jobId, messageId, agentId
  const children = []
  const saved = {}
  const setEnv = (values) => { for (const [k, v] of Object.entries(values)) { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v } }
  const cookieHeaders = (cookie) => ({ cookie, 'x-team-request': 'panel' })
  const containers = () => execFileSync('docker', ['ps', '-a', '--filter', `label=${LABEL}`, '--filter', `name=^tp-job-${jobId}$`, '--format', '{{.ID}}'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  const idOf = (name) => { try { return execFileSync('docker', ['inspect', '-f', '{{.Id}}', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null } }
  const health = async () => (await env.app.inject({ url: '/health', headers: { cookie: editor } })).json()
  const attemptRows = () => env.db.prepare('SELECT id, attempt, machine, destroyed_at, destroy_attempts FROM execute_machines WHERE job_id = ?').all(jobId)
  const jobRow = () => env.db.prepare('SELECT status, phase, attempts FROM jobs WHERE id = ?').get(jobId)

  function startWorker (name, extra = {}) {
    const slow = join(dir, 'slow-claude')
    const childEnv = {
      ...process.env, DATA_DIR: env.dir, WORKER_MODE: 'external', LOG_LEVEL: 'info', QUEUE_LEASE_MS: String(LEASE_MS), QUEUE_HEARTBEAT_MS: String(HEARTBEAT_MS),
      EXECUTE_RUNNER: 'machine', EXECUTE_MACHINE_CLAUDE_BIN: '/job/slow-claude', EXECUTE_TEAM_URL: 'http://127.0.0.1:1', EXECUTE_KILL_GRACE_MS: '1000',
      // The double of Claude Code travels with the job directory, which RUN copies into the machine.
      EXECUTE_MACHINE_CREATE: `bash ${DRIVER}create.sh {job_id} {workdir}`,
      EXECUTE_MACHINE_RUN: `cp '${slow}' {workdir}/slow-claude && chmod 755 {workdir}/slow-claude && bash ${DRIVER}run.sh {job_id} {workdir} {machine}`,
      EXECUTE_MACHINE_DESTROY: `bash ${DRIVER}destroy.sh {job_id} {workdir} {machine}`,
      ...extra
    }
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/worker.js'], { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    const handle = { name, child, output: '', exited: null }
    child.stdout.on('data', (d) => { handle.output += d })
    child.stderr.on('data', (d) => { handle.output += d })
    child.on('exit', (code, signal) => { handle.exited = { code, signal } })
    children.push(handle)
    return handle
  }
  const ready = (w) => until(() => /worker running/.test(w.output) || w.exited, { timeoutMs: 30_000, everyMs: 50 }).then(() => assert.match(w.output, /worker running/, `${w.name} did not start: ${w.output}`))
  const killed = (w) => new Promise((resolveKill) => { w.child.once('exit', resolveKill); w.child.kill('SIGKILL') })

  /** A fresh execute job for the message, with a worker A that has its session running in a container. Returns A and the id of the container. */
  async function sessionRunning () {
    env.db.prepare("UPDATE jobs SET status = 'cancelled', lease_until = NULL, worker_id = NULL WHERE kind = 'execute' AND status IN ('queued', 'running')").run()
    env.db.prepare('INSERT OR IGNORE INTO message_assignees (message_id, member_id) VALUES (?, ?)').run(messageId, agentId) // a job that ended with a handoff leaves the message to a person
    const queued = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/execute`, headers: cookieHeaders(editor) })
    assert.equal(queued.statusCode, 202, queued.body)
    jobId = Number(queued.json().job_ids[0])
    const a = startWorker('worker A')
    await ready(a)
    try {
      await until(() => jobRow().phase === 'run' && containers().length === 1, { timeoutMs: 120_000, everyMs: 100 })
    } catch (error) { throw new Error(`${error.message}; the job is ${JSON.stringify(jobRow())}; worker A said:\n${a.output.slice(-3000)}`) }
    const id = idOf(`tp-job-${jobId}`)
    assert.ok(id, 'the container of the session exists')
    assert.equal((await health()).machines.open, 1, 'the machine is registered while the session runs')
    return { a, id }
  }

  before(async () => {
    try { execFileSync('docker', ['info'], { stdio: 'ignore' }) } catch {
      assert.fail('Docker does not answer (docker info failed): this test needs a Docker daemon and does not skip without one')
    }
    // The message is made by this process (a pipeline-only worker analyses it); the execute job is enqueued by hand once that worker is stopped, and run by the child processes.
    env = await makeEnv({ worker: true, config: { identity: { login: { ipMax: 1000 } } } })
    dir = mkdtempSync(join(tmpdir(), 'machines-sigkill-'))
    writeFileSync(join(dir, 'slow-claude'), SLOW_CLAUDE)
    chmodSync(join(dir, 'slow-claude'), 0o755)
    execFileSync('docker', ['build', '-q', '--build-arg', 'CLAUDE_PACKAGE=', '-t', IMAGE, DRIVER], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 600_000 })
    setEnv({ TP_DOCKER_IMAGE: IMAGE, TP_DOCKER_STATE: join(dir, 'state'), TP_DOCKER_REPO: '', TP_DOCKER_MAX_CONTAINERS: undefined, TP_DOCKER_PASS_ENV: undefined })
    await addMember(env, { email: 'ed@x.org', role: 'editor' })
    editor = await login(env, 'ed@x.org')
    const created = await env.app.inject({ method: 'POST', url: '/api/members', headers: cookieHeaders(editor), payload: { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Perfil del agente: arreglo pantallas.' } })
    assert.equal(created.statusCode, 201, created.body)
    agentId = Number(created.json().id)
    const authorId = await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    updateMember(env.db, authorId, { profile: 'Perfil de Ana: llevo la agenda de la clínica.' })
    const author = await login(env, 'ana@x.org')
    setProjectDescription(env.db, 'Descripción del proyecto: agenda de clínicas.')
    const res = await postInput(env, author, { text: 'La pantalla de agenda queda en blanco al abrirla.' })
    const inputId = res.json().input_id
    await until(() => env.db.prepare('SELECT status FROM inputs WHERE id = ?').get(inputId).status === 'proposed', { timeoutMs: 10_000 })
    const pub = await env.app.inject({ method: 'POST', url: `/api/inputs/${inputId}/publish`, headers: { ...cookieHeaders(author), 'content-type': 'application/json' }, payload: '{}' })
    assert.equal(pub.statusCode, 200, pub.body)
    messageId = env.db.prepare('SELECT id FROM messages WHERE input_id = ?').get(inputId).id
    await env.worker.stop()
    // The judgement of the Guard of the idea is already made, so the child processes need no model provider.
    env.db.prepare('UPDATE messages SET estimates_json = ? WHERE id = ?').run(JSON.stringify({ idea: 0.1, idea_guard: false, idea_reason: 'prueba' }), messageId)
    env.db.prepare('INSERT OR IGNORE INTO message_assignees (message_id, member_id) VALUES (?, ?)').run(messageId, agentId)
    env.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE kind = 'execute' AND status = 'queued'").run()
    // The machine is named tp-job-<job id> and the daemon is shared with other runs of the driver (the conformance script and its tests start from job 1): the jobs of this test get
    // ids from a range that depends on this process, so that nobody else's container has the name of one of ours.
    const first = 100_000 + (process.pid % 800_000)
    env.db.prepare("INSERT INTO jobs (id, kind, payload_json, status, priority, attempts, max_attempts, run_at, created_at, finished_at) VALUES (?, 'extract', '{}', 'cancelled', 0, 0, 1, ?, ?, ?)").run(first, Date.now(), Date.now(), Date.now())
  })

  after(async () => {
    for (const w of children) { if (w.exited === null) w.child.kill('SIGKILL') }
    try { execFileSync('docker', ['ps', '-a', '-q', '--filter', `label=${LABEL}`, '--filter', 'name=^tp-job-'], { encoding: 'utf8' }).split('\n').filter(Boolean).forEach((id) => { try { execFileSync('docker', ['rm', '-f', '-v', id], { stdio: 'ignore' }) } catch { /* gone */ } }) } catch { /* docker gone */ }
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    await env?.close()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('kill -9 in the middle of RUN, the job is cancelled, another worker starts: it destroys the container and /health says machines.open is 0', async () => {
    const { a, id } = await sessionRunning()
    await killed(a)
    assert.deepEqual(a.exited.signal, 'SIGKILL')
    assert.equal(idOf(`tp-job-${jobId}`), id, 'nothing destroyed the container: the worker died without a chance to')
    const dead = await health()
    assert.equal(dead.machines.open, 1, 'the register still has the machine open: a person looking would see it')
    env.queue.cancel(jobId) // the job does not come back
    const b = startWorker('worker B')
    await ready(b)
    await until(async () => idOf(`tp-job-${jobId}`) === null && (await health()).machines.open === 0, { timeoutMs: 60_000, everyMs: 100 })
    assert.match(b.output, /an orphan machine was destroyed/, 'the worker says it destroyed it')
    assert.equal((await health()).status, 'ok')
    b.child.kill('SIGTERM')
    await until(() => b.exited, { timeoutMs: 15_000 })
    assert.equal(b.exited.code, 0)
  })

  it('kill -9 in the middle of RUN and the job comes back by its expired lease: the container is destroyed or taken over by the next attempt, never two; when the job ends nothing is left', async () => {
    const { a, id } = await sessionRunning()
    await killed(a)
    const b = startWorker('worker B')
    await ready(b)
    // The lease of A expires, the queue gives the job to B (a second attempt) and B either adopts the machine (CREATE returns the same container) or the sweep destroys the old one first.
    try {
      // `jobs.phase` still says «run» from the killed attempt: the second attempt is running when its own row exists and the old one is gone or closed.
      await until(async () => jobRow().attempts >= 2 && jobRow().phase === 'run' && attemptRows().some((r) => r.attempt >= 2) && (await health()).machines.open === 1, { timeoutMs: 90_000, everyMs: 100 })
    } catch (error) { throw new Error(`${error.message}; the job is ${JSON.stringify(jobRow())}; open ${JSON.stringify((await health()).machines)}; worker B said:\n${b.output.slice(-2500)}`) }
    const now = idOf(`tp-job-${jobId}`)
    assert.ok(now, 'the second attempt has its container')
    assert.equal(containers().length, 1, 'one container for the job, not two')
    const open = (await health()).machines.open
    assert.equal(open, 1, `one open row for it: the old one was taken over or destroyed; rows: ${JSON.stringify(attemptRows())}`)
    // The job ends without anyone asking the worker: cancelled. The worker notices at its next heartbeat, aborts the session and destroys the machine.
    env.queue.cancel(jobId)
    await until(async () => containers().length === 0 && (await health()).machines.open === 0, { timeoutMs: 60_000, everyMs: 100 })
    assert.equal(idOf(`tp-job-${jobId}`), null)
    assert.notEqual(now, null)
    assert.ok(id, 'the first container existed before the kill')
    b.child.kill('SIGTERM')
    await until(() => b.exited, { timeoutMs: 15_000 })
  })
})
