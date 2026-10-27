// Shared by the hooks of the fly-machines driver (create.mjs, run.mjs, collect.mjs, destroy.mjs). Zero dependencies: Node's own fetch.
//
// Contract: this driver meets version 1 of the host contract (docs/CONTRATO-DE-ANFITRION.md). The host declares it with EXECUTE_CONTRACT_VERSION=1.
//
// Settings (environment of the Team Platform worker). Nothing here names a host: app, region, token and image are the host's to declare.
//   TP_FLY_APP               Fly app whose Machines API is used (required)
//   FLY_API_TOKEN            token of the Fly Machines API (or TP_FLY_TOKEN_FILE: a file that holds it). A token is never read from an argument.
//   TP_FLY_IMAGE             image of the machine (required by create). Needs bash, node, git, tar, coreutils and util-linux (runuser); see Dockerfile.
//   TP_FLY_REGION            region of the machines (empty: Fly chooses)
//   TP_FLY_CPU_KIND, TP_FLY_CPUS, TP_FLY_MEMORY_MB   size of the machine. Omission: shared, 1, 256, the defaults of the Machines API (create machine, docs.fly.io,
//                            consulted 2026-10-26). Claude Code needs more memory than 256 MB: the host that runs it declares TP_FLY_MEMORY_MB.
//   TP_FLY_MAX_LIFE_S        most seconds a machine lives, whatever the worker does (default 7200, see MAX_LIFE_DEFAULT_S)
//   TP_FLY_MAX_MACHINES      most machines of this driver alive at once; create answers 75 beyond it. Empty: no cap (the cap is the host's to declare)
//   TP_FLY_USER              user of the image that runs the session (default node; Claude Code refuses to run unattended as root)
//   TP_FLY_PASS_ENV          names of variables copied from the worker's environment into the session (default «ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN»)
//   TP_FLY_REPO              absolute path of the host repository on the worker. The session gets a clone, works on the branch tp/<message id> and collect.sh
//                            brings the branch back into this repository, which is where deliver.sh looks for it. Empty: the session works in the job directory.
//   TP_FLY_BASE_REF          ref the branch starts from (default: what HEAD of the clone points to)
//   TP_FLY_STATE             directory of the driver's own state: the creation lock and the transcripts
//   TP_FLY_INSTANCE          identity of this instance of the driver when other instances use the same Fly app (1 to 20 lower case letters or digits). It is in the
//                            name of every machine (tp-<instance>-job-<id>) and in the metadata the driver lists, counts and checks by, so two instances whose job ids
//                            coincide never take each other's machine. Default: the first 8 hex digits of the sha256 of TP_FLY_STATE, which is already one per instance.
//   TP_FLY_API               base URL of the Machines API (default https://api.machines.dev)
//   TP_FLY_START_TIMEOUT_S   seconds create waits for the machine to start (default 60, the default of the wait endpoint)
//   TP_FLY_POLL_WAIT_S       seconds one exec waits for new output of the session (default 45, see POLL_WAIT_DEFAULT_S)
//   TP_FLY_EXEC_GAP_MS       least milliseconds between two exec calls that poll (default 1000, see EXEC_GAP_DEFAULT_MS)
//   TP_FLY_UPLOAD_PARALLEL   exec calls of an upload in flight at once (default 3, see EXEC_GAP_DEFAULT_MS)
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DRIVER_LABEL = 'fly-machines'

// Fly documents no field for the most a machine lives (create machine, docs.fly.io/machines/api/machines-resource, consulted 2026-10-26: only `auto_destroy`
// and `schedule`, and `schedule` restarts). The driver gets the same effect from the machine itself: its only process is `sleep <N>`, the restart policy is
// `no` and `auto_destroy` is true, so the machine is destroyed by Fly when the sleep ends, with no worker alive (measured 2026-10-27: a machine created
// with `sleep 120` was gone from the app two minutes later).
// 7200 s = twice EXECUTE_TIMEOUT_MS (3,600,000 ms, docs/CONTRATO-DE-ANFITRION.md): RUN is bounded by it and COLLECT has a plazo of its own of the same value.
export const MAX_LIFE_DEFAULT_S = 7200

// Measured 2026-10-27 against the Machines API: one exec call is cut with HTTP 408 after about 65 s whatever its `timeout` (timeout 100 returned 408 at 65.5 s).
// The poll waits 45 s and returns by itself, 20 s under that cut.
export const POLL_WAIT_DEFAULT_S = 45

