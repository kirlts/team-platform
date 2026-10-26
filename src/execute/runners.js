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
//                                        timeout or abort, and also when CREATE failed half way
// The delivery (UD-263) is one more host command, EXECUTE_DELIVER_COMMAND, run by src/execute/deliver.js with the same placeholders
// plus {message_id} and {branch}.
// Signals go only to the process group this module started (detached child), never to a parent.

import { spawn } from 'node:child_process'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
  // fuera-de-la-imagen: claude — the local runner is the host's own machine; the worker image has no claude and production runs the session in `machine` (EXECUTE_RUNNER=machine)
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
 * Machine runner: CREATE, RUN, and DESTROY in a finally. Resolves like `runLocal`, plus `machine` and `destroy`
 * ({ code, stderr }). The timeout covers CREATE and RUN together.
 */
export async function runMachine ({ config, jobId, workdir, args, prompt, env, onData, signal, log = () => {}, phase = (name, fn) => fn(), createGate = null }) {
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
  try {
    let created
    try {
      created = await phase('create', () => shell(fillCommand(x.machineCreate, base), { env: shellEnv, keepStdout: true, timeoutMs: left(), graceMs: x.killGraceMs, signal }))
    } finally { gate?.leave(created) }
    const named = created.stdout.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
    if (named) machine = named
    if (created.code !== 0) {
      result = { ...created, phase: 'create', machine }
      return result
    }
    const ran = await phase('run', () => shell(fillCommand(x.machineRun, { ...base, machine }), { env: shellEnv, onData, timeoutMs: left(), graceMs: x.killGraceMs, signal }))
    result = { ...ran, timedOut: ran.timedOut || created.timedOut, phase: 'run', machine }
    return result
  } finally {
    // A worker that shuts down (a deploy) while the session runs leaves the machine and the session alone: the host's RUN command keeps the session
    // apart from this connection, and the worker that takes the job next calls RUN again and attaches to it (2026-10-25, job 156: the session lived 17 min after
    // the restart and the repetition would have started another). Destroying here would kill the work that the next attempt is going to pick up.
    // An abort before RUN (a machine still being created) has no session to keep and is destroyed as always.
    if (signal?.aborted && signal.reason === 'shutdown' && result?.phase === 'run') {
      if (result) result.detached = true
      log(`shutdown: machine ${machine} and its session stay for the next attempt of job ${jobId}`)
      return result
    }
    // Before destroying: afterwards the transcript is gone. A failure here is recorded and never fails the job.
    // stderr keeps its END: on a machine its start is ssh and useradd noise and the cause comes last (job 132, 2026-10-24).
    if (x.machineCollect && result?.phase === 'run' && !signal?.aborted) {
      const collected = await phase('collect', () => shell(fillCommand(x.machineCollect, { ...base, machine }), { env: shellEnv, keepStdout: true, timeoutMs: x.timeoutMs, graceMs: x.killGraceMs }))
      const ref = collected.code === 0 ? collected.stdout.split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? null : null
      collect = { code: collected.code, ref, stderr: collected.stderr.slice(-2000) }
      if (collected.code !== 0) log(`the transcript of machine ${machine} could not be collected (exit ${collected.code}): ${collected.stderr.slice(-500)}`)
    }
    // Always, even after a timeout or an abort: a machine left running is the cost that must not happen.
    const destroyed = await phase('destroy', () => shell(fillCommand(x.machineDestroy, { ...base, machine }), { env: shellEnv, keepStdout: true, timeoutMs: x.timeoutMs, graceMs: x.killGraceMs }))
    if (destroyed.code !== 0) log(`machine ${machine} could not be destroyed (exit ${destroyed.code}): ${destroyed.stderr.slice(-500)}`)
    if (result) result.destroy = { code: destroyed.code, stderr: destroyed.stderr.slice(-2000) }
    if (result && collect) result.collect = collect
  }
}
