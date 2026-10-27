#!/usr/bin/env node
// The battery record: for every commit that passed the complete battery, git notes in the canonical's remote. A host that installs
// that commit reads them with one command instead of repeating, in its own image, tests the canonical already passed. Two references:
//   refs/notes/verificaciones  the record a host reads (format 1, exactly these fields: formato, sha, resultado «verde», anfitrion,
//                              imagen_base, comandos [{orden, codigo}], momento). `anfitrion` is the fingerprint of the host's
//                              compose file, given with --compose <path> or --anfitrion <16 hex>; the file is named generically here.
//   refs/notes/battery         the same facts and more (seconds, counts, hash of each output, tree, runner, what was skipped), for
//                              whoever audits. Written first; the verification is written last, once everything else is in place.
//
//   node scripts/battery-record.mjs run <sha> [--remote origin] [--no-push] [--no-retry] [--compose <file> | --anfitrion <16 hex>]
//        runs the four orders on <sha> in a worktree of its own (removed at the end) and writes the note only if all exited 0.
//        An order that fails and names its failing test files is repeated once, only on those files (the rule of the repository for a
//        failure); if they pass, the order is recorded with exit 0 plus `first_run` and `retried`, so the note says it happened.
//   node scripts/battery-record.mjs write <sha> --from <results.jsonl> [--remote origin] [--compose <file> | --anfitrion <16 hex>]
//        writes the note from the results of orders somebody else ran (scripts/publish-main.sh, which runs the battery as the door
//        to `main` and hands over what it ran instead of running it twice). Same rule: nothing is written unless all exited 0.
//   node scripts/battery-record.mjs result --name N --exit E --seconds S --log FILE --cmd CMD
//        prints the line of results.jsonl for an order somebody else ran (counts and hash come from its log).
//   node scripts/battery-record.mjs show <sha> [--remote <url>] [--ref verificaciones|battery] [--trace]
//        prints the note of <sha> (default reference: verificaciones) (any prefix of 4 or more hex digits) and exits 0; exits 1 when there is none, 3 when there is one
//        that is not valid for that commit. Works from any repository, or from none, and does not need the commit object.
//
// The same read as one line of git, from any repository, with the full sha:
//   git fetch -q https://github.com/kirlts/team-platform.git +refs/notes/verificaciones:refs/notes/verificaciones && git notes --ref=verificaciones show <full sha>
//
// Why a git note and not a file: every write is a commit of the reference, so writing one by hand leaves the
// author, the date and the parent in the history of the reference (`show --trace`). Writes are fast-forward pushes, never forced.
// If the remote advanced between the fetch and the push (another writer), the note is applied again on top of the new head and the
// push is repeated: one note per sha means two writers never touch the same entry, so none is lost.
//
// The orders run one after the other, not side by side: `test:completa` starts containers and the others bind ports, and they were
// never run side by side (the same rule as scripts/publish-main.sh). Override for tests: BATTERY_TEST_CMD, BATTERY_PANEL_CMD,
// BATTERY_CLIENT_CMD, BATTERY_STATIC_CMD. TMPDIR is where the logs go (default $HOME/.cache: /tmp is memory).
//
// Format (schema 1), one line of JSON per note:
//   schema, sha, tree, date (ISO with offset), node, runner (user@host), commands[] (name, cmd, exit, seconds, tests/pass/fail when
//   the order prints them, log_sha256 = SHA-256 of the whole output), skipped[] (name, reason: an order the door did not run), and
//   image_base[] (ref and digest of each external `FROM` of the Dockerfile at that sha; digest null with the reason when unknown).
// The `imagen_base` of the verification is the digest of the base the production image is built on: the external root of the last
// stage of the Dockerfile. A verification is not written without it.

import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCHEMA = 1
// Each kind of note: the reference it lives in, the local mirror `show` fetches it into (never the name a host may use for its own
// copy), and its validator.
export const KINDS = {
  battery: { ref: 'refs/notes/battery', mirror: 'refs/notes/tp-battery' },
  verificaciones: { ref: 'refs/notes/verificaciones', mirror: 'refs/notes/tp-verificaciones' },
}
// Ceiling of laps of the write loop so that a remote that rejects forever cannot hold the door. A lap is repeated only because
// another writer advanced the reference, so the loop ends when the writers do; the ceiling is a guard, not a tuned value.
const WRITE_LAPS = 8 // guard against a remote that always rejects; not a measured value

