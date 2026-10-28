// Where the unattended session runs (EXECUTE_RUNNER, MS §7.5 «Ejecución»).
//   local     `claude -p` on this machine, in a worktree of EXECUTE_REPO_DIR (branch tp/<message_id>) or in the job dir.
//   machine   three shell commands the host declares; Team Platform knows no cloud provider:
//               EXECUTE_MACHINE_CREATE   placeholders {job_id} {workdir}; exit 0; its last stdout line is {machine}
//                                        (empty: team-job-<job_id>)
//               EXECUTE_MACHINE_RUN      placeholders {job_id} {workdir} {machine}; copies {workdir} to the machine, runs
//                                        `bash run.sh` there and streams its stdout (the NDJSON) back
//               EXECUTE_MACHINE_COLLECT  optional (UD-262); placeholders {job_id} {workdir} {machine}; runs after RUN and before
//                                        DESTROY, only if the machine was reached; copies the session transcript out of the machine
//                                        and prints where it left it (a path or an object key) as its last stdout line
//               EXECUTE_MACHINE_DESTROY  placeholders {job_id} {workdir} {machine}; runs always: after success, failure,
//                                        timeout, abort or an orderly shutdown of the worker (unless EXECUTE_KEEP_SESSION_ON_SHUTDOWN), and also when CREATE failed half way. What a sudden death
//                                        of the worker leaves is destroyed by the sweep of src/execute/machines.js when the next worker starts
//             The deadline of the job (EXECUTE_TIMEOUT_MS) does not cut a CREATE that is still running: it gets EXECUTE_CREATE_SETTLE_MS more to name its machine, then DESTROY receives that name.
//             DESTROY has its own bound, EXECUTE_DESTROY_TIMEOUT_MS, not the deadline of the session.
// The delivery (UD-263) is one more host command, EXECUTE_DELIVER_COMMAND, run by src/execute/deliver.js with the same placeholders
// plus {message_id} and {branch}.
// Signals go only to the process group this module started (detached child), never to a parent.

import { spawn } from 'node:child_process'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GUARDS_COPY } from './hooks/guards.js'

export const shellQuote = (v) => `'${String(v).replace(/'/g, "'\\''")}'`

/** Replaces {name} placeholders by their shell-quoted values. */
export function fillCommand (template, values) {
  return template.replace(/\{(job_id|workdir|machine|message_id|branch)\}/g, (m, k) => (values[k] === undefined ? m : shellQuote(values[k])))
}

/**
 * Spawns a process in its own group and streams stdout lines. Resolves { code, signal, timedOut, aborted, stdout, stderr }
 * (stdout kept only with `keepStdout`). On timeout or abort: SIGTERM to the group, SIGKILL after `graceMs`.
 */
export function spawnStreaming (cmd, args, { cwd, env, stdin = null, onData = null, keepStdout = false, timeoutMs, graceMs, signal = null }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ code: null, signal: null, timedOut: false, aborted: false, stdout: '', stderr: error.message, spawnError: error })
      return
    }
    const out = []
    let timedOut = false
    let aborted = false
    let killTimer = null
    const stop = () => {
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
      killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ } }, graceMs)
      killTimer.unref?.()
    }
    const timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
    const onAbort = () => { aborted = true; stop() }
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }) }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (c) => { if (keepStdout) out.push(c); onData?.(c) })
    child.stderr.setEncoding('utf8')
    // The first 4000 characters and the LAST 16000: a delivery that prints more than 20000 characters of stderr ends with the line that says why it
    // failed (measured 2026-10-23, delivery 100: the cause came after 20000 characters and the failure notice stopped at the load measurement).
    let errHead = ''
    let errTail = ''
    let errCut = false
    child.stderr.on('data', (c) => {
      if (errHead.length < 4000) { errHead += c; if (errHead.length > 4000) { errTail = errHead.slice(4000); errHead = errHead.slice(0, 4000) } return }
      errTail += c
      if (errTail.length > 16000) { errTail = errTail.slice(-16000); errCut = true }
    })
    let spawnError = null
    child.on('error', (e) => { spawnError = e })
    child.on('close', (code, sig) => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      signal?.removeEventListener?.('abort', onAbort)
      resolve({ code, signal: sig, timedOut, aborted, stdout: out.join(''), stderr: errHead + (errCut ? '\n[… salida omitida …]\n' : '') + errTail, spawnError })
    })
    child.stdin.on('error', () => {})
    if (stdin !== null) child.stdin.end(stdin)
    else child.stdin.end()
  })
}

const shell = (command, opts) => spawnStreaming('/bin/sh', ['-c', command], opts)

/** Local runner: `claude` with the arguments, the prompt on stdin. */
export async function runLocal ({ config, args, prompt, cwd, env, onData, signal }) {
  const x = config.execute
  // outside-the-image: claude — the local runner is the host's own machine; the worker image has no claude and production runs the session in `machine` (EXECUTE_RUNNER=machine)
  return spawnStreaming(x.bin, args, { cwd, env, stdin: prompt, onData, timeoutMs: x.timeoutMs, graceMs: x.killGraceMs, signal })
}

