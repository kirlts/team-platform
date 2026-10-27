// scripts/publish-main.sh on toy repositories with a local remote, with doubles for the battery, the panel, the client and the conformance
// (the script reads them from PUBLISH_*_CMD). Nothing here touches the real remote: the script is copied into each toy repository and
// publishes to the bare repository next to it. The doubles write the commit they ran on, which proves the checks run on THAT sha, in a
// worktree of their own, and not in the checkout.
import { afterEach, before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1' }
let base

const sh = (cwd, cmd, args, env = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, DEPLOY_PUBLISHES_MAIN: '', RELEASE_PUBLISHES_MAIN: '', ...GIT_ENV, ...env } })

const CHANGELOG = (version) => `# Changelog\n\n## [Unreleased]\n\n## [${version}] - 2026-10-26\n\n### Added\n- Something.\n`

// A toy host: a bare remote, a repository with desarrollo and main, and the door copied in.
function makeToy(name) {
  const dir = join(base, name)
  mkdirSync(dir, { recursive: true })
  const remote = join(dir, 'remote.git')
  const repo = join(dir, 'repo')
  assert.equal(sh(dir, 'git', ['init', '-q', '--bare', 'remote.git']).status, 0)
  assert.equal(sh(dir, 'git', ['init', '-q', 'repo']).status, 0)
  const git = (...args) => { const r = sh(repo, 'git', args); assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim() }
  git('checkout', '-q', '-b', 'desarrollo')
  for (const d of ['scripts', '.githooks', 'docs']) mkdirSync(join(repo, d), { recursive: true })
  cpSync(join(root, 'scripts/publish-main.sh'), join(repo, 'scripts/publish-main.sh'))
  cpSync(join(root, 'scripts/main-solo-desde-desarrollo.sh'), join(repo, 'scripts/main-solo-desde-desarrollo.sh'))
  cpSync(join(root, '.githooks/pre-push'), join(repo, '.githooks/pre-push'))
  const release = (version) => {
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'toy', version }))
    writeFileSync(join(repo, 'docs/CHANGELOG.md'), CHANGELOG(version))
  }
  const commit = (file, content = file) => {
    mkdirSync(dirname(join(repo, file)), { recursive: true })
    writeFileSync(join(repo, file), content); git('add', '-A'); git('commit', '-q', '-m', file); return git('rev-parse', 'HEAD')
  }
  git('remote', 'add', 'origin', remote)
  release('0.1.0')
  const first = commit('first')
  git('push', '-q', 'origin', 'desarrollo', `${first}:refs/heads/main`) // the hook is not active yet
  git('config', 'core.hooksPath', '.githooks')
  const log = join(dir, 'log.txt')
  const doubles = (extra = {}) => ({
    TMPDIR: join(dir, 'tmp'),
    PUBLISH_TEST_CMD: `echo "battery $(pwd) $(git rev-parse HEAD)" >> '${log}'`,
    PUBLISH_PANEL_CMD: `echo "panel" >> '${log}'`,
    PUBLISH_CLIENT_CMD: `echo "client" >> '${log}'`,
    PUBLISH_CONFORMANCE_CMD: `echo "conformance $(git rev-parse HEAD)" >> '${log}'`,
    ...extra,
  })
  // The doubles are command strings: the script runs them with bash -c inside the worktree, where $(pwd) and HEAD are those of the worktree.
  const publish = (args = [], env = {}) => sh(repo, 'bash', ['scripts/publish-main.sh', ...args], doubles(env))
  const ran = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [])
  const remoteRef = (ref) => { const r = sh(repo, 'git', ['ls-remote', 'origin', ref, `${ref}^{}`]); return r.stdout.trim().split('\n').filter(Boolean).pop()?.split('\t')[0] ?? '' }
  const leftover = () => { const d = join(repo, '.claude/worktrees'); return existsSync(d) ? readdirSync(d) : [] }
  return { dir, repo, git, commit, release, publish, ran, remoteRef, leftover, first }
}

before(() => {
  mkdirSync(join(root, '.cache'), { recursive: true })
  base = mkdtempSync(join(root, '.cache', 'publish-test-'))
})
after(() => rmSync(base, { recursive: true, force: true }))

