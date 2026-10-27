// scripts/battery-record.mjs on toy repositories with a local remote and doubles for the four orders (BATTERY_*_CMD).
// Nothing here touches the real remote: every repository lives under .cache/ of the checkout (never /tmp, which is memory).
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { baseOf, buildRecord, buildVerification, externalBases, failedFiles, failedNames, finalBase, hostFingerprint, imageBase, imageMarkers, inImage, lookupDigest, parseCounts, pickBase, readNote, skippedTests, verificationProblems, writeNote } from './battery-record.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GIT_ENV = { GIT_AUTHOR_NAME: 'author', GIT_AUTHOR_EMAIL: 'a@t', GIT_COMMITTER_NAME: 'author', GIT_COMMITTER_EMAIL: 'a@t', GIT_CONFIG_NOSYSTEM: '1' }
// Two tests call writeNote() in this process, whose git commands inherit this environment: the identity is the test's own, not the machine's.
Object.assign(process.env, GIT_ENV)
let base
let counter = 0

const sh = (cwd, cmd, args, env = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV, ...env } })
const ok = (cwd, cmd, args, env) => { const r = sh(cwd, cmd, args, env); assert.equal(r.status, 0, `${cmd} ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim() }

// A toy canonical: a bare remote and a repository with the script copied in and two commits pushed.
function makeToy () {
  const dir = join(base, `t${++counter}`)
  mkdirSync(dir, { recursive: true })
  const remote = join(dir, 'remote.git')
  const repo = join(dir, 'repo')
  ok(dir, 'git', ['init', '-q', '--bare', 'remote.git'])
  ok(dir, 'git', ['init', '-q', '-b', 'desarrollo', 'repo'])
  mkdirSync(join(repo, 'scripts'))
  cpSync(join(root, 'scripts/battery-record.mjs'), join(repo, 'scripts/battery-record.mjs'))
  ok(repo, 'git', ['remote', 'add', 'origin', remote])
  const commit = (name) => { writeFileSync(join(repo, name), name); ok(repo, 'git', ['add', name]); ok(repo, 'git', ['commit', '-q', '-m', name]); return ok(repo, 'git', ['rev-parse', 'HEAD']) }
  const first = commit('first')
  const second = commit('second')
  ok(repo, 'git', ['push', '-q', 'origin', 'desarrollo'])
  const doubles = (over = {}) => ({ TMPDIR: join(dir, 'tmp'), BATTERY_TEST_CMD: 'echo "# tests 3"; echo "# pass 3"; echo "# fail 0"', BATTERY_PANEL_CMD: 'echo "Tests  7 passed (7)"', BATTERY_CLIENT_CMD: 'echo client', BATTERY_STATIC_CMD: 'echo static', ...over })
  const run = (sha, over = {}, args = []) => sh(repo, 'node', ['scripts/battery-record.mjs', 'run', sha, ...args], doubles(over))
  const notesRef = () => sh(repo, 'git', ['ls-remote', 'origin', 'refs/notes/battery']).stdout.trim()
  return { dir, remote, repo, first, second, run, notesRef, doubles }
}

// Any other repository: it has none of the commits of the canonical.
function makeElsewhere (t) {
  const other = join(t.dir, 'elsewhere')
  ok(t.dir, 'git', ['init', '-q', 'elsewhere'])
  return other
}

before(() => {
  mkdirSync(join(root, '.cache'), { recursive: true })
  base = mkdtempSync(join(root, '.cache', 'battery-test-'))
})
after(() => rmSync(base, { recursive: true, force: true }))

test('the counts of an order are read from node --test (TAP and spec) and vitest, and the last summary wins', () => {
  assert.deepEqual(parseCounts('# tests 12\n# pass 10\n# fail 2\n'), { tests: 12, pass: 10, fail: 2 })
  assert.deepEqual(parseCounts('ℹ tests 4\nℹ pass 4\nℹ fail 0\n'), { tests: 4, pass: 4, fail: 0 })
  assert.deepEqual(parseCounts('\u001b[2m Tests \u001b[22m 1 failed | 11 passed (12)\n'), { tests: 12, pass: 11, fail: 1 })
  assert.deepEqual(parseCounts('Tests  5 passed (5)\n'), { tests: 5, pass: 5, fail: 0 })
  assert.deepEqual(parseCounts('nothing to count\n'), {})
  assert.deepEqual(failedNames('✖ the first (1.2ms)\n  ✖ nested one\nok 1 - fine\nnot ok 2 - the second\nℹ fail 2\n'), ['the first', 'nested one', 'the second'])
})

test('the external bases of a Dockerfile are the FROM lines that do not name an earlier stage', () => {
  const df = 'FROM node:24-alpine AS panel\nFROM alpine:3.24 AS base\nFROM base AS extract\nFROM node:24-alpine AS deps\nFROM base\n'
  assert.deepEqual(externalBases(df), ['node:24-alpine', 'alpine:3.24'])
  const lookup = (ref) => (ref.startsWith('node') ? { digest: `sha256:${'a'.repeat(64)}` } : { digest: null, reason: 'offline' })
  assert.deepEqual(imageBase(df, lookup), [
    { ref: 'node:24-alpine', digest: `sha256:${'a'.repeat(64)}` },
    { ref: 'alpine:3.24', digest: null, reason: 'offline' },
  ])
  assert.deepEqual(imageBase(null)[0].digest, null)
})

test('a record is built only from orders that all exited 0', () => {
  const sha = 'a'.repeat(40)
  const good = { name: 'complete', cmd: 'x', exit: 0, seconds: 1.5, tests: 3, pass: 3, fail: 0, log_sha256: 'b'.repeat(64) }
  const rec = buildRecord({ sha, tree: 'c'.repeat(40), results: [good], bases: [], runner: 'u@h' })
  assert.equal(rec.schema, 1)
  assert.match(rec.date, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/)
  assert.deepEqual(rec.commands[0], { name: 'complete', cmd: 'x', exit: 0, seconds: 1.5, tests: 3, pass: 3, fail: 0, log_sha256: 'b'.repeat(64) })
  assert.throws(() => buildRecord({ sha, tree: 't', results: [good, { ...good, name: 'panel', exit: 1 }], bases: [] }), /did not exit 0: panel \(1\)/)
  assert.throws(() => buildRecord({ sha, tree: 't', results: [], bases: [] }), /nothing to record/)
})

test('run writes the note only when every order exits 0, and then show finds it from another repository that lacks the commit', () => {
  const t = makeToy()
  const r = t.run(t.second)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const record = JSON.parse(r.stdout)
  assert.deepEqual(record.commands.map((c) => c.name), ['complete', 'panel', 'client', 'static'])
  assert.deepEqual([record.commands[0].tests, record.commands[0].pass, record.commands[0].fail], [3, 3, 0])
  assert.equal(record.commands[1].tests, 7)
  assert.equal(record.sha, t.second)
  assert.equal(record.tree, ok(t.repo, 'git', ['rev-parse', `${t.second}^{tree}`]))
  assert.equal(record.image_base[0].digest, null) // the toy has no Dockerfile
  assert.match(record.image_base[0].reason, /no Dockerfile/)
  assert.match(t.notesRef(), /refs\/notes\/battery$/)
  assert.equal(ok(t.repo, 'git', ['worktree', 'list']).split('\n').length, 1, 'the worktree of the run is removed')

  const elsewhere = makeElsewhere(t)
  assert.notEqual(sh(elsewhere, 'git', ['cat-file', '-e', t.second]).status, 0, 'the other repository does not have the commit')
  const show = sh(elsewhere, 'node', [join(t.repo, 'scripts/battery-record.mjs'), 'show', t.second, '--ref', 'battery', '--remote', t.remote])
  assert.equal(show.status, 0, show.stderr)
  assert.deepEqual(JSON.parse(show.stdout), record)
  const short = sh(elsewhere, 'node', [join(t.repo, 'scripts/battery-record.mjs'), 'show', t.second.slice(0, 8), '--ref', 'battery', '--remote', t.remote])
  assert.equal(short.status, 0, short.stderr)
  // The one line of git of the documentation gives the same note without the script.
  const line = sh(elsewhere, 'bash', ['-c', `git fetch -q ${t.remote} +refs/notes/battery:refs/notes/tp-battery && git notes --ref=tp-battery show ${t.second}`])
  assert.equal(line.status, 0, line.stderr)
  assert.deepEqual(JSON.parse(line.stdout), record)
  // A commit that did not pass has no record.
  const none = sh(elsewhere, 'node', [join(t.repo, 'scripts/battery-record.mjs'), 'show', t.first, '--ref', 'battery', '--remote', t.remote])
  assert.equal(none.status, 1)
  assert.equal(none.stdout, '')
  // From no repository at all.
  const outside = sh(t.dir, 'node', [join(t.repo, 'scripts/battery-record.mjs'), 'show', t.second, '--ref', 'battery', '--remote', t.remote])
  assert.equal(outside.status, 0, outside.stderr)
})

test('an order that exits non-zero writes nothing and the failures are listed one per line', () => {
  const t = makeToy()
  const r = t.run(t.second, { BATTERY_PANEL_CMD: 'echo "✖ the broken one (3.1ms)"; echo "✖ another one"; exit 1' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /failed: the broken one/)
  assert.match(r.stderr, /failed: another one/)
  assert.match(r.stderr, /nothing written/)
  assert.equal(t.notesRef(), '', 'the reference does not exist on the remote')
  assert.doesNotMatch(r.stderr, /==> client/, 'the orders after the failure do not run')
})

test('a note written by hand is a commit in the history of the reference, and a note under the wrong sha is not valid', () => {
  const t = makeToy()
  assert.equal(t.run(t.second).status, 0)
  const hand = join(t.dir, 'hand')
  ok(t.dir, 'git', ['clone', '-q', t.remote, 'hand'])
  ok(hand, 'git', ['fetch', '-q', 'origin', 'refs/notes/battery:refs/notes/battery'])
  const forged = JSON.stringify({ schema: 1, sha: t.second, tree: 'f'.repeat(40), date: 'x', node: 'v0', runner: 'x@y', commands: [{ name: 'complete', cmd: 'true', exit: 0, seconds: 0, log_sha256: '0' }], skipped: [], image_base: [] })
  const byHand = { GIT_AUTHOR_NAME: 'someone by hand', GIT_COMMITTER_NAME: 'someone by hand' }
  ok(hand, 'git', ['notes', '--ref=battery', 'add', '-f', '-m', forged, t.first], byHand) // under the wrong sha: says it is for `second`
  ok(hand, 'git', ['push', '-q', 'origin', 'refs/notes/battery'])
  const history = ok(t.repo, 'git', ['ls-remote', 'origin', 'refs/notes/battery']).split('\t')[0]
  ok(t.repo, 'git', ['fetch', '-q', 'origin', 'refs/notes/battery:refs/notes/tp-battery'])
  assert.equal(history, ok(t.repo, 'git', ['rev-parse', 'refs/notes/tp-battery']))
  assert.equal(ok(t.repo, 'git', ['rev-list', '--count', 'refs/notes/tp-battery']), '2', 'one commit per write, the automatic one and the manual one')
  const wrong = sh(t.repo, 'node', ['scripts/battery-record.mjs', 'show', t.first, '--ref', 'battery'])
  assert.equal(wrong.status, 3, wrong.stderr)
  assert.match(wrong.stderr, /stored under/)
  const trace = sh(t.repo, 'node', ['scripts/battery-record.mjs', 'show', t.first, '--ref', 'battery', '--trace'])
  assert.equal(trace.status, 3)
  assert.match(trace.stderr, /someone by hand/, 'the trace names who wrote it')
  // Rewriting the note of the commit that did pass with a different tree is caught against the commit when it is at hand.
  ok(hand, 'git', ['notes', '--ref=battery', 'add', '-f', '-m', forged, t.second])
  ok(hand, 'git', ['push', '-q', 'origin', 'refs/notes/battery'])
  const swapped = sh(t.repo, 'node', ['scripts/battery-record.mjs', 'show', t.second, '--ref', 'battery'])
  assert.equal(swapped.status, 3, swapped.stderr)
  assert.match(swapped.stderr, /the tree of the commit is/)
})

test('a writer that finds the reference moved applies its note again on top of the new head and loses none', () => {
  const t = makeToy()
  const mk = (sha) => buildRecord({ sha, tree: ok(t.repo, 'git', ['rev-parse', `${sha}^{tree}`]), results: [{ name: 'complete', cmd: 'x', exit: 0, seconds: 1, log_sha256: 'e'.repeat(64) }], bases: [] })
  const other = join(t.dir, 'other')
  ok(t.dir, 'git', ['clone', '-q', t.remote, 'other'])
  // The first lap: another writer (a different clone) lands its note between our fetch and our push.
  const w = writeNote(t.repo, 'origin', mk(t.first), {
    beforePush: (lap) => { if (lap === 1) writeNote(other, 'origin', mk(t.second)) },
  })
  assert.equal(w.lap, 2)
  for (const sha of [t.first, t.second]) assert.equal(readNote(null, t.remote, sha).status, 'found', sha)
})

test('several writers at the same time lose no note', async () => {
  const t = makeToy()
  const shas = [t.first, t.second]
  // One more commit per writer; each writer is a clone of its own, as two hosts would be.
  const writers = []
  for (let i = 0; i < 4; i++) {
    const dir = join(t.dir, `w${i}`)
    ok(t.dir, 'git', ['clone', '-q', t.remote, `w${i}`])
    mkdirSync(join(dir, 'scripts'))
    cpSync(join(root, 'scripts/battery-record.mjs'), join(dir, 'scripts/battery-record.mjs'))
    writeFileSync(join(dir, `f${i}`), 'x'); ok(dir, 'git', ['add', `f${i}`]); ok(dir, 'git', ['commit', '-q', '-m', `w${i}`])
    shas.push(ok(dir, 'git', ['rev-parse', 'HEAD']))
    writers.push(dir)
  }
  const codes = await Promise.all(writers.map((dir, i) => new Promise((done) => {
    const c = spawn('node', ['scripts/battery-record.mjs', 'run', shas[i + 2], '--remote', 'origin'], { cwd: dir, env: { ...process.env, ...GIT_ENV, ...t.doubles({ TMPDIR: join(t.dir, `tmp${i}`) }) }, stdio: 'ignore' })
    c.on('close', done)
  })))
  assert.deepEqual(codes, [0, 0, 0, 0])
  for (let i = 0; i < 4; i++) assert.equal(readNote(null, t.remote, shas[i + 2]).status, 'found', `writer ${i}`)
})

test('an order that fails naming its test files is repeated once, only on those files, and the note says so', () => {
  const t = makeToy()
  writeFileSync(join(t.repo, 'again.test.mjs'), "import { test } from 'node:test'\ntest('passes alone', () => {})\n")
  ok(t.repo, 'git', ['add', 'again.test.mjs']); ok(t.repo, 'git', ['commit', '-q', '-m', 'again'])
  const sha = ok(t.repo, 'git', ['rev-parse', 'HEAD'])
  const failing = 'echo "# tests 5"; echo "# pass 4"; echo "# fail 1"; echo "✖ failing tests:"; echo; echo "test at again.test.mjs:1:1"; exit 1'
  assert.deepEqual(failedFiles('test at again.test.mjs:1:1\ntest at a/b.test.js:20:3\ntest at again.test.mjs:9:9\n'), ['again.test.mjs', 'a/b.test.js'])
  const r = t.run(sha, { BATTERY_TEST_CMD: failing })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const complete = JSON.parse(r.stdout).commands[0]
  assert.equal(complete.exit, 0)
  assert.deepEqual(complete.retried.files, ['again.test.mjs'])
  assert.equal(complete.first_run.exit, 1)
  assert.equal(complete.retried.pass, 1)
  assert.match(r.stderr, /repeated only: again\.test\.mjs/)
  // A file that fails again leaves the order failed and writes nothing.
  writeFileSync(join(t.repo, 'again.test.mjs'), "import { test } from 'node:test'\ntest('fails alone', () => { throw new Error('x') })\n")
  ok(t.repo, 'git', ['commit', '-q', '-am', 'broken']); const bad = ok(t.repo, 'git', ['rev-parse', 'HEAD'])
  const r2 = t.run(bad, { BATTERY_TEST_CMD: failing })
  assert.equal(r2.status, 1)
  assert.equal(sh(t.repo, 'node', ['scripts/battery-record.mjs', 'show', bad, '--ref', 'battery']).status, 1)
  // --no-retry keeps the first result.
  assert.equal(t.run(sha, { BATTERY_TEST_CMD: failing }, ['--no-retry']).status, 1)
})

const DIGEST = `sha256:${'d'.repeat(64)}`

test('the host fingerprint is the one the reader computes: the compose without its shas, SHA-256, 16 hex', () => {
  const compose = 'image: reg/app:${V:-48a684af79c77ec05b7faab46750c2de5a17cbf5}\nworker: reg/w:${W:-48a684af79c77ec05b7faab46750c2de5a17cbf5-ccfa2077d636}\npin: x@sha256:4c1ca296ef525f108f5d3552cc337c0c09587cf8dae7f0067fd93349e47dc1cd\n\n'
  // The reader's own pipeline, in the shell: printf of the text without trailing newlines, sed, sha256sum, first 16.
  const sh_ = spawnSync('bash', ['-c', "printf '%s\\n' \"$(cat)\" | sed -E 's/[0-9a-f]{40}(-[0-9a-z]+)?/V/g' | sha256sum | cut -c1-16"], { input: compose, encoding: 'utf8' })
  assert.equal(hostFingerprint(compose), sh_.stdout.trim())
  // Another sha in the same places gives the same host; another line gives another.
  assert.equal(hostFingerprint(compose.replaceAll('48a684af79c77ec05b7faab46750c2de5a17cbf5', 'f'.repeat(40)).replace('-ccfa2077d636', '-aaaaaaaaaaaa')), hostFingerprint(compose))
  assert.notEqual(hostFingerprint(`${compose}extra: 1\n`), hostFingerprint(compose))
})

test('the base of the production image is the external root of the last stage', () => {
  assert.equal(finalBase('FROM node:24-alpine AS panel\nFROM alpine:3.24 AS base\nFROM base AS extract\nFROM base\n'), 'alpine:3.24')
  assert.equal(finalBase('FROM alpine:3.24\n'), 'alpine:3.24')
})

test('a verification has exactly the fields the reader needs and is built only from orders that exited 0', () => {
  const sha = 'a'.repeat(40)
  const results = [{ name: 'complete', cmd: 'npm run test:completa', exit: 0 }, { name: 'panel', cmd: 'npm run test:panel', exit: 0 }]
  const v = buildVerification({ sha, host: '0123456789abcdef', results, baseDigest: DIGEST, date: new Date('2026-10-26T23:00:00.123Z') })
  assert.deepEqual(v, { formato: 1, sha, resultado: 'verde', anfitrion: '0123456789abcdef', imagen_base: DIGEST, node: process.version, comandos: [{ orden: 'npm run test:completa', codigo: 0 }, { orden: 'npm run test:panel', codigo: 0 }], momento: '2026-10-26T23:00:00Z' })
  assert.equal(buildVerification({ sha, host: '0123456789abcdef', results, baseDigest: DIGEST, nodeVersion: 'v24.1.0' }).node, 'v24.1.0')
  assert.throws(() => buildVerification({ sha, host: '0123456789abcdef', results, baseDigest: DIGEST, nodeVersion: '24' }), /Node version/)
  assert.ok(verificationProblems({ ...v, node: undefined }, sha).length > 0)
  assert.deepEqual(verificationProblems(v, sha), [])
  assert.throws(() => buildVerification({ sha, host: '0123456789abcdef', results: [{ ...results[0], exit: 1 }], baseDigest: DIGEST }), /did not exit 0/)
  assert.throws(() => buildVerification({ sha, host: '0123456789abcdef', results, baseDigest: null, baseReason: 'offline' }), /digest of the image base is unknown \(offline\)/)
  assert.throws(() => buildVerification({ sha, host: 'xyz', results, baseDigest: DIGEST }), /16 hex/)
  assert.ok(verificationProblems({ ...v, resultado: 'rojo' }, sha).length > 0)
  assert.ok(verificationProblems({ ...v, comandos: [{ orden: 'x', codigo: 1 }] }, sha).length > 0)
  assert.ok(verificationProblems(v, 'b'.repeat(40)).length > 0)
  // An order repeated on its failed files is named so, and never claims the first run passed.
  const retried = buildVerification({ sha, host: '0123456789abcdef', results: [{ ...results[0], retried: { files: ['x.test.mjs'] } }], baseDigest: DIGEST })
  assert.match(retried.comandos[0].orden, /first run failed; repeated only: x\.test\.mjs/)
})

test('run with a host writes the verification a reader accepts, from another repository, with the one line of git', () => {
  const t = makeToy()
  writeFileSync(join(t.repo, 'Dockerfile'), 'FROM node:24-alpine AS panel\nFROM alpine:3.24 AS base\nFROM base\n')
  ok(t.repo, 'git', ['add', 'Dockerfile']); ok(t.repo, 'git', ['commit', '-q', '-m', 'dockerfile'])
  const sha = ok(t.repo, 'git', ['rev-parse', 'HEAD'])
  const compose = join(t.dir, 'compose.yml')
  writeFileSync(compose, 'image: reg/app:${V:-48a684af79c77ec05b7faab46750c2de5a17cbf5}\n')
  const digests = JSON.stringify({ 'alpine:3.24': DIGEST, 'node:24-alpine': `sha256:${'e'.repeat(64)}` })
  const r = t.run(sha, { BATTERY_TEST_DIGESTS: digests }, ['--compose', compose])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const v = JSON.parse(r.stdout)
  assert.deepEqual(Object.keys(v), ['formato', 'sha', 'resultado', 'anfitrion', 'imagen_base', 'node', 'comandos', 'momento'])
  assert.equal(v.imagen_base, DIGEST)
  assert.equal(v.node, process.version)
  assert.equal(v.anfitrion, hostFingerprint(readFileSync(compose, 'utf8')))
  assert.deepEqual(v.comandos.map((c) => c.codigo), [0, 0, 0, 0])
  const elsewhere = makeElsewhere(t)
  const line = sh(elsewhere, 'bash', ['-c', `git fetch -q ${t.remote} +refs/notes/verificaciones:refs/notes/verificaciones && git notes --ref=verificaciones show ${sha}`])
  assert.equal(line.status, 0, line.stderr)
  assert.deepEqual(JSON.parse(line.stdout), v)
  const show = sh(elsewhere, 'node', [join(t.repo, 'scripts/battery-record.mjs'), 'show', sha, '--remote', t.remote])
  assert.equal(show.status, 0, show.stderr)
  assert.deepEqual(JSON.parse(show.stdout), v)
  const detail = sh(elsewhere, 'node', [join(t.repo, 'scripts/battery-record.mjs'), 'show', sha, '--ref', 'battery', '--remote', t.remote])
  assert.equal(JSON.parse(detail.stdout).image_base.length, 2)
  // The verification of a commit that did not pass does not exist.
  assert.equal(sh(elsewhere, 'node', [join(t.repo, 'scripts/battery-record.mjs'), 'show', t.first, '--remote', t.remote]).status, 1)
})

test('without the digest of the image base nothing is written: neither the verification nor the detailed record', () => {
  const t = makeToy()
  writeFileSync(join(t.repo, 'Dockerfile'), 'FROM alpine:3.24\n')
  ok(t.repo, 'git', ['add', 'Dockerfile']); ok(t.repo, 'git', ['commit', '-q', '-m', 'dockerfile'])
  const sha = ok(t.repo, 'git', ['rev-parse', 'HEAD'])
  const r = t.run(sha, { BATTERY_TEST_DIGESTS: '{}' }, ['--anfitrion', '0123456789abcdef'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /digest of the image base is unknown/)
  assert.equal(t.notesRef(), '')
  assert.equal(sh(t.repo, 'git', ['ls-remote', 'origin', 'refs/notes/verificaciones']).stdout.trim(), '')
})

test('--base-image names the base the host declares: the digest comes from the detailed record when the ref is a FROM, else from the registry', () => {
  const bases = [{ ref: 'node:24-alpine', digest: `sha256:${'e'.repeat(64)}` }, { ref: 'alpine:3.24', digest: DIGEST }]
  assert.deepEqual(pickBase({ baseImage: 'node:24-alpine', rootRef: 'alpine:3.24', bases }), { digest: `sha256:${'e'.repeat(64)}` })
  assert.deepEqual(pickBase({ rootRef: 'alpine:3.24', bases }), { digest: DIGEST }, 'without --base-image: the root of the last stage')
  const calls = []
  const lookup = (ref) => { calls.push(ref); return { digest: `sha256:${'f'.repeat(64)}` } }
  assert.deepEqual(pickBase({ baseImage: 'other:1', rootRef: 'alpine:3.24', bases, lookup }), { digest: `sha256:${'f'.repeat(64)}` })
  assert.deepEqual(calls, ['other:1'])
  assert.equal(pickBase({ baseImage: 'other:1', bases, lookup: () => ({ digest: null, reason: 'offline' }) }).digest, null)

  const t = makeToy()
  writeFileSync(join(t.repo, 'Dockerfile'), 'FROM node:24-alpine AS panel\nFROM alpine:3.24 AS base\nFROM base\n')
  ok(t.repo, 'git', ['add', 'Dockerfile']); ok(t.repo, 'git', ['commit', '-q', '-m', 'dockerfile'])
  const sha = ok(t.repo, 'git', ['rev-parse', 'HEAD'])
  const digests = JSON.stringify({ 'alpine:3.24': DIGEST, 'node:24-alpine': `sha256:${'e'.repeat(64)}` })
  const r = t.run(sha, { BATTERY_TEST_DIGESTS: digests }, ['--anfitrion', '0123456789abcdef', '--base-image', 'node:24-alpine'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(JSON.parse(r.stdout).imagen_base, `sha256:${'e'.repeat(64)}`)
  // A ref that is neither a FROM nor resolvable writes nothing.
  const t2 = makeToy()
  const bad = t2.run(t2.second, { BATTERY_TEST_DIGESTS: '{}' }, ['--anfitrion', '0123456789abcdef', '--base-image', 'unknown:1'])
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /digest of the image base is unknown/)
  assert.equal(t2.notesRef(), '')
})

// A toy whose commit passed the battery (detailed record only) and whose Dockerfile has two external bases.
function passedToy (over = {}, args = []) {
  const t = makeToy()
  writeFileSync(join(t.repo, 'Dockerfile'), 'FROM node:24-alpine AS panel\nFROM alpine:3.24 AS base\nFROM base\n')
  ok(t.repo, 'git', ['add', 'Dockerfile']); ok(t.repo, 'git', ['commit', '-q', '-m', 'dockerfile'])
  t.sha = ok(t.repo, 'git', ['rev-parse', 'HEAD'])
  t.digests = JSON.stringify({ 'alpine:3.24': DIGEST, 'node:24-alpine': `sha256:${'e'.repeat(64)}` })
  const r = t.run(t.sha, { BATTERY_TEST_DIGESTS: t.digests, ...over }, args)
  return { t, r }
}
const verifRef = (t) => sh(t.repo, 'git', ['ls-remote', 'origin', 'refs/notes/verificaciones']).stdout.trim()
// regenerate must not run anything: every double of the orders and the digest table are gone from its environment.
const regen = (t, args) => sh(t.repo, 'node', ['scripts/battery-record.mjs', 'regenerate', t.sha, ...args], { TMPDIR: join(t.dir, 'tmp'), BATTERY_TEST_CMD: 'exit 9', BATTERY_PANEL_CMD: 'exit 9', BATTERY_CLIENT_CMD: 'exit 9', BATTERY_STATIC_CMD: 'exit 9' })

test('regenerate rewrites only the verification from the detailed record already published, without running the orders', () => {
  // Publish only the detailed record (no host given), then regenerate with the host and the base the host declares.
  const first = passedToy()
  const t1 = first.t
  assert.equal(first.r.status, 0, first.r.stderr)
  assert.equal(verifRef(t1), '', 'no host: no verification')
  const detailBefore = sh(t1.repo, 'node', ['scripts/battery-record.mjs', 'show', t1.sha, '--ref', 'battery']).stdout
  const compose = join(t1.dir, 'compose.yml')
  writeFileSync(compose, 'image: reg/app:${V:-48a684af79c77ec05b7faab46750c2de5a17cbf5}\n')
  const dry = regen(t1, ['--compose', compose, '--base-image', 'node:24-alpine', '--dry-run'])
  assert.equal(dry.status, 0, dry.stderr)
  assert.equal(verifRef(t1), '', '--dry-run pushes nothing')
  assert.match(dry.stderr, /--dry-run, nothing pushed/)
  const w = regen(t1, ['--compose', compose, '--base-image', 'node:24-alpine'])
  assert.equal(w.status, 0, w.stderr)
  const v = JSON.parse(w.stdout)
  assert.deepEqual(JSON.parse(dry.stdout).comandos, v.comandos)
  assert.deepEqual(Object.keys(v), ['formato', 'sha', 'resultado', 'anfitrion', 'imagen_base', 'node', 'comandos', 'momento'])
  assert.equal(v.sha, t1.sha)
  assert.equal(v.anfitrion, hostFingerprint(readFileSync(compose, 'utf8')))
  assert.equal(v.imagen_base, `sha256:${'e'.repeat(64)}`, 'the digest of the declared base comes from image_base of the detail, no registry')
  assert.equal(v.node, JSON.parse(detailBefore).node, 'node comes from the detailed record')
  assert.deepEqual(v.comandos.map((c) => c.codigo), [0, 0, 0, 0])
  assert.deepEqual(v.comandos.map((c) => c.orden), JSON.parse(detailBefore).commands.map((c) => c.cmd), 'the orders are the ones that ran, not the doubles of this call')
  assert.match(verifRef(t1), /refs\/notes\/verificaciones$/)
  assert.equal(sh(t1.repo, 'node', ['scripts/battery-record.mjs', 'show', t1.sha, '--ref', 'battery']).stdout, detailBefore, 'the detailed record is untouched')
  const shown = sh(t1.repo, 'node', ['scripts/battery-record.mjs', 'show', t1.sha])
  assert.equal(shown.status, 0, shown.stderr)
  assert.deepEqual(JSON.parse(shown.stdout), v)
  // Without a host, or for a commit with no detail, nothing is written.
  assert.equal(regen(t1, []).status, 2)
  const none = sh(t1.repo, 'node', ['scripts/battery-record.mjs', 'regenerate', t1.first, '--anfitrion', '0123456789abcdef', '--base-image', 'node:24-alpine'])
  assert.equal(none.status, 1)
  assert.match(none.stderr, /no detailed record/)
})

test('regenerate rejects a detailed record with an order that did not exit 0 and writes nothing', () => {
  const { t, r } = passedToy()
  assert.equal(r.status, 0, r.stderr)
  const hand = join(t.dir, 'hand')
  ok(t.dir, 'git', ['clone', '-q', t.remote, 'hand'])
  ok(hand, 'git', ['fetch', '-q', 'origin', 'refs/notes/battery:refs/notes/battery'])
  const detail = JSON.parse(ok(hand, 'git', ['notes', '--ref=battery', 'show', t.sha]))
  detail.commands[1].exit = 1
  ok(hand, 'git', ['notes', '--ref=battery', 'add', '-f', '-m', JSON.stringify(detail), t.sha])
  ok(hand, 'git', ['push', '-q', 'origin', 'refs/notes/battery'])
  const w = regen(t, ['--anfitrion', '0123456789abcdef', '--base-image', 'node:24-alpine'])
  assert.notEqual(w.status, 0)
  assert.match(w.stderr, /not valid|did not exit 0/)
  assert.equal(verifRef(t), '')
})

// ---- the battery runs in the pinned image ------------------------------------------------------------------------------------

const IMAGE_DIGEST = `sha256:${'d'.repeat(64)}`
const OUTPUT = `battery-image: node v24.22.1\nbattery-image: image ${IMAGE_DIGEST}\nbattery-image: tree ${'a'.repeat(40)}\n\n﹣ a test that needs docker (0.2ms) # requires docker: \`docker info\` did not run (ENOENT)\n  ﹣ inner (1ms) # requires git-identity: git has no user.name\nok 3 - tap form # SKIP requires chromium: not installed\n✔ passes (1ms)\n`

test('the markers of the image and the tests it skipped are read from the output, with their reasons', () => {
  assert.deepEqual(imageMarkers(OUTPUT), { node: 'v24.22.1', image: IMAGE_DIGEST, tree: 'a'.repeat(40) })
  assert.deepEqual(imageMarkers('npm run test:completa\n'), {}, 'an output that did not run in the image has no markers')
  assert.deepEqual(skippedTests(OUTPUT), [
    { test: 'a test that needs docker', reason: 'requires docker: `docker info` did not run (ENOENT)' },
    { test: 'inner', reason: 'requires git-identity: git has no user.name' },
    { test: 'tap form', reason: 'requires chromium: not installed' },
  ])
})

test('a pinned reference names its digest without asking a registry', () => {
  assert.deepEqual(lookupDigest(`node:24-alpine@${IMAGE_DIGEST}`), { digest: IMAGE_DIGEST })
  assert.deepEqual(imageBase(`FROM node:24-alpine@${IMAGE_DIGEST} AS battery\nFROM alpine:3.24@${IMAGE_DIGEST} AS base\n`), [{ ref: `node:24-alpine@${IMAGE_DIGEST}`, digest: IMAGE_DIGEST }, { ref: `alpine:3.24@${IMAGE_DIGEST}`, digest: IMAGE_DIGEST }])
})

test('a record of orders that ran in the image carries the Node and the digest of the image, the tests it skipped, and the order that ran outside is marked', () => {
  const inside = { name: 'complete', cmd: 'npm run test:completa', where: 'image', exit: 0, seconds: 1, tests: 3, pass: 2, fail: 0, node: 'v24.22.1', image: IMAGE_DIGEST, tree: 'a'.repeat(40), skipped_tests: skippedTests(OUTPUT), log_sha256: 'a'.repeat(64) }
  const outside = { name: 'conformance', cmd: 'node scripts/host-conformance.mjs', where: 'host', node: 'v24.20.0', exit: 0, seconds: 2, log_sha256: 'b'.repeat(64) }
  const rec = buildRecord({ sha: 'c'.repeat(40), tree: 'e'.repeat(40), results: [inside, outside], bases: [], nodeVersion: 'v99.0.0' })
  assert.equal(rec.node, 'v24.22.1', 'the Node of the image, not the one of the machine that publishes')
  assert.equal(rec.image, IMAGE_DIGEST)
  assert.deepEqual(rec.skipped_tests.map((t) => [t.order, t.test]), [['complete', 'a test that needs docker'], ['complete', 'inner'], ['complete', 'tap form']])
  assert.deepEqual(rec.commands.map((c) => [c.name, c.where, c.node]), [['complete', 'image', undefined], ['conformance', 'host', 'v24.20.0']])
  // An old-style result (no markers) keeps the old shape: no `image`, no `skipped_tests`.
  const plain = buildRecord({ sha: 'c'.repeat(40), tree: 'e'.repeat(40), results: [{ name: 'complete', cmd: 'x', exit: 0, seconds: 1, log_sha256: 'b'.repeat(64) }], bases: [], nodeVersion: 'v24.1.0' })
  assert.equal('image' in plain, false)
  assert.equal('skipped_tests' in plain, false)
  assert.equal(plain.node, 'v24.1.0')
})

test('the verification names the image the battery ran in, whatever base the host declares, and says so when they differ', () => {
  const warnings = []
  const pinned = `sha256:${'1'.repeat(64)}`
  const other = `sha256:${'2'.repeat(64)}`
  const bases = [{ ref: 'node:24-alpine', digest: other }]
  assert.deepEqual(baseOf({ baseImage: 'node:24-alpine', dockerfile: null, bases, imageDigest: pinned, warn: (m) => warnings.push(m) }), { digest: pinned })
  assert.equal(warnings.length, 1)
  assert.ok(warnings[0].includes(`declares node:24-alpine (${other})`) && warnings[0].includes(pinned), warnings[0])
  assert.deepEqual(baseOf({ baseImage: 'node:24-alpine', dockerfile: null, bases: [{ ref: 'node:24-alpine', digest: pinned }], imageDigest: pinned, warn: (m) => warnings.push(m) }), { digest: pinned })
  assert.equal(warnings.length, 1, 'no warning when they agree')
  assert.deepEqual(baseOf({ baseImage: 'node:24-alpine', dockerfile: null, bases, imageDigest: undefined }), { digest: other }, 'without the image, the host declaration decides as before')
})

test('inImage quotes the command and the tree so that bash gets them back as they were', () => {
  const line = inImage("echo 'a b'", '/tmp/x y')
  const argv = spawnSync('bash', ['-c', `set -- ${line.slice(line.indexOf(' --tree ') + 1)}; printf '%s|' "$@"`], { encoding: 'utf8' }).stdout
  assert.equal(argv, "--tree|/tmp/x y|--|echo 'a b'|")
})
