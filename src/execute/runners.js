// Where the unattended session runs (EXECUTE_RUNNER, MS §7.5 «Ejecución»).
//   local     `claude -p` on this machine, in a worktree of EXECUTE_REPO_DIR (branch tp/<message_id>) or in the job dir.
//   machine   three shell commands the host declares; Team Platform knows no cloud provider:
//               EXECUTE_MACHINE_CREATE   placeholders {job_id} {workdir}; exit 0; its last stdout line is {machine}
//                                        (empty: team-job-<job_id>)
//               EXECUTE_MACHINE_RUN      placeholders {job_id} {workdir} {machine}; copies {workdir} to the machine, runs
//                                        `bash run.sh` there and streams its stdout (the NDJSON) back
//               EXECUTE_MACHINE_DESTROY  placeholders {job_id} {workdir} {machine}; runs always: after success, failure,
//                                        timeout or abort, and also when CREATE failed half way
// Signals go only to the process group this module started (detached child), never to a parent.

import { spawn } from 'node:child_process'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const shellQuote = (v) => `'${String(v).replace(/'/g, "'\\''")}'`

/** Replaces {name} placeholders by their shell-quoted values. */
export function fillCommand (template, values) {
  return template.replace(/\{(job_id|workdir|machine)\}/g, (m, k) => (values[k] === undefined ? m : shellQuote(values[k])))
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
    const err = []
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
    child.stderr.on('data', (c) => { if (err.join('').length < 20000) err.push(c) })
    let spawnError = null
    child.on('error', (e) => { spawnError = e })
    child.on('close', (code, sig) => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      signal?.removeEventListener?.('abort', onAbort)
      resolve({ code, signal: sig, timedOut, aborted, stdout: out.join(''), stderr: err.join(''), spawnError })
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
    'cd "${TEAM_REPO_DIR:-$JOB_DIR}"',
    `exec ${shellQuote(claudeBin)} ${args.map(shellQuote).join(' ')} < "$JOB_DIR/prompt.md"`
  ].join('\n')
  await writeFile(join(workdir, 'run.sh'), `${script}\n`)
  await chmod(join(workdir, 'run.sh'), 0o755)
}

/**
 * Machine runner: CREATE, RUN, and DESTROY in a finally. Resolves like `runLocal`, plus `machine` and `destroy`
 * ({ code, stderr }). The timeout covers CREATE and RUN together.
 */
export async function runMachine ({ config, jobId, workdir, args, prompt, env, onData, signal, log = () => {} }) {
  const x = config.execute
  await writeMachineFiles({ workdir, args, prompt, env, claudeBin: x.machineBin })
  const started = Date.now()
  const left = () => Math.max(1, x.timeoutMs - (Date.now() - started))
  const base = { job_id: String(jobId), workdir }
  const shellEnv = { ...process.env, TEAM_JOB_ID: String(jobId), TEAM_WORKDIR: workdir }
  let machine = `team-job-${jobId}`
  let result
  try {
    const created = await shell(fillCommand(x.machineCreate, base), { env: shellEnv, keepStdout: true, timeoutMs: left(), graceMs: x.killGraceMs, signal })
    const named = created.stdout.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
    if (named) machine = named
    if (created.code !== 0) {
      result = { ...created, phase: 'create', machine }
      return result
    }
    const ran = await shell(fillCommand(x.machineRun, { ...base, machine }), { env: shellEnv, onData, timeoutMs: left(), graceMs: x.killGraceMs, signal })
    result = { ...ran, timedOut: ran.timedOut || created.timedOut, phase: 'run', machine }
    return result
  } finally {
    // Always, even after a timeout or an abort: a machine left running is the cost that must not happen.
    const destroyed = await shell(fillCommand(x.machineDestroy, { ...base, machine }), { env: shellEnv, keepStdout: true, timeoutMs: x.timeoutMs, graceMs: x.killGraceMs })
    if (destroyed.code !== 0) log(`machine ${machine} could not be destroyed (exit ${destroyed.code}): ${destroyed.stderr.slice(0, 500)}`)
    if (result) result.destroy = { code: destroyed.code, stderr: destroyed.stderr.slice(0, 2000) }
  }
}
