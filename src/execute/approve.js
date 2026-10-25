// The delivery of a branch that a person approved: the one rule behind `POST /messages/:id/deliver` (an Editor with the button of the API) and behind a
// reply of an Editor that asked Claude to deliver (UD-280: the session returns `review: approve` and the system, not the model, enqueues the delivery).

import { get } from '../db/index.js'
import { parseJson } from '../db/util.js'
import { conflict, notFound } from '../domain/errors.js'
import { audit } from '../domain/audit.js'
import { assertNotDiscarded } from '../domain/delivery-review.js'
import { enqueueDeliver } from './enqueue.js'

/**
 * Enqueues the `deliver` job of the message with `TEAM_REVIEWED_BY` = `requestedBy` and returns its id. `exceptJobId` is the `execute` job that is asking
 * (it is running by definition). Errors: 409 `deliver_not_configured`, `message_closed`, `execute_busy`, `delivery_discarded`, `no_agent_assignee`, `deliver_busy`.
 */
export function approveDelivery ({ db, config, events }, { messageId, requestedBy, exceptJobId = null }) {
  if (!config.execute.deliverCommand) throw conflict('Esta instancia no declara la orden de entrega a producción.', 'deliver_not_configured')
  const message = get(db, 'SELECT id, status FROM messages WHERE id = ? AND deleted_at IS NULL', messageId)
  if (!message) throw notFound('El mensaje no existe.')
  if (message.status === 'closed') throw conflict('El mensaje está cerrado. Hay que reabrirlo para entregarlo.', 'message_closed')
  if (get(db, "SELECT id FROM jobs WHERE kind = 'execute' AND message_id = ? AND status IN ('queued', 'running') AND id IS NOT ?", messageId, exceptJobId)) throw conflict('El mensaje tiene un trabajo en cola o corriendo; la entrega espera a que termine.', 'execute_busy')
  assertNotDiscarded(db, messageId)
  // The agent that answers is the one of the last job of the message; without one, the only active agent among its assignees.
  const last = get(db, "SELECT payload_json FROM jobs WHERE kind IN ('execute', 'deliver') AND message_id = ? ORDER BY id DESC LIMIT 1", messageId)
  let memberId = parseJson(last?.payload_json, {}).member_id ?? null
  if (memberId !== null && !get(db, "SELECT id FROM members WHERE id = ? AND kind = 'agent' AND active = 1", memberId)) memberId = null
  if (memberId === null) {
    memberId = get(db, `SELECT m.id FROM message_assignees a JOIN members m ON m.id = a.member_id
                        WHERE a.message_id = ? AND m.kind = 'agent' AND m.active = 1 ORDER BY m.id LIMIT 1`, messageId)?.id ?? null
  }
  if (memberId === null) throw conflict('El mensaje no tiene un agente asignado.', 'no_agent_assignee')
  // What the session said is kept by the last delivery of the message, so the reply that closes it carries the same summary.
  const kept = parseJson(get(db, "SELECT payload_json FROM jobs WHERE kind = 'deliver' AND message_id = ? AND json_extract(payload_json, '$.output') IS NOT NULL ORDER BY id DESC LIMIT 1", messageId)?.payload_json, {})
  const jobId = events.transaction(() => {
    const id = enqueueDeliver(db, {
      messageId,
      payload: {
        member_id: memberId, branch: `tp/${messageId}`, round: 0, output: kept.output ?? null,
        execute_job_id: kept.execute_job_id ?? null, execute_attempt: kept.execute_attempt ?? null, requested_by: requestedBy
      }
    })
    if (id !== null) audit(db, { memberId: requestedBy, action: 'message.deliver', entity: 'message', entityId: messageId, detail: { job_id: id } })
    return id
  })
  if (jobId === null) throw conflict('La entrega de este mensaje ya está en curso.', 'deliver_busy')
  return jobId
}
