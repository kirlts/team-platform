// The map of the repository a session starts in (UD-295): within its token budget, from git alone, rebuilt only when the structure changes.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildRepoMap, MAP_MAX_TOKENS } from './repo-map.mjs'

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@x.org', '-c', 'user.name=t', ...args], { cwd, stdio: 'pipe' })
function repo () {
  const dir = mkdtempSync(join(tmpdir(), 'repo-map-'))
  git(dir, 'init', '-q')
  for (const f of ['src/api/routes/a.js', 'src/pages/Home.tsx', 'db/migrations/0001.sql', 'tests/a.test.js', 'package-lock.json']) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), 'x') }
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'one')
  writeFileSync(join(dir, 'src/pages/Home.tsx'), 'y'); writeFileSync(join(dir, 'package-lock.json'), 'y'); git(dir, 'commit', '-qam', 'two')
  return dir
}

test('the map says where screens, API, migrations and tests live, lists the hot files without lock files, and names its source', async () => {
  const dir = repo()
  try {
    const m = await buildRepoMap({ cwd: dir })
    for (const piece of ['pantallas: src/pages', 'api: src/api', 'migraciones: db/migrations', 'pruebas: tests', 'src/pages/Home.tsx (2)', 'git ls-files', 'git log --since=30.days']) assert.ok(m.text.includes(piece), `${piece}\n${m.text}`)
    assert.ok(!m.text.includes('package-lock'))
    assert.ok(m.estimatedTokens <= MAP_MAX_TOKENS)
    assert.ok(!(await buildRepoMap({ cwd: dir, brief: true })).text.includes('Carpetas'))
    assert.ok((await buildRepoMap({ cwd: dir, paths: ['db/'] })).text.includes('Más tocados en 30 días: db/migrations/0001.sql'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the structure is rebuilt only when the folders change; a small budget cuts the hot files first', async () => {
  const dir = repo()
  try {
    assert.equal((await buildRepoMap({ cwd: dir })).cached, false)
    assert.equal((await buildRepoMap({ cwd: dir })).cached, true)
    writeFileSync(join(dir, 'src/pages/New.tsx'), 'z'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'three')
    assert.equal((await buildRepoMap({ cwd: dir })).cached, false, 'a new file changes the counts')
    const small = await buildRepoMap({ cwd: dir, maxTokens: 60 })
    assert.equal(small.hotFiles, 0, 'with no room the hot files go first')
    assert.ok(small.text.includes('Fuente:'), 'the source stays')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
