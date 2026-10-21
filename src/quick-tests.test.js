// Tests of the selection logic behind `npm run test:rapido` (src/testing/quick.js): it must run every test a change
// can reach and only those, and when in doubt it must run everything.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { affectedTests, allTests, changedSinceMark, closureOf, readMark, writeMark } from './testing/quick.js'

/** A small repository: two tests, a shared helper, a module only one test reaches and a SQL file read by name. */
function makeRepo () {
  const root = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'team-platform-quick-'))
  const put = (file, text) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text) }
  put('src/a/a.js', "export const a = 1\n")
  put('src/a/a.test.js', "import { a } from './a.js'\nimport { helper } from '../testing/helper.js'\n")
  put('src/b/b.js', "export const b = 1\n")
  put('src/b/b.test.js', "import('../b/b.js')\nconst sql = new URL('./schema.sql', import.meta.url)\n")
  put('src/b/schema.sql', 'CREATE TABLE t (id INTEGER);\n')
  put('src/testing/helper.js', "export const helper = 1\n")
  put('src/c.test.js', "import { helper } from './testing/helper.js'\nreadFileSync('migrations/0001_initial.sql')\n")
  put('src/migrations/0001_initial.sql', 'SELECT 1;\n')
  put('package.json', '{}\n')
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('add', '-A'); git('commit', '-qm', 'base')
  return { root, put, git, close: () => rmSync(root, { recursive: true, force: true }) }
}

test('test:rapido: the closure follows static, dynamic and URL references', () => {
  const repo = makeRepo()
  try {
    assert.deepEqual(allTests(repo.root), ['src/a/a.test.js', 'src/b/b.test.js', 'src/c.test.js'])
    assert.deepEqual([...closureOf(repo.root, 'src/b/b.test.js')].sort(), ['src/b/b.js', 'src/b/b.test.js', 'src/b/schema.sql'])
    assert.deepEqual([...closureOf(repo.root, 'src/a/a.test.js')].sort(), ['src/a/a.js', 'src/a/a.test.js', 'src/testing/helper.js'])
  } finally { repo.close() }
})

test('test:rapido: a change affects the tests that reach it and no others', () => {
  const repo = makeRepo()
  try {
    assert.deepEqual(affectedTests(repo.root, ['src/a/a.js']), ['src/a/a.test.js'])
    assert.deepEqual(affectedTests(repo.root, ['src/b/b.js']), ['src/b/b.test.js'])
    assert.deepEqual(affectedTests(repo.root, ['src/testing/helper.js']), ['src/a/a.test.js', 'src/c.test.js'])
    assert.deepEqual(affectedTests(repo.root, ['src/b/schema.sql']), ['src/b/b.test.js'])
    assert.deepEqual(affectedTests(repo.root, ['src/migrations/0001_initial.sql']), ['src/c.test.js'])
    // A file in a subdirectory of a directory with code is reached by whoever reaches that code (migrations).
    assert.deepEqual(affectedTests(repo.root, ['src/b/migrations/0003.sql']), ['src/b/b.test.js'])
    assert.deepEqual(affectedTests(repo.root, ['src/a/a.test.js']), ['src/a/a.test.js'])
    assert.deepEqual(affectedTests(repo.root, ['docs/TEST.md']), [])
    // A deleted code file still affects whoever mentions it; a dependency change affects everything.
    assert.deepEqual(affectedTests(repo.root, ['src/b/gone.js']), [])
    assert.equal(affectedTests(repo.root, ['package-lock.json']).length, 3)
  } finally { repo.close() }
})

test('test:rapido: with no mark everything runs; after a green run only what changed since', () => {
  const repo = makeRepo()
  try {
    assert.equal(readMark(repo.root), null)
    assert.equal(changedSinceMark(repo.root), null)
    repo.put('src/a/a.js', 'export const a = 2\n') // already modified when the mark is written
    repo.put('src/new.test.js', '\n')
    writeMark(repo.root)
    assert.deepEqual(changedSinceMark(repo.root), [], 'what was already modified at the mark is not a change')
    repo.put('src/b/b.js', 'export const b = 2\n')
    assert.deepEqual(changedSinceMark(repo.root), ['src/b/b.js'])
    repo.put('src/a/a.js', 'export const a = 3\n') // modified again after the mark
    assert.deepEqual(changedSinceMark(repo.root).sort(), ['src/a/a.js', 'src/b/b.js'])
    repo.put('src/a/a.js', 'export const a = 2\n') // back to what the mark saw
    assert.deepEqual(changedSinceMark(repo.root), ['src/b/b.js'])
    // A new commit does not hide anything: the comparison is against the marked commit.
    repo.git('add', '-A'); repo.git('commit', '-qm', 'second')
    assert.deepEqual(changedSinceMark(repo.root), ['src/b/b.js'])
    writeMark(repo.root)
    assert.deepEqual(changedSinceMark(repo.root), [])
  } finally { repo.close() }
})

test('test:rapido: a mark that points to a commit that no longer exists runs everything', () => {
  const repo = makeRepo()
  try {
    writeMark(repo.root)
    const markFile = path.join(repo.root, '.cache', 'test-quick.json')
    writeFileSync(markFile, JSON.stringify({ commit: '0'.repeat(40), dirty: {} }))
    assert.equal(changedSinceMark(repo.root), null)
  } finally { repo.close() }
})
