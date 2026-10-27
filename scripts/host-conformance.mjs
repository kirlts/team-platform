#!/usr/bin/env node
// Conformance of a host driver to the host contract (plan 2026, piece A3; docs/CONTRATO-DE-ANFITRION.md is the contract).
//
//   node scripts/host-conformance.mjs --driver drivers/docker-local
//
// A driver is a directory with the five orders as shell scripts: create.sh, run.sh, collect.sh, destroy.sh and deliver.sh (the markers and the
// exit codes 0, 75 and 76 are those of drivers/README.md). The script runs the real `execute` and `deliver` jobs of the worker against an ephemeral
// database, with the five orders of the driver as the hooks and a double of Claude Code inside the machine (scripts/testing/fake-claude-canary.mjs):
// it spends no call to Anthropic. Each case has its own verdict, one line each; the exit code is 0 only when every case passes.
//
// An optional file of the driver, conformance.sh, prepares what the orders need (an image, a state directory) and prints KEY=VALUE lines for their
// environment, among them EXECUTE_CONTRACT_VERSION, the contract version the driver declares. See drivers/docker-local/conformance.sh.

import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { loadConfig } from '../src/config.js'
import { createPipeline } from '../src/domain/pipeline.js'
import { createVault, loadMasterKey } from '../src/domain/vault.js'
import { setProjectDescription } from '../src/domain/settings.js'
import { CONTRACT_VERSION, checkContractVersion } from '../src/execute/contract-version.js'
import { createDeliverHandler } from '../src/execute/deliver.js'
import { createExecuteHandler } from '../src/execute/handler.js'
import { fillCommand, shellQuote, spawnStreaming } from '../src/execute/runners.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../src/testing/helpers.js'
import { createWorker } from '../src/worker.js'

export const OK = 0
export const FAILED = 1
export const USAGE = 2

const ORDERS = ['create', 'run', 'collect', 'destroy', 'deliver']
const DOUBLE = fileURLToPath(new URL('./testing/fake-claude-canary.mjs', import.meta.url))

// Bounds of the guide, none of them a property of the contract. A hung driver has to end as a failed case, not as a run that never returns.
//   PREPARE_TIMEOUT_MS   conformance.sh of the driver, which may build an image. The existing test of the reference driver bounds the same build at 600 s (src/execute/drivers-docker-local.test.js).
//   HOOK_TIMEOUT_MS      one order of the driver (EXECUTE_TIMEOUT_MS covers CREATE and RUN together). The test of the reference driver bounds one job at 180 s (same file); 120 s is a test bound.
//   CASE_WAIT_MS         the most a flow waits for its jobs to end: two sessions (the second try of a session that died) plus a delivery, each within HOOK_TIMEOUT_MS.
//   DEADLINE_MS          the deadline of the «deadline» case: a test deadline, short on purpose. The double sleeps longer than it (SLEEP_PAST_DEADLINE_MS), so the session always outlives it.
const PREPARE_TIMEOUT_MS = 600_000
const HOOK_TIMEOUT_MS = 120_000
const CASE_WAIT_MS = 3 * HOOK_TIMEOUT_MS + 60_000
const DEADLINE_MS = 10_000
const SLEEP_PAST_DEADLINE_MS = 60_000
const KILL_GRACE_MS = 2_000 // the grace between SIGTERM and SIGKILL of a hook that overran: a test bound
const CAPACITY_WAIT_MS = 1_000 // EXECUTE_CAPACITY_WAIT_MS at its minimum (src/config.js): the wait after a 75 is not what a case measures

const usageText = () => `Usage: node scripts/host-conformance.mjs --driver <directory> [--keep] [--only <case>[,<case>...]]

Runs the host contract against a driver and prints one line per case (ok or FAIL, with the reason). Exit code:
  0  every case passed; the last line says the contract_version that is met
  1  at least one case failed (the run goes on to the end so that every verdict is printed)
  2  usage: no driver, a directory that does not exist, or an unknown case

The driver is a directory with create.sh, run.sh, collect.sh, destroy.sh and deliver.sh, and optionally conformance.sh (see drivers/docker-local).
  --keep   do not remove the work directory at the end (it is printed)
  --only   run only these cases (ids below); the ones that need a flow run that flow

Cases:
${caseList()}
Requirements:
  Node and the dependencies of the repository (npm ci), as for the tests. No external database: the script creates an ephemeral SQLite database
  of its own, in a directory under $TMPDIR (system temporary directory when it is not set); the same one the tests of src/ use. Set TMPDIR to a disk
  directory when /tmp is memory.
  Docker, only for drivers that need it: drivers/docker-local requires a Docker daemon the user can reach and builds its machine image (no Claude Code in it).
  git, to prepare the host repository some drivers use. Network: none beyond what the driver itself needs.
  The environment of the five orders is the one of this process plus the lines of conformance.sh; set EXECUTE_CONTRACT_VERSION there or here to declare the version.
  A 75 of CREATE, a 75 of DELIVER and a 76 of DELIVER are injected in front of the driver's order, because each driver reaches them its own way; the cases say so.
The 75 of DELIVER carries the mark ##team wait before-machine; in-machine is not exercised, it fails the job at once by design.
Not covered: that the machine reaches EXECUTE_TEAM_URL (the double does not call the API), the quotas of a real cloud, and the sweep of the machines that a worker
killed without warning leaves (the worker destroys them when it starts; src/execute/machines-docker-local.test.js covers it against real containers).
`

