// Bitácora de cambios (GET /audit, sólo el editor): quién creó, publicó, cerró, reabrió o editó áreas y
// plantillas, y cuándo. Se escribe dentro de la misma transacción que el cambio, así que no hay cambio sin
// registro ni registro sin cambio.

import { all, get, run } from '../db/index.js'
import { iso, parseJson } from '../db/util.js'

export function audit (db, { memberId = null, action, entity, entityId = null, detail = null, now = Date.now }) {
  run(db, 'INSERT INTO audit_log (at, member_id, action, entity, entity_id, detail_json) VALUES (?, ?, ?, ?, ?, ?)',
    now(), memberId, action, entity, entityId, detail === null ? null : JSON.stringify(detail))
}

export function listAudit (db, { limit, offset, entity = null, action = null }) {
  const scope = []
  const params = []
  if (entity) { scope.push('a.entity = ?'); params.push(entity) }
  if (action) { scope.push('a.action = ?'); params.push(action) }
  const cond = scope.length ? `WHERE ${scope.join(' AND ')}` : ''
  const total = get(db, `SELECT COUNT(*) AS n FROM audit_log a ${cond}`, ...params).n
  const rows = all(db, `
    SELECT a.*, m.name AS member_name FROM audit_log a LEFT JOIN members m ON m.id = a.member_id
     ${cond} ORDER BY a.at DESC, a.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset)
  return {
    total,
    items: rows.map((f) => ({
      id: f.id, at: iso(f.at), member_id: f.member_id, member_name: f.member_name,
      action: f.action, entity: f.entity, entity_id: f.entity_id, detail: parseJson(f.detail_json, null)
    }))
  }
}