/** The files the machine needs: run.sh (the invocation), env.sh (mode 600: it carries the agent secret), prompt.md. */
export async function writeMachineFiles ({ workdir, args, prompt, env, claudeBin }) {
  await writeFile(join(workdir, 'prompt.md'), prompt)
  const exports = Object.entries(env).map(([k, v]) => `${k}=${shellQuote(v)}`).join('\n')
  await writeFile(join(workdir, 'env.sh'), `${exports}\n`, { mode: 0o600 })
  const script = [
    '#!/usr/bin/env bash',
    '# Written by the Team Platform worker for one `execute` job. Runs inside the machine.',
    'set -euo pipefail',
    'JOB_DIR="$(cd "$(dirname "$0")" && pwd)"',
    'set -a; . "$JOB_DIR/env.sh"; set +a',
    'export PATH="$JOB_DIR/bin:$PATH"',
    'mkdir -p "$JOB_DIR/captures"; export TEAM_CAPTURES_DIR="$JOB_DIR/captures"', // the machine\'s own path; the host\'s collect command copies it back to {workdir}/captures
    'mkdir -p "$JOB_DIR/attachments"; export TEAM_ATTACHMENTS_DIR="$JOB_DIR/attachments"', // UD-272: same for the documents; the collect command copies {workdir}/attachments back too
    '[ -d "$JOB_DIR/thread" ] && export TEAM_THREAD_DIR="$JOB_DIR/thread" || true', // UD-278: the files of the thread travel with {workdir}; the machine reads its own copy
    `[ -f "$JOB_DIR/${GUARDS_COPY}" ] && export TEAM_GUARDS_FILE="$JOB_DIR/${GUARDS_COPY}" || true`, // the guards file of the host travels with the job directory; the hooks (`team hook`) read this copy
    'cd "${TEAM_REPO_DIR:-$JOB_DIR}"',
    `exec ${shellQuote(claudeBin)} ${args.map((a) => (a.startsWith('@JOB_DIR@/') ? `"$JOB_DIR/${a.slice(10)}"` : shellQuote(a))).join(' ')} < "$JOB_DIR/prompt.md"`
  ].join('\n')
  await writeFile(join(workdir, 'run.sh'), `${script}\n`)
  await chmod(join(workdir, 'run.sh'), 0o755)
}

/**
 * The gate of the creation of machines of one worker (UD-303). Calls to CREATE run side by side (a warm machine admits several at once); when one ends with 75
 * (no capacity), the next ones in this cycle (`waitMs`) get the same answer with no process, and a session that ends opens the gate at once (`open`): the capacity is back. The quota that
 * the host reported (`##team quota machines=<N>` on the error output) travels with the answer.
 */
