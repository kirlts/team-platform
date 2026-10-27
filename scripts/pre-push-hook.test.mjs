// The `main` lock of .githooks/pre-push, on toy repositories with a local remote (plan 2026, piece C2).
// The hook accepts the mark of the publication door (RELEASE_PUBLISHES_MAIN) and, until the first host stops exporting it, the old
// one (DEPLOY_PUBLISHES_MAIN). Everything else about `main` is unchanged: desarrollo or an ancestor, fast-forward, never deleted.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ZERO = '0'.repeat(40)
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1' }
let base
let repo
let A, B, C

const run = (cwd, args, env = {}) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, DEPLOY_PUBLISHES_MAIN: '', RELEASE_PUBLISHES_MAIN: '', ...GIT_ENV, ...env } })
const git = (args) => { const r = run(repo, args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim() }
const commit = (file) => { writeFileSync(join(repo, file), file); git(['add', file]); git(['commit', '-q', '-m', file]); return git(['rev-parse', 'HEAD']) }
const push = (refspec, env) => run(repo, ['push', 'origin', refspec], env)

// The cache directory of the repository is ignored by git (.cache/) and is not /tmp, which is memory.
before(() => {
  mkdirSync(join(root, '.cache'), { recursive: true })
  base = mkdtempSync(join(root, '.cache', 'hook-test-'))
  assert.equal(run(base, ['init', '-q', '--bare', 'remote.git']).status, 0)
  repo = join(base, 'repo')
  assert.equal(run(base, ['init', '-q', 'repo']).status, 0)
  git(['checkout', '-q', '-b', 'desarrollo'])
  mkdirSync(join(repo, '.githooks')); mkdirSync(join(repo, 'scripts'))
  cpSync(join(root, '.githooks/pre-push'), join(repo, '.githooks/pre-push'))
  cpSync(join(root, 'scripts/main-solo-desde-desarrollo.sh'), join(repo, 'scripts/main-solo-desde-desarrollo.sh'))
  git(['remote', 'add', 'origin', join(base, 'remote.git')])
  git(['add', '-A']); git(['commit', '-q', '-m', 'base']); A = git(['rev-parse', 'HEAD'])
  B = commit('uno')
  git(['push', '-q', 'origin', 'desarrollo'])
  git(['config', 'core.hooksPath', '.githooks']) // from here on the hook guards every push
  git(['checkout', '-q', '-b', 'ajena', B]); C = commit('ajena') // a commit that is not in desarrollo
  git(['checkout', '-q', 'desarrollo'])
})
after(() => rmSync(base, { recursive: true, force: true }))

test('without a mark, main is not pushed', () => {
  const r = push(`${A}:refs/heads/main`)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /publish-main\.sh/)
})

test('the mark of the publication door lets a desarrollo sha through', () => {
  const r = push(`${A}:refs/heads/main`, { RELEASE_PUBLISHES_MAIN: A })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(git(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], A)
})

test('the old mark of the first host is still accepted, and main advances by fast-forward', () => {
  const r = push(`${B}:refs/heads/main`, { DEPLOY_PUBLISHES_MAIN: B })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(git(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], B)
})

test('a sha that is not desarrollo nor its ancestor is rejected, with either mark', () => {
  for (const env of [{ RELEASE_PUBLISHES_MAIN: C }, { DEPLOY_PUBLISHES_MAIN: C }]) {
    const r = push(`${C}:refs/heads/main`, env)
    assert.notEqual(r.status, 0, JSON.stringify(env))
  }
  assert.equal(git(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], B)
})

test('the mark of another sha is no use', () => {
  const r = push(`${C}:refs/heads/main`, { RELEASE_PUBLISHES_MAIN: A })
  assert.notEqual(r.status, 0)
})

test('main cannot be deleted, even with the zero sha as the mark', () => {
  for (const env of [{ RELEASE_PUBLISHES_MAIN: ZERO }, { DEPLOY_PUBLISHES_MAIN: ZERO }, {}]) {
    const r = push(':refs/heads/main', env)
    assert.notEqual(r.status, 0, JSON.stringify(env))
  }
  assert.equal(git(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], B)
})

test('main cannot go back (it is not a fast-forward)', () => {
  const r = push(`${A}:refs/heads/main`, { RELEASE_PUBLISHES_MAIN: A })
  assert.notEqual(r.status, 0)
  assert.equal(git(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], B)
})

test('other branches and tags are not touched by the hook', () => {
  assert.equal(push('ajena:refs/heads/ajena').status, 0)
  assert.equal(run(repo, ['push', 'origin', `${B}:refs/tags/v0.0.1`]).status, 0)
})
