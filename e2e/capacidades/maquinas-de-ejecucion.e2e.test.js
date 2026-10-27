// Capability «Máquinas de ejecución» (docs/CAPACIDADES-1.0.md): the host connects a driver of four orders (create, run, collect, destroy) and the session runs in that
// machine, which is always destroyed. Here the driver is the reference one, drivers/docker-local, against a real Docker daemon: a person sends, the worker creates a
// container, copies the job into it, runs the double of Claude inside, the double answers THROUGH THE NETWORK to the API of the instance (`team reply` from the
// container), the transcript is collected and the container is destroyed. What is asserted is what the person reads in the thread, not the state of the jobs.
// Docker is a requirement: without it this test fails and says so, a skipped test did not pass. The image is built once (without Claude Code: the session is the double).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { iniciarCiclo, until } from '../contrato/ciclo.mjs'
import { tempDir } from '../../src/testing/helpers.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DRIVER = path.join(ROOT, 'drivers/docker-local')
const IMAGE = 'team-platform-agent:e2e'
// Other sessions of this computer run the same driver at the same time and its machines are named after the job id (small integers): every order of this
// test goes with a prefix of its own, so that it never meets, reuses or destroys a machine that is not its own.
const RUN = `e2e${process.pid}`
const FAKE_SESSION = path.join(ROOT, 'src/execute/testing/fake-claude-stream.mjs')

let c
let state
let wrapper

const machinesOf = (jobId) => execFileSync('docker', ['ps', '-a', '-q', '--filter', `name=^tp-job-${RUN}-${jobId === undefined ? '' : `${jobId}$`}`], { encoding: 'utf8' }).split('\n').filter(Boolean)

before(async () => {
  try { execFileSync('docker', ['info'], { stdio: 'ignore' }) } catch { assert.fail('Docker does not answer (docker info failed): this test needs a Docker daemon and does not skip without one') }
  const started = Date.now()
  // The same Dockerfile as the real image, without Claude Code (CLAUDE_PACKAGE empty). The layers are cached after the first build.
  execFileSync('docker', ['build', '-q', '--build-arg', 'CLAUDE_PACKAGE=', '-t', IMAGE, DRIVER], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 600_000 })
  console.log(`# image ${IMAGE} ready in ${((Date.now() - started) / 1000).toFixed(1)} s`)
  state = tempDir()
  // The order RUN of the host: it puts the double of Claude in the job directory (which the driver copies into the machine) and runs the driver's own run.sh.
  wrapper = path.join(state, 'run-with-double.sh')
  const bin = path.join(state, 'double')
  mkdirSync(bin)
  copyFileSync(FAKE_SESSION, path.join(bin, 'fake-claude-stream.mjs'))
  writeFileSync(path.join(bin, 'claude-double'), `#!/bin/sh
# What Claude Code leaves under $CLAUDE_CONFIG_DIR/projects, then the stream of the fake session; FAKE_CLAUDE is not needed: it is next to this file.
mkdir -p "$CLAUDE_CONFIG_DIR/projects/-job"
echo '{"type":"user","session_id":"sess-0001"}' > "$CLAUDE_CONFIG_DIR/projects/-job/sess-0001.jsonl"
exec node "$(dirname "$0")/fake-claude-stream.mjs" "$@"
`, { mode: 0o755 })
  writeFileSync(wrapper, `#!/usr/bin/env bash
set -e
mkdir -p "$2/bin"
cp ${bin}/fake-claude-stream.mjs ${bin}/claude-double "$2/bin/"
exec bash ${DRIVER}/run.sh "$@"
`, { mode: 0o755 })
  chmodSync(wrapper, 0o755)
  Object.assign(process.env, { TP_DOCKER_IMAGE: IMAGE, TP_DOCKER_STATE: path.join(state, 'driver-state'), TP_DOCKER_PASS_ENV: 'FAKE_EXECUTE_MODE FAKE_EXECUTE_REPLY FAKE_EXECUTE_EXTRA' })
  delete process.env.TP_DOCKER_REPO
  delete process.env.TP_DOCKER_MAX_CONTAINERS
  // The instance listens on every interface: the container reaches it as host.docker.internal.
  c = await iniciarCiclo({ listenHost: '0.0.0.0' })
  c.iniciar({
    runner: 'machine',
    machineCreate: `bash ${DRIVER}/create.sh ${RUN}-{job_id} {workdir}`,
    machineRun: `bash ${wrapper} ${RUN}-{job_id} {workdir} {machine}`,
    machineCollect: `bash ${DRIVER}/collect.sh ${RUN}-{job_id} {workdir} {machine}`,
    machineDestroy: `bash ${DRIVER}/destroy.sh ${RUN}-{job_id} {workdir} {machine}`,
    machineBin: '/job/bin/claude-double',
    teamUrl: `http://host.docker.internal:${c.port}`,
    timeoutMs: 180_000
  })
})
after(async () => {
  await c?.cerrar()
  for (const id of machinesOf()) { try { execFileSync('docker', ['rm', '-f', '-v', id], { stdio: 'ignore' }) } catch { /* destroyed by the test */ } }
  if (state) rmSync(state, { recursive: true, force: true })
})

