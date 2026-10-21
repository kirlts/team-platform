// Sesiones opacas en la tabla `sessions` (MASTER-SPEC §7.7, informe 04 §2.2). La ficha son 32 bytes al azar que
// sólo viven en la cookie; la base guarda su SHA-256. Un volcado de la base no permite suplantar a nadie.

import { createHash, randomBytes } from 'node:crypto'
import { get, run } from '../db/index.js'

export const hashToken = (token) => createHash('sha256').update(token).digest('hex')

export function createSessions ({ db, config, now = Date.now }) {
  const s = config.identity.session
  const absolutoMs = s.absoluteHours * 3600 * 1000
  const ociosoMs = s.idleMinutes * 60 * 1000
  const toqueMs = s.touchSeconds * 1000

  /** Sesión nueva (siempre regenerada: nunca se reutiliza una ficha previa, OWASP Session Management). */
  function create (memberId) {
    const token = randomBytes(s.tokenBytes).toString('base64url')
    const t = now()
    run(db, 'INSERT INTO sessions (id, member_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      hashToken(token), memberId, t, t, t + absolutoMs)
    return { token, maxAgeSeconds: Math.floor(absolutoMs / 1000) }
  }

  /** Devuelve el miembro dueño de la ficha, o null si no existe, venció o estuvo ociosa demasiado. */
  function lookup (token) {
    if (!token || typeof token !== 'string') return null
    const id = hashToken(token)
    const fila = get(db, `
      SELECT s.last_seen_at, s.expires_at, m.id, m.email, m.name, m.role
        FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.id = ?`, id)
    if (!fila) return null
    const t = now()
    if (fila.expires_at <= t || fila.last_seen_at + ociosoMs <= t) {
      run(db, 'DELETE FROM sessions WHERE id = ?', id)
      return null
    }
    if (t - fila.last_seen_at >= toqueMs) run(db, 'UPDATE sessions SET last_seen_at = ? WHERE id = ?', t, id)
    return { id: fila.id, email: fila.email, name: fila.name, role: fila.role }
  }

  const destroy = (token) => { if (token) run(db, 'DELETE FROM sessions WHERE id = ?', hashToken(token)) }

  /** Invalida las sesiones de un miembro (cambio de rol o de contraseña). `exceptToken` conserva la actual. */
  function destroyForMember (memberId, exceptToken = null) {
    if (exceptToken) run(db, 'DELETE FROM sessions WHERE member_id = ? AND id <> ?', memberId, hashToken(exceptToken))
    else run(db, 'DELETE FROM sessions WHERE member_id = ?', memberId)
  }

  return { create, lookup, destroy, destroyForMember }
}