const CASES = [
  ['orders', 'the driver carries the five orders (create.sh, run.sh, collect.sh, destroy.sh, deliver.sh)'],
  ['version', 'the contract version the driver declares has the major version of the core'],
  ['sequence', 'CREATE, RUN, COLLECT and DESTROY run once each, in that order, with exit 0, and the machine CREATE named is the one the others receive'],
  ['ndjson', 'the session leaves a valid NDJSON: RUN prints only JSON objects, one per line, and the last one is the result'],
  ['transcript', 'COLLECT leaves the transcript: its reference is kept with the run'],
  ['deliver', 'DELIVER ends with 0 and a reference: the run is delivered'],
  ['deliver-repeat', 'DELIVER can run twice on the same branch with the same result'],
  ['destroy-run-fails', 'DESTROY runs, with exit 0, after a RUN whose session died'],
  ['destroy-deadline', 'DESTROY runs, with exit 0, after the deadline of the job was exceeded'],
  ['destroy-twice', 'DESTROY of a machine that no longer exists exits 0, twice'],
  ['destroy-shutdown', 'DESTROY runs, with exit 0, when the worker shuts down in an orderly way while RUN is running (EXECUTE_KEEP_SESSION_ON_SHUTDOWN=0)'],
  ['create-75', 'a 75 from CREATE does not spend the attempt (injected)'],
  ['deliver-75', 'a 75 from DELIVER does not spend the attempt (injected)'],
  ['deliver-76', 'a 76 from DELIVER leaves delivery_held and no retry (injected)']
]
function caseList () { return CASES.map(([id, text]) => `  ${id.padEnd(18)} ${text}`).join('\n') }

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The wrappers. Each order of the hooks is a small script of the script that logs what happened and calls the order of the driver, passing its
// arguments, its standard output and its exit code through untouched. What they log is the evidence of the cases.

const WRAPPERS = {
  'create.sh': `#!/usr/bin/env bash
JOB="$1"
if [ "\${CONFORMANCE_CREATE_75:-}" = 1 ] && [ ! -e "$CONFORMANCE_FLAGS/create-75" ]; then
  : > "$CONFORMANCE_FLAGS/create-75"
  echo "create $JOB exit=75 injected" >> "$CONFORMANCE_LOG"
  echo '##team quota machines=1' >&2
  exit 75
fi
OUT="$(bash "$CONFORMANCE_DRIVER/create.sh" "$@")"; CODE=$?
MACHINE="$(printf '%s\\n' "$OUT" | sed '/^[[:space:]]*$/d' | tail -n 1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
echo "create $JOB exit=$CODE machine=$MACHINE" >> "$CONFORMANCE_LOG"
printf '%s\\n' "$OUT"
exit "$CODE"
`,
  'run.sh': `#!/usr/bin/env bash
JOB="$1"; WORKDIR="$2"; MACHINE="\${3:-}"
echo "run $JOB machine=$MACHINE start" >> "$CONFORMANCE_LOG"
# The double of Claude Code travels with the job directory, which every driver copies into the machine: bin/ is at the front of the PATH of run.sh.
mkdir -p "$WORKDIR/bin"
cp "$CONFORMANCE_DOUBLE" "$WORKDIR/bin/claude-double.mjs"
{ printf '#!/bin/sh\\n'; printf '%s\\n' "$CONFORMANCE_DOUBLE_ENV"; printf 'exec node "$(dirname "$0")/claude-double.mjs" "$@"\\n'; } > "$WORKDIR/bin/claude-double"
chmod 755 "$WORKDIR/bin/claude-double"
bash "$CONFORMANCE_DRIVER/run.sh" "$@" | tee -a "$CONFORMANCE_STREAM"
CODE=\${PIPESTATUS[0]}
echo "run $JOB machine=$MACHINE exit=$CODE" >> "$CONFORMANCE_LOG"
exit "$CODE"
`,
  'collect.sh': `#!/usr/bin/env bash
JOB="$1"; MACHINE="\${3:-}"
OUT="$(bash "$CONFORMANCE_DRIVER/collect.sh" "$@")"; CODE=$?
REF="$(printf '%s\\n' "$OUT" | sed '/^[[:space:]]*$/d' | tail -n 1)"
echo "collect $JOB machine=$MACHINE exit=$CODE" >> "$CONFORMANCE_LOG"
printf '%s\\n' "$OUT"
exit "$CODE"
`,
  'destroy.sh': `#!/usr/bin/env bash
JOB="$1"; MACHINE="\${3:-}"
bash "$CONFORMANCE_DRIVER/destroy.sh" "$@"; CODE=$?
echo "destroy $JOB machine=$MACHINE exit=$CODE" >> "$CONFORMANCE_LOG"
exit "$CODE"
`,
  'deliver.sh': `#!/usr/bin/env bash
MODE="\${CONFORMANCE_DELIVER_MODE:-pass}"
if [ "$MODE" = later ] && [ ! -e "$CONFORMANCE_FLAGS/deliver-75" ]; then
  : > "$CONFORMANCE_FLAGS/deliver-75"
  echo "deliver $2 message=$1 exit=75 injected" >> "$CONFORMANCE_LOG"
  echo '##team wait before-machine'
  exit 75
fi
if [ "$MODE" = held ]; then
  echo "deliver $2 message=$1 exit=76 injected" >> "$CONFORMANCE_LOG"
  echo 'conformance: held for the review of a person'
  exit 76
fi
bash "$CONFORMANCE_DRIVER/deliver.sh" "$@"; CODE=$?
echo "deliver $2 message=$1 exit=$CODE" >> "$CONFORMANCE_LOG"
exit "$CODE"
`
}

