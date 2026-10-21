// SQLite connection through `node:sqlite` (MASTER-SPEC §3). WAL, busy_timeout and synchronous=FULL.
// Two steps, kept separate on purpose (report 03 §4, M7):
//   openDatabase()      opens a connection and sets the CONNECTION pragmas. It does not touch the journal mode.
//   initializeDatabase()  the single step before the API and the worker: sets WAL, migrates and seeds.
// Two simultaneous startups that set WAL failed with «database is locked» in 2 of 20 cases (M7).

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

/** Compares «a.b.c» versions. Returns negative, zero or positive. */
function compareVersions (a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * Requires Node ≥ 24.15 (node:sqlite as a release candidate) and SQLite ≥ 3.51.3 (fix for the WAL reset
 * bug, report 03 §2.1). An API process and a worker write at the same time: that is the affected profile.
 */
export function assertRuntime () {
  const minNode = '24.15.0'
  const minSqlite = '3.51.3'
  if (compareVersions(process.versions.node, minNode) < 0) {
    throw new Error(`Node ${minNode} or later is required; this is ${process.versions.node}.`)
  }
  const probe = new DatabaseSync(':memory:')
  const { v } = probe.prepare('SELECT sqlite_version() AS v').get()
  probe.close()
  if (compareVersions(v, minSqlite) < 0) {
    throw new Error(`SQLite ${minSqlite} or later is required (WAL bug fixed); this is ${v}.`)
  }
  return { node: process.versions.node, sqlite: v }
}

/** Opens a connection with the connection pragmas. It does not change the journal mode. */
export function openDatabase (file, sqliteConfig = { busyTimeoutMs: 5000, synchronous: 'FULL' }) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
  // `timeout` is the busy_timeout (I03 §2.3: without it, 16 % of the concurrent transactions failed).
  const db = new DatabaseSync(file, { timeout: sqliteConfig.busyTimeoutMs, enableForeignKeyConstraints: true })
  db.exec(`PRAGMA synchronous = ${sqliteConfig.synchronous === 'NORMAL' ? 'NORMAL' : 'FULL'}`)
  db.exec(`PRAGMA busy_timeout = ${Number(sqliteConfig.busyTimeoutMs)}`)
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

/**
 * Runs `fn` inside a `BEGIN IMMEDIATE` transaction (MS §3: every transaction that reads and then writes).
 * If one is already open, `fn` takes part in it. `fn` must be synchronous: no call to a model provider
 * happens inside a transaction (I03 §2.3).
 */
export function tx (db, fn) {
  if (db.isTransaction) return fn()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* the transaction already ended */ }
    throw error
  }
}

const cacheSentencias = new WeakMap()

/** Prepared statement, cached per connection. */
export function stmt (db, sql) {
  let bySql = cacheSentencias.get(db)
  if (!bySql) {
    bySql = new Map()
    cacheSentencias.set(db, bySql)
  }
  let s = bySql.get(sql)
  if (!s) {
    s = db.prepare(sql)
    bySql.set(sql, s)
  }
  return s
}

export const get = (db, sql, ...params) => stmt(db, sql).get(...params)
export const all = (db, sql, ...params) => stmt(db, sql).all(...params)
export const run = (db, sql, ...params) => stmt(db, sql).run(...params)

/** Lists the migrations: `NNNN_name.sql` files in order, numbered contiguously from 1. */
export function listMigrations (dir = migrationsDir) {
  const filePaths = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  return filePaths.map((filePath, i) => {
    const m = /^(\d+)_.+\.sql$/.exec(filePath)
    if (!m) throw new Error(`Invalid migration name: ${filePath}`)
    const version = Number(m[1])
    if (version !== i + 1) throw new Error(`Migration numbering must be contiguous; ${filePath} is in position ${i + 1}.`)
    return { version, filePath, sql: readFileSync(path.join(dir, filePath), 'utf8') }
  })
}

export function userVersion (db) {
  return db.prepare('PRAGMA user_version').get().user_version
}

function enableWal (db) {
  const current = db.prepare('PRAGMA journal_mode').get().journal_mode
  if (current === 'wal') return
  try {
    db.exec('PRAGMA journal_mode = WAL')
  } catch (error) {
    // I03 §4, M7: one short retry after rereading the mode (another process may have won the race).
    if (db.prepare('PRAGMA journal_mode').get().journal_mode === 'wal') return
    db.exec('PRAGMA journal_mode = WAL')
  }
}

/** Consistent copy with `VACUUM INTO` to a temporary file and `rename` (I03 §2.4: 123 ms with an active writer). */
export function backupDatabase (db, target) {
  mkdirSync(path.dirname(target), { recursive: true })
  const tmpFile = `${target}.parcial`
  rmSync(tmpFile, { force: true })
  db.prepare('VACUUM INTO ?').run(tmpFile)
  renameSync(tmpFile, target)
  return target
}

/**
 * Applies the pending migrations. Each one runs in its own `BEGIN IMMEDIATE` transaction that reads
 * `user_version` inside, so two simultaneous processes apply each file only once (M7).
 * Refuses to start if the database is newer than the last file. Before migrating an existing database
 * it leaves a backup (the way back for a runner that only moves forward).
 */
export function migrate (db, { dir = migrationsDir, backupsDir = null, log = () => {} } = {}) {
  const migrations = listMigrations(dir)
  const lastVersion = migrations.length
  const initialVersion = userVersion(db)
  if (initialVersion > lastVersion) {
    throw new Error(`The database is at version ${initialVersion} and this build only knows up to ${lastVersion}. Update the program.`)
  }
  if (initialVersion > 0 && initialVersion < lastVersion && backupsDir) {
    const target = path.join(backupsDir, `antes-de-migrar-v${initialVersion}-${Date.now()}.db`)
    backupDatabase(db, target)
    log(`Backup before migration: ${target}`)
  }
  let applied = 0
  for (const m of migrations) {
    tx(db, () => {
      if (userVersion(db) >= m.version) return
      db.exec(m.sql)
      // PRAGMA does not accept parameters; `version` is an integer validated above.
      db.exec(`PRAGMA user_version = ${m.version}`)
      applied++
      log(`Migration applied: ${m.filePath}`)
    })
  }
  return { fromVersion: initialVersion, toVersion: lastVersion, applied }
}

export const latestVersion = () => listMigrations().length

/**
 * The single initialization step: WAL, migrations and seeding. It runs before the API and the worker.
 * `seed` is injected so tests can migrate without seeding.
 */
export async function initializeDatabase (config, { seed = null, log = () => {} } = {}) {
  assertRuntime()
  mkdirSync(config.dataDir, { recursive: true })
  mkdirSync(config.attachmentsDir, { recursive: true })
  mkdirSync(config.tmpDir, { recursive: true })
  const db = openDatabase(config.dbFile, config.sqlite)
  try {
    enableWal(db)
    const result = migrate(db, { backupsDir: config.backupsDir, log })
    if (seed) await seed(db, config, log)
    return result
  } finally {
    db.close()
  }
}

/**
 * Opens the working connection and checks that the schema is up to date. Whoever calls this (the separate
 * worker) does not migrate: if initialization is missing, it fails with a message and the supervisor restarts it.
 */
export function openInitialized (config) {
  assertRuntime()
  const db = openDatabase(config.dbFile, config.sqlite)
  const version = userVersion(db)
  const expectedRoute = latestVersion()
  if (version !== expectedRoute) {
    db.close()
    throw new Error(`The database is at version ${version} and ${expectedRoute} was expected. Run «npm run db:init» first.`)
  }
  return db
}
