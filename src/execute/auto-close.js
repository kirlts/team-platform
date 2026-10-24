// Claude closes the message after its final reply (UD-271, MASTER-SPEC §7.5 «Cierre por Claude»). The session asks with two fields of its structured
// output, `close` and `close_reason`; the system decides. It closes only when all of this holds, and the model cannot override any of it:
//   1. what was asked is done and checked: the delivery ended with exit 0 (the `deliver` job), or the outcome is one that needs no change (`investigated`,
//      no delivery) — never `needs_decision`, `not_mine` or `blocked`, a held, failed or exhausted delivery, nor an edited message;
//   2. nothing is left to the sender: the session said so with `close: true` (the judgement of meaning is the model's; the system reads the field);
//   3. a first reply that carried a «before» is followed by a final reply that carries at least one «after».
// And never when a person replied in the thread after the first reply of the agent in this run. The closing line is «Cerrado: <reason>» («Closed: …»).
// The caller closes with `closeMessage`, the function of `POST /api/messages/:id/close`, right after posting the reply and with the agent as the author of its `message.close` audit row.

import { get } from '../db/index.js'
import { HANDOFF_OUTCOMES } from '../domain/escalation.js'
import { hasBefore } from './captures.js'

/** Outcomes that need no delivery to be done: the check showed nothing had to change (or it was already decided). */
export const NO_CHANGE_OUTCOMES = ['investigated']
const REASON_CHARS = 300 // declared courtesy: the reason is one line of the closing reply
const LABELS = { 'es-419': 'Cerrado', en: 'Closed' }

/** What the session asked for in its output: `{ reason }` with `close: true` and a reason, else `null`. The reason is one line. */
export function closeRequest (output) {
  if (output?.close !== true || typeof output.close_reason !== 'string') return null
  const reason = output.close_reason.replace(/\s+/g, ' ').trim().slice(0, REASON_CHARS)
  return reason ? { reason } : null
}

/** The line the final reply adds: «Cerrado: <reason>» in the language of the sender. */
export const closeLine = (reason, language) => `${LABELS[language] ?? LABELS['es-419']}: ${reason}`

/**
 * When the first reply of this run was posted: the first reply of the agent at or after `from` (the creation of the job), else `from`. A person's reply
 * after this moment means the sender is already in the conversation.
 */
export function firstReplyAnchor (db, { messageId, agentId, from }) {
  return get(db, 'SELECT MIN(created_at) AS at FROM replies WHERE message_id = ? AND author_id = ? AND created_at >= ? AND deleted_at IS NULL', messageId, agentId, from)?.at ?? from
}

/** Whether a person (the sender or anyone else, not the agent) replied in the thread after `since`. */
export function personRepliedSince (db, { messageId, agentId, since }) {
  return Boolean(get(db, `SELECT 1 AS ok FROM replies r JOIN members m ON m.id = r.author_id
                           WHERE r.message_id = ? AND r.author_id <> ? AND m.kind = 'person' AND r.created_at > ? AND r.deleted_at IS NULL LIMIT 1`, messageId, agentId, since))
}

/**
 * The reason to close, or `null` when the message stays open. `delivered`: the delivery ended with exit 0. `after`: how many «after» captures the final
 * reply carries. `since`: the anchor of `firstReplyAnchor` (it travels with the delivery).
 */
export function closeReason (db, config, { output, request, delivered, messageId, agentId, after, since }) {
  if (!config.execute.autoClose || !request) return null
  if (HANDOFF_OUTCOMES.includes(output?.outcome)) return null
  if (!delivered && !NO_CHANGE_OUTCOMES.includes(output?.outcome)) return null
  if (hasBefore(db, { messageId, authorId: agentId }) && after < 1) return null
  if (personRepliedSince(db, { messageId, agentId, since })) return null
  return request.reason
}