// Machines API rate limit: «1 request, per second, per action, short-term burstable up to 3» (Fly staff, community.fly.io/t/understanding-fly-io-api-rate-hard-limits/20636,
// consulted 2026-10-27; the docs.fly.io pages of the API list no figures). A poll that found output waits for the rest of this gap before the next exec, and an
// upload keeps at most the burst (3) in flight. A 429 is answered by waiting the Retry-After it carries, or this gap when it carries none.
export const EXEC_GAP_DEFAULT_MS = 1000
export const UPLOAD_PARALLEL_DEFAULT = 3

// Measured 2026-10-27: the body of an exec request is accepted up to 16,072 bytes and refused at 17,072 (the machine answers HTTP 200, exit_code 0 and an
// «Unhandled rejection: PayloadTooLarge» on stderr, which is why exec() checks stderr). `stdin` is not delivered to the command (it reads /dev/null), so data
// travels as arguments: 12,000 base64 characters per call leave room for the command around them.
export const UPLOAD_CHUNK_CHARS = 12000

// Measured 2026-10-27: an exec answer over 10,485,760 bytes after JSON encoding is refused with HTTP 413. Downloads are read in slices of 4 MiB of base64 text
// (no character of it is escaped by JSON). A session's output goes by the poll, which returns at most POLL_MAX_BYTES of whole lines: quotes in NDJSON become
// \" and double their size, so 1 MiB is far from the limit.
export const DOWNLOAD_SLICE_BYTES = 4 * 1024 * 1024
export const POLL_MAX_BYTES = 1024 * 1024

export class DriverError extends Error {
  constructor (message, code = 1) { super(message); this.code = code }
}
/** Not now: the platform answered that it cannot (capacity, rate limit, no connection). The hook exits 75. */
export class NotNow extends DriverError {
  constructor (message) { super(message, 75) }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export const sha256 = (data) => createHash('sha256').update(data).digest('hex')

/** A job id is interpolated into names and paths: only letters, digits, dot, dash and underscore. */
export const safeJob = (job) => String(job).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '')
/** The name of a machine: Fly names are lower case letters, digits and dashes. */
export const machineName = (s, job) => `tp-${s.instance}-job-${safeJob(job).toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`
/**
 * Whether the {machine} an order received is the machine of the job of this instance. Three names mean it: its own; the default of the core
 * (team-job-<job_id>), which the register holds when the worker died before CREATE answered; and the name before instances existed (tp-job-<id>), whose
 * machine carries no instance metadata and so is never found here: it ends by itself at its maximum life.
 */
export const isMachineOfJob = (s, job, machine) => [machineName(s, job), `team-job-${job}`, `tp-job-${safeJob(job).toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`].includes(machine)

export function loadSettings (env = process.env) {
  const int = (name, fallback, min = 0) => {
    const raw = env[name]
    if (raw === undefined || raw === '') return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n < min) throw new DriverError(`${name} must be an integer of at least ${min}: «${raw}»`)
    return n
  }
  let token = env.FLY_API_TOKEN || ''
  if (!token && env.TP_FLY_TOKEN_FILE) token = readFileSync(env.TP_FLY_TOKEN_FILE, 'utf8').trim()
  const state = env.TP_FLY_STATE || join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'team-platform-fly')
  const s = {
    api: (env.TP_FLY_API || 'https://api.machines.dev').replace(/\/+$/, ''),
    app: env.TP_FLY_APP || '',
    token,
    image: env.TP_FLY_IMAGE || '',
    region: env.TP_FLY_REGION || '',
    cpuKind: env.TP_FLY_CPU_KIND || 'shared',
    cpus: int('TP_FLY_CPUS', 1, 1),
    memoryMb: int('TP_FLY_MEMORY_MB', 256, 256),
    maxLifeS: int('TP_FLY_MAX_LIFE_S', MAX_LIFE_DEFAULT_S, 1),
    maxMachines: int('TP_FLY_MAX_MACHINES', 0, 1),
    user: env.TP_FLY_USER || 'node',
    passEnv: (env.TP_FLY_PASS_ENV ?? 'ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN').split(/\s+/).filter(Boolean),
    repo: env.TP_FLY_REPO || '',
    baseRef: env.TP_FLY_BASE_REF || '',
    state,
    instance: env.TP_FLY_INSTANCE || sha256(state).slice(0, 8),
    startTimeoutS: int('TP_FLY_START_TIMEOUT_S', 60, 1),
    pollWaitS: int('TP_FLY_POLL_WAIT_S', POLL_WAIT_DEFAULT_S, 1),
    execGapMs: int('TP_FLY_EXEC_GAP_MS', EXEC_GAP_DEFAULT_MS, 0),
    uploadParallel: int('TP_FLY_UPLOAD_PARALLEL', UPLOAD_PARALLEL_DEFAULT, 1)
  }
  if (!/^[a-z0-9]{1,20}$/.test(s.instance)) throw new DriverError(`TP_FLY_INSTANCE must be 1 to 20 lower case letters or digits: «${s.instance}»`)
  if (!s.app) throw new DriverError('TP_FLY_APP is not set: the Fly app whose machines this driver manages')
  if (!s.token) throw new DriverError('no token: set FLY_API_TOKEN (or TP_FLY_TOKEN_FILE)')
  return s
}

