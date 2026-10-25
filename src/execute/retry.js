// Retry a session that failed (UD-282). The notice of a failure («Claude no pudo responder: …») carries the `execute` job that failed
// (`replies.failed_job_id`); retrying enqueues a new job with the same origin: the same message and agent and the same `mention`, `forward` or delivery
// context in the payload, so the session reads the same thread, files and voice notes again. Nothing here reads text (RULES 4).

import { get, run } from '../db/index.js'
import { parseJson } from '../db/util.js'
import { audit } from '../domain/audit.js'
import { conflict, notFound } from '../domain/errors.js'
import { resolveExecuteModel } from '../domain/execute-models.js'
import { assertNotDiscarded } from '../domain/delivery-review.js'
import { enqueueExecute } from './enqueue.js'
import { approveDelivery } from './approve.js'
import { dailyBudget } from './budget.js'

// The causes a second try cannot fix: the output did not fit its format, or the agent cannot start (its configuration, the host's). Every other code is a limit
// (steps, time, spend per message) or a service (model, machine, lease): one more try may end well.
const NOT_RETRYABLE = ['invalid_output', 'execute_flag_rejected', 'account_inactive', 'agent_secret_missing', 'not_an_agent', 'template', 'host_instructions_missing', 'harness_unavailable']

// What each database knows of the day's cap: the routes register it with the configuration (`watchBudget`); without it the cap is not read.
const budgets = new WeakMap()
const deliverables = new WeakMap()
export function watchBudget (db, config, now = Date.now) {
  budgets.set(db, () => dailyBudget(db, config.execute, now()).remaining > 0)
  deliverables.set(db, () => Boolean(config.execute.deliverCommand))
}

// What is not origin: who and where are columns of the new job, and the notice of the spending cap belongs to one run.
// The acknowledgement belongs to one run too: a retry posts its own. `retry_after_reply_id` is the notice it answers: the agent's replies up to it (the old
// acknowledgement, the notice itself) do not answer the mention again.
const NOT_ORIGIN = ['message_id', 'member_id', 'requested_by', 'budget_notice', 'ack_reply_id', 'retry_after_reply_id']

/**
 * Why the notice `reply` can or cannot be retried, as a conflict `{ code, message }` or `null` when it can. The failed job must be the latest `execute` job of
 * the agent on the message: a newer one (queued, running or finished) already took its place.
 */
export function retryBlock (db, reply) {
  if (!reply || reply.failed_job_id === null || reply.failed_job_id === undefined || reply.deleted_at !== null) return { code: 'not_a_failure', message: 'Esa respuesta no avisa de un trabajo fallido.' }
  const job = get(db, "SELECT id, kind, status, payload_json FROM jobs WHERE id = ? AND kind IN ('execute', 'deliver')", reply.failed_job_id)
  if (!job || job.status !== 'failed') return { code: 'not_a_failure', message: 'Ese trabajo no está fallido.' }
  const deliver = job.kind === 'deliver' // UD-289: a failed delivery is retried by the same rule, with the delivery command and no model
  const memberId = parseJson(job.payload_json, {}).member_id
  // The last `execute` job of the message (for a delivery, the last of either kind), whoever it was for, or one already queued or running, takes the place of this one.
  if (get(db, `SELECT id FROM jobs WHERE kind IN (${deliver ? "'execute', 'deliver'" : "'execute'"}) AND message_id = ? AND id > ?`, reply.message_id, job.id)) {
    return { code: 'retry_stale', message: 'Ya hay un intento posterior de este trabajo.' }
  }
  if (!deliver && NOT_RETRYABLE.includes(reply.failed_code)) return { code: 'not_retryable', message: 'Ese fallo no se arregla con otro intento.' }
  if (!deliver && budgets.get(db)?.() === false) return { code: 'budget_spent', message: 'Se alcanzó el tope de gasto de hoy.' }
  const message = get(db, 'SELECT status FROM messages WHERE id = ? AND deleted_at IS NULL', reply.message_id)
  if (!message) return { code: 'not_found', message: 'El mensaje no existe.' }
  if (deliver && deliverables.get(db)?.() === false) return { code: 'deliver_not_configured', message: 'Esta instancia no declara la orden de entrega a producción.' }
  if (get(db, "SELECT id FROM jobs WHERE kind = 'deliver' AND message_id = ? AND status IN ('queued', 'running')", reply.message_id)) return { code: 'execute_busy', message: 'El mensaje tiene una entrega en curso.' }
  if (message.status === 'closed') return { code: 'message_closed', message: 'El mensaje está cerrado. Hay que reabrirlo para trabajarlo.' }
  if (deliver) { try { assertNotDiscarded(db, reply.message_id) } catch { return { code: 'delivery_discarded', message: 'La rama de este mensaje se descartó y no se entrega.' } } }
  if (!get(db, "SELECT id FROM members WHERE id = ? AND kind = 'agent' AND active = 1", memberId)) return { code: 'not_an_agent', message: 'El miembro no es un agente activo.' }
  return null
}

