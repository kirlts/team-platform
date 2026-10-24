// Mentions in a reply (UD-278, MASTER-SPEC §7.1 «Menciones»). A reply carries `mention_ids`: the members the person picked from the list the panel
// offers when they typed «@». The list is data: nothing here reads the text of the reply to find a name (RULES 4).
//
// What a mention does, all in the transaction that stores the reply:
//   - the mentioned member joins the assignees of the message (the thread is now associated with their account);
//   - a person gets a notice (the event the bell already listens to, `reason: 'mention'`);
//   - an agent gets its `execute` job on the same message, with `mention: { reply_id, by }` in the payload. An agent that is already working
//     the message keeps the mention as pending (`reply_mentions.pending`) and the end of that work attends it in a following run: it is not lost;
//   - one `message.mention` row in the audit log per mention.

import { all, get, run } from '../db/index.js'
import { audit } from './audit.js'
import { badRequest, notFound } from './errors.js'
import { enqueueExecute } from '../execute/enqueue.js'
import { readingTranscripts } from './reply-extract.js'

/**
 * Checks `ids` (the members picked in the list) for a reply by `authorId`. Returns the distinct members as `[{ id, kind, name }]` in the order picked.
 * 404 when a member does not exist; 400 `assignee_inactive` when one is deactivated, 400 `mention_self` when it is the author, and 400 `mention_loop`
 * when an agent mentions an agent (two agents would call each other without a person in between).
 */
export function checkMentions (db, { authorId, ids }) {
  const author = get(db, 'SELECT id, kind FROM members WHERE id = ?', authorId)
  const out = []
  for (const raw of ids ?? []) {
    const id = Number(raw)
    if (out.some((m) => m.id === id)) continue
    const to = get(db, 'SELECT id, kind, active, name FROM members WHERE id = ?', id)
    if (!to) throw notFound('El miembro mencionado no existe.')
    if (to.id === authorId) throw badRequest('Una respuesta no menciona a quien la escribe.', 'mention_self')
    if (to.active !== 1) throw badRequest('El miembro mencionado está desactivado.', 'assignee_inactive')
    if (author?.kind === 'agent' && to.kind === 'agent') throw badRequest('Un agente no menciona a otro agente.', 'mention_loop')
    out.push({ id: to.id, kind: to.kind, name: to.name })
  }
  return out
}

/**
 * Stores the mentions of the reply `replyId` and applies their effects. Call it inside the transaction of the reply. `mentions` comes from `checkMentions`.
 * Returns `[{ member_id, job_id }]` (`job_id` is null for a person and for an agent whose mention is pending).
 */
export function recordMentions ({ db, events, now = Date.now }, { messageId, replyId, authorId, mentions }) {
  if (mentions.length === 0) return []
  const message = get(db, 'SELECT id, title, input_id FROM messages WHERE id = ?', messageId)
  for (const m of mentions) {
    run(db, 'INSERT INTO reply_mentions (reply_id, member_id, pending) VALUES (?, ?, ?)', replyId, m.id, m.kind === 'agent' ? 1 : 0)
    run(db, 'INSERT OR IGNORE INTO message_assignees (message_id, member_id) VALUES (?, ?)', messageId, m.id)
    if (m.kind === 'person') {
      events.publish({ kind: 'message', memberId: m.id, data: { message_id: messageId, title: message.title, author_id: authorId, input_id: message.input_id, reason: 'mention', reply_id: replyId } })
    }
  }
  attendPendingMentions(db, { now, messageId })
  const rows = all(db, `SELECT member_id, job_id FROM reply_mentions WHERE reply_id = ? AND member_id IN (${mentions.map(() => '?').join(',')}) ORDER BY rowid`, replyId, ...mentions.map((m) => m.id))
  for (const r of rows) {
    audit(db, { memberId: authorId, action: 'message.mention', entity: 'message', entityId: messageId, detail: { member: r.member_id, reply_id: replyId, job_id: r.job_id }, now })
  }
  return rows.map((r) => ({ member_id: r.member_id, job_id: r.job_id }))
}