// ---------------------------------------------------------------------------------------------------------------------------------------------

const lastLine = (text) => String(text).split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? ''
const run = (cmd, args, options) => new Promise((resolveRun) => execFile(cmd, args, { encoding: 'utf8', ...options }, (error, stdout, stderr) => resolveRun({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr })))

/** What a wrapper logged: `{ order, job, fields }` per line, in order. */
function readLog (file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    const [order, ...rest] = line.split(' ')
    const fields = Object.fromEntries(rest.filter((p) => p.includes('=')).map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]))
    return { order, line, job: /^\d+$/.test(rest[0] ?? '') ? rest[0] : null, ...fields, injected: rest.includes('injected'), start: rest.includes('start') }
  })
}

/** Parses the KEY=VALUE lines that conformance.sh prints. */
function parseEnvLines (text) {
  const env = {}
  for (const line of text.split('\n')) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (m) env[m[1]] = m[2]
  }
  return env
}

class Verdicts {
  constructor (out) { this.out = out; this.list = [] }
  record (id, ok, reason) {
    const text = CASES.find(([c]) => c === id)?.[1] ?? id
    this.list.push({ id, ok })
    this.out(`${ok ? 'ok  ' : 'FAIL'} ${id}: ${text}${ok ? '' : ` -- ${reason}`}${ok && reason ? ` (${reason})` : ''}`)
  }
  /** `check()` returns nothing when the case holds and throws an Error whose message is the reason when it does not. */
  async check (id, check) {
    try { const note = await check(); this.record(id, true, typeof note === 'string' ? note : '') } catch (error) { this.record(id, false, error.message) }
  }
  get failed () { return this.list.filter((v) => !v.ok).length }
}

const fail = (message) => { throw new Error(message) }
const expect = (condition, message) => { if (!condition) fail(message) }

/**
 * Entry point. `argv` without the executable and the script; `io.out` and `io.err` receive the lines. Returns the exit code.
 */
