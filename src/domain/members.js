// Team members (MASTER-SPEC §1.1). A member edits only their own profile (UD-023), language and password; the editor
// administers the rest. At least one editor must remain.

import { all, get, run, tx } from '../db/index.js'
import { iso } from '../db/util.js'
import { conflict, notFound } from './errors.js'
import { audit } from './audit.js'
import { DEFAULT_LANGUAGE, requireLanguage } from './language.js'

export const MEMBER_COLUMNS = 'id, email, name, role, profile, language, active, created_at'
const COLUMNS = MEMBER_COLUMNS

export const toMember = (dbRow) => ({
  id: dbRow.id, email: dbRow.email, name: dbRow.name, role: dbRow.role,
  profile: dbRow.profile, language: dbRow.language, active: dbRow.active === 1, created_at: iso(dbRow.created_at)
})

export const listMembers = (db) => all(db, `SELECT ${COLUMNS} FROM members ORDER BY name COLLATE NOCASE, id`).map(toMember)

export function getMember (db, id) {
  const dbRow = get(db, `SELECT ${COLUMNS} FROM members WHERE id = ?`, id)
  if (!dbRow) throw notFound('El miembro no existe.')
  return toMember(dbRow)
}

export function createMember (db, { email, name, role = 'member', profile = '', language = DEFAULT_LANGUAGE }, { now = Date.now, actorId = null } = {}) {
  if (get(db, 'SELECT 1 AS e FROM members WHERE email = ?', email)) throw conflict('Ya existe un miembro con ese correo.', 'email_taken')
  const r = run(db, 'INSERT INTO members (email, name, role, profile, language, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    email, name, role, profile, requireLanguage(language), now())
  const id = Number(r.lastInsertRowid)
  audit(db, { memberId: actorId, action: 'member.create', entity: 'member', entityId: id, detail: { email, role }, now })
  return id
}

const EDITABLE_FIELDS = ['name', 'email', 'role', 'profile', 'language', 'active']

/** Applies a patch. Returns { member, roleChanged, deactivated }. Rejects leaving the team without an editor. */
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
    // Deactivation (UD-017 lifecycle): soft, so the history stays. Nobody deactivates their own account.
    if (patch.active === false && current.active === 1 && actorId === id) {
      throw conflict('No se puede desactivar la propia cuenta.', 'cannot_deactivate_self')
    }
    // The team always keeps an active editor: neither demoting nor deactivating the last one is allowed.
    const leavesEditors = current.role === 'editor' && current.active === 1 &&
      ((patch.role !== undefined && patch.role !== 'editor') || patch.active === false)
    if (leavesEditors) {
      const { n } = get(db, "SELECT COUNT(*) AS n FROM members WHERE role = 'editor' AND active = 1 AND id <> ?", id)
      if (n < 1) throw conflict('Debe quedar al menos un editor activo en el equipo.', 'last_editor')
    }
    if (edits.length > 0) {
      const val = (k, v) => (k === 'active' ? (v ? 1 : 0) : v)
      run(db, `UPDATE members SET ${edits.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, ...edits.map(([k, v]) => val(k, v)), id)
      audit(db, { memberId: actorId, action: 'member.update', entity: 'member', entityId: id, detail: { fieldValues: edits.map(([k]) => k) }, now })
    }
    return {
      member: getMember(db, id),
      roleChanged: patch.role !== undefined && patch.role !== current.role,
      deactivated: patch.active === false && current.active === 1
    }
  })
}
