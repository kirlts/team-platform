// Installation seeding: the initial areas and templates (MASTER-SPEC §1.1, §7.9) and, from the command line,
// the first editor. No password comes seeded (report 04 §4: Umami forces a change of its own; here none
// exists): the first editor is created with
//   `node src/db/seed.js --editor correo contraseña [nombre]`
//
// The initial set is defined by the analyzer's `loadSeed()` (`templates/areas.json` and the files it lists):
// a single source for what gets installed and what the analyzer validates.

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig, loadEnvFile } from '../config.js'
import { get, initializeDatabase, openInitialized, run, tx } from './index.js'
import { parseTemplate } from '../domain/template-file.js'

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Reads the analyzer's initial set. Returns null if that module is not installed. */
export async function readSeedSet (config) {
  const filePath = path.join(srcDir, 'analyze', 'seed.js') // the analyzer defines the initial set, even if ANALYZE_MODULE points to another one
  if (!existsSync(filePath)) return null
  const { loadSeed } = await import(pathToFileURL(filePath).href)
  return loadSeed(config.templatesDir)
}

/** Seeds areas and templates only if the `areas` table is empty (new installation). */
export async function seedDefaults (db, config, log = () => {}) {
  if (get(db, 'SELECT COUNT(*) AS n FROM areas').n > 0) return { areas: 0, templates: 0 }
  const seedSet = await readSeedSet(config)
  if (!seedSet) {
    log('No areas were seeded: the analyzer module that defines the initial set is missing.')
    return { areas: 0, templates: 0 }
  }
  tx(db, () => {
    if (get(db, 'SELECT COUNT(*) AS n FROM areas').n > 0) return // another process won the race
    insertSeedSet(db, seedSet)
  })
  log(`Seeded ${seedSet.areas.length} areas and ${seedSet.templates.length} templates.`)
  return { areas: seedSet.areas.length, templates: seedSet.templates.length }
}

/** Inserts the initial areas and templates. Synchronous, so a caller can run it inside its own transaction (the data reset reuses it). */
export function insertSeedSet (db, seedSet, nowMs = Date.now()) {
  const areaIdMap = new Map()
  for (const area of seedSet.areas) {
    const { lastInsertRowid } = run(db, 'INSERT INTO areas (title, description, position, color) VALUES (?, ?, ?, ?)', area.title, area.description, area.position, area.color ?? '#4f46e5')
    areaIdMap.set(area.id, Number(lastInsertRowid))
  }
  for (const t of seedSet.templates) {
    const parsed = parseTemplate(t.body_markdown) // an invalid template stops the installation with its reason
    run(db, 'INSERT INTO templates (area_id, name, description, body_markdown, updated_at) VALUES (?, ?, ?, ?, ?)',
      areaIdMap.get(t.area_id), parsed.name, parsed.description, t.body_markdown, nowMs)
  }
  return { areas: seedSet.areas.length, templates: seedSet.templates.length }
}

/** Creates (or promotes and resets) an editor. It is the only way to add the first member (UD-007). */
export async function ensureEditor (db, config, { email, password, name }) {
  const { hashPassword, validatePassword } = await import('../identity/password.js')
  validatePassword(password, config.identity.password)
  const hash = await hashPassword(password, config.identity.argon2)
  const nowMs = Date.now()
  return tx(db, () => {
    const existing = get(db, 'SELECT id FROM members WHERE email = ?', email)
    let id
    if (existing) {
      id = existing.id
      run(db, "UPDATE members SET role = 'editor' WHERE id = ?", id)
    } else {
      id = Number(run(db, "INSERT INTO members (email, name, role, created_at) VALUES (?, ?, 'editor', ?)", email, name, nowMs).lastInsertRowid)
    }
    run(db, `INSERT INTO credentials (member_id, password_hash, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(member_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at, failed_count = 0, next_attempt_at = 0`,
    id, hash, nowMs)
    run(db, 'DELETE FROM sessions WHERE member_id = ?', id)
    return { id, email, name: name ?? email, created: !existing }
  })
}

/**
 * Installation: if there is no member and ADMIN_EMAIL is set, creates the first editor. The password is
 * ADMIN_PASSWORD or, if missing, a random one that is returned so it can be shown only once. With existing
 * members it does nothing: ADMIN_EMAIL is not a way to promote anyone.
 */
export async function bootstrapFirstEditor (db, config) {
  if (!config.adminEmail || get(db, 'SELECT COUNT(*) AS n FROM members').n > 0) return null
  const password = config.adminPassword || randomBytes(18).toString('base64url') // 24 characters, above the minimum of 15
  const r = await ensureEditor(db, config, { email: config.adminEmail, password, name: config.adminEmail.split('@')[0] })
  return { ...r, password, generated: !config.adminPassword }
}

// ---- Command line
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  loadEnvFile()
  const config = loadConfig()
  const args = process.argv.slice(2)
  const i = args.indexOf('--editor')
  try {
    await initializeDatabase(config, { seed: seedDefaults, log: (m) => console.log(m) })
    if (i >= 0) {
      const [email, password, nameValue] = args.slice(i + 1)
      if (!email || !password) throw new Error('Uso: node src/db/seed.js --editor correo contraseña [nombre]')
      const db = openInitialized(config)
      try {
        const r = await ensureEditor(db, config, { email, password, name: nameValue ?? email.split('@')[0] })
        console.log(`${r.created ? 'Editor creado' : 'Editor actualizado'}: ${r.email} (id ${r.id}).`)
      } finally {
        db.close()
      }
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