/** The ids of `replies` (rows with `failed_job_id`) that can be retried now: what the panel draws as «Reintentar». */
export function retryableIds (db, rows) {
  return new Set(rows.filter((r) => r.failed_job_id !== null && r.failed_job_id !== undefined && retryBlock(db, r) === null).map((r) => r.id))
}

/** The ids of `replies` whose retry (`replaced_by_job_id`) is still queued or running: the thread draws them as «Reintentando» (UD-290). */
export function retryingIds (db, rows) {
  return new Set(rows.filter((r) => r.replaced_by_job_id !== null && r.replaced_by_job_id !== undefined && get(db, "SELECT id FROM jobs WHERE id = ? AND status IN ('queued', 'running')", r.replaced_by_job_id)).map((r) => r.id))
}

/**
 * Launches again the job whose failure `replyId` tells. Anyone who can mention the agent can (a member). Audited as `message.execute_retry`. Returns the job id.
 * 404 when the reply is not in the message; 409 `not_a_failure`, `not_retryable`, `budget_spent`, `retry_stale`, `message_closed`, `not_an_agent`, and `execute_busy` when the agent already has a
 * job queued or running for the message (or a delivery of it), so a second click enqueues nothing. With the day's cap spent it is refused (409 `budget_spent`), and the thread does not offer it.
 */
export function retryExecute ({ db, config, events, now = Date.now }, { messageId, replyId, actor }) {
  return events.transaction(() => {
    const reply = get(db, 'SELECT id, message_id, failed_job_id, failed_code, deleted_at FROM replies WHERE id = ? AND message_id = ?', replyId, messageId)
    if (!reply) throw notFound('La respuesta no existe.')
    const block = retryBlock(db, reply)
    if (block) throw conflict(block.message, block.code)
    const failed = get(db, 'SELECT kind, payload_json FROM jobs WHERE id = ?', reply.failed_job_id)
    if (failed.kind === 'deliver') { // UD-289
      const deliverJobId = approveDelivery({ db, config, events }, { messageId, requestedBy: actor.id })
      run(db, 'UPDATE replies SET replaced_by_job_id = ? WHERE id = ?', deliverJobId, replyId)
      audit(db, { memberId: actor.id, action: 'message.deliver_retry', entity: 'message', entityId: messageId, detail: { reply_id: replyId, failed_job_id: reply.failed_job_id, job_id: deliverJobId }, now })
      return deliverJobId
    }
    const payload = parseJson(failed.payload_json, {})
    const extra = Object.fromEntries(Object.entries(payload).filter(([k]) => !NOT_ORIGIN.includes(k)))
    extra.retry_after_reply_id = reply.id
    // UD-295: a session that failed on the lighter model of the area is not tried on it again: the retry runs with the area's model.
    const failedModel = get(db, 'SELECT model FROM jobs WHERE id = ?', reply.failed_job_id)?.model ?? null
    if (failedModel && failedModel !== resolveExecuteModel(db, { messageId, fallback: config.execute.model, escalated: true }).model) extra.escalated = true
    else delete extra.escalated
    const jobId = enqueueExecute(db, { messageId, memberId: payload.member_id, requestedBy: actor.id, now, extra })
    if (jobId === null) throw conflict('El agente ya tiene un trabajo en cola o corriendo para este mensaje.', 'execute_busy')
    // A failed run handed the message to a person: the agent works it again as a mention does, so it is among the assignees.
    run(db, 'INSERT OR IGNORE INTO message_assignees (message_id, member_id) VALUES (?, ?)', messageId, payload.member_id)
    run(db, 'UPDATE replies SET replaced_by_job_id = ? WHERE id = ?', jobId, replyId) // UD-290: the notice stays, marked as replaced by this job
    audit(db, { memberId: actor.id, action: 'message.execute_retry', entity: 'message', entityId: messageId, detail: { reply_id: replyId, failed_job_id: reply.failed_job_id, job_id: jobId }, now })
    return jobId
  })
}
