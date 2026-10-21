// Siembra de instalación: las cinco áreas iniciales con sus plantillas (MASTER-SPEC §1.1, §7.9) y, por línea
// de comandos, el primer editor. Ninguna contraseña viene sembrada (informe 04 §4: Umami obliga a cambiar la
// suya; acá no existe ninguna): el primer editor se crea con
//   node src/db/seed.js --editor correo contraseña [nombre]
//
// Las plantillas salen de `templates/<clave>.md` o `templates/<clave>/*.md` si existen (las escribe otro
// agente; contrato en src/contracts.md). Si falta alguna, se usa el juego mínimo de este archivo.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig, loadEnvFile } from '../config.js'
import { get, initializeDatabase, openInitialized, run, tx } from './index.js'
import { parseTemplate } from '../domain/template-file.js'

/** Claves estables de las áreas iniciales: sólo sirven para emparejar archivos de `templates/` al sembrar. */
export const DEFAULT_AREAS = [
  {
    key: 'idea',
    title: 'Idea',
    description: 'Una propuesta o una exploración sin compromiso: algo que podría hacerse o probarse, todavía sin pedido formal.',
    template: `---
name: Idea
description: Propuesta o exploración que todavía no es un pedido formal.
fields:
  - { name: summary, label: "Resumen de la idea", required: true }
  - { name: motivation, label: "Por qué podría servir", required: false }
  - { name: first_step, label: "Primer paso posible", required: false }
---
## Método
Una idea es un mensaje aparte de cualquier error o pedido. Si un mismo texto propone dos cosas que se
pueden decidir por separado, son dos ideas.

## Formato de salida
Un mensaje por idea. Título: la idea en una frase corta.
`
  },
  {
    key: 'error',
    title: 'Error',
    description: 'Algo que antes funcionaba o debería funcionar y no lo hace.',
    template: `---
name: Reporte de error
description: Algo que antes funcionaba o debería funcionar y no lo hace.
fields:
  - { name: steps, label: "Pasos para reproducir", required: true }
  - { name: expected, label: "Qué se esperaba", required: true }
  - { name: actual, label: "Qué pasó", required: true }
  - { name: where, label: "Dónde (pantalla, URL)", required: false }
---
## Método
Cada error distinto es un mensaje. Dos errores que comparten una captura son dos mensajes, y la captura
acompaña a ambos.

## Formato de salida
Un mensaje por error. Título: verbo en infinitivo y lugar.
`
  },
  {
    key: 'feature',
    title: 'Nueva funcionalidad',
    description: 'Algo que el producto todavía no hace y alguien pide que haga.',
    template: `---
name: Pedido de funcionalidad
description: Algo que el producto todavía no hace y alguien pide que haga.
fields:
  - { name: request, label: "Qué se pide", required: true }
  - { name: reason, label: "Para qué", required: false }
  - { name: where, label: "Dónde aparecería", required: false }
---
## Método
Cada pedido que se pueda construir y entregar por separado es un mensaje.

## Formato de salida
Un mensaje por pedido. Título: la capacidad pedida, en una frase corta.
`
  },
  {
    key: 'feedback',
    title: 'Retroalimentación',
    description: 'Una opinión o valoración sobre algo existente, sin un error ni un pedido concreto.',
    template: `---
name: Retroalimentación
description: Opinión o valoración sobre algo que ya existe, sin un error ni un pedido concreto.
fields:
  - { name: subject, label: "Sobre qué", required: true }
  - { name: opinion, label: "Qué se opina", required: true }
---
## Método
Una opinión por tema. Si la opinión contiene un error o un pedido concreto, ese punto pertenece a su
propia área.

## Formato de salida
Un mensaje por tema. Título: el tema y el sentido de la opinión.
`
  },
  {
    key: 'question',
    title: 'Pregunta',
    description: 'Una duda que espera una respuesta de alguien del equipo.',
    template: `---
name: Pregunta
description: Duda que espera una respuesta de alguien del equipo.
fields:
  - { name: question, label: "La pregunta", required: true }
  - { name: context, label: "Contexto", required: false }
---
## Método
Cada pregunta que se responde por separado es un mensaje.

## Formato de salida
Un mensaje por pregunta. Título: la pregunta, en una frase.
`
  }
]

function plantillasDeArchivo (dir, clave) {
  if (!existsSync(dir)) return []
  const archivos = []
  const unico = path.join(dir, `${clave}.md`)
  if (existsSync(unico)) archivos.push(unico)
  const carpeta = path.join(dir, clave)
  if (existsSync(carpeta) && statSync(carpeta).isDirectory()) {
    for (const f of readdirSync(carpeta).filter((n) => n.endsWith('.md')).sort()) archivos.push(path.join(carpeta, f))
  }
  return archivos.map((f) => readFileSync(f, 'utf8'))
}

/** Siembra áreas y plantillas sólo si la tabla `areas` está vacía (instalación nueva). */
export function seedDefaults (db, config, log = () => {}) {
  const { n } = get(db, 'SELECT COUNT(*) AS n FROM areas')
  if (n > 0) return { areas: 0, templates: 0 }
  const ahora = Date.now()
  let plantillas = 0
  tx(db, () => {
    DEFAULT_AREAS.forEach((area, posicion) => {
      const { lastInsertRowid } = run(db, 'INSERT INTO areas (title, description, position) VALUES (?, ?, ?)', area.title, area.description, posicion)
      const delArchivo = plantillasDeArchivo(config.templatesDir, area.key)
      const textos = delArchivo.length > 0 ? delArchivo : [area.template]
      for (const markdown of textos) {
        const t = parseTemplate(markdown) // una plantilla inválida detiene la instalación con su motivo
        run(db, 'INSERT INTO templates (area_id, name, description, body_markdown, updated_at) VALUES (?, ?, ?, ?, ?)',
          Number(lastInsertRowid), t.name, t.description, markdown, ahora)
        plantillas++
      }
    })
  })
  log(`Sembradas ${DEFAULT_AREAS.length} áreas y ${plantillas} plantillas.`)
  return { areas: DEFAULT_AREAS.length, templates: plantillas }
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

// ---- Línea de comandos
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  loadEnvFile()
  const config = loadConfig()
  const args = process.argv.slice(2)
  const i = args.indexOf('--editor')
  try {
    initializeDatabase(config, { seed: seedDefaults, log: (m) => console.log(m) })
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