/**
 * Enqueues the `execute` job of every agent with pending mentions (of one message, or of all). One job per message and agent carries all the pending
 * replies: `mention.reply_id` is the latest and `mention.earlier` the ones before it. An agent that already has a job in the queue or running for the
 * message (or a delivery of it), or while the speech of an audio or video of the thread is still being read (UD-279), keeps them pending: the end of that work calls this again (`worker.js`). A mention whose reply was deleted, whose message was
 * closed or deleted, or whose agent was deactivated has nothing to attend and stops being pending. The agent joins the assignees again: a mention is
 * an explicit call, also after a failed run handed the message to a person. Returns the ids of the jobs enqueued.
 */
export function attendPendingMentions (db, { now = Date.now, messageId = null } = {}) {
  const rows = all(db, `
    SELECT rm.reply_id, rm.member_id, r.message_id, r.author_id, r.deleted_at AS reply_deleted, m.deleted_at AS message_deleted, m.status, a.active
      FROM reply_mentions rm
      JOIN replies r ON r.id = rm.reply_id
      JOIN messages m ON m.id = r.message_id
      JOIN members a ON a.id = rm.member_id
     WHERE rm.pending = 1 ${messageId === null ? '' : 'AND r.message_id = ?'}
     ORDER BY rm.reply_id`, ...(messageId === null ? [] : [messageId]))
  const groups = new Map()
  for (const r of rows) {
    const key = `${r.message_id}:${r.member_id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const jobs = []
  for (const group of groups.values()) {
    const { message_id: mId, member_id: agentId } = group[0]
    const stale = (r) => r.reply_deleted !== null || r.message_deleted !== null || r.status === 'closed' || r.active !== 1
    for (const r of group.filter(stale)) run(db, 'UPDATE reply_mentions SET pending = 0 WHERE reply_id = ? AND member_id = ?', r.reply_id, r.member_id)
    const live = group.filter((r) => !stale(r))
    if (live.length === 0) continue
    if (readingTranscripts(db, mId)) continue // UD-279: the agent starts when the speech of the thread is text; the end of that reading calls this again
    const last = live.at(-1)
    run(db, 'INSERT OR IGNORE INTO message_assignees (message_id, member_id) VALUES (?, ?)', mId, agentId)
    const earlier = live.slice(0, -1).map((r) => r.reply_id)
    const job = enqueueExecute(db, { messageId: mId, memberId: agentId, requestedBy: last.author_id, now, extra: { mention: { reply_id: last.reply_id, by: last.author_id, ...(earlier.length ? { earlier } : {}) } } })
    if (job === null) continue
    for (const r of live) run(db, 'UPDATE reply_mentions SET pending = 0, job_id = ? WHERE reply_id = ? AND member_id = ?', job, r.reply_id, r.member_id)
    jobs.push(job)
  }
  return jobs
}

/** The members a reply mentions, by reply id: `Map<replyId, memberId[]>`. */
export function mentionsOf (db, replyIds) {
  const table = new Map()
  if (replyIds.length === 0) return table
  const rows = all(db, `SELECT reply_id, member_id FROM reply_mentions WHERE reply_id IN (${replyIds.map(() => '?').join(',')}) ORDER BY reply_id, rowid`, ...replyIds)
  for (const r of rows) {
    if (!table.has(r.reply_id)) table.set(r.reply_id, [])
    table.get(r.reply_id).push(r.member_id)
  }
  return table
}

/**
 * Whether `agentId` has answered the mention in `replyId`: a live reply of the agent in the same message after it. This is the guarantee of UD-278: a mention
 * of an agent always gets at least one reply from it, and the failure path checks it before giving up. `exceptReplyId` leaves out the acknowledgement
 * the system posted itself when the session started: it does not count as the answer.
 */
export function mentionAnswered (db, { messageId, agentId, replyId, exceptReplyId = 0 }) {
  return Boolean(get(db, 'SELECT 1 AS ok FROM replies WHERE message_id = ? AND author_id = ? AND id > ? AND id != ? AND deleted_at IS NULL LIMIT 1', messageId, agentId, replyId, exceptReplyId))
}
