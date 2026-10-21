import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { assertRuntime, get, initializeDatabase, latestVersion, listMigrations, migrate, openDatabase, openInitialized, run, tx, userVersion } from './index.js'
import { seedDefaults, DEFAULT_AREAS } from './seed.js'
import { tempDir, testConfig } from '../testing/helpers.js'

const aquí = path.dirname(fileURLToPath(import.meta.url))

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

test('la inicialización fija WAL, migra al último archivo y siembra las cinco áreas', () => {
  const dir = tempDir()
  const config = testConfig(dir)
  const r = initializeDatabase(config, { seed: seedDefaults })
  assert.equal(r.hasta, latestVersion())
  const db = openInitialized(config)
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
  assert.equal(userVersion(db), latestVersion())
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM areas').n, DEFAULT_AREAS.length)
  assert.ok(get(db, 'SELECT COUNT(*) AS n FROM templates').n >= DEFAULT_AREAS.length)
  // Sembrar de nuevo no duplica nada.
  assert.deepEqual(seedDefaults(db, config), { areas: 0, templates: 0 })
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('inicializar dos veces no reaplica migraciones', () => {
  const dir = tempDir()
  const config = testConfig(dir)
  initializeDatabase(config)
  const segunda = initializeDatabase(config)
  assert.equal(segunda.aplicadas, 0)
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
  const migraciones = path.join(dir, 'm')
  mkdirSync(migraciones)
  writeFileSync(path.join(migraciones, '0001_a.sql'), 'CREATE TABLE a (x INTEGER);')
  writeFileSync(path.join(migraciones, '0002_b.sql'), 'CREATE TABLE b (x INTEGER); INSERT INTO tabla_inexistente VALUES (1);')
  const db = openDatabase(path.join(dir, 'c.db'))
  assert.throws(() => migrate(db, { dir: migraciones }))
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
  const migraciones = path.join(dir, 'm')
  const respaldos = path.join(dir, 'respaldos')
  mkdirSync(migraciones)
  writeFileSync(path.join(migraciones, '0001_a.sql'), 'CREATE TABLE a (x INTEGER);')
  const db = openDatabase(path.join(dir, 'd.db'))
  migrate(db, { dir: migraciones, backupsDir: respaldos })
  run(db, 'INSERT INTO a VALUES (7)')
  writeFileSync(path.join(migraciones, '0002_b.sql'), 'CREATE TABLE b (y INTEGER);')
  migrate(db, { dir: migraciones, backupsDir: respaldos })
  const archivos = readdirSync(respaldos)
  assert.equal(archivos.length, 1)
  const copia = openDatabase(path.join(respaldos, archivos[0]))
  assert.equal(get(copia, 'SELECT x FROM a').x, 7)
  assert.equal(userVersion(copia), 1)
  copia.close()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('restricciones del esquema: rol y estados con CHECK, claves foráneas activas', () => {
  const dir = tempDir()
  const config = testConfig(dir)
  initializeDatabase(config)
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
  const script = path.join(aquí, 'init.js')
  const correr = () => new Promise((resolve) => {
    const hijo = spawn(process.execPath, [script], { env: { ...process.env, DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] })
    let salida = ''
    hijo.stdout.on('data', (d) => { salida += d })
    hijo.stderr.on('data', (d) => { salida += d })
    hijo.on('close', (codigo) => resolve({ codigo, salida }))
  })
  const resultados = await Promise.all([correr(), correr(), correr()])
  for (const r of resultados) assert.equal(r.codigo, 0, r.salida)
  const db = openInitialized(testConfig(dir))
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM areas').n, DEFAULT_AREAS.length) // sembrado una sola vez
  assert.equal(userVersion(db), latestVersion())
  db.close()
  assert.ok(existsSync(path.join(dir, 'team.db')))
  rmSync(dir, { recursive: true, force: true })
})
