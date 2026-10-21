// Miembros del equipo (MASTER-SPEC §1.1). Un miembro edita sólo su descripción y dominios; el editor
// administra a los demás. Debe quedar al menos un editor.

import { all, get, run, tx } from '../db/index.js'
import { iso } from '../db/util.js'
import { conflict, notFound } from './errors.js'

const COLUMNAS = 'id, email, name, role, responsibilities, domains, created_at'

export const toMember = (fila) => ({
  id: fila.id, email: fila.email, name: fila.name, role: fila.role,
  responsibilities: fila.responsibilities, domains: fila.domains, created_at: iso(fila.created_at)
})

export const listMembers = (db) => all(db, `SELECT ${COLUMNAS} FROM members ORDER BY name COLLATE NOCASE, id`).map(toMember)

export function getMember (db, id) {
  const fila = get(db, `SELECT ${COLUMNAS} FROM members WHERE id = ?`, id)
  if (!fila) throw notFound('El miembro no existe.')
  return toMember(fila)
}

export function createMember (db, { email, name, role = 'member', responsibilities = '', domains = '' }, now = Date.now) {
  if (get(db, 'SELECT 1 AS e FROM members WHERE email = ?', email)) throw conflict('Ya existe un miembro con ese correo.', 'email_taken')
  const r = run(db, 'INSERT INTO members (email, name, role, responsibilities, domains, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    email, name, role, responsibilities, domains, now())
  return Number(r.lastInsertRowid)
}

const CAMPOS_EDITABLES = ['name', 'email', 'role', 'responsibilities', 'domains']

/** Aplica un parche. Devuelve { member, roleChanged }. Rechaza dejar al equipo sin editor. */
export function updateMember (db, id, patch) {
  return tx(db, () => {
    const actual = get(db, `SELECT ${COLUMNAS} FROM members WHERE id = ?`, id)
    if (!actual) throw notFound('El miembro no existe.')
    const cambios = Object.entries(patch).filter(([k, v]) => CAMPOS_EDITABLES.includes(k) && v !== undefined)
    if (patch.email !== undefined && patch.email !== actual.email) {
      const otro = get(db, 'SELECT id FROM members WHERE email = ? AND id <> ?', patch.email, id)
      if (otro) throw conflict('Ya existe un miembro con ese correo.', 'email_taken')
    }
    if (patch.role !== undefined && patch.role !== actual.role && actual.role === 'editor') {
      const { n } = get(db, "SELECT COUNT(*) AS n FROM members WHERE role = 'editor'")
      if (n <= 1) throw conflict('Debe quedar al menos un editor en el equipo.', 'last_editor')
    }
    if (cambios.length > 0) {
      run(db, `UPDATE members SET ${cambios.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cambios.map(([, v]) => v), id)
    }
    return { member: getMember(db, id), roleChanged: patch.role !== undefined && patch.role !== actual.role }
  })
}