/**
 * One call to the Machines API. Resolves { status, body, headers }; never throws for an HTTP status. A 429 waits the Retry-After of the answer (or the exec gap)
 * and asks again, up to `retries` times, and then answers the 429. No connection throws NotNow.
 */
export async function call (s, method, path, body, { retries = 6, signal } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res
    try {
      res = await fetch(`${s.api}${path}`, {
        method,
        headers: { authorization: `Bearer ${s.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new NotNow(`the Machines API does not answer (${s.api}): ${error.cause?.code ?? error.message}`)
    }
    const text = await res.text()
    let parsed = text
    try { parsed = text ? JSON.parse(text) : null } catch { /* the answer is not JSON: keep the text */ }
    if (res.status === 429 && attempt < retries) {
      const wait = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(wait) && wait > 0 ? wait * 1000 : Math.max(s.execGapMs, 1))
      continue
    }
    return { status: res.status, body: parsed, headers: res.headers }
  }
}

export const errorText = (res) => (typeof res.body === 'string' ? res.body : res.body?.error ?? JSON.stringify(res.body)).toString().slice(0, 500)

/** Machines of the app that carry all the metadata given, as the API lists them (destroyed machines are not listed). */
export async function listMachines (s, metadata) {
  const query = Object.entries(metadata).map(([k, v]) => `metadata.${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  const res = await call(s, 'GET', `/v1/apps/${encodeURIComponent(s.app)}/machines${query ? `?${query}` : ''}`)
  if (res.status === 429 || res.status >= 500) throw new NotNow(`listing machines: HTTP ${res.status}: ${errorText(res)}`)
  if (res.status !== 200 || !Array.isArray(res.body)) throw new DriverError(`listing machines: HTTP ${res.status}: ${errorText(res)}`)
  return res.body
}

export const ALIVE_STATES = new Set(['created', 'starting', 'started', 'replacing'])

/** The machine of a job of this instance, found by the metadata this driver wrote at create (never by name pattern). null when there is none. */
export async function findMachine (s, job) {
  const found = await listMachines(s, { team_platform_driver: DRIVER_LABEL, team_platform_instance: s.instance, team_platform_job: safeJob(job) })
  return found.find((m) => m.name === machineName(s, job)) ?? null
}

/**
 * exec on a machine. Resolves { stdout, stderr, code }. Throws DriverError('machine gone', 2) when the machine is not there, and a DriverError when the
 * platform refused the call even though it answered 200: the in-machine agent answers an oversized request with exit_code 0 and «Unhandled rejection» on stderr.
 */
export async function exec (s, machineId, command, { timeoutS = 30 } = {}) {
  const res = await call(s, 'POST', `/v1/apps/${encodeURIComponent(s.app)}/machines/${machineId}/exec`, { command, timeout: timeoutS })
  if (res.status === 404) throw new DriverError(`the machine ${machineId} does not exist`, 2)
  if (res.status === 408) { const e = new DriverError(`exec timed out: ${errorText(res)}`, 1); e.timedOut = true; throw e }
  if (res.status === 429 || res.status >= 500) throw new NotNow(`exec: HTTP ${res.status}: ${errorText(res)}`)
  if (res.status !== 200 || typeof res.body !== 'object' || res.body === null) throw new DriverError(`exec: HTTP ${res.status}: ${errorText(res)}`)
  const { stdout = '', stderr = '', exit_code: code = 0 } = res.body
  if (/^Unhandled rejection: Rejection\(/.test(stderr)) throw new DriverError(`exec refused by the machine agent: ${stderr.slice(0, 200)}`)
  return { stdout, stderr, code }
}

/** exec that must end with 0; stderr of the command goes to ours. */
export async function execOk (s, machineId, command, opts) {
  const r = await exec(s, machineId, command, opts)
  if (r.stderr) process.stderr.write(r.stderr.endsWith('\n') ? r.stderr : `${r.stderr}\n`)
  if (r.code !== 0) throw new DriverError(`${command.slice(0, 3).join(' ')} ended with ${r.code}`)
  return r
}

/** Runs the hook: the error of a driver becomes its message and its code. */
export async function main (fn) {
  try { await fn() } catch (error) {
    if (error instanceof DriverError) { console.error(`${process.argv[1].split('/').at(-1)}: ${error.message}`); process.exitCode = error.code; return }
    console.error(error.stack ?? String(error)); process.exitCode = 1
  }
}
