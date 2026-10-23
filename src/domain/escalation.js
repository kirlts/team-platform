// Handing a message over to a person (UD-269, MASTER-SPEC §7.5 «Traspaso a una persona»). When an unattended session ends with
// `needs_decision` or `not_mine`, or its delivery is held for review, the message must reach a person's tray: the agent leaves the
// assignees, the person who decides in the area joins them, the message goes back to `open` and the reply of the agent is a question
// to that person. The decision comes from the structured field of the result, never from reading its text (RULES 4).

import { all, get, run } from '../db/index.js'
import { audit } from './audit.js'
import { addReply } from './messages.js'

/** The outcomes of the structured result that hand the message to a person. A held delivery does the same, by exit code 76 (UD-266). */
export const HANDOFF_OUTCOMES = ['needs_decision', 'not_mine']

/** Reply kind of the question to the person: the platform has no `question` kind, `clarification` is the one that exists. */
export const HANDOFF_REPLY_KIND = 'clarification'

const firstEditor = (db) => get(db, "SELECT id FROM members WHERE role = 'editor' AND kind = 'person' AND active = 1 ORDER BY id LIMIT 1")?.id ?? null
const isActivePerson = (db, id) => id !== null && id !== undefined && Boolean(get(db, "SELECT 1 AS ok FROM members WHERE id = ? AND kind = 'person' AND active = 1", id))

/**
 * Who decides in the area: the member the area names while that member is an active person; else the first active Editor; else the
 * sender of the message when it is an active person; else nobody (`null`, and the invariant `buriedHandoffs` shows it).
 */
export function deciderOf (db, areaId, authorId = null) {
  const named = get(db, 'SELECT escalation_member_id AS id FROM areas WHERE id = ?', areaId)?.id ?? null
  if (isActivePerson(db, named)) return named
  return firstEditor(db) ?? (isActivePerson(db, authorId) ? authorId : null)
}

/**
 * Posts `body` as the agent's question to the person who decides and hands the message over, in one transaction: reply of kind
 * `clarification`, agent out of the assignees, person in, status back to `open`, one `message.escalate` audit row, and a notice to the
 * person. Returns `{ replyId, personId }`; with nobody to hand it to (`personId` null) only the reply is posted.
 */
export function handOffToPerson ({ db, events, now = Date.now }, { messageId, agentId, body, files = [], source }) {
  return events.transaction(() => {
    const message = get(db, 'SELECT id, area_id, author_id, title, input_id FROM messages WHERE id = ? AND deleted_at IS NULL', messageId)
    const { replyId } = addReply({ db, events, now }, { messageId, authorId: agentId, kind: HANDOFF_REPLY_KIND, body, files })
    const personId = message ? deciderOf(db, message.area_id, message.author_id) : null
    if (personId === null) return { replyId, personId }
    run(db, 'DELETE FROM message_assignees WHERE message_id = ? AND member_id = ?', messageId, agentId)
    run(db, 'INSERT OR IGNORE INTO message_assignees (message_id, member_id) VALUES (?, ?)', messageId, personId)
    run(db, "UPDATE messages SET status = 'open', updated_at = ? WHERE id = ?", now(), messageId)
    audit(db, { memberId: agentId, action: 'message.escalate', entity: 'message', entityId: messageId, detail: { to: personId, source, reply_id: replyId }, now })
    events.publish({ kind: 'message', memberId: personId, data: { message_id: messageId, title: message.title, author_id: agentId, input_id: message.input_id, reason: 'assigned' } })
    return { replyId, personId }
  })
}

/**
 * The invariant: messages whose latest result from the agent is `needs_decision`, `not_mine` or a delivery held for review, that are
 * not closed or deleted and have no person assigned. It must be empty. A message with a queued or running `execute` or `deliver` job is
 * not counted: someone has just asked the agent again and its new result is on the way. Result of an attempt that failed or was aborted
 * is not a result.
 */
export function buriedHandoffs (db) {
  return all(db, `
    SELECT m.id AS message_id, CASE WHEN r.delivery_held = 1 THEN 'delivery_held' ELSE r.outcome END AS result
      FROM messages m
      JOIN execute_runs r ON r.id = (
             SELECT x.id FROM execute_runs x
              WHERE x.message_id = m.id AND x.outcome IS NOT NULL AND x.outcome NOT IN ('aborted', 'failed')
              ORDER BY x.started_at DESC, x.id DESC LIMIT 1)
     WHERE m.deleted_at IS NULL AND m.status <> 'closed'
       AND (r.outcome IN (${HANDOFF_OUTCOMES.map((o) => `'${o}'`).join(', ')}) OR r.delivery_held = 1)
       AND NOT EXISTS (SELECT 1 FROM message_assignees x JOIN members p ON p.id = x.member_id WHERE x.message_id = m.id AND p.kind = 'person')
       AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.message_id = m.id AND j.kind IN ('execute', 'deliver') AND j.status IN ('queued', 'running'))
     ORDER BY m.id`)
}
