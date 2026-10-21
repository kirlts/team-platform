// Miembros del equipo (MASTER-SPEC §1.1). Un miembro edita sólo su descripción y dominios; el editor
// administra a los demás. Debe quedar al menos un editor.

import { all, get, run, tx } from '../db/index.js'
import { iso } from '../db/util.js'
import { conflict, notFound } from './errors.js'
import { audit } from './audit.js'
import { DEFAULT_LANGUAGE, requireLanguage } from './language.js'

export const MEMBER_COLUMNS = 'id, email, name, role, responsibilities, domains, language, created_at'
const COLUMNS = MEMBER_COLUMNS

/** Los dominios se guardan como lista en JSON y salen como arreglo de textos. */
export const parseDomains = (textValue) => {
  try { const v = JSON.parse(textValue); return Array.isArray(v) ? v.map(String) : [] } catch { return [] }
}

export const toMember = (dbRow) => ({
  id: dbRow.id, email: dbRow.email, name: dbRow.name, role: dbRow.role,
  responsibilities: dbRow.responsibilities, domains: parseDomains(dbRow.domains), language: dbRow.language, created_at: iso(dbRow.created_at)
})

export const listMembers = (db) => all(db, `SELECT ${COLUMNS} FROM members ORDER BY name COLLATE NOCASE, id`).map(toMember)

export function getMember (db, id) {
  const dbRow = get(db, `SELECT ${COLUMNS} FROM members WHERE id = ?`, id)
  if (!dbRow) throw notFound('El miembro no existe.')
  return toMember(dbRow)
}

export function createMember (db, { email, name, role = 'member', responsibilities = '', domains = [], language = DEFAULT_LANGUAGE }, { now = Date.now, actorId = null } = {}) {
  if (get(db, 'SELECT 1 AS e FROM members WHERE email = ?', email)) throw conflict('Ya existe un miembro con ese correo.', 'email_taken')
  const r = run(db, 'INSERT INTO members (email, name, role, responsibilities, domains, language, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    email, name, role, responsibilities, JSON.stringify(domains), requireLanguage(language), now())
  const id = Number(r.lastInsertRowid)
  audit(db, { memberId: actorId, action: 'member.create', entity: 'member', entityId: id, detail: { email, role }, now })
  return id
}

const EDITABLE_FIELDS = ['name', 'email', 'role', 'responsibilities', 'domains', 'language']

/** Aplica un parche. Devuelve { member, roleChanged }. Rechaza dejar al equipo sin editor. */
export function updateMember (db, id, patch, { actorId = null, now = Date.now } = {}) {
  return tx(db, () => {
    const current = get(db, `SELECT ${COLUMNS} FROM members WHERE id = ?`, id)
    if (!current) throw notFound('El miembro no existe.')
    const normalized = patch.language === undefined ? patch : { ...patch, language: requireLanguage(patch.language) }
    const edits = Object.entries(normalized).filter(([k, v]) => EDITABLE_FIELDS.includes(k) && v !== undefined)
    if (patch.email !== undefined && patch.email !== current.email) {
      const another = get(db, 'SELECT id FROM members WHERE email = ? AND id <> ?', patch.email, id)
      if (another) throw conflict('Ya existe un miembro con ese correo.', 'email_taken')
    }
    if (patch.role !== undefined && patch.role !== current.role && current.role === 'editor') {
      const { n } = get(db, "SELECT COUNT(*) AS n FROM members WHERE role = 'editor'")
      if (n <= 1) throw conflict('Debe quedar al menos un editor en el equipo.', 'last_editor')
    }
    if (edits.length > 0) {
      const val = (k, v) => (k === 'domains' ? JSON.stringify(v) : v)
      run(db, `UPDATE members SET ${edits.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, ...edits.map(([k, v]) => val(k, v)), id)
      audit(db, { memberId: actorId, action: 'member.update', entity: 'member', entityId: id, detail: { fieldValues: edits.map(([k]) => k) }, now })
    }
    return { member: getMember(db, id), roleChanged: patch.role !== undefined && patch.role !== current.role }
  })
}