test('a publication runs the checks on the sha of desarrollo in its own worktree, then pushes main and the tag', () => {
  const t = makeToy('ok')
  t.release('0.2.0')
  const sha = t.commit('second')
  t.git('push', '-q', 'origin', 'desarrollo')
  const r = t.publish()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const lines = t.ran()
  assert.equal(lines.length, 2, lines.join('\n')) // battery and conformance; panel/ and packages/client/ did not change
  assert.match(lines[0], new RegExp(`^battery .*/\\.claude/worktrees/publish-.* ${sha}$`))
  assert.equal(lines[1], `conformance ${sha}`)
  assert.equal(t.remoteRef('refs/heads/main'), sha)
  assert.equal(t.remoteRef('refs/tags/v0.2.0'), sha)
  assert.deepEqual(t.leftover(), [], 'the temporary worktree is removed')
  assert.match(r.stdout, /battery\s+ok\s+\d+\.\ds/)
  assert.match(r.stdout, /conformance\s+ok\s+\d+\.\ds/)
})

test('--dry-run does everything except tag and push', () => {
  const t = makeToy('dry')
  t.release('0.2.0')
  const sha = t.commit('second'); t.git('push', '-q', 'origin', 'desarrollo')
  const r = t.publish(['--dry-run'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(t.ran().length, 2)
  assert.notEqual(t.remoteRef('refs/heads/main'), sha)
  assert.equal(t.remoteRef('refs/tags/v0.2.0'), '')
  assert.equal(sh(t.repo, 'git', ['tag', '--list']).stdout.trim(), '')
  assert.deepEqual(t.leftover(), [])
  assert.match(r.stdout, /dry run: would publish v0\.2\.0/)
})

test('the panel and the client run only when they changed since main', () => {
  const t = makeToy('panel')
  t.release('0.2.0')
  t.commit('panel/src/App.tsx'); t.commit('packages/client/src/a.ts'); t.git('push', '-q', 'origin', 'desarrollo')
  const r = t.publish()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(t.ran().map((l) => l.split(' ')[0]), ['battery', 'panel', 'client', 'conformance'])
})

test('a failing battery stops the publication: no conformance, no tag, main stays', () => {
  const t = makeToy('battery')
  t.release('0.2.0'); t.commit('second'); t.git('push', '-q', 'origin', 'desarrollo')
  const before = t.remoteRef('refs/heads/main')
  const r = t.publish([], { PUBLISH_TEST_CMD: 'echo "1 fail: algo.test.js"; exit 7' })
  assert.equal(r.status, 1)
  assert.match(r.stdout, /battery\s+FAILED \(exit 7\)/)
  assert.match(r.stdout, /1 fail: algo\.test\.js/, 'the output of the failing check is shown')
  assert.deepEqual(t.ran(), [])
  assert.equal(t.remoteRef('refs/heads/main'), before)
  assert.equal(t.remoteRef('refs/tags/v0.2.0'), '')
  assert.deepEqual(t.leftover(), [])
})

test('a failing conformance stops the publication', () => {
  const t = makeToy('conformance')
  t.release('0.2.0'); t.commit('second'); t.git('push', '-q', 'origin', 'desarrollo')
  const before = t.remoteRef('refs/heads/main')
  const r = t.publish([], { PUBLISH_CONFORMANCE_CMD: 'exit 1' })
  assert.equal(r.status, 1)
  assert.equal(t.remoteRef('refs/heads/main'), before)
  assert.equal(t.remoteRef('refs/tags/v0.2.0'), '')
})

test('a sha that is not desarrollo nor an ancestor is refused before any check runs', () => {
  const t = makeToy('foreign')
  t.release('0.2.0'); t.commit('second'); t.git('push', '-q', 'origin', 'desarrollo')
  t.git('checkout', '-q', '-b', 'ajena'); const foreign = t.commit('ajena')
  const r = t.publish([foreign])
  assert.equal(r.status, 1)
  assert.deepEqual(t.ran(), [])
  assert.match(r.stderr, /not desarrollo/)
})

test('an ancestor of desarrollo can be published, and what main already has is not published again', () => {
  const t = makeToy('ancestor')
  t.release('0.2.0'); const middle = t.commit('second')
  t.release('0.3.0'); t.commit('third'); t.git('push', '-q', 'origin', 'desarrollo')
  // At the middle commit package.json says 0.2.0 and its changelog has the section.
  const r = t.publish([middle])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(t.remoteRef('refs/heads/main'), middle)
  assert.equal(t.remoteRef('refs/tags/v0.2.0'), middle)
  const again = t.publish([middle])
  assert.equal(again.status, 0)
  assert.match(again.stdout, /nothing to publish/)
})

test('without the changelog section of the version, the publication is refused before the battery; --dry-run measures and exits 3', () => {
  const t = makeToy('release')
  writeFileSync(join(t.repo, 'package.json'), JSON.stringify({ name: 'toy', version: '0.2.0' }))
  t.commit('second'); t.git('push', '-q', 'origin', 'desarrollo')
  const r = t.publish()
  assert.equal(r.status, 1)
  assert.match(r.stderr, /no «## \[0\.2\.0\]» section|has no/)
  assert.deepEqual(t.ran(), [])
  const dry = t.publish(['--dry-run'])
  assert.equal(dry.status, 3, dry.stdout + dry.stderr)
  assert.equal(t.ran().length, 2, 'the dry run still ran the checks')
})

test('an unreleased note left in the changelog is refused', () => {
  const t = makeToy('unreleased')
  writeFileSync(join(t.repo, 'package.json'), JSON.stringify({ name: 'toy', version: '0.2.0' }))
  writeFileSync(join(t.repo, 'docs/CHANGELOG.md'), `# Changelog\n\n## [Unreleased]\n\n- A change nobody released.\n\n## [0.2.0] - 2026-10-26\n\n- x\n`)
  t.commit('second'); t.git('push', '-q', 'origin', 'desarrollo')
  const r = t.publish()
  assert.equal(r.status, 1)
  assert.match(r.stderr, /Unreleased/)
})

test('a version already published at another commit, or not greater than the last one, is refused', () => {
  const t = makeToy('versions')
  t.release('0.2.0'); t.commit('second'); t.git('push', '-q', 'origin', 'desarrollo')
  assert.equal(t.publish().status, 0)
  t.commit('third'); t.git('push', '-q', 'origin', 'desarrollo') // same version 0.2.0 at another commit
  const same = t.publish()
  assert.equal(same.status, 1)
  assert.match(same.stderr, /v0\.2\.0 was already published/)
  t.release('0.1.5'); t.commit('lower'); t.git('push', '-q', 'origin', 'desarrollo')
  const lower = t.publish()
  assert.equal(lower.status, 1)
  assert.match(lower.stderr, /not greater than the published v0\.2\.0/)
  t.release('0.10.0'); const top = t.commit('higher'); t.git('push', '-q', 'origin', 'desarrollo')
  const higher = t.publish()
  assert.equal(higher.status, 0, higher.stdout + higher.stderr)
  assert.equal(t.remoteRef('refs/tags/v0.10.0'), top, 'versions compare as numbers: 0.10.0 is greater than 0.2.0')
})

test('the door does not publish without the mark: the hook of the toy rejects a plain push of main', () => {
  const t = makeToy('hook')
  t.release('0.2.0'); const sha = t.commit('second'); t.git('push', '-q', 'origin', 'desarrollo')
  const r = sh(t.repo, 'git', ['push', 'origin', `${sha}:refs/heads/main`])
  assert.notEqual(r.status, 0)
})

test('--dry-run does not stop at the first failing step: it runs the rest and still exits 1', () => {
  const t = makeToy('dry-failing')
  t.release('0.2.0'); t.commit('second'); t.git('push', '-q', 'origin', 'desarrollo')
  const r = t.publish(['--dry-run'], { PUBLISH_TEST_CMD: 'exit 4' })
  assert.equal(r.status, 1)
  assert.deepEqual(t.ran().map((l) => l.split(' ')[0]), ['conformance'])
  assert.match(r.stdout, /battery\s+FAILED \(exit 4\)/)
  assert.match(r.stdout, /conformance\s+ok/)
  assert.deepEqual(t.leftover(), [])
})
