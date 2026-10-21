// Siembra de instalación: las áreas y plantillas iniciales (MASTER-SPEC §1.1, §7.9) y, por línea de comandos,
// el primer editor. Ninguna contraseña viene sembrada (informe 04 §4: Umami obliga a cambiar la suya; acá no
// existe ninguna): el primer editor se crea con
//   node src/db/seed.js --editor correo contraseña [nombre]
//
// El juego inicial lo define `loadSeed()` del analizador (`templates/areas.json` y los archivos que enumera):
// una sola fuente para lo que se instala y lo que el analizador valida.

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig, loadEnvFile } from '../config.js'
import { get, initializeDatabase, openInitialized, run, tx } from './index.js'
import { parseTemplate } from '../domain/template-file.js'

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Lee el juego inicial del analizador. Devuelve null si ese módulo no está instalado. */
async function leerJuegoInicial (config) {
  const archivo = path.join(srcDir, 'analyze', 'seed.js') // el juego inicial lo define el analizador, aunque ANALYZE_MODULE apunte a otro
  if (!existsSync(archivo)) return null
  const { loadSeed } = await import(pathToFileURL(archivo).href)
  return loadSeed(config.templatesDir)
}

/** Siembra áreas y plantillas sólo si la tabla `areas` está vacía (instalación nueva). */
export async function seedDefaults (db, config, log = () => {}) {
  if (get(db, 'SELECT COUNT(*) AS n FROM areas').n > 0) return { areas: 0, templates: 0 }
  const juego = await leerJuegoInicial(config)
  if (!juego) {
    log('No se sembraron áreas: falta el módulo del analizador que define el juego inicial.')
    return { areas: 0, templates: 0 }
  }
  const ahora = Date.now()
  tx(db, () => {
    if (get(db, 'SELECT COUNT(*) AS n FROM areas').n > 0) return // otro proceso ganó la carrera
    const idDelArea = new Map()
    for (const area of juego.areas) {
      const { lastInsertRowid } = run(db, 'INSERT INTO areas (title, description, position) VALUES (?, ?, ?)', area.title, area.description, area.position)
      idDelArea.set(area.id, Number(lastInsertRowid))
    }
    for (const t of juego.templates) {
      const parsed = parseTemplate(t.body_markdown) // una plantilla inválida detiene la instalación con su motivo
      run(db, 'INSERT INTO templates (area_id, name, description, body_markdown, updated_at) VALUES (?, ?, ?, ?, ?)',
        idDelArea.get(t.area_id), parsed.name, parsed.description, t.body_markdown, ahora)
    }
  })
  log(`Sembradas ${juego.areas.length} áreas y ${juego.templates.length} plantillas.`)
  return { areas: juego.areas.length, templates: juego.templates.length }
}

/** Crea (o eleva y reinicia) un editor. Es la única vía de alta del primer miembro (UD-007). */
export async function ensureEditor (db, config, { email, password, name }) {
  const { hashPassword, validatePassword } = await import('../identity/password.js')
  validatePassword(password, config.identity.password)
  const hash = await hashPassword(password, config.identity.argon2)
  const ahora = Date.now()
  return tx(db, () => {
    const existente = get(db, 'SELECT id FROM members WHERE email = ?', email)
    let id
    if (existente) {
      id = existente.id
      run(db, "UPDATE members SET role = 'editor' WHERE id = ?", id)
    } else {
      id = Number(run(db, "INSERT INTO members (email, name, role, created_at) VALUES (?, ?, 'editor', ?)", email, name, ahora).lastInsertRowid)
    }
    run(db, `INSERT INTO credentials (member_id, password_hash, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(member_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at, failed_count = 0, next_attempt_at = 0`,
    id, hash, ahora)
    run(db, 'DELETE FROM sessions WHERE member_id = ?', id)
    return { id, email, name: name ?? email, created: !existente }
  })
}

/**
 * Instalación: si no hay ningún miembro y se declaró ADMIN_EMAIL, crea el primer editor. La contraseña es
 * ADMIN_PASSWORD o, si falta, una al azar que se devuelve para mostrarla una sola vez. Con miembros existentes
 * no hace nada: ADMIN_EMAIL no es una vía para elevar a nadie.
 */
export async function bootstrapFirstEditor (db, config) {
  if (!config.adminEmail || get(db, 'SELECT COUNT(*) AS n FROM members').n > 0) return null
  const password = config.adminPassword || randomBytes(18).toString('base64url') // 24 caracteres, sobre el mínimo de 15
  const r = await ensureEditor(db, config, { email: config.adminEmail, password, name: config.adminEmail.split('@')[0] })
  return { ...r, password, generated: !config.adminPassword }
}

// ---- Línea de comandos
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  loadEnvFile()
  const config = loadConfig()
  const args = process.argv.slice(2)
  const i = args.indexOf('--editor')
  try {
    await initializeDatabase(config, { seed: seedDefaults, log: (m) => console.log(m) })
    if (i >= 0) {
      const [email, password, nombre] = args.slice(i + 1)
      if (!email || !password) throw new Error('Uso: node src/db/seed.js --editor correo contraseña [nombre]')
      const db = openInitialized(config)
      try {
        const r = await ensureEditor(db, config, { email, password, name: nombre ?? email.split('@')[0] })
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

