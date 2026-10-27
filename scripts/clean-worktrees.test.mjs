// scripts/clean-worktrees.sh retires only the worktrees that meet its declared condition.
// The test builds a throwaway repository with a local remote inside this worktree (never in /tmp)
// and one worktree of each class.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, openSync, closeSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'clean-worktrees.sh')
const scratchRoot = join(resolve(here, '..'), '.cache')

let base, repo, wt
const children = []

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' })
const run = (...args) => execFileSync('bash', [script, ...args], { cwd: repo, encoding: 'utf8' })
const parse = (out) => {
  const rows = {}
  for (const line of out.trim().split('\n')) {
    const [cls, path] = line.split('\t')
    if (path) rows[path] = cls
  }
  return rows
}

before(() => {
  mkdirSync(scratchRoot, { recursive: true })
  base = mkdtempSync(join(scratchRoot, 'clean-worktrees-'))
  const remote = join(base, 'remote.git')
  repo = join(base, 'repo')
  git(base, 'init', '--bare', '-q', remote)
  git(base, 'init', '-q', '-b', 'main', repo)
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', 'a.txt')
  git(repo, 'commit', '-q', '-m', 'first')
  git(repo, 'remote', 'add', 'origin', remote)
  git(repo, 'push', '-q', 'origin', 'main')
  wt = (name) => join(repo, '.claude', 'worktrees', name)
  for (const name of ['clean', 'live', 'open', 'dirty', 'unpushed']) {
    git(repo, 'worktree', 'add', '-q', '-b', `br-${name}`, wt(name), 'main')
    git(repo, 'push', '-q', 'origin', `br-${name}`)
  }
  writeFileSync(join(wt('dirty'), 'new.txt'), 'uncommitted\n')
  writeFileSync(join(wt('unpushed'), 'b.txt'), 'b\n')
  git(wt('unpushed'), 'add', 'b.txt')
  git(wt('unpushed'), 'commit', '-q', '-m', 'local only')
  // Pushed but not in main: the work in progress of someone else.
  git(repo, 'worktree', 'add', '-q', '-b', 'br-unmerged', wt('unmerged'), 'main')
  writeFileSync(join(wt('unmerged'), 'c.txt'), 'c\n')
  git(wt('unmerged'), 'add', 'c.txt')
  git(wt('unmerged'), 'commit', '-q', '-m', 'pushed, not landed')
  git(wt('unmerged'), 'push', '-q', 'origin', 'br-unmerged')
  git(repo, 'fetch', '-q', 'origin')
  // A process whose cwd is inside "live".
  children.push(spawn('sleep', ['600'], { cwd: wt('live'), stdio: 'ignore' }))
  // A process that only holds a file open under "open", with its cwd elsewhere.
  const fd = openSync(join(wt('open'), 'a.txt'), 'r')
  children.push(spawn('sleep', ['600'], { cwd: base, stdio: [fd, 'ignore', 'ignore'] }))
  closeSync(fd)
})

after(() => {
  for (const c of children) c.kill('SIGKILL')
  rmSync(base, { recursive: true, force: true })
})

test('--list classifies each worktree and removes nothing', () => {
  const rows = parse(run('--list'))
  assert.equal(rows[wt('clean')], 'removable')
  assert.equal(rows[wt('live')], 'live')
  assert.equal(rows[wt('open')], 'live')
  assert.equal(rows[wt('dirty')], 'dirty')
  assert.equal(rows[wt('unpushed')], 'unpushed')
  assert.equal(rows[wt('unmerged')], 'unmerged')
  for (const name of ['clean', 'live', 'open', 'dirty', 'unpushed', 'unmerged']) assert.ok(existsSync(wt(name)), name)
  assert.match(run('--list').trim().split('\n').at(-1), /^live 2, nested 0, dirty 1, unpushed 1, unmerged 1, unknown 0, removable 1$/)
})

test('without --list only the removable worktree goes and every branch stays', () => {
  const out = run()
  assert.ok(!existsSync(wt('clean')))
  for (const name of ['live', 'open', 'dirty', 'unpushed', 'unmerged']) assert.ok(existsSync(wt(name)), name)
  assert.ok(existsSync(join(wt('dirty'), 'new.txt')))
  const branches = git(repo, 'branch', '--format=%(refname:short)').split('\n')
  for (const name of ['clean', 'live', 'open', 'dirty', 'unpushed']) assert.ok(branches.includes(`br-${name}`), name)
  assert.ok(out.includes(`git -C ${repo} worktree add ${wt('clean')} br-clean`), 'prints the recreate command')
  assert.match(out, /removed 1 of 1 removable, freed .* (MB|GB);/)
  // The printed command recreates it.
  git(repo, 'worktree', 'add', '-q', wt('clean'), 'br-clean')
  assert.ok(existsSync(join(wt('clean'), 'a.txt')))
})

test('once the process is gone the worktree becomes removable', () => {
  children[0].kill('SIGKILL')
  // The process is reaped asynchronously: wait for the kernel to drop it from /proc without a fixed sleep.
  return new Promise((ok) => children[0].once('exit', ok)).then(() => {
    assert.equal(parse(run('--list'))[wt('live')], 'removable')
  })
})

test('a worktree that contains another worktree is never removed with it', () => {
  git(repo, 'worktree', 'add', '-q', '-b', 'br-outer', wt('outer'), 'main')
  git(repo, 'push', '-q', 'origin', 'br-outer')
  const inner = join(wt('outer'), 'inner')
  git(repo, 'worktree', 'add', '-q', '-b', 'br-inner', inner, 'main')
  writeFileSync(join(inner, 'precious.txt'), 'uncommitted\n')
  const rows = parse(run('--list'))
  assert.equal(rows[wt('outer')], 'nested')
  assert.equal(rows[inner], 'dirty')
  run()
  assert.ok(existsSync(join(inner, 'precious.txt')))
})
