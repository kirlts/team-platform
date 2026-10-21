import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { assertRuntime, get, initializeDatabase, latestVersion, listMigrations, migrate, openDatabase, openInitialized, run, tx, userVersion } from './index.js'
import { seedDefaults } from './seed.js'
const FIVE_AREAS = 5 // templates/areas.json trae Idea, Error, Nueva funcionalidad, Retroalimentación y Pregunta
import { tempDir, testConfig } from '../testing/helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))

test('el entorno cumple Node y SQLite mínimos', () => {
  const v = assertRuntime()
  assert.ok(v.sqlite)
})

test('pragmas de conexión: busy_timeout, synchronous=FULL y claves foráneas', () => {
  const dir = tempDir()
  const db = openDatabase(path.join(dir, 'a.db'))
  assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000)
  assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 2) // FULL
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('la inicialización fija WAL, migra al último archivo y siembra las cinco áreas', async () => {
  const dir = tempDir()
  const config = testConfig(dir)
  const r = await initializeDatabase(config, { seed: seedDefaults })
  assert.equal(r.toVersion, latestVersion())
  const db = openInitialized(config)
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
  assert.equal(userVersion(db), latestVersion())
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM areas').n, FIVE_AREAS)
  assert.ok(get(db, 'SELECT COUNT(*) AS n FROM templates').n >= FIVE_AREAS)
  // Sembrar de nuevo no duplica nada.
  assert.deepEqual(await seedDefaults(db, config), { areas: 0, templates: 0 })
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('inicializar dos veces no reaplica migraciones', async () => {
  const dir = tempDir()
  const config = testConfig(dir)
  await initializeDatabase(config)
  const secondRun = await initializeDatabase(config)
  assert.equal(secondRun.applied, 0)
  rmSync(dir, { recursive: true, force: true })
})

test('se niega a arrancar si la base es más nueva que el último archivo', () => {
  const dir = tempDir()
  const db = openDatabase(path.join(dir, 'b.db'))
  db.exec('PRAGMA user_version = 99')
  assert.throws(() => migrate(db), /sólo conoce hasta/)
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('una migración con error deja versión y esquema intactos', () => {
  const dir = tempDir()
  const migrations = path.join(dir, 'm')
  mkdirSync(migrations)
  writeFileSync(path.join(migrations, '0001_a.sql'), 'CREATE TABLE a (x INTEGER);')
  writeFileSync(path.join(migrations, '0002_b.sql'), 'CREATE TABLE b (x INTEGER); INSERT INTO tabla_inexistente VALUES (1);')
  const db = openDatabase(path.join(dir, 'c.db'))
  assert.throws(() => migrate(db, { dir: migrations }))
  assert.equal(userVersion(db), 1) // la primera quedó aplicada; la segunda se revirtió entera
  assert.equal(get(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'b'").n, 0)
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('la numeración de migraciones debe ser contigua', () => {
  const dir = tempDir()
  mkdirSync(path.join(dir, 'm'))
  writeFileSync(path.join(dir, 'm', '0001_a.sql'), 'SELECT 1;')
  writeFileSync(path.join(dir, 'm', '0003_c.sql'), 'SELECT 1;')
  assert.throws(() => listMigrations(path.join(dir, 'm')), /contigua/)
  rmSync(dir, { recursive: true, force: true })
})

test('antes de migrar una base existente deja un respaldo consistente', () => {
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

test('restricciones del esquema: rol y estados con CHECK, claves foráneas activas', async () => {
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

test('tx revierte ante un error y anida sin abrir otra transacción', () => {
  const dir = tempDir()
  const db = openDatabase(path.join(dir, 'e.db'))
  db.exec('CREATE TABLE t (x INTEGER)')
  assert.throws(() => tx(db, () => { run(db, 'INSERT INTO t VALUES (1)'); throw new Error('falla') }), /falla/)
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM t').n, 0)
  tx(db, () => { tx(db, () => run(db, 'INSERT INTO t VALUES (2)')); assert.ok(db.isTransaction) })
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM t').n, 1)
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('dos procesos que inicializan a la vez aplican cada migración una sola vez', async () => {
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
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM areas').n, FIVE_AREAS) // sembrado una sola vez
  assert.equal(userVersion(db), latestVersion())
  db.close()
  assert.ok(existsSync(path.join(dir, 'team.db')))
  rmSync(dir, { recursive: true, force: true })
})

test('la migración del perfil funde responsabilidades y dominios en prosa y elimina las dos columnas (UD-023)', () => {
  const dir = tempDir()
  const olderDir = path.join(dir, 'previous')
  mkdirSync(olderDir)
  const files = listMigrations()
  const target = files.find((f) => f.filePath.includes('member_profile'))
  assert.ok(target)
  for (const f of files.filter((m) => m.version < target.version)) writeFileSync(path.join(olderDir, f.filePath), f.sql)
  const db = openDatabase(path.join(dir, 'p.db'))
  migrate(db, { dir: olderDir })
  const add = (email, responsibilities, domains) => run(db, 'INSERT INTO members (email, name, responsibilities, domains, created_at) VALUES (?, ?, ?, ?, 0)', email, email, responsibilities, domains)
  add('both@x.org', 'Servidor y API', '["backend","datos"]')
  add('resp@x.org', 'Pruebas', '[]')
  add('doms@x.org', '', '["diseño"]')
  add('none@x.org', '', '[]')
  add('spaces@x.org', '  ', '["", " ui "]')
  add('broken@x.org', 'Soporte', 'no es json')
  const result = migrate(db)
  assert.equal(result.applied, files.length - olderVersion(files, target))
  const profile = (email) => get(db, 'SELECT profile FROM members WHERE email = ?', email).profile
  assert.equal(profile('both@x.org'), 'Responsabilidades: Servidor y API\nDominios: backend, datos')
  assert.equal(profile('resp@x.org'), 'Responsabilidades: Pruebas')
  assert.equal(profile('doms@x.org'), 'Dominios: diseño')
  assert.equal(profile('none@x.org'), '')
  assert.equal(profile('spaces@x.org'), 'Dominios: ui')
  assert.equal(profile('broken@x.org'), 'Responsabilidades: Soporte')
  const columns = db.prepare('PRAGMA table_info(members)').all().map((c) => c.name)
  assert.ok(columns.includes('profile'))
  assert.ok(!columns.includes('responsibilities') && !columns.includes('domains'))
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Number of migrations that come before `target`. */
function olderVersion (files, target) {
  return files.filter((f) => f.version < target.version).length
}