test('a send is run in a Docker machine: the session answers from inside it through the network, the transcript is collected and the machine is gone', async () => {
  process.env.FAKE_EXECUTE_EXTRA = JSON.stringify({ outcome: 'investigated', summary: 'La agenda ya carga bien; no hubo nada que cambiar.' })
  const id = await c.enviar('La agenda queda en blanco al abrir la semana.')
  await c.esperar(id, { timeoutMs: 120_000 })

  // What the person reads: the first answer, written by the session from inside the container, and the closing one, written by the worker from the result.
  const replies = await c.respuestasDeClaude(id)
  assert.deepEqual(replies.map((r) => r.body.split('\n')[0]), ['Recibido. Empiezo por leer la pantalla.', 'La agenda ya carga bien; no hubo nada que cambiar.'])

  // The run happened in a machine, which the worker destroyed; its transcript left it before.
  const [job] = c.trabajos(id, 'execute')
  assert.equal(job.status, 'done')
  assert.deepEqual(machinesOf(job.id), [], 'the machine of the job is still there')
  const runs = (await c.env.app.inject({ url: '/api/ops/execute-runs', headers: { cookie: c.editor } })).json()
  const run = (Array.isArray(runs) ? runs : runs.items).find((r) => String(r.message_id) === String(id))
  assert.ok(run, 'the run is not in the list of runs')
  assert.equal(run.transcript_ref, path.join(state, 'driver-state/transcripts', `${RUN}-${job.id}`))
  assert.ok(existsSync(run.transcript_ref) && readdirSync(path.join(run.transcript_ref, '-job')).some((f) => f.endsWith('.jsonl')), 'the transcript is not where the run says')
})

test('a session that dies inside the machine is told in the thread and the machine is destroyed all the same', async () => {
  process.env.FAKE_EXECUTE_MODE = 'exit'
  const before = machinesOf().length
  const id = await c.enviar('El botón de reservas no responde.')
  // The end is what the person reads: the worker tries a second time before it tells (a failed job alone is not the end), so the wait is for that notice.
  await until(async () => /No pude terminar este trabajo/.test((await c.ultimaDeClaude(id))?.body ?? ''), { timeoutMs: 120_000 })
  await c.esperar(id, { timeoutMs: 120_000 })
  const failed = c.trabajos(id, 'execute')
  assert.ok(failed.length >= 1 && failed.every((j) => j.status === 'failed'), failed.map((j) => j.status).join())
  assert.equal(machinesOf().length, before, 'a machine of the failed run is still alive')
  for (const j of failed) assert.deepEqual(machinesOf(j.id), [])
  const last = await c.ultimaDeClaude(id)
  assert.ok(last, 'the person reads nothing about the session that died')
  assert.match(last.body, /No pude terminar este trabajo por un problema del sistema \(la máquina de trabajo/)
})
