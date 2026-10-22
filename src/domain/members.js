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

/** What a member left behind. The audit log is not history: its `member_id` is `ON DELETE SET NULL` (UD-240). */
export function memberHistory (db, id) {
  const count = (sql) => get(db, sql, id).n
  return {
    inputs: count('SELECT COUNT(*) AS n FROM inputs WHERE author_id = ?'),
    messages: count('SELECT COUNT(*) AS n FROM messages WHERE author_id = ?'),
    replies: count('SELECT COUNT(*) AS n FROM replies WHERE author_id = ?'),
    edits: count('SELECT COUNT(*) AS n FROM message_edits WHERE member_id = ?'),
    assignments: count('SELECT COUNT(*) AS n FROM message_assignees WHERE member_id = ?')
  }
}

const hasHistory = (h) => Object.values(h).some((n) => n > 0)

/**
 * Deletes a member for good (UD-240). Nobody deletes themselves nor the last active editor. Without history the row
 * goes with its credentials, sessions and identity links (all cascade). With history and `purge` everything of theirs
 * goes too: their inputs (attachments, jobs, proposal), their messages (replies of others, assignees, attachment links,
 * edits), their replies on messages of others (the message goes back to `open` when no reply is left and it is not
 * closed), their edits and their assignments. Without `purge` a member with history is a 409 `member_has_history`
 * with the counts. Returns { member_id, deleted: { inputs, messages, replies }, sha256s } where `sha256s` are the
 * files the deleted rows referenced, for the caller to free from the volume once nothing else references them.
 */
export function deleteMember (db, id, { actorId = null, purge = false, queue = null, now = Date.now } = {}) {
  return tx(db, () => {
    const current = get(db, `SELECT ${COLUMNS} FROM members WHERE id = ?`, id)
    if (!current) throw notFound('El miembro no existe.')
    if (actorId === id) throw conflict('No se puede eliminar la propia cuenta.', 'cannot_delete_self')
    if (current.role === 'editor' && current.active === 1) {
      const { n } = get(db, "SELECT COUNT(*) AS n FROM members WHERE role = 'editor' AND active = 1 AND id <> ?", id)
      if (n < 1) throw conflict('Debe quedar al menos un editor activo en el equipo.', 'last_editor')
    }
    const history = memberHistory(db, id)
    const deleted = { inputs: history.inputs, messages: history.messages, replies: history.replies }
    if (hasHistory(history) && !purge) {
      throw conflict('El miembro tiene historial: se desactiva, o se elimina con todo lo suyo.', 'member_has_history', deleted)
    }
    const sha256s = []
    if (hasHistory(history)) {
      // Files the rows about to go referenced: of their inputs, of their messages, of their replies and of the replies on their messages.
      const shas = (sql) => all(db, sql, id).map((r) => r.sha256)
      sha256s.push(
        ...shas("SELECT a.sha256 FROM attachments a JOIN inputs i ON i.id = a.input_id WHERE i.author_id = ? AND a.kind <> 'link'"),
        ...shas("SELECT a.sha256 FROM attachments a JOIN message_attachments x ON x.attachment_id = a.id JOIN messages m ON m.id = x.message_id WHERE m.author_id = ? AND a.kind <> 'link'"),
        ...shas("SELECT ra.sha256 FROM reply_attachments ra JOIN replies r ON r.id = ra.reply_id WHERE r.author_id = ? AND ra.kind <> 'link'"),
        ...shas("SELECT ra.sha256 FROM reply_attachments ra JOIN replies r ON r.id = ra.reply_id JOIN messages m ON m.id = r.message_id WHERE m.author_id = ? AND ra.kind <> 'link'")
      )
      // Messages of others where this member replied: their state is derived again once the replies are gone.
      const touched = all(db, 'SELECT DISTINCT r.message_id AS id FROM replies r JOIN messages m ON m.id = r.message_id WHERE r.author_id = ? AND m.author_id <> ?', id, id).map((r) => r.id)
      run(db, 'DELETE FROM replies WHERE author_id = ?', id)
      for (const messageId of touched) {
        const left = get(db, 'SELECT COUNT(*) AS n FROM replies WHERE message_id = ?', messageId).n
        if (left === 0) run(db, "UPDATE messages SET status = 'open' WHERE id = ? AND status = 'answered'", messageId)
      }
      run(db, 'DELETE FROM message_edits WHERE member_id = ?', id)
      run(db, 'DELETE FROM message_assignees WHERE member_id = ?', id)
      run(db, 'DELETE FROM messages WHERE author_id = ?', id) // cascades: assignees, attachment links, replies of others, edits
      if (queue) for (const input of all(db, 'SELECT id FROM inputs WHERE author_id = ?', id)) queue.cancelForInput(input.id)
      run(db, 'DELETE FROM inputs WHERE author_id = ?', id) // cascades: attachments, jobs, proposal
    }
    run(db, 'DELETE FROM members WHERE id = ?', id) // cascades: credentials, sessions, identity_links, job_events
    audit(db, { memberId: actorId, action: 'member.delete', entity: 'member', entityId: id, detail: { email: current.email, role: current.role, purge: hasHistory(history), ...deleted }, now })
    return { member_id: id, deleted, sha256s }
  })
}
