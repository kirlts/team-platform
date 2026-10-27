// EXECUTE_MACHINE_COLLECT of the fly-machines driver. See collect.sh.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DriverError, execOk, findMachine, loadSettings, machineName, main, safeJob } from './lib/fly.mjs'
import { download, untar, upload } from './lib/transfer.mjs'

const MACHINE_DIR = fileURLToPath(new URL('./machine/', import.meta.url))
const hasJsonl = (dir) => readdirSync(dir, { withFileTypes: true }).some((e) => (e.isDirectory() ? hasJsonl(join(dir, e.name)) : e.name.endsWith('.jsonl')))

await main(async () => {
  const [job, workdir, machine] = process.argv.slice(2)
  if (!job || !workdir) throw new DriverError('usage: collect.sh <job_id> <workdir> <machine>')
  const s = loadSettings()
  if (machine && machine !== machineName(job)) throw new DriverError(`not a machine of this driver: ${machine}`)
  const mine = await findMachine(s, job)
  if (!mine) throw new DriverError(`the machine ${machineName(job)} does not exist`, 2)

  // pack.sh normally arrived with RUN; this makes collect independent of how far RUN got.
  await execOk(s, mine.id, ['bash', '-c', 'mkdir -p /tp/agent'])
  await upload(s, mine.id, readFileSync(join(MACHINE_DIR, 'pack.sh')), '/tp/agent/pack.sh')
  await execOk(s, mine.id, ['chmod', '755', '/tp/agent/pack.sh'])

  const outputs = await download(s, mine.id, ['job'])
  if (outputs) await untar(outputs, workdir).catch((e) => console.error(`collect.sh: captures and attachments could not be copied; the worker will discard them: ${e.message}`))

  if (s.repo) {
    const branch = execFileSync('bash', ['-c', 'set -a; . "$1"; printf %s "${TEAM_BRANCH:-}"', '_', join(workdir, 'env.sh')], { encoding: 'utf8' })
    if (branch) {
      try {
        const bundle = await download(s, mine.id, ['branch', branch])
        if (bundle) {
          const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'tp-fly-branch-'))
          try {
            writeFileSync(join(dir, 'branch.bundle'), bundle)
            execFileSync('git', ['-C', s.repo, 'fetch', '-q', join(dir, 'branch.bundle'), `refs/heads/${branch}:refs/heads/${branch}`], { stdio: ['ignore', 'ignore', 'inherit'] })
          } finally { rmSync(dir, { recursive: true, force: true }) }
          console.error(`collect.sh: the branch ${branch} is now in ${s.repo}`)
        } else console.error(`collect.sh: the session pushed no new commits to ${branch}`)
      } catch (error) {
        // The branch is not part of the transcript: a failure here is said and deliver.sh answers that the branch does not exist.
        console.error(`collect.sh: the branch ${branch} could not be brought out: ${error.message}`)
      }
    }
  }

  const transcript = await download(s, mine.id, ['transcript'])
  if (!transcript) throw new DriverError('the session left no /job/claude/projects', 3)
  const dest = join(s.state, 'transcripts', safeJob(job))
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  await untar(transcript, dest)
  if (!hasJsonl(dest)) throw new DriverError('no .jsonl transcript in the machine', 3)
  console.log(dest)
})
