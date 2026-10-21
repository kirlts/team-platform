import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { assertRuntime, get, initializeDatabase, latestVersion, listMigrations, migrate, openDatabase, openInitialized, run, tx, userVersion } from './index.js'
import { seedDefaults } from './seed.js'
const FIVE_AREAS = 5 // templates/areas.json brings `Idea, Error, Nueva funcionalidad, Retroalimentación` and `Pregunta`
import { tempDir, testConfig } from '../testing/helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))

test('the environment meets the minimum Node and SQLite versions', () => {
  const v = assertRuntime()
  assert.ok(v.sqlite)
})

test('connection pragmas: busy_timeout, synchronous=FULL and foreign keys', () => {
  const dir = tempDir()
  const db = openDatabase(path.join(dir, 'a.db'))
  assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000)
  assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 2) // FULL
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('initialization sets WAL, migrates to the last file and seeds the five areas', async () => {
  const dir = tempDir()
  const config = testConfig(dir)
  const r = await initializeDatabase(config, { seed: seedDefaults })
  assert.equal(r.toVersion, latestVersion())
  const db = openInitialized(config)
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
  assert.equal(userVersion(db), latestVersion())
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM areas').n, FIVE_AREAS)
  assert.ok(get(db, 'SELECT COUNT(*) AS n FROM templates').n >= FIVE_AREAS)
  // Seeding again duplicates nothing.
  assert.deepEqual(await seedDefaults(db, config), { areas: 0, templates: 0 })
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('initializing twice does not reapply migrations', async () => {
  const dir = tempDir()
  const config = testConfig(dir)
  await initializeDatabase(config)
  const secondRun = await initializeDatabase(config)
  assert.equal(secondRun.applied, 0)
  rmSync(dir, { recursive: true, force: true })
})

test('refuses to start if the database is newer than the last file', () => {
  const dir = tempDir()
  const db = openDatabase(path.join(dir, 'b.db'))
  db.exec('PRAGMA user_version = 99')
  assert.throws(() => migrate(db), /only knows up to/)
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('a migration with an error leaves version and schema intact', () => {
  const dir = tempDir()
  const migrations = path.join(dir, 'm')
  mkdirSync(migrations)
  writeFileSync(path.join(migrations, '0001_a.sql'), 'CREATE TABLE a (x INTEGER);')
  writeFileSync(path.join(migrations, '0002_b.sql'), 'CREATE TABLE b (x INTEGER); INSERT INTO tabla_inexistente VALUES (1);')
  const db = openDatabase(path.join(dir, 'c.db'))
  assert.throws(() => migrate(db, { dir: migrations }))
  assert.equal(userVersion(db), 1) // the first one stayed applied; the second one was rolled back entirely
  assert.equal(get(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'b'").n, 0)
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('migration numbering must be contiguous', () => {
  const dir = tempDir()
  mkdirSync(path.join(dir, 'm'))
  writeFileSync(path.join(dir, 'm', '0001_a.sql'), 'SELECT 1;')
  writeFileSync(path.join(dir, 'm', '0003_c.sql'), 'SELECT 1;')
  assert.throws(() => listMigrations(path.join(dir, 'm')), /contiguous/)
  rmSync(dir, { recursive: true, force: true })
})

test('before migrating an existing database it leaves a consistent backup', () => {
  const dir = tempDir()
  const migrations = path.join(dir, 'm')
  const backups = path.join(dir, 'respaldos')
  mkdirSync(migrations)
  writeFileSync(path.join(migrations, '0001_a.sql'), 'CREATE TABLE a (x INTEGER);')
  const db = openDatabase(path.join(dir, 'd.db'))
  migrate(db, { dir: migrations, backupsDir: backups })
  run(db, 'INSERT INTO a VALUES (7)')
  writeFileSync(path.join(migrations, '0002_b.sql'), 'CREATE TABLE b (y INTEGER);')
  migrate(db, { dir: migrations, backupsDir: backups })
  const filePaths = readdirSync(backups)
  assert.equal(filePaths.length, 1)
  const copyOf = openDatabase(path.join(backups, filePaths[0]))
  assert.equal(get(copyOf, 'SELECT x FROM a').x, 7)
  assert.equal(userVersion(copyOf), 1)
  copyOf.close()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('schema constraints: role and statuses with CHECK, foreign keys enabled', async () => {
  const dir = tempDir()
  const config = testConfig(dir)
  await initializeDatabase(config)
  const db = openInitialized(config)
  assert.throws(() => run(db, "INSERT INTO members (email, name, role, created_at) VALUES ('a@b.c', 'A', 'admin', 1)"), /CHECK/)
  assert.throws(() => run(db, "INSERT INTO inputs (author_id, content_hash, created_at, updated_at) VALUES (999, 'h', 1, 1)"), /FOREIGN KEY/)
  assert.throws(() => run(db, "INSERT INTO jobs (kind, status, run_at, created_at) VALUES ('analyze', 'raro', 1, 1)"), /CHECK/)
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('tx rolls back on an error and nests without opening another transaction', () => {
  const dir = tempDir()
  const db = openDatabase(path.join(dir, 'e.db'))
  db.exec('CREATE TABLE t (x INTEGER)')
  assert.throws(() => tx(db, () => { run(db, 'INSERT INTO t VALUES (1)'); throw new Error('fails') }), /fails/)
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM t').n, 0)
  tx(db, () => { tx(db, () => run(db, 'INSERT INTO t VALUES (2)')); assert.ok(db.isTransaction) })
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM t').n, 1)
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('two processes that initialize at the same time apply each migration only once', async () => {
  const dir = tempDir()
  const script = path.join(here, 'init.js')
  const runIt = () => new Promise((resolve) => {
    const proc = spawn(process.execPath, [script], { env: { ...process.env, DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] })
    let outText = ''
    proc.stdout.on('data', (d) => { outText += d })
    proc.stderr.on('data', (d) => { outText += d })
    proc.on('close', (errorCodeValue) => resolve({ errorCodeValue, outText }))
  })
  const results = await Promise.all([runIt(), runIt(), runIt()])
  for (const r of results) assert.equal(r.errorCodeValue, 0, r.outText)
  const db = openInitialized(testConfig(dir))
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM areas').n, FIVE_AREAS) // seeded only once
  assert.equal(userVersion(db), latestVersion())
  db.close()
  assert.ok(existsSync(path.join(dir, 'team.db')))
  rmSync(dir, { recursive: true, force: true })
})