export function createCreationGate ({ waitMs, now = Date.now }) {
  let blockedUntil = 0
  let quotaLine = ''
  return {
    async enter () {
      if (now() < blockedUntil) return { blocked: true, stderr: quotaLine }
      return {
        blocked: false,
        leave (created) {
          if (created?.code === 75) { blockedUntil = now() + waitMs; quotaLine = /^##team quota machines=\d+\s*$/m.exec(created.stderr ?? '')?.[0].trim() ?? '' }
        }
      }
    },
    open () { blockedUntil = 0 }
  }
}

/**
 * The DESTROY order of the host for one machine. Resolves like `spawnStreaming`: `code` 0 is destroyed; anything else (an exit code, a
 * timeout, a shell that did not start) is a failure that the caller records and never reads as «there is no machine».
 */
export function destroyMachine ({ config, jobId, workdir, machine }) {
  const x = config.execute
  const shellEnv = { ...process.env, TEAM_JOB_ID: String(jobId), TEAM_WORKDIR: workdir }
  return shell(fillCommand(x.machineDestroy, { job_id: String(jobId), workdir, machine }), { env: shellEnv, keepStdout: true, timeoutMs: x.destroyTimeoutMs ?? x.timeoutMs, graceMs: x.killGraceMs })
}

/**
 * Machine runner: CREATE, RUN, and DESTROY in a finally. Resolves like `runLocal`, plus `machine` and `destroy`
 * ({ code, stderr }). The timeout covers CREATE and RUN together.
 *
 * `track` (optional) is the register of machines (src/execute/machines.js): `begin(machine)` runs BEFORE CREATE with the default name and returns
 * a handle, `named(handle, machine)` after CREATE (the name it printed, or the default one), `parked(handle)` when a shutdown leaves the machine on purpose (the row stays open) and
 * `destroyed(handle, { code, stderr })` after DESTROY. A `begin` that throws
 * stops the job before anything is created (a machine nobody wrote down is one nobody can sweep); the other two are courtesies and never fail the job.
 */
export async function runMachine ({ config, jobId, workdir, args, prompt, env, onData, signal, log = () => {}, phase = (name, fn) => fn(), createGate = null, track = null }) {
  const x = config.execute
  await writeMachineFiles({ workdir, args, prompt, env, claudeBin: x.machineBin })
  const started = Date.now()
  const left = () => Math.max(1, x.timeoutMs - (Date.now() - started))
  const base = { job_id: String(jobId), workdir }
  const shellEnv = { ...process.env, TEAM_JOB_ID: String(jobId), TEAM_WORKDIR: workdir }
  let machine = `team-job-${jobId}`
  let result
  let collect = null
  // UD-303: a job that arrives while the host has just said it has no capacity does not run the host's scripts again (each call of `gcloud` burned 1 to 2 s of
  // CPU of the production machine, 2026-10-25 13:50). It gets the same answer without a process, and nothing was created, so nothing is destroyed.
  const gate = createGate ? await createGate.enter() : null
  if (gate?.blocked) return { code: 75, signal: null, timedOut: false, aborted: false, stdout: '', stderr: gate.stderr, phase: 'create', machine, gated: true }
  const handle = track ? track.begin(machine) : null // before CREATE: a worker that dies from here on leaves the row for the sweep
  try {
    let created
    try {
      // The deadline of the job does not cut CREATE: a CREATE cut half way leaves a machine that the host goes on creating and that DESTROY cannot find yet (2026-10-28: containers
      // in state Created that nobody destroyed). CREATE gets the time that is left plus `createSettleMs` to name its machine; an abort of the worker still cuts it at once.
      created = await phase('create', () => shell(fillCommand(x.machineCreate, base), { env: shellEnv, keepStdout: true, timeoutMs: left() + (x.createSettleMs ?? 0), graceMs: x.killGraceMs, signal }))
    } finally { gate?.leave(created) }
    const named = created.stdout.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
    if (named) machine = named
    try { track?.named(handle, machine) } catch (e) { log(`could not record the name of machine ${machine}: ${e.message}`) }
    if (created.code !== 0) {
      result = { ...created, phase: 'create', machine }
      return result
    }
    // CREATE ended in green but after the deadline of the job: there is no time left for a session. The machine exists and is named; DESTROY (the finally) removes it.
    if (Date.now() - started >= x.timeoutMs) {
      log(`the deadline of job ${jobId} expired while CREATE was running; CREATE named machine ${machine} and it is destroyed without a session`)
      result = { ...created, timedOut: true, phase: 'create', machine }
      return result
    }
    const ran = await phase('run', () => shell(fillCommand(x.machineRun, { ...base, machine }), { env: shellEnv, onData, timeoutMs: left(), graceMs: x.killGraceMs, signal }))
    result = { ...ran, timedOut: ran.timedOut || created.timedOut, phase: 'run', machine }
    return result
  } finally {
    // EXECUTE_KEEP_SESSION_ON_SHUTDOWN: a worker that shuts down (a deploy) while the session runs leaves the machine and the session alone, if the host asked for it: its RUN keeps
    // the session apart from this connection, and the worker that takes the job next calls RUN again and attaches to it (2026-10-25, job 156). The register keeps the row open: the sweep
    // leaves it alone while its job is still to run, the next attempt takes it over, and the sweep destroys it if the job ends first. An abort before RUN (a machine still being created) has no session to keep.
    if (x.keepSessionOnShutdown && signal?.aborted && signal.reason === 'shutdown' && result?.phase === 'run') {
      result.detached = true
      try { track?.parked(handle) } catch (e) { log(`could not record that machine ${machine} stays: ${e.message}`) }
      log(`shutdown: machine ${machine} and its session stay for the next attempt of job ${jobId}`)
      return result
    }
    // Before destroying: afterwards the transcript is gone. A failure here is recorded and never fails the job.
    // stderr keeps its END: on a machine its start is ssh and useradd noise and the cause comes last (job 132, 2026-10-24).
    // Not when the job was aborted (cancelled, lease lost, shutdown): nobody reads that transcript and the worker is on its way out.
    if (x.machineCollect && result?.phase === 'run' && !signal?.aborted) {
      const collected = await phase('collect', () => shell(fillCommand(x.machineCollect, { ...base, machine }), { env: shellEnv, keepStdout: true, timeoutMs: x.timeoutMs, graceMs: x.killGraceMs }))
      const ref = collected.code === 0 ? collected.stdout.split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? null : null
      collect = { code: collected.code, ref, stderr: collected.stderr.slice(-2000) }
      if (collected.code !== 0) log(`the transcript of machine ${machine} could not be collected (exit ${collected.code}): ${collected.stderr.slice(-500)}`)
    }
    // Always, even after a timeout, an abort or the orderly shutdown of the worker (a deploy): a machine left running is the cost that must not happen.
    // The session does not survive the shutdown: the next attempt creates its own machine. If this call does not finish (the worker is killed), the row
    // of the register stays open and the next worker destroys the machine when it starts.
    const destroyed = await phase('destroy', () => destroyMachine({ config, jobId, workdir, machine }))
    if (destroyed.code !== 0) log(`machine ${machine} could not be destroyed (exit ${destroyed.code}): ${destroyed.stderr.slice(-500)}`)
    try { track?.destroyed(handle, { code: destroyed.code, stderr: destroyed.stderr }) } catch (e) { log(`could not record the destruction of machine ${machine}: ${e.message}`) }
    if (result) result.destroy = { code: destroyed.code, stderr: destroyed.stderr.slice(-2000) }
    if (result && collect) result.collect = collect
  }
}
