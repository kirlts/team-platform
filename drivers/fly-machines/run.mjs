// EXECUTE_MACHINE_RUN of the fly-machines driver. See run.sh.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DriverError, POLL_MAX_BYTES, exec, execOk, findMachine, isMachineOfJob, loadSettings, machineName, main, sleep } from './lib/fly.mjs'
import { tarDirectory, upload } from './lib/transfer.mjs'

const MACHINE_DIR = fileURLToPath(new URL('./machine/', import.meta.url))
const quote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`

/** TEAM_BRANCH and TEAM_AGENT_EMAIL, read from env.sh the way run.sh of the job reads it. */
function sessionIdentity (workdir) {
  const out = execFileSync('bash', ['-c', 'set -a; . "$1"; printf "%s\\n%s" "${TEAM_BRANCH:-}" "${TEAM_AGENT_EMAIL:-}"', '_', join(workdir, 'env.sh')], { encoding: 'utf8' })
  const [branch, email] = out.split('\n')
  return { branch, email: email || 'agent@team-platform.invalid' }
}

/** The host repository as a git bundle of every ref (the clone in the machine starts from it). */
function repoBundle (repo) {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'tp-fly-bundle-'))
  try {
    const file = join(dir, 'repo.bundle')
    execFileSync('git', ['-C', repo, 'bundle', 'create', file, '--all'], { stdio: ['ignore', 'ignore', 'inherit'] })
    return readFileSync(file)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

async function launch (s, id, job, workdir) {
  const { branch, email } = sessionIdentity(workdir)
  if (s.repo && !branch) throw new DriverError('env.sh has no TEAM_BRANCH')
  const stage = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'tp-fly-agent-'))
  try {
    for (const f of ['poll.mjs', 'launch.sh', 'pack.sh']) copyFileSync(join(MACHINE_DIR, f), join(stage, f))
    writeFileSync(join(stage, 'launch.env'), [
      `LAUNCH_USER=${quote(s.user)}`, `LAUNCH_BRANCH=${quote(branch)}`, `LAUNCH_BASE=${quote(s.baseRef)}`,
      `GIT_NAME=${quote(process.env.GIT_AUTHOR_NAME || 'Team Platform agent')}`, `GIT_EMAIL=${quote(process.env.GIT_AUTHOR_EMAIL || email)}`
    ].join('\n') + '\n')
    // By name only into the file; the values travel inside the HTTPS body of the upload and never in a command line of this machine.
    writeFileSync(join(stage, 'session.env'), s.passEnv.filter((n) => process.env[n]).map((n) => `export ${n}=${quote(process.env[n])}`).join('\n') + '\n', { mode: 0o600 })
    chmodSync(join(stage, 'session.env'), 0o600)
    await execOk(s, id, ['bash', '-c', 'set -e; mkdir -p /tp/agent /tp/up'])
    await upload(s, id, await tarDirectory(stage), '/tp/up/agent.tgz')
  } finally { rmSync(stage, { recursive: true, force: true }) }
  await execOk(s, id, ['bash', '-c', 'set -e; tar xzf /tp/up/agent.tgz -C /tp/agent; rm -f /tp/up/agent.tgz; chmod 755 /tp/agent/launch.sh /tp/agent/pack.sh'])
  await upload(s, id, await tarDirectory(workdir), '/tp/up/job.tgz')
  if (s.repo) await upload(s, id, repoBundle(s.repo), '/tp/up/repo.bundle')
  await execOk(s, id, ['bash', '/tp/agent/launch.sh'], { timeoutS: 120 })
}

/** Follows the session until it ends. Resolves its exit code. */
async function follow (s, id) {
  let outOffset = 0
  let errOffset = 0
  let started = 0
  for (;;) {
    // The least gap between two exec calls that the API admits (lib/fly.mjs, EXEC_GAP_DEFAULT_MS); the first call goes at once.
    const wait = started + s.execGapMs - Date.now()
    if (started && wait > 0) await sleep(wait)
    started = Date.now()
    let r
    try {
      r = await exec(s, id, ['node', '/tp/agent/poll.mjs', String(outOffset), String(errOffset), String(s.pollWaitS), String(POLL_MAX_BYTES)], { timeoutS: s.pollWaitS + 5 })
    } catch (error) {
      // The API cut the call, or it is not answering for a moment: nothing was delivered, the same offsets ask again. A machine that is gone or a refusal is not retried.
      if (error.timedOut || error.code === 75) { if (error.code === 75) console.error(`run.sh: ${error.message}`); continue }
      throw error
    }
    if (r.code !== 0 && r.code !== 100) throw new DriverError(`the poll of the session failed (exit ${r.code}): ${r.stderr.slice(-500)}`)
    if (r.stdout) { process.stdout.write(r.stdout); outOffset += Buffer.byteLength(r.stdout) }
    if (r.stderr) { process.stderr.write(r.stderr); errOffset += Buffer.byteLength(r.stderr) }
    if (r.code === 100) break
  }
  const code = Number((await execOk(s, id, ['cat', '/tp/exit'])).stdout.trim())
  if (!Number.isInteger(code)) throw new DriverError('the session left no exit code')
  return code
}

await main(async () => {
  const [job, workdir, machine] = process.argv.slice(2)
  if (!job || !workdir) throw new DriverError('usage: run.sh <job_id> <workdir> <machine>')
  if (!existsSync(join(workdir, 'run.sh'))) throw new DriverError(`${join(workdir, 'run.sh')} does not exist`, 2)
  const s = loadSettings()
  if (machine && !isMachineOfJob(s, job, machine)) throw new DriverError(`not a machine of this driver: ${machine}`)
  const mine = await findMachine(s, job)
  if (!mine) throw new DriverError(`the machine ${machineName(s, job)} does not exist`, 2)
  const launched = (await exec(s, mine.id, ['test', '-d', '/tp/launched'])).code === 0
  if (launched) console.error('run.sh: the session is already launched; following it from its first line')
  else await launch(s, mine.id, job, workdir)
  const code = await follow(s, mine.id)
  await new Promise((resolve) => process.stdout.write('', resolve))
  process.exitCode = code
})
