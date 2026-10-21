// Conexión a SQLite por `node:sqlite` (MASTER-SPEC §3). WAL, busy_timeout y synchronous=FULL.
// Dos pasos separados a propósito (informe 03 §4, M7):
//   openDatabase()      abre una conexión y fija los pragmas de CONEXIÓN. No toca el modo del diario.
//   initializeDatabase()  paso único previo a la API y al worker: fija WAL, migra y siembra.
// Dos arranques simultáneos que fijan WAL fallaron con «database is locked» en 2 de 20 casos (M7).

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

/** Compara versiones «a.b.c». Devuelve negativo, cero o positivo. */
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
 * Exige Node ≥ 24.15 (node:sqlite como release candidate) y SQLite ≥ 3.51.3 (corrección del error de
 * reinicio de WAL, informe 03 §2.1). Un proceso API y un worker escriben a la vez: ése es el perfil afectado.
 */
export function assertRuntime () {
  const minNode = '24.15.0'
  const minSqlite = '3.51.3'
  if (compareVersions(process.versions.node, minNode) < 0) {
    throw new Error(`Se requiere Node ${minNode} o posterior; esta es la ${process.versions.node}.`)
  }
  const probe = new DatabaseSync(':memory:')
  const { v } = probe.prepare('SELECT sqlite_version() AS v').get()
  probe.close()
  if (compareVersions(v, minSqlite) < 0) {
    throw new Error(`Se requiere SQLite ${minSqlite} o posterior (error de WAL corregido); esta es la ${v}.`)
  }
  return { node: process.versions.node, sqlite: v }
}

/** Abre una conexión con los pragmas de conexión. No cambia el modo del diario. */
export function openDatabase (file, sqliteConfig = { busyTimeoutMs: 5000, synchronous: 'FULL' }) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
  // `timeout` es el busy_timeout (I03 §2.3: sin él, 16 % de las transacciones concurrentes fallaron).
  const db = new DatabaseSync(file, { timeout: sqliteConfig.busyTimeoutMs, enableForeignKeyConstraints: true })
  db.exec(`PRAGMA synchronous = ${sqliteConfig.synchronous === 'NORMAL' ? 'NORMAL' : 'FULL'}`)
  db.exec(`PRAGMA busy_timeout = ${Number(sqliteConfig.busyTimeoutMs)}`)
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

/**
 * Ejecuta `fn` dentro de una transacción `BEGIN IMMEDIATE` (MS §3: toda transacción que lee y luego escribe).
 * Si ya hay una abierta, `fn` participa en ella. `fn` debe ser síncrona: ninguna llamada a un proveedor de
 * modelo ocurre dentro de una transacción (I03 §2.3).
 */
export function tx (db, fn) {
  if (db.isTransaction) return fn()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* la transacción ya terminó */ }
    throw error
  }
}

const cacheSentencias = new WeakMap()

/** Sentencia preparada con caché por conexión. */
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

/** Lista las migraciones: archivos `NNNN_nombre.sql` ordenados, con numeración contigua desde 1. */
export function listMigrations (dir = migrationsDir) {
  const filePaths = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  return filePaths.map((filePath, i) => {
    const m = /^(\d+)_.+\.sql$/.exec(filePath)
    if (!m) throw new Error(`Nombre de migración inválido: ${filePath}`)
    const version = Number(m[1])
    if (version !== i + 1) throw new Error(`La numeración de migraciones debe ser contigua; ${filePath} ocupa el lugar ${i + 1}.`)
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
    // I03 §4, M7: un reintento corto tras releer el modo (otro proceso pudo ganar la carrera).
    if (db.prepare('PRAGMA journal_mode').get().journal_mode === 'wal') return
    db.exec('PRAGMA journal_mode = WAL')
  }
}

/** Copia consistente con `VACUUM INTO` a un temporal y `rename` (I03 §2.4: 123 ms con escritor activo). */
export function backupDatabase (db, target) {
  mkdirSync(path.dirname(target), { recursive: true })
  const tmpFile = `${target}.parcial`
  rmSync(tmpFile, { force: true })
  db.prepare('VACUUM INTO ?').run(tmpFile)
  renameSync(tmpFile, target)
  return target
}

/**
 * Aplica las migraciones pendientes. Cada una corre en su propia transacción `BEGIN IMMEDIATE` que lee
 * `user_version` adentro, así dos procesos simultáneos aplican cada archivo una sola vez (M7).
 * Se niega a arrancar si la base es más nueva que el último archivo. Antes de migrar una base existente
 * deja un respaldo (la vía de vuelta de un ejecutor que sólo avanza).
 */
export function migrate (db, { dir = migrationsDir, backupsDir = null, log = () => {} } = {}) {
  const migrations = listMigrations(dir)
  const lastVersion = migrations.length
  const initialVersion = userVersion(db)
  if (initialVersion > lastVersion) {
    throw new Error(`La base está en la versión ${initialVersion} y esta compilación sólo conoce hasta la ${lastVersion}. Actualiza el programa.`)
  }
  if (initialVersion > 0 && initialVersion < lastVersion && backupsDir) {
    const target = path.join(backupsDir, `antes-de-migrar-v${initialVersion}-${Date.now()}.db`)
    backupDatabase(db, target)
    log(`Respaldo previo a la migración: ${target}`)
  }
  let applied = 0
  for (const m of migrations) {
    tx(db, () => {
      if (userVersion(db) >= m.version) return
      db.exec(m.sql)
      // PRAGMA no admite parámetros; `version` es un entero validado arriba.
      db.exec(`PRAGMA user_version = ${m.version}`)
      applied++
      log(`Migración aplicada: ${m.filePath}`)
    })
  }
  return { fromVersion: initialVersion, toVersion: lastVersion, applied }
}

export const latestVersion = () => listMigrations().length

/**
 * El paso de inicialización único: WAL, migraciones y siembra. Corre antes de la API y del worker.
 * `seed` se inyecta para que las pruebas migren sin sembrar.
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
 * Abre la conexión de trabajo y verifica que el esquema esté al día. Quien llama a esto (el worker aparte)
 * no migra: si falta la inicialización, falla con un mensaje y el supervisor lo reinicia.
 */
export function openInitialized (config) {
  assertRuntime()
  const db = openDatabase(config.dbFile, config.sqlite)
  const version = userVersion(db)
  const expectedRoute = latestVersion()
  if (version !== expectedRoute) {
    db.close()
    throw new Error(`La base está en la versión ${version} y se esperaba la ${expectedRoute}. Ejecuta primero «npm run db:init».`)
  }
  return db
}
