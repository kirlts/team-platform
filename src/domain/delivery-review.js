// The review of a held delivery (UD-275, MASTER-SPEC §7.5 «Revisión de una entrega retenida»). A delivery that exits 76 leaves the branch
// `tp/<id>` waiting for a person. The message view exposes it as `pending_delivery` while the latest run of the message ended held, nobody
// discarded it and no session is working the message; the person delivers it (`POST /messages/:id/deliver`), asks for changes in the thread
// or discards it here.

import { get, run } from '../db/index.js'
import { audit } from './audit.js'
import { conflict, notFound } from './errors.js'

/** The latest run of the message that reached a result (the same rule as `buriedHandoffs`). */
const LATEST_RUN = `SELECT * FROM execute_runs x WHERE x.message_id = ? AND x.outcome IS NOT NULL AND x.outcome NOT IN ('aborted', 'failed') AND x.review_answered IS NOT 1
                     ORDER BY x.started_at DESC, x.id DESC LIMIT 1`

/**
 * `{ branch, held_reason, job_id, agent_id, delivering_job_id }` while a held delivery waits for a person, else null. `job_id` is the `execute`
 * job that wrote the branch; `delivering_job_id` the `deliver` job that is queued or running after a person approved it (the review stays
 * visible while it runs, to show its progress, and disappears when the delivery succeeds).
 */
export function pendingDelivery (db, messageId, { exceptJobId = null } = {}) {
  const message = get(db, 'SELECT status FROM messages WHERE id = ? AND deleted_at IS NULL', messageId)
  if (!message || message.status === 'closed') return null
  const latest = get(db, LATEST_RUN, messageId)
  if (!latest || latest.delivery_held !== 1 || latest.delivery_discarded_at !== null) return null
  // `exceptJobId`: the session that was called to answer the review is itself a running `execute` job, and it must still see what it was called about.
  if (get(db, "SELECT id FROM jobs WHERE message_id = ? AND kind = 'execute' AND status IN ('queued', 'running') AND id IS NOT ?", messageId, exceptJobId)) return null
  const delivering = get(db, "SELECT id FROM jobs WHERE message_id = ? AND kind = 'deliver' AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1", messageId)
  const executeJob = get(db, 'SELECT payload_json FROM jobs WHERE id = ?', latest.job_id)
  let agentId = null
  try { agentId = JSON.parse(executeJob?.payload_json ?? '{}').member_id ?? null } catch { /* the agent is a courtesy of the view */ }
  return {
    branch: `tp/${messageId}`,
    held_reason: latest.delivery_hold_reason ?? '',
    job_id: String(latest.job_id),
    agent_id: agentId === null ? null : String(agentId),
    delivering_job_id: delivering ? String(delivering.id) : null
  }
}

/**
 * A person discards the held branch: it is never delivered. The run keeps who and when, the thread gets the notice «Descartado por <name>: <reason>»
 * and the message stays open. 409 `no_pending_delivery` without a held review, 409 `deliver_busy` while a delivery of it runs.
 */
export function discardDelivery ({ db, events, now = Date.now }, { messageId, memberId, reason, exceptJobId = null }) {
  return events.transaction(() => {
    if (!get(db, 'SELECT id FROM messages WHERE id = ? AND deleted_at IS NULL', messageId)) throw notFound('El mensaje no existe.')
    const pending = pendingDelivery(db, messageId, { exceptJobId })
    if (!pending) throw conflict('El mensaje no tiene una entrega esperando revisión.', 'no_pending_delivery')
    if (pending.delivering_job_id) throw conflict('La entrega de este mensaje ya está en curso.', 'deliver_busy')
    const t = now()
    run(db, 'UPDATE execute_runs SET delivery_discarded_at = ?, delivery_discarded_by = ? WHERE job_id = ? AND delivery_held = 1', t, memberId, pending.job_id)
    const name = get(db, 'SELECT name FROM members WHERE id = ?', memberId)?.name ?? ''
    // A notice of the system in the thread, signed by the person who discarded; it does not change the state of the message (it stays open).
    const r = run(db, "INSERT INTO replies (message_id, author_id, body, kind, created_at) VALUES (?, ?, ?, 'answer', ?)", messageId, memberId, `Descartado por ${name}: ${reason.trim()}`, t)
    run(db, "UPDATE messages SET status = 'open', updated_at = ? WHERE id = ?", t, messageId)
    audit(db, { memberId, action: 'message.delivery_discard', entity: 'message', entityId: messageId, detail: { job_id: pending.job_id, reply_id: Number(r.lastInsertRowid), reason: reason.trim() }, now })
    return { replyId: Number(r.lastInsertRowid) }
  })
}

/** 409 `delivery_discarded` when the latest result of the message is a branch a person discarded: it is never delivered (a new run clears it). */
export function assertNotDiscarded (db, messageId) {
  const latest = get(db, LATEST_RUN, messageId)
  if (latest && latest.delivery_discarded_at !== null) throw conflict('La rama de este mensaje se descartó y no se entrega.', 'delivery_discarded')
}