const here = dirname(fileURLToPath(import.meta.url))

export const ORDERS = [
  { name: 'complete', env: 'BATTERY_TEST_CMD', cmd: 'npm run test:completa' },
  { name: 'panel', env: 'BATTERY_PANEL_CMD', cmd: 'npm run test:panel' },
  { name: 'client', env: 'BATTERY_CLIENT_CMD', cmd: 'npm run test:client' },
  { name: 'static', env: 'BATTERY_STATIC_CMD', cmd: 'node --test src/static.test.js' },
]

export function git (cwd, args, input) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', input, maxBuffer: 1 << 28, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  return { status: r.status, out: (r.stdout ?? '').trim(), raw: r.stdout ?? '', err: (r.stderr ?? '').trim() }
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

// The counts an order prints: the summary of `node --test` (TAP `# tests 12` or spec `ℹ tests 12`) or of vitest (`Tests  1 failed | 11 passed (12)`).
// The last summary wins: an order that runs several suites reports the one that closes it.
export function parseCounts (output) {
  const text = output.replace(ANSI, '')
  const node = {}
  for (const m of text.matchAll(/^(?:#|ℹ)\s+(tests|pass|fail)\s+(\d+)\s*$/gm)) node[m[1]] = Number(m[2])
  if (node.tests !== undefined) return { tests: node.tests, pass: node.pass ?? 0, fail: node.fail ?? 0 }
  let last
  for (const m of text.matchAll(/^\s*Tests\s+(?:(\d+) failed \| )?(?:(\d+) passed)?.*?\((\d+)\)\s*$/gm)) last = m
  if (last) return { tests: Number(last[3]), pass: Number(last[2] ?? 0), fail: Number(last[1] ?? 0) }
  return {}
}

// The names of what failed in an output, for the one-line-per-test report.
export function failedNames (output) {
  const names = new Set()
  for (const line of output.replace(ANSI, '').split('\n')) {
    const m = /^\s*(?:✖|not ok \d+ -)\s+(.+?)(?:\s+\(\d+(?:\.\d+)?ms\))?\s*$/.exec(line)
    if (m && !/^\d+ /.test(m[1])) names.add(m[1])
  }
  return [...names]
}

// Runs one order with bash in `cwd`, mirrors its output to the terminal, writes it to `logPath` and hashes the whole of it.
export function runOrder ({ name, cmd, cwd, env, logPath, echo = true }) {
  return new Promise((resolveRun) => {
    const started = process.hrtime.bigint()
    const hash = createHash('sha256')
    const log = createWriteStream(logPath)
    // NODE_TEST_CONTEXT would make a nested `node --test` skip its files when this script itself runs inside a test.
    const { NODE_TEST_CONTEXT: _context, ...inherited } = process.env
    const child = spawn('bash', ['-c', cmd], { cwd, env: { ...inherited, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    // The output goes to stderr: stdout of this script is the record, for whoever pipes it.
    const take = (chunk) => { hash.update(chunk); log.write(chunk); if (echo) process.stderr.write(chunk) }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    const done = (code, signal) => {
      log.end(() => {
        const seconds = Math.round(Number(process.hrtime.bigint() - started) / 1e8) / 10
        const output = readFileSync(logPath, 'utf8')
        resolveRun({ name, cmd, exit: code ?? 128, seconds, ...(signal ? { signal } : {}), ...parseCounts(output), log_sha256: hash.digest('hex'), failed: code === 0 ? [] : failedNames(output) })
      })
    }
    child.on('error', () => done(127, null))
    child.on('close', done)
  })
}

// The test files a failed `node --test` order names in its «failing tests» section (`test at <file>:<line>:<col>`).
export function failedFiles (output) {
  const files = new Set()
  for (const m of output.replace(ANSI, '').matchAll(/^test at (\S+?):\d+:\d+\s*$/gm)) files.add(m[1])
  return [...files]
}

// The rule of the repository for a failure: repeat only what failed, once (docs of the door, «un reintento repite sólo lo que falló»).
// Returns the order's result as it stands to be recorded: untouched when it passed or names no file; with exit 0 and the declared
// `first_run` and `retried` when the files that failed pass on their own. A file that fails again leaves the order failed.
export async function retryFailedFiles (result, { cwd, env, logPath }) {
  if (result.exit === 0) return result
  const files = failedFiles(readFileSync(logPath, 'utf8'))
  if (files.length === 0) return result
  const quoted = files.map((f) => `'${f.replaceAll("'", "'\\''")}'`).join(' ')
  const cmd = `node --test ${quoted}`
  console.error(`\n==> retry only what failed in ${result.name}: ${cmd}`)
  const again = await runOrder({ name: `${result.name}-retry`, cmd, cwd, env, logPath: `${logPath}.retry` })
  if (again.exit !== 0) return { ...result, retried: { files, exit: again.exit, seconds: again.seconds } }
  const { tests, pass, fail } = result
  return {
    name: result.name,
    cmd: result.cmd,
    exit: 0,
    seconds: result.seconds,
    log_sha256: result.log_sha256,
    first_run: { exit: result.exit, tests, pass, fail, seconds: result.seconds },
    retried: { files, exit: 0, seconds: again.seconds, tests: again.tests, pass: again.pass, fail: again.fail, log_sha256: again.log_sha256 },
    failed: [],
  }
}

// The external bases of a Dockerfile: the `FROM` lines that do not name an earlier stage.
export function externalBases (dockerfile) {
  const stages = new Set()
  const refs = []
  for (const line of dockerfile.split('\n')) {
    const m = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(line)
    if (!m) continue
    if (!stages.has(m[1]) && m[1] !== 'scratch' && !refs.includes(m[1])) refs.push(m[1])
    if (m[2]) stages.add(m[2])
  }
  return refs
}

// The digest of an image reference: the registry's (what a build pulls) when it answers, else the local copy's. `lookup` is injectable.
export function lookupDigest (ref) {
  // Test seam: BATTERY_TEST_DIGESTS = JSON {ref: digest} answers without a registry.
  if (process.env.BATTERY_TEST_DIGESTS) {
    const known = JSON.parse(process.env.BATTERY_TEST_DIGESTS)[ref]
    return known ? { digest: known } : { digest: null, reason: 'not in BATTERY_TEST_DIGESTS' }
  }
  const reasons = []
  const remote = spawnSync('docker', ['buildx', 'imagetools', 'inspect', ref], { encoding: 'utf8' })
  const m = remote.status === 0 ? /^Digest:\s+(sha256:[0-9a-f]{64})/m.exec(remote.stdout) : null
  if (m) return { digest: m[1] }
  reasons.push(`imagetools inspect: ${(remote.stderr || remote.error?.message || 'no digest in the answer').trim().split('\n')[0]}`)
  const local = spawnSync('docker', ['image', 'inspect', '--format', '{{join .RepoDigests "\n"}}', ref], { encoding: 'utf8' })
  const l = local.status === 0 ? /@(sha256:[0-9a-f]{64})/.exec(local.stdout) : null
  if (l) return { digest: l[1] }
  reasons.push(`image inspect: ${(local.stderr || local.error?.message || 'the image has no repository digest').trim().split('\n')[0]}`)
  return { digest: null, reason: reasons.join('; ') }
}

export function imageBase (dockerfile, lookup = lookupDigest) {
  if (dockerfile == null) return [{ ref: null, digest: null, reason: 'no Dockerfile at that commit' }]
  return externalBases(dockerfile).map((ref) => ({ ref, ...lookup(ref) }))
}

// The record of a commit. Throws unless every order that ran exited 0 and at least one ran: a record exists only for what passed.
export function buildRecord ({ sha, tree, results, skipped = [], bases, date = new Date(), nodeVersion = process.version, runner }) {
  const ran = results.filter((r) => !r.skipped)
  if (ran.length === 0) throw new Error('no order ran: there is nothing to record')
  const bad = ran.filter((r) => r.exit !== 0)
  if (bad.length > 0) throw new Error(`not recorded, these orders did not exit 0: ${bad.map((r) => `${r.name} (${r.exit})`).join(', ')}`)
  const pad = (n) => String(Math.abs(n)).padStart(2, '0')
  const off = -date.getTimezoneOffset()
  const stamp = `${new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19)}${off >= 0 ? '+' : '-'}${pad(Math.trunc(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  return {
    schema: SCHEMA,
    sha,
    tree,
    date: stamp,
    node: nodeVersion,
    runner: runner ?? `${userInfo().username}@${hostname()}`,
    commands: ran.map(({ name, cmd, exit, seconds, tests, pass, fail, log_sha256: logHash, first_run: firstRun, retried }) => ({ name, cmd, exit, seconds, ...(tests !== undefined ? { tests, pass, fail } : {}), log_sha256: logHash, ...(retried ? { first_run: firstRun, retried } : {}) })),
    skipped,
    image_base: bases,
  }
}

// The base the production image is built on: the external image at the root of the last stage of the Dockerfile.
export function finalBase (dockerfile) {
  const from = new Map() // stage name -> what it starts from
  let last = null
  for (const line of dockerfile.split('\n')) {
    const m = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(line)
    if (!m) continue
    last = m[1]
    if (m[2]) from.set(m[2], m[1])
  }
  const seen = new Set()
  while (last && from.has(last) && !seen.has(last)) { seen.add(last); last = from.get(last) }
  return last
}

// The fingerprint of a host's compose file: its text with every 40-hex sha (and the `-<suffix>` after it) replaced by `V`, SHA-256,
// first 16 hex digits. The text is taken without its trailing newlines and closed with one, as the reader does.
export function hostFingerprint (composeText) {
  const text = `${composeText.replace(/\n+$/, '')}\n`
  return createHash('sha256').update(text.replace(/[0-9a-f]{40}(-[0-9a-z]+)?/g, 'V')).digest('hex').slice(0, 16)
}

// The verification a host reads (format 1). Throws unless every order exited 0 and the base digest is known.
export function buildVerification ({ sha, host, results, baseDigest, baseReason, date = new Date() }) {
  if (!/^[0-9a-f]{16}$/.test(host ?? '')) throw new Error(`the host fingerprint must be 16 hex digits, got ${host}`)
  if (!/^sha256:[0-9a-f]{64}$/.test(baseDigest ?? '')) throw new Error(`no verification: the digest of the image base is unknown${baseReason ? ` (${baseReason})` : ''}`)
  const ran = results.filter((r) => !r.skipped)
  const bad = ran.filter((r) => r.exit !== 0)
  if (ran.length === 0 || bad.length > 0) throw new Error('no verification: an order did not exit 0, or none ran')
  return {
    formato: 1,
    sha,
    resultado: 'verde',
    anfitrion: host,
    imagen_base: baseDigest,
    // An order repeated only on its failed files is named with what was repeated: the note must not say the first run exited 0.
    comandos: ran.map((r) => ({ orden: r.retried ? `${r.cmd} (first run failed; repeated only: ${r.retried.files.join(' ')})` : r.cmd, codigo: r.exit })),
    momento: `${date.toISOString().slice(0, 19)}Z`,
  }
}

// The problems of a verification read from a note (the same checks as its reader). Empty when it is valid for `sha`.
export function verificationProblems (r, sha) {
  const problems = []
  if (r.formato !== 1) problems.push(`formato ${r.formato}`)
  if (!/^[0-9a-f]{40}$/.test(r.sha ?? '') || r.sha !== sha) problems.push(`the note says it is for ${r.sha}, it is stored under ${sha}`)
  if (r.resultado !== 'verde') problems.push(`resultado ${r.resultado}`)
  if (!/^[0-9a-f]{16}$/.test(r.anfitrion ?? '')) problems.push('anfitrion is not 16 hex digits')
  if (!/^sha256:[0-9a-f]{64}$/.test(r.imagen_base ?? '')) problems.push('imagen_base is not a sha256 digest')
  if (!Array.isArray(r.comandos) || r.comandos.length === 0 || r.comandos.some((c) => !c || typeof c.orden !== 'string' || c.codigo !== 0)) problems.push('comandos is empty or has a code other than 0')
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(r.momento ?? '')) problems.push('momento is not a UTC ISO date')
  return problems
}

// The problems of a battery record read from a note.
export function batteryProblems (r, sha, repo) {
  const problems = []
  if (r.schema !== SCHEMA) problems.push(`schema ${r.schema} (this reader knows ${SCHEMA})`)
  if (r.sha !== sha) problems.push(`the note says it is for ${r.sha}, it is stored under ${sha}`)
  if (!Array.isArray(r.commands) || r.commands.length === 0 || r.commands.some((c) => c.exit !== 0)) problems.push('it lists no command, or one that did not exit 0')
  // The tree is checked when the commit is at hand; a host that only fetched the notes does not have it and relies on the sha.
  if (repo) {
    const tree = git(repo, ['rev-parse', '--verify', '-q', `${sha}^{tree}`])
    if (tree.status === 0 && tree.out !== r.tree) problems.push(`the tree of the commit is ${tree.out}, the note says ${r.tree}`)
  }
  return problems
}

// A push the remote refused because the reference moved (another writer), as opposed to a refusal of policy or of the network.
const isRejection = (err) => /\[rejected\]|non-fast-forward|fetch first|stale info|failed to update ref|failed to lock|cannot lock ref/i.test(err)

// Writes the note of record.sha into `refs/notes/battery` of `remote` (a name or a URL), from the repository `repo`, which has the commit.
export function writeNote (repo, remote, record, { beforePush, kind = 'battery' } = {}) {
  const NOTES_REF = KINDS[kind].ref
  const work = mkdtempSync(join(process.env.TMPDIR || join(process.env.HOME, '.cache'), 'battery-note-'))
  const file = join(work, 'note.json')
  const tmpRef = `refs/notes/battery-w-${process.pid}-${randomBytes(3).toString('hex')}`
  try {
    writeFileSync(file, `${JSON.stringify(record)}\n`)
    for (let lap = 1; lap <= WRITE_LAPS; lap++) {
      git(repo, ['update-ref', '-d', tmpRef])
      const head = git(repo, ['ls-remote', remote, NOTES_REF])
      if (head.status !== 0) throw new Error(`cannot read ${NOTES_REF} from ${remote}: ${head.err}`)
      if (head.out) {
        const f = git(repo, ['fetch', '-q', remote, `+${NOTES_REF}:${tmpRef}`])
        if (f.status !== 0) throw new Error(`cannot fetch ${NOTES_REF} from ${remote}: ${f.err}`)
      }
      const add = git(repo, ['notes', `--ref=${tmpRef}`, 'add', '-f', '-F', file, record.sha])
      if (add.status !== 0) throw new Error(`git notes add: ${add.err}`)
      if (beforePush) beforePush(lap) // test seam: lets a test move the remote reference between the fetch and the push
      const push = git(repo, ['push', '-q', remote, `${tmpRef}:${NOTES_REF}`])
      if (push.status === 0) return { lap }
      if (!isRejection(push.err)) throw new Error(`push of ${NOTES_REF} to ${remote}: ${push.err}`)
    }
    throw new Error(`${NOTES_REF} on ${remote} kept advancing for ${WRITE_LAPS} laps`)
  } finally {
    git(repo, ['update-ref', '-d', tmpRef])
    rmSync(work, { recursive: true, force: true })
  }
}

// The path of the note of `sha` inside the notes tree: git fans notes out in directories of two hex digits when there are many.
function notePath (repo, ref, wanted) {
  const full = /^[0-9a-f]{40}$/.test(wanted)
  if (full) {
    for (const p of [wanted, `${wanted.slice(0, 2)}/${wanted.slice(2)}`, `${wanted.slice(0, 2)}/${wanted.slice(2, 4)}/${wanted.slice(4)}`]) {
      if (git(repo, ['cat-file', '-e', `${ref}:${p}`]).status === 0) return { path: p, sha: wanted }
    }
    return null
  }
  const listing = git(repo, ['ls-tree', '-r', '--name-only', ref])
  if (listing.status !== 0) return null
  const found = listing.raw.split('\n').filter(Boolean).map((p) => ({ path: p, sha: p.replaceAll('/', '') })).filter((e) => e.sha.startsWith(wanted))
  if (found.length > 1) throw new Error(`${wanted} is ambiguous: ${found.map((e) => e.sha.slice(0, 12)).join(', ')}`)
  return found[0] ?? null
}

// Reads the note of `wanted` (a full sha or a prefix) from `remote`. `repo` is any repository (it receives the mirror reference
// `refs/notes/tp-<kind>`), or null to use a throwaway one. Returns { status: 'found'|'missing'|'invalid', ... }.
export function readNote (repo, remote, wanted, { trace = false, kind = 'battery' } = {}) {
  const NOTES_REF = KINDS[kind].ref
  const MIRROR_REF = KINDS[kind].mirror
  let dir = null
  let cwd = repo
  if (!cwd) {
    dir = mkdtempSync(join(process.env.TMPDIR || join(process.env.HOME, '.cache'), 'battery-show-'))
    git(dir, ['init', '-q', '--bare'])
    cwd = dir
  }
  try {
    if (!/^[0-9a-f]{4,40}$/.test(wanted)) return { status: 'invalid', reason: `${wanted} is not a hex sha` }
    const head = git(cwd, ['ls-remote', remote, NOTES_REF])
    if (head.status !== 0) throw new Error(`cannot read ${NOTES_REF} from ${remote}: ${head.err}`)
    if (!head.out) return { status: 'missing', reason: `${remote} has no ${NOTES_REF}` }
    const f = git(cwd, ['fetch', '-q', remote, `+${NOTES_REF}:${MIRROR_REF}`])
    if (f.status !== 0) throw new Error(`cannot fetch ${NOTES_REF} from ${remote}: ${f.err}`)
    const hit = notePath(cwd, MIRROR_REF, wanted)
    if (!hit) return { status: 'missing', reason: `no record for ${wanted}` }
    const text = git(cwd, ['cat-file', 'blob', `${MIRROR_REF}:${hit.path}`]).out
    let record
    try { record = JSON.parse(text) } catch { return { status: 'invalid', reason: 'the note is not JSON', sha: hit.sha } }
    const problems = kind === 'verificaciones' ? verificationProblems(record, hit.sha) : batteryProblems(record, hit.sha, repo)
    const out = { status: problems.length ? 'invalid' : 'found', record, sha: hit.sha, problems }
    if (trace) out.trace = git(cwd, ['log', '--format=%H %an <%ae> %aI %s', MIRROR_REF, '--', hit.path]).out.split('\n').filter(Boolean)
    return out
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}

// ---- the commands -------------------------------------------------------------------------------------------------------------

function parseArgs (argv) {
  const opts = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--no-push' || a === '--trace' || a === '--no-retry') opts[a.slice(2)] = true
    else if (['--remote', '--ref', '--anfitrion', '--compose', '--from', '--name', '--exit', '--seconds', '--log', '--cmd'].includes(a)) opts[a.slice(2)] = argv[++i]
    else if (a.startsWith('--')) { console.error(`battery-record: unknown option ${a}`); process.exit(2) }
    else opts._.push(a)
  }
  return opts
}

const repoRoot = () => {
  const r = git(here, ['rev-parse', '--show-toplevel'])
  if (r.status !== 0) throw new Error('this script must run from a checkout of the canonical')
  return r.out
}
const commonDir = (root) => resolve(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).out, '..')

function resolveCommit (root, wanted, remote) {
  let r = git(root, ['rev-parse', '--verify', '-q', `${wanted}^{commit}`])
  if (r.status !== 0) {
    git(root, ['fetch', '-q', remote])
    r = git(root, ['rev-parse', '--verify', '-q', `${wanted}^{commit}`])
  }
  if (r.status !== 0) throw new Error(`${wanted} is not a commit of this repository or of ${remote}`)
  return r.out
}

// The fingerprint of the host the tests ran against: given as 16 hex digits or computed from its compose file. Null when neither is given.
function hostOf (opts) {
  if (opts.anfitrion) return opts.anfitrion
  if (opts.compose) return hostFingerprint(readFileSync(opts.compose, 'utf8'))
  return null
}

// Both notes of a commit from the results of its orders. The verification is null (with a warning) when no host was given.
function recordsFor (root, sha, results, skipped, opts) {
  const tree = git(root, ['rev-parse', `${sha}^{tree}`]).out
  const dockerfile = git(root, ['show', `${sha}:Dockerfile`])
  const bases = imageBase(dockerfile.status === 0 ? dockerfile.raw : null)
  const battery = buildRecord({ sha, tree, results, skipped, bases })
  const host = hostOf(opts)
  if (!host) {
    console.error('battery-record: no --compose or --anfitrion given: only the detailed record is written, not the verification a host reads')
    return { battery, verification: null }
  }
  const root_ = dockerfile.status === 0 ? finalBase(dockerfile.raw) : null
  const entry = bases.find((b) => b.ref === root_)
  const verification = buildVerification({ sha, host, results, baseDigest: entry?.digest, baseReason: entry?.reason ?? 'no Dockerfile or no FROM at that commit' })
  return { battery, verification }
}

// Writes the detailed record first and the verification last: the verification is the signal a host acts on.
function persist (root, remote, { battery, verification }) {
  const written = []
  const w = writeNote(root, remote, battery, { kind: 'battery' })
  written.push(`${KINDS.battery.ref} (lap ${w.lap})`)
  if (verification) {
    const v = writeNote(root, remote, verification, { kind: 'verificaciones' })
    written.push(`${KINDS.verificaciones.ref} (lap ${v.lap})`)
  }
  console.error(`battery-record: wrote ${written.join(' and ')} for ${battery.sha} on ${remote}`)
}

function prepareModules (root, common, wt, rel) {
  const dir = join(wt, rel)
  if (!existsSync(join(dir, 'package-lock.json'))) return
  const home = join(common, rel)
  if (existsSync(join(home, 'node_modules')) && existsSync(join(home, 'package-lock.json')) && readFileSync(join(home, 'package-lock.json')).equals(readFileSync(join(dir, 'package-lock.json')))) {
    symlinkSync(join(home, 'node_modules'), join(dir, 'node_modules'))
    return
  }
  console.error(`battery-record: installing ${rel || '.'} (its lockfile at the sha differs from the one installed in ${home})`)
  const r = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`npm ci failed in ${rel || '.'}`)
}

async function commandRun (opts) {
  const root = repoRoot()
  const remote = opts.remote ?? 'origin'
  if (!opts._[1]) { console.error('usage: battery-record run <sha>'); return 2 }
  const sha = resolveCommit(root, opts._[1], remote)
  const common = commonDir(root)
  const tmp = process.env.TMPDIR || join(process.env.HOME, '.cache')
  const logs = join(tmp, `battery-${sha.slice(0, 8)}-${process.pid}`)
  mkdirSync(logs, { recursive: true })
  mkdirSync(join(common, '.claude/worktrees'), { recursive: true })
  const wt = join(common, '.claude/worktrees', `battery-${sha.slice(0, 8)}-${process.pid}`)
  const add = git(root, ['worktree', 'add', '-q', '--detach', wt, sha])
  if (add.status !== 0) throw new Error(`cannot create the worktree: ${add.err}`)
  const results = []
  try {
    for (const rel of ['', 'panel', 'packages/client']) prepareModules(root, common, wt, rel)
    for (const order of ORDERS) {
      const cmd = process.env[order.env] ?? order.cmd
      console.error(`\n==> ${order.name}: ${cmd}`)
      const logPath = join(logs, `${order.name}.log`)
      let r = await runOrder({ name: order.name, cmd, cwd: wt, env: { TMPDIR: tmp }, logPath })
      if (!opts['no-retry']) r = await retryFailedFiles(r, { cwd: wt, env: { TMPDIR: tmp }, logPath })
      results.push(r)
      if (r.exit !== 0) break // the record needs all of them; the rest would only spend the machine
    }
    const bad = results.filter((r) => r.exit !== 0)
    console.error('\nbattery-record: orders')
    for (const r of results) console.error(`  ${r.name.padEnd(9)} ${r.exit === 0 ? 'ok    ' : `FAILED (${r.exit})`} ${r.seconds}s ${r.tests !== undefined ? `${r.pass}/${r.tests} pass` : ''}${r.retried ? ` (repeated only: ${r.retried.files.join(', ')})` : ''}  ${r.cmd}`)
    if (bad.length) {
      for (const r of bad) for (const n of r.failed) console.error(`  failed: ${n}`)
      console.error(`battery-record: nothing written for ${sha}; logs in ${logs}`)
      return 1
    }
    const records = recordsFor(root, sha, results, [], opts)
    if (!opts['no-push']) persist(root, remote, records)
    console.log(JSON.stringify(records.verification ?? records.battery))
    rmSync(logs, { recursive: true, force: true })
    return 0
  } finally {
    spawnSync('find', [wt, '-maxdepth', '3', '-name', 'node_modules', '-type', 'l', '-delete'])
    git(root, ['worktree', 'remove', '--force', wt])
    git(root, ['worktree', 'prune'])
  }
}

function commandWrite (opts) {
  const root = repoRoot()
  const remote = opts.remote ?? 'origin'
  if (!opts._[1] || !opts.from) { console.error('usage: battery-record write <sha> --from <results.jsonl>'); return 2 }
  const sha = resolveCommit(root, opts._[1], remote)
  const lines = readFileSync(opts.from, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const results = lines.filter((l) => !l.skipped)
  const skipped = lines.filter((l) => l.skipped).map((l) => ({ name: l.name, reason: l.skipped }))
  const records = recordsFor(root, sha, results, skipped, opts)
  persist(root, remote, records)
  console.log(JSON.stringify(records.verification ?? records.battery))
  return 0
}

function commandResult (opts) {
  if (!opts.name || opts.exit === undefined || !opts.log || !opts.cmd) { console.error('usage: battery-record result --name N --exit E --seconds S --log FILE --cmd CMD'); return 2 }
  const raw = readFileSync(opts.log)
  const output = raw.toString('utf8')
  console.log(JSON.stringify({ name: opts.name, cmd: opts.cmd, exit: Number(opts.exit), seconds: Number(opts.seconds), ...parseCounts(output), log_sha256: createHash('sha256').update(raw).digest('hex') }))
  return 0
}

function commandShow (opts) {
  if (!opts._[1]) { console.error('usage: battery-record show <sha> [--remote <url>] [--ref verificaciones|battery] [--trace]'); return 2 }
  const inside = git(process.cwd(), ['rev-parse', '--git-dir']).status === 0
  const bare = git(process.cwd(), ['rev-parse', '--is-bare-repository']).out === 'true'
  const repo = inside && !bare ? process.cwd() : null
  const remote = opts.remote ?? (repo ? 'origin' : null)
  if (!remote) { console.error('battery-record show: outside a repository the remote is required (--remote <url>)'); return 2 }
  const kind = opts.ref ?? 'verificaciones'
  if (!KINDS[kind]) { console.error(`battery-record show: --ref is one of ${Object.keys(KINDS).join(', ')}`); return 2 }
  const r = readNote(repo, remote, opts._[1].toLowerCase(), { trace: opts.trace, kind })
  if (r.status === 'missing') { console.error(`battery-record: ${r.reason}`); return 1 }
  if (r.status === 'invalid') {
    console.error(`battery-record: invalid record: ${r.problems?.join('; ') ?? r.reason}`)
    for (const line of r.trace ?? []) console.error(`  ref history: ${line}`)
    return 3
  }
  console.log(JSON.stringify(r.record))
  for (const line of r.trace ?? []) console.error(`  ref history: ${line}`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2))
  const table = { run: commandRun, write: commandWrite, result: commandResult, show: commandShow }
  const fn = table[opts._[0]]
  if (!fn) { console.error('usage: battery-record <run|write|result|show> <sha> [options]'); process.exit(2) }
  Promise.resolve().then(() => fn(opts)).then((code) => process.exit(code), (e) => { console.error(`battery-record: ${e.message}`); process.exit(1) })
}
