// The map of the repository a session starts in (UD-295): within its token budget, from git alone, rebuilt only when the structure changes.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildRepoMap, MAP_MAX_TOKENS, readNotes } from './repo-map.mjs'

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

test('the migrations line names the newest migration, which says which number comes next', async () => {
  const dir = repo()
  try {
    mkdirSync(join(dir, 'db/migrations'), { recursive: true }); writeFileSync(join(dir, 'db/migrations/0002_second.sql'), 'x'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'two migrations')
    assert.ok((await buildRepoMap({ cwd: dir })).text.includes('migraciones: db/migrations (2); última 0002_second.sql'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the host\'s notes go after the structure, count in the budget and are the last thing it cuts; a missing file is no notes', async () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'notes.txt'), '\nTests of a change: node scripts/tests-of-a-change.mjs\n   \nDecisions: grep -n docs/decisions.md\n')
    assert.deepEqual(await readNotes(dir, 'notes.txt'), ['Tests of a change: node scripts/tests-of-a-change.mjs', 'Decisions: grep -n docs/decisions.md'])
    assert.deepEqual(await readNotes(dir, join(dir, 'notes.txt')), await readNotes(dir, 'notes.txt'), 'an absolute path reads the same file')
    assert.deepEqual(await readNotes(dir, 'no-such-file.txt'), [])
    assert.deepEqual(await readNotes(dir, ''), [])
    const notes = await readNotes(dir, 'notes.txt')
    const m = await buildRepoMap({ cwd: dir, notes })
    const lines = m.text.split('\n')
    assert.ok(lines.indexOf(notes[0]) > lines.findIndex((l) => l.startsWith('pruebas:')), 'after the structure')
    assert.ok(lines.indexOf(notes[1]) < lines.findIndex((l) => l.startsWith('Más tocados')), 'before the hot files')
    assert.equal(m.notes, 2)
    // No room: first the hot files, then the structure; the notes stay while anything else can go.
    const tight = await buildRepoMap({ cwd: dir, notes, maxTokens: 110 })
    assert.equal(tight.hotFiles, 0)
    assert.ok(!tight.text.includes('Más tocados'), 'no empty header of hot files')
    assert.ok(tight.text.includes(notes[0]) && tight.estimatedTokens <= 110, tight.text)
    const none = await buildRepoMap({ cwd: dir, notes, maxTokens: 20 })
    assert.ok(none.estimatedTokens <= 20 || none.notes === 0, 'the notes go last, and only when nothing else is left to cut')
    assert.equal((await buildRepoMap({ cwd: dir })).notes, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('`team map --hook` in the repository of a session prints the notes of TEAM_MAP_NOTES as the context of the session start, and nothing breaks without them', () => {
  const dir = repo()
  const team = fileURLToPath(new URL('./team.mjs', import.meta.url))
  const run = (extra) => JSON.parse(execFileSync(process.execPath, [team, 'map', '--hook'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, ...extra } }))
  try {
    writeFileSync(join(dir, 'notes.txt'), 'Tests of a change: node scripts/tests-of-a-change.mjs\n')
    const withNotes = run({ TEAM_MAP_NOTES: 'notes.txt' }).hookSpecificOutput
    assert.equal(withNotes.hookEventName, 'SessionStart')
    assert.ok(withNotes.additionalContext.includes('Tests of a change: node scripts/tests-of-a-change.mjs'))
    assert.ok(!run({}).hookSpecificOutput.additionalContext.includes('Tests of a change'))
    assert.ok(run({ TEAM_MAP_NOTES: 'missing.txt' }).hookSpecificOutput.additionalContext.includes('<repo_map>'), 'a missing notes file leaves the map as it was')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
