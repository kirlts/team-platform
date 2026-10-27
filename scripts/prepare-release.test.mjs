// scripts/prepare-release.mjs: how the version rises and how `[Unreleased]` of the changelog moves to it (plan 2026, piece C4).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compare, moveUnreleased, nextVersion, setLockVersion } from './prepare-release.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('the version rises by level and the explicit one must be greater', () => {
  assert.equal(nextVersion('0.1.0', 'patch'), '0.1.1')
  assert.equal(nextVersion('0.1.9', 'minor'), '0.2.0')
  assert.equal(nextVersion('0.9.3', 'major'), '1.0.0')
  assert.equal(nextVersion('0.1.0', 'current'), '0.1.0')
  assert.equal(nextVersion('0.1.0', '0.10.0'), '0.10.0')
  assert.throws(() => nextVersion('0.2.0', '0.1.9'), /not greater/)
  assert.throws(() => nextVersion('0.2.0', '0.2.0'), /not greater/)
  assert.throws(() => nextVersion('0.2', 'patch'), /not a version/)
  assert.equal(compare('0.10.0', '0.2.0'), 1)
})

const SAMPLE = `# Changelog

## [Unreleased]

- First.

### Changed
- Second.

## [0.1.0] - 2026-01-01

- Old.

<!--
## [X.Y.Z] - YYYY-MM-DD
-->
`

test('what is under [Unreleased] moves to the new version and [Unreleased] stays empty', () => {
  const out = moveUnreleased(SAMPLE, '0.1.1', '2026-10-27')
  assert.match(out, /## \[Unreleased\]\n\n## \[0\.1\.1\] - 2026-10-27\n\n- First\.\n\n### Changed\n- Second\.\n\n## \[0\.1\.0\] - 2026-01-01/)
  assert.ok(out.endsWith('-->\n'))
  // After the move, the section [Unreleased] holds nothing: that is what scripts/publish-main.sh asks for.
  const between = out.split('## [Unreleased]')[1].split('## [0.1.1]')[0]
  assert.equal(between.trim(), '')
})

test('the last section before the template comment also moves', () => {
  const out = moveUnreleased('# C\n\n## [Unreleased]\n\n- Only.\n\n<!--\n## [X.Y.Z] - YYYY-MM-DD\n-->\n', '0.1.0', '2026-10-27')
  assert.match(out, /## \[0\.1\.0\] - 2026-10-27\n\n- Only\.\n\n<!--/)
})

test('an empty [Unreleased], a missing one or an existing version are errors', () => {
  assert.throws(() => moveUnreleased('# C\n\n## [Unreleased]\n\n## [0.1.0] - x\n', '0.1.1', 'd'), /empty/)
  assert.throws(() => moveUnreleased('# C\n', '0.1.1', 'd'), /no «## \[Unreleased\]»/)
  assert.throws(() => moveUnreleased(SAMPLE, '0.1.0', 'd'), /already has/)
})

test('the lockfile repeats the version in two places', () => {
  const lock = JSON.stringify({ name: 'x', version: '0.1.0', packages: { '': { name: 'x', version: '0.1.0' }, 'node_modules/a': { version: '3.0.0' } } }, null, 2) + '\n'
  const out = JSON.parse(setLockVersion(lock, '0.2.0'))
  assert.equal(out.version, '0.2.0')
  assert.equal(out.packages[''].version, '0.2.0')
  assert.equal(out.packages['node_modules/a'].version, '3.0.0')
})

test('the command writes package.json, package-lock.json and the changelog and nothing else', () => {
  mkdirSync(join(root, '.cache'), { recursive: true })
  const dir = mkdtempSync(join(root, '.cache', 'release-test-'))
  try {
    mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'docs'))
    cpSync(join(root, 'scripts/prepare-release.mjs'), join(dir, 'scripts/prepare-release.mjs'))
    writeFileSync(join(dir, 'package.json'), '{\n  "name": "x",\n  "version": "0.1.0",\n  "private": true\n}\n')
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: 'x', version: '0.1.0', packages: { '': { version: '0.1.0' } } }, null, 2) + '\n')
    writeFileSync(join(dir, 'docs/CHANGELOG.md'), SAMPLE)
    const run = (...a) => spawnSync(process.execPath, [join(dir, 'scripts/prepare-release.mjs'), ...a], { encoding: 'utf8' })
    const r = run('minor', '--date', '2026-10-27')
    assert.equal(r.status, 0, r.stderr)
    assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, '0.2.0')
    assert.match(readFileSync(join(dir, 'package.json'), 'utf8'), /"private": true\n}\n$/, 'the rest of package.json is untouched')
    assert.equal(JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8')).packages[''].version, '0.2.0')
    assert.match(readFileSync(join(dir, 'docs/CHANGELOG.md'), 'utf8'), /## \[0\.2\.0\] - 2026-10-27/)
    assert.equal(run('patch').status, 1, 'the second run finds [Unreleased] empty')
    assert.equal(run().status, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
