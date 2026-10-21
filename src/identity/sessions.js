// Opaque sessions in the `sessions` table (MASTER-SPEC §7.7, report 04 §2.2). The token is 32 random bytes that
// live only in the cookie; the database stores its SHA-256. A database dump does not allow impersonating anyone.

import { createHash, randomBytes } from 'node:crypto'
import { get, run } from '../db/index.js'

export const hashToken = (token) => createHash('sha256').update(token).digest('hex')

export function createSessions ({ db, config, now = Date.now }) {
  const s = config.identity.session
  const absoluteMs = s.absoluteHours * 3600 * 1000
  const idleMs = s.idleMinutes * 60 * 1000
  const touchMs = s.touchSeconds * 1000

  /** New session (always regenerated: a previous token is never reused, OWASP Session Management). */
  function create (memberId) {
    const token = randomBytes(s.tokenBytes).toString('base64url')
    const t = now()
    run(db, 'INSERT INTO sessions (id, member_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      hashToken(token), memberId, t, t, t + absoluteMs)
    return { token, maxAgeSeconds: Math.floor(absoluteMs / 1000) }
  }

  /** Returns the member who owns the token, or null if it does not exist, expired or was idle too long. */
  function lookup (token) {
    if (!token || typeof token !== 'string') return null
    const id = hashToken(token)
    const dbRow = get(db, `
      SELECT s.last_seen_at, s.expires_at, m.id, m.email, m.name, m.role
        FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.id = ? AND m.active = 1`, id) // a deactivated member's session is dead even if it was not destroyed
    if (!dbRow) return null
    const t = now()
    if (dbRow.expires_at <= t || dbRow.last_seen_at + idleMs <= t) {
      run(db, 'DELETE FROM sessions WHERE id = ?', id)
      return null
    }
    if (t - dbRow.last_seen_at >= touchMs) run(db, 'UPDATE sessions SET last_seen_at = ? WHERE id = ?', t, id)
    return { id: dbRow.id, email: dbRow.email, name: dbRow.name, role: dbRow.role }
  }

  const destroy = (token) => { if (token) run(db, 'DELETE FROM sessions WHERE id = ?', hashToken(token)) }

  /** Invalidates a member's sessions (role or password change). `exceptToken` keeps the current one. */
  function destroyForMember (memberId, exceptToken = null) {
    if (exceptToken) run(db, 'DELETE FROM sessions WHERE member_id = ? AND id <> ?', memberId, hashToken(exceptToken))
    else run(db, 'DELETE FROM sessions WHERE member_id = ?', memberId)
  }

  return { create, lookup, destroy, destroyForMember }
}
