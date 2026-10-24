// Forwarding a message to a member (UD-272, MASTER-SPEC §7.1 «Reenviar»). The same message gets one more assignee: no new message. The thread
// gets a reply of kind `forward` (author: who forwards; `forwarded_to`: the recipient; body: the reason they wrote, which is required). When the
// recipient is an agent member, its `execute` job is enqueued for the same message with the forward as context (src/execute/prompt.js).
// A closed message is not forwarded (409 `message_closed`, as `execute` does): reopening is a decision of a person, not a side effect of a forward.

import { get, run } from '../db/index.js'
import { audit } from './audit.js'
import { badRequest, conflict, notFound } from './errors.js'
import { getMessage } from './messages.js'
import { enqueueExecute } from '../execute/enqueue.js'

/** The reply kind of the notice in the thread. */
export const FORWARD_KIND = 'forward'

/**
 * Forwards `messageId` from `actor` to the active member `memberId` with the required `comment`. Returns `{ message, replyId, jobId }` (`jobId` is
 * null unless the recipient is an agent). Everything happens in one transaction: nothing is left half done when the agent already has a job.
 */
export function forwardMessage ({ db, events, now = Date.now }, { messageId, actor, memberId, comment }) {
  const reason = typeof comment === 'string' ? comment.trim() : ''
  if (reason === '') throw badRequest('Falta el motivo del reenvío.', 'forward_comment_required')
  const { replyId, jobId } = events.transaction(() => {
    const message = get(db, 'SELECT id, status, title, input_id FROM messages WHERE id = ? AND deleted_at IS NULL', messageId)
    if (!message) throw notFound('El mensaje no existe.')
    if (message.status === 'closed') throw conflict('El mensaje está cerrado. Hay que reabrirlo para reenviarlo.', 'message_closed')
    const to = get(db, 'SELECT id, kind, active FROM members WHERE id = ?', memberId)
    if (!to) throw notFound('El miembro no existe.')
    if (to.id === actor.id) throw badRequest('Un mensaje no se reenvía a quien lo reenvía.', 'forward_to_self')
    if (to.active !== 1) throw badRequest('El miembro está desactivado.', 'assignee_inactive')
    const t = now()
    const id = Number(run(db, "INSERT INTO replies (message_id, author_id, body, kind, created_at, forwarded_to) VALUES (?, ?, ?, 'forward', ?, ?)", messageId, actor.id, reason, t, to.id).lastInsertRowid)
    const added = run(db, 'INSERT OR IGNORE INTO message_assignees (message_id, member_id) VALUES (?, ?)', messageId, to.id).changes > 0
    // Whoever receives it has it waiting: an answered message goes back to `open` for the new assignee, as a handoff does (UD-269).
    run(db, "UPDATE messages SET status = 'open', updated_at = ? WHERE id = ?", t, messageId)
    let job = null
    if (to.kind === 'agent') {
      job = enqueueExecute(db, { messageId, memberId: to.id, requestedBy: actor.id, now, extra: { forward: { reply_id: id, by: actor.id } } })
      if (job === null) throw conflict('El agente ya tiene un trabajo en cola o corriendo para este mensaje.', 'execute_busy')
    } else if (added) {
      events.publish({ kind: 'message', memberId: to.id, data: { message_id: messageId, title: message.title, author_id: actor.id, input_id: message.input_id, reason: 'assigned' } })
    }
    audit(db, { memberId: actor.id, action: 'message.forward', entity: 'message', entityId: messageId, detail: { to: to.id, reply_id: id, job_id: job }, now })
    return { replyId: id, jobId: job }
  })
  return { message: getMessage(db, messageId), replyId, jobId }
}