export async function main (argv, { out = (l) => console.log(l), err = (l) => console.error(l), env = process.env } = {}) {
  const args = parseArgs(argv)
  if (args.help) { out(usageText().trimEnd()); return OK }
  if (args.error) { err(args.error); err(usageText().split('\n')[0]); return USAGE }
  if (!args.driver) { err('--driver is required.'); err(usageText().split('\n')[0]); return USAGE }
  const driverDir = resolve(args.driver)
  if (!existsSync(driverDir) || !statSync(driverDir).isDirectory()) { err(`The driver directory does not exist: ${args.driver}`); return USAGE }
  const unknown = (args.only ?? []).filter((id) => !CASES.some(([c]) => c === id))
  if (unknown.length) { err(`Unknown case: ${unknown.join(', ')}. The cases: ${CASES.map(([c]) => c).join(', ')}`); return USAGE }
  const wanted = (id) => !args.only || args.only.includes(id)

  const verdicts = new Verdicts(out)
  const saved = {}
  const setEnv = (values) => { for (const [k, v] of Object.entries(values)) { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v } }
  const base = mkdtempSync(join(env.TMPDIR || tmpdir(), 'host-conformance-'))
  let testEnv = null
  let worker = null
  try {
    // 1. The driver carries the five orders.
    const missing = ORDERS.filter((o) => !existsSync(join(driverDir, `${o}.sh`)))
    if (wanted('orders')) await verdicts.check('orders', () => { expect(missing.length === 0, `missing in ${args.driver}: ${missing.map((o) => `${o}.sh`).join(', ')}`) })
    if (missing.length) return finish(verdicts, out, err, null)

    // 2. The host repository and the preparation of the driver.
    const repo = join(base, 'host-repo')
    mkdirSync(repo)
    for (const g of [['init', '-q', '-b', 'main'], ['-c', 'user.name=conformance', '-c', 'user.email=conformance@example.org', 'commit', '-q', '--allow-empty', '-m', 'base']]) {
      const r = await run('git', ['-C', repo, ...g]); if (r.code !== 0) { err(`git ${g[0]} failed: ${r.stderr}`); return FAILED }
    }
    const driverState = join(base, 'driver-state')
    mkdirSync(driverState)
    setEnv({ CONFORMANCE_DIR: base, CONFORMANCE_REPO: repo, CONFORMANCE_DRIVER: driverDir })
    let declared = env.EXECUTE_CONTRACT_VERSION || undefined
    if (existsSync(join(driverDir, 'conformance.sh'))) {
      const prepared = await run('bash', [join(driverDir, 'conformance.sh')], { env: process.env, timeout: PREPARE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 })
      if (prepared.code !== 0) {
        err(prepared.stderr.trim())
        verdicts.record('orders', false, `conformance.sh of the driver ended with ${prepared.code}; nothing was run`)
        return finish(verdicts, out, err, null)
      }
      const lines = parseEnvLines(prepared.stdout)
      declared = lines.EXECUTE_CONTRACT_VERSION || declared
      setEnv(lines)
    }
    const check = (() => { try { return checkContractVersion(declared) } catch (error) { return { ok: false, line: error.message, declared } } })()
    if (wanted('version')) await verdicts.check('version', () => { expect(check.ok, check.line); return check.declared ? `declares ${check.declared}, core implements ${CONTRACT_VERSION}` : 'the driver declares none: not checked' })

    // 3. The wrappers, the ephemeral database and the people of the team.
    const hooks = join(base, 'hooks')
    mkdirSync(hooks)
    for (const [name, text] of Object.entries(WRAPPERS)) { writeFileSync(join(hooks, name), text); chmodSync(join(hooks, name), 0o755) }
    const hook = (name, markers) => `bash ${shellQuote(join(hooks, name))} ${markers}`
    const hookCommands = {
      machineCreate: hook('create.sh', '{job_id} {workdir}'),
      machineRun: hook('run.sh', '{job_id} {workdir} {machine}'),
      machineCollect: hook('collect.sh', '{job_id} {workdir} {machine}'),
      machineDestroy: hook('destroy.sh', '{job_id} {workdir} {machine}'),
      deliverCommand: hook('deliver.sh', '{message_id} {job_id} {branch} {workdir}')
    }
    const deliverMarkers = (ids) => fillCommand(`bash ${shellQuote(join(driverDir, 'deliver.sh'))} {message_id} {job_id} {branch} {workdir}`, ids)

    const analyze = async (bundle, opts) => {
      const r = await fakeAnalyze(bundle, opts)
      r.proposal.messages[0].assignee_ids = bundle.members.filter((m) => m.name === 'Claude').map((m) => m.id)
      return r
    }
    const headers = (cookie) => ({ cookie, 'x-team-request': 'panel' })
    testEnv = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, modules: { analyze } })
    const vault = createVault(loadMasterKey({ dataDir: testEnv.dir }))
    await addMember(testEnv, { email: 'ed@x.org', role: 'editor' })
    const editor = await login(testEnv, 'ed@x.org')
    const created = await testEnv.app.inject({ method: 'POST', url: '/api/members', headers: headers(editor), payload: { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Agent profile: answers conformance checks.' } })
    expect(created.statusCode === 201, `could not create the agent: ${created.body}`)
    await addMember(testEnv, { email: 'ana@x.org', name: 'Ana' })
    const author = await login(testEnv, 'ana@x.org')
    setProjectDescription(testEnv.db, 'Conformance run of a host driver.')

    const startWorker = (execute) => {
      const config = loadConfig({ DATA_DIR: testEnv.dir, LOG_LEVEL: 'silent' }, {
        execute: {
          runner: 'machine', machineBin: 'claude-double', teamUrl: 'http://host.docker.internal:3000', killGraceMs: KILL_GRACE_MS, dailyBudgetUsd: 1000,
          infraRetryWaitMs: 0, capacityWaitMs: CAPACITY_WAIT_MS, timeoutMs: HOOK_TIMEOUT_MS, deliverTimeoutMs: HOOK_TIMEOUT_MS, ...hookCommands, ...execute
        }
      })
      const handlers = {
        ...createPipeline({ db: testEnv.db, config, queue: testEnv.queue, events: testEnv.events, modules: testEnv.modules }),
        execute: createExecuteHandler({ db: testEnv.db, config, queue: testEnv.queue, events: testEnv.events, vault, getProviders: testEnv.modules.getProviders }),
        deliver: createDeliverHandler({ db: testEnv.db, config, queue: testEnv.queue, events: testEnv.events })
      }
      worker = createWorker({ db: testEnv.db, queue: testEnv.queue, events: testEnv.events, config, handlers })
      worker.start()
    }
    const jobsOf = (messageId, kind) => testEnv.db.prepare('SELECT * FROM jobs WHERE kind = ? AND message_id = ? ORDER BY id').all(kind, messageId)
    const settled = (messageId, kinds) => {
      const all = testEnv.db.prepare(`SELECT status FROM jobs WHERE message_id = ? AND kind IN (${kinds.map(() => '?').join(',')})`).all(messageId, ...kinds)
      return all.length > 0 && all.every((j) => ['done', 'failed', 'cancelled'].includes(j.status))
    }

    /** One message through the real jobs, with the settings of the case. Returns everything the cases read. */
    let counter = 0
    async function flow (name, { double = {}, execute = {}, create75 = false, deliverMode = 'pass', delivers = true, shutdownDuringRun = false }) {
      const dir = join(base, `${String(++counter).padStart(2, '0')}-${name}`)
      mkdirSync(join(dir, 'flags'), { recursive: true })
      const files = { log: join(dir, 'log'), stream: join(dir, 'session.ndjson') }
      writeFileSync(files.log, ''); writeFileSync(files.stream, '')
      const doubleEnv = { FAKE_CANARY_OUTCOME: 'done', FAKE_CANARY_TRANSCRIPT: '1', FAKE_CANARY_PUSH: '1', ...double }
      setEnv({
        CONFORMANCE_DRIVER: driverDir, CONFORMANCE_LOG: files.log, CONFORMANCE_STREAM: files.stream, CONFORMANCE_FLAGS: join(dir, 'flags'), CONFORMANCE_DOUBLE: DOUBLE,
        CONFORMANCE_DOUBLE_ENV: Object.entries(doubleEnv).map(([k, v]) => `export ${k}=${shellQuote(v)}`).join('\n'),
        CONFORMANCE_CREATE_75: create75 ? '1' : '', CONFORMANCE_DELIVER_MODE: deliverMode
      })
      await worker?.stop()
      startWorker({ deliverCommand: delivers ? hookCommands.deliverCommand : '', ...execute })
      const res = await postInput(testEnv, author, { text: `Conformance case ${name}: leave a change on the branch.` })
      const inputId = res.json().input_id
      await until(() => testEnv.db.prepare('SELECT status FROM inputs WHERE id = ?').get(inputId).status === 'proposed', { timeoutMs: 30_000 })
      const published = await testEnv.app.inject({ method: 'POST', url: `/api/inputs/${inputId}/publish`, headers: { ...headers(author), 'content-type': 'application/json' }, payload: '{}' })
      expect(published.statusCode === 200, `could not publish the message: ${published.body}`)
      const messageId = testEnv.db.prepare('SELECT id FROM messages WHERE input_id = ?').get(inputId).id
      const kinds = delivers ? ['execute', 'deliver'] : ['execute']
      if (shutdownDuringRun) {
        // The orderly shutdown of the worker (a deploy) once the session is running: `stop()` aborts the job with the reason «shutdown».
        try { await until(() => readLog(files.log).some((l) => l.order === 'run' && l.start), { timeoutMs: HOOK_TIMEOUT_MS, everyMs: 100 }) } catch { /* the case says that RUN never started */ }
        await worker.stop()
      } else {
        try { await until(() => jobsOf(messageId, 'execute').length > 0 && settled(messageId, kinds), { timeoutMs: CASE_WAIT_MS, everyMs: 100 }) } catch { /* the cases read what there is and say what is missing */ }
      }
      // The job can be closed (its own cap, a deadline) while the order that retires the machine is still running: the verdict reads the log once DESTROY of the last CREATE has ended.
      const retired = () => { const log = readLog(files.log); const at = log.map((l) => l.order).lastIndexOf('create'); return at < 0 || log.slice(at).some((l) => l.order === 'destroy') }
      try { await until(retired, { timeoutMs: HOOK_TIMEOUT_MS, everyMs: 100 }) } catch { /* the cases say that no DESTROY ran */ }
      await worker.stop(); worker = null
      // A flow leaves nothing behind. The orderly shutdown of a worker returns the job it was running to the queue with its attempt refunded (that is the contract, and what
      // «destroy-shutdown» exercises): left there, the worker of the NEXT flow claims it and runs it with the hooks, the log and the delivery mode of that flow, so a DELIVER
      // of another message lands in the log of a case that counts them (measured 2026-10-26: «deliver-76» failed with «DELIVER ran more than once» because the delivery of
      // the message of «shutdown» ran inside its flow). The jobs are read first, so the verdicts see what the flow did; the jobs still alive are cancelled after.
      const leftovers = () => testEnv.db.prepare("SELECT id FROM jobs WHERE message_id = ? AND status IN ('queued', 'running')").all(messageId).map((j) => j.id)
      const [execJob] = jobsOf(messageId, 'execute')
      const deliverJobs = jobsOf(messageId, 'deliver')
      const runRow = execJob ? testEnv.db.prepare('SELECT * FROM execute_runs WHERE job_id = ? ORDER BY attempt DESC LIMIT 1').get(execJob.id) : null
      const stream = readFileSync(files.stream, 'utf8').split('\n').filter((l) => l.trim())
      const log = readLog(files.log)
      for (const id of leftovers()) testEnv.queue.cancel(id)
      return { name, messageId, branch: `tp/${messageId}`, execJob, deliverJobs, deliverJob: deliverJobs.at(-1), runRow, log, stream, files }
    }
    const lastOf = (f, order) => f.log.filter((l) => l.order === order && !l.start).at(-1)
    const describeJobs = (f) => `execute job ${f.execJob ? `${f.execJob.status} (${String(f.execJob.last_error ?? '').slice(0, 200) || 'no error recorded'})` : 'never enqueued'}${f.deliverJob ? `; deliver job ${f.deliverJob.status}` : ''}`

    // 4. The flows and their cases.
    const needs = (...ids) => ids.some(wanted)
    let happy = null
    if (needs('sequence', 'ndjson', 'transcript', 'deliver', 'deliver-repeat', 'destroy-twice')) {
      happy = await flow('happy', {})
      const f = happy
      await verdicts.check('sequence', () => {
        expect(f.execJob?.status === 'done', `the session did not end in green: ${describeJobs(f)}`)
        const orders = f.log.filter((l) => ['create', 'run', 'collect', 'destroy'].includes(l.order) && !l.start)
        expect(orders.map((l) => l.order).join(' ') === 'create run collect destroy', `the orders ran as «${orders.map((l) => l.order).join(' ') || 'none'}», not «create run collect destroy»`)
        const bad = orders.filter((l) => l.exit !== '0')
        expect(bad.length === 0, `${bad.map((l) => `${l.order} ended with ${l.exit}`).join(', ')}`)
        const named = lastOf(f, 'create').machine
        expect(named, 'CREATE printed no machine name on its last stdout line')
        const strays = orders.slice(1).filter((l) => l.machine !== named)
        expect(strays.length === 0, `CREATE named «${named}» and ${strays.map((l) => `${l.order} received «${l.machine}»`).join(', ')}`)
        expect(f.runRow?.machine === named, `the run records the machine «${f.runRow?.machine}», not «${named}»`)
        return `machine ${named}`
      })
      await verdicts.check('ndjson', () => {
        expect(f.stream.length >= 2, `RUN printed ${f.stream.length} lines; a session prints at least its init and its result`)
        const events = f.stream.map((l, i) => { try { return JSON.parse(l) } catch { return fail(`line ${i + 1} of RUN is not JSON: ${l.slice(0, 120)}`) } })
        const notObjects = events.findIndex((e) => e === null || typeof e !== 'object' || Array.isArray(e) || typeof e.type !== 'string')
        expect(notObjects < 0, `line ${notObjects + 1} of RUN is JSON but not an event with a «type»`)
        const last = events.at(-1)
        expect(last.type === 'result', `the last line of RUN has type «${last.type}», not «result»`)
        expect(last.is_error === false && last.structured_output?.summary, 'the result carries no structured_output with a summary')
        return `${events.length} lines`
      })
      await verdicts.check('transcript', () => {
        expect(f.runRow, `no run was recorded: ${describeJobs(f)}`)
        expect(f.runRow.transcript_ref, `COLLECT left no reference${f.runRow.transcript_error ? `: ${f.runRow.transcript_error}` : ''}`)
        const ref = f.runRow.transcript_ref
        if (existsSync(ref) && statSync(ref).isDirectory()) {
          const hasJsonl = (d) => readdirSync(d, { withFileTypes: true }).some((e) => (e.isDirectory() ? hasJsonl(join(d, e.name)) : e.name.endsWith('.jsonl')))
          expect(hasJsonl(ref), `the directory ${ref} holds no .jsonl transcript`)
          return `${ref} holds a .jsonl`
        }
        return `reference ${ref}`
      })
      await verdicts.check('deliver', () => {
        expect(f.deliverJob, `no delivery was enqueued: ${describeJobs(f)}`)
        expect(f.deliverJob.status === 'done', `the delivery ended ${f.deliverJob.status}: ${String(f.deliverJob.last_error ?? '').slice(0, 300)}`)
        expect(f.runRow?.delivered === 1, `the run is not marked delivered (delivered=${f.runRow?.delivered}, held=${f.runRow?.delivery_held})`)
        expect(f.runRow.delivery_ref, 'DELIVER printed no reference on its last stdout line')
        return `reference ${f.runRow.delivery_ref}`
      })
      await verdicts.check('deliver-repeat', async () => {
        expect(f.runRow?.delivered === 1, 'there is no first delivery to repeat (see «deliver»)')
        const workdir = join(base, 'repeat-workdir'); mkdirSync(workdir, { recursive: true })
        const ids = { message_id: String(f.messageId), job_id: String(f.deliverJob.id), branch: f.branch, workdir }
        const deliverEnv = { ...process.env, TEAM_JOB_ID: ids.job_id, TEAM_MESSAGE_ID: ids.message_id, TEAM_BRANCH: ids.branch, TEAM_WORKDIR: workdir, TEAM_DELIVER_ROUND: '0', TEAM_DELIVER_ATTEMPT: '1', TEAM_OUTPUT_JSON: '{"outcome":"done"}', TEAM_BEFORE_CAPTURES: '[]', TEAM_CAPTURES_VIDEO: '0', TEAM_REVIEWED_BY: '' }
        const results = []
        for (let i = 0; i < 2; i++) results.push(await spawnStreaming('/bin/sh', ['-c', deliverMarkers(ids)], { env: deliverEnv, keepStdout: true, timeoutMs: HOOK_TIMEOUT_MS, graceMs: KILL_GRACE_MS }))
        const [a, b] = results
        expect(a.code === 0 && b.code === 0, `the repetitions ended with ${a.code} and ${b.code}${a.code !== 0 ? `: ${a.stderr.slice(-300)}` : `: ${b.stderr.slice(-300)}`}`)
        expect(lastLine(a.stdout) === lastLine(b.stdout), `the references differ: «${lastLine(a.stdout)}» and «${lastLine(b.stdout)}»`)
        expect(lastLine(a.stdout) === f.runRow.delivery_ref, `the reference of the repetition («${lastLine(a.stdout)}») is not the one of the delivery («${f.runRow.delivery_ref}»)`)
      })
      await verdicts.check('destroy-twice', async () => {
        const machine = lastOf(f, 'destroy')?.machine
        expect(machine, 'the first flow destroyed no machine to ask about again')
        const destroyCmd = fillCommand(`bash ${shellQuote(join(driverDir, 'destroy.sh'))} {job_id} {workdir} {machine}`, { job_id: String(f.execJob.id), workdir: join(base, 'repeat-workdir'), machine })
        const codes = []
        for (let i = 0; i < 2; i++) codes.push((await spawnStreaming('/bin/sh', ['-c', destroyCmd], { env: process.env, keepStdout: true, timeoutMs: HOOK_TIMEOUT_MS, graceMs: KILL_GRACE_MS })).code)
        expect(codes.every((c) => c === 0), `DESTROY of the already destroyed «${machine}» ended with ${codes.join(' and ')}`)
      })
    }

    if (needs('destroy-run-fails')) {
      const f = await flow('run-fails', { double: { FAKE_CANARY_MODE: 'exit' }, delivers: false })
      await verdicts.check('destroy-run-fails', () => {
        const starts = f.log.filter((l) => l.order === 'run' && l.start)
        expect(starts.length > 0, `RUN never started: ${describeJobs(f)}`)
        const runs = f.log.filter((l) => l.order === 'run' && !l.start)
        expect(runs.length > 0 && runs.every((l) => l.exit !== '0'), 'the session did not fail as the double was told to')
        for (const [i, start] of starts.entries()) {
          const at = f.log.indexOf(start)
          const next = f.log.slice(at + 1).find((l) => l.order === 'destroy')
          expect(next, `no DESTROY ran after the RUN number ${i + 1} (job ${start.job}) failed`)
          expect(next.exit === '0', `DESTROY after the failed RUN number ${i + 1} ended with ${next.exit}`)
        }
        return `${starts.length} run${starts.length > 1 ? 's' : ''}, each followed by a DESTROY with exit 0`
      })
    }

    if (needs('destroy-deadline')) {
      // A test deadline (DEADLINE_MS) shorter than the session (SLEEP_PAST_DEADLINE_MS); the contract fixes no number.
      const f = await flow('deadline', { double: { FAKE_CANARY_SLEEP_MS: String(SLEEP_PAST_DEADLINE_MS) }, execute: { timeoutMs: DEADLINE_MS }, delivers: false })
      await verdicts.check('destroy-deadline', () => {
        expect(f.execJob?.status === 'failed', `the job should end failed by its deadline and ended as: ${describeJobs(f)}`)
        const start = f.log.find((l) => l.order === 'run' && l.start)
        // A deadline that expired before RUN started (a slow CREATE) is also a deadline; DESTROY has to follow either way.
        const after = f.log.slice(start ? f.log.indexOf(start) : 0).find((l) => l.order === 'destroy')
        expect(after, 'no DESTROY ran after the deadline')
        expect(after.exit === '0', `DESTROY after the deadline ended with ${after.exit}`)
        return start ? 'the session was cut during RUN' : 'the deadline expired before RUN started'
      })
    }

    if (needs('destroy-shutdown')) {
      // The session outlives the stop: the double sleeps longer than the whole case. The case fixes the variable it exercises: with 1 (the default) the machine stays on purpose.
      const f = await flow('shutdown', { double: { FAKE_CANARY_SLEEP_MS: String(SLEEP_PAST_DEADLINE_MS) }, delivers: false, shutdownDuringRun: true, execute: { keepSessionOnShutdown: false } })
      await verdicts.check('destroy-shutdown', () => {
        const start = f.log.find((l) => l.order === 'run' && l.start)
        expect(start, 'RUN never started, so there was no session to shut down')
        const created = f.log.filter((l) => l.order === 'create' && l.exit === '0').at(-1)
        const after = f.log.slice(f.log.indexOf(start)).find((l) => l.order === 'destroy')
        expect(after, 'no DESTROY ran after the worker shut down in the middle of RUN: the machine is left alive')
        expect(after.exit === '0', `DESTROY after the shutdown ended with ${after.exit}`)
        expect(!created || after.machine === created.machine, `CREATE named «${created?.machine}» and DESTROY received «${after.machine}»`)
        return `machine ${after.machine} destroyed`
      })
    }

    if (needs('create-75')) {
      const f = await flow('create-75', { create75: true, delivers: false })
      await verdicts.check('create-75', () => {
        expect(f.log.some((l) => l.order === 'create' && l.injected), 'the 75 was not injected')
        expect(f.execJob?.status === 'done', `after the 75 the job should wait and end in green: ${describeJobs(f)}`)
        expect(f.execJob.attempts === 1, `the 75 spent an attempt: attempts = ${f.execJob.attempts}`)
        const creates = f.log.filter((l) => l.order === 'create' && !l.injected)
        expect(creates.length >= 1 && creates[0].exit === '0', 'CREATE did not run again after the wait')
      })
    }

    if (needs('deliver-75')) {
      const f = await flow('deliver-75', { deliverMode: 'later' })
      await verdicts.check('deliver-75', () => {
        expect(f.log.some((l) => l.order === 'deliver' && l.injected), 'the 75 was not injected')
        expect(f.deliverJob?.status === 'done', `after the 75 the delivery should wait and end in green: ${describeJobs(f)}`)
        expect(f.deliverJob.attempts === 1, `the 75 spent an attempt: attempts = ${f.deliverJob.attempts}`)
        expect(f.runRow?.delivered === 1, 'the run is not marked delivered after the wait')
        expect(f.log.filter((l) => l.order === 'deliver' && l.exit === '0').length >= 1, 'DELIVER did not run again after the wait')
      })
    }

    if (needs('deliver-76')) {
      const f = await flow('deliver-76', { deliverMode: 'held' })
      await verdicts.check('deliver-76', () => {
        expect(f.deliverJob, `no delivery was enqueued: ${describeJobs(f)}`)
        expect(f.deliverJob.status === 'done', `a held delivery ends done, not ${f.deliverJob.status}: ${String(f.deliverJob.last_error ?? '').slice(0, 300)}`)
        expect(f.deliverJob.attempts === 1, `a held delivery is not retried: attempts = ${f.deliverJob.attempts}`)
        expect(f.runRow?.delivery_held === 1 && f.runRow?.delivered === 0, `the run should be held and not delivered (delivery_held=${f.runRow?.delivery_held}, delivered=${f.runRow?.delivered})`)
        // One DELIVER per job: the queue hands a job to one attempt at a time (its claim and its renewal are fenced by the attempt), so a second line of THIS job is a real double delivery.
        expect(f.log.filter((l) => l.order === 'deliver' && l.job === String(f.deliverJob.id)).length === 1, 'DELIVER ran more than once')
        expect(f.log.every((l) => l.order !== 'deliver' || l.message === String(f.messageId)), 'a DELIVER of another message ran inside this case')
      })
    }

    return finish(verdicts, out, err, check)
  } catch (error) {
    err(`The run stopped before the end: ${error.stack ?? error.message}`)
    return FAILED
  } finally {
    await worker?.stop().catch(() => {})
    await testEnv?.close().catch(() => {})
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    if (args.keep) out(`work directory kept: ${base}`)
    else rmSync(base, { recursive: true, force: true })
  }
}

function finish (verdicts, out, err, check) {
  const failed = verdicts.failed
  const total = verdicts.list.length
  if (failed === 0) {
    out(check?.declared ? `contract_version: ${check.declared} met (${total} cases passed; the core implements ${CONTRACT_VERSION})` : `contract_version: ${CONTRACT_VERSION} met (${total} cases passed; the driver declares no version)`)
    return OK
  }
  out(`contract_version: ${check?.declared ?? CONTRACT_VERSION} NOT met: ${failed} of ${total} cases failed (${verdicts.list.filter((v) => !v.ok).map((v) => v.id).join(', ')})`)
  return FAILED
}

function parseArgs (argv) {
  const args = { driver: null, keep: false, only: null, help: false, error: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--keep') args.keep = true
    else if (a === '--driver') { args.driver = argv[++i] ?? null; if (!args.driver) args.error = '--driver needs a directory.' }
    else if (a.startsWith('--driver=')) args.driver = a.slice(9)
    else if (a === '--only') { args.only = (argv[++i] ?? '').split(',').filter(Boolean); if (!args.only.length) args.error = '--only needs case ids.' }
    else args.error = `Unknown argument: ${a}`
  }
  return args
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const code = await main(process.argv.slice(2))
  process.exit(code)
}
