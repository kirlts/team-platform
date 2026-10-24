// A mention that arrives while the agent's session runs the message (UD-285, MASTER-SPEC §7.5 «Menciones»). Until now such a mention stayed pending and the end of
// the session enqueued another one (`attendPendingMentions`). Now the session takes it at its next step: a hook of Claude Code that runs after every batch of tools
// calls `team mentions`, which calls this. What is taken is marked in the same transaction (`pending = 0`, `job_id` = the running job, `live_at`), so the end of the
// session does not open a second job for it, and the thread gets one fixed line in the agent's name saying it was received.
//
// The platform reads no text to decide anything: which replies are taken comes from `reply_mentions` (the members picked when the reply was written).

import { all, get, run } from '../db/index.js'
import { iso } from '../db/util.js'
import { readingTranscripts } from './reply-extract.js'
import { addReply } from './messages.js'

// The line of the thread when the running session took a mention: the agent's, in the language of the person who sent the message.
const LIVE_ACK_TEXTS = {
  'es-419': 'Recibido. Lo tomo en cuenta en lo que estoy haciendo.',
  en: 'Received. I am taking it into account in what I am doing.'
}

/**
 * Takes the pending mentions of `job`'s agent in `job`'s message and returns them as the session needs them:
 * `[{ reply_id, by, at, body, attachments: [{ id, kind, name, mime, size, link? , transcript }] }]`, oldest first. Empty when there is nothing new (one indexed query).
 * A mention whose reply was deleted, whose message closed or whose agent was deactivated is left for `attendPendingMentions` to drop; while the speech of the thread
 * is still being read (UD-279) nothing is taken, so a voice note arrives as text on a later step or, at the latest, in the job that follows the session.
 */
export function takeLiveMentions ({ db, events, now = Date.now }, { jobId, messageId, agentId }) {
  const probe = get(db, `SELECT 1 AS ok FROM reply_mentions rm JOIN replies r ON r.id = rm.reply_id
                          WHERE rm.pending = 1 AND rm.member_id = ? AND r.message_id = ? LIMIT 1`, agentId, messageId)
  if (!probe) return []
  if (readingTranscripts(db, messageId)) return []
  let taken = []
  events.transaction(() => {
    const rows = all(db, `
      SELECT rm.reply_id, r.body, r.created_at, p.name AS by_name
        FROM reply_mentions rm
        JOIN replies r ON r.id = rm.reply_id AND r.deleted_at IS NULL
        JOIN messages m ON m.id = r.message_id AND m.deleted_at IS NULL AND m.status != 'closed'
        JOIN members a ON a.id = rm.member_id AND a.active = 1
        JOIN members p ON p.id = r.author_id
       WHERE rm.pending = 1 AND rm.member_id = ? AND r.message_id = ?
       ORDER BY rm.reply_id`, agentId, messageId)
    if (rows.length === 0) return
    const files = all(db, `SELECT id, reply_id, kind, name, path, mime, size, extracted_text FROM reply_attachments
                            WHERE reply_id IN (${rows.map(() => '?').join(',')}) ORDER BY reply_id, position, id`, ...rows.map((r) => r.reply_id))
    taken = rows.map((r) => ({
      reply_id: r.reply_id, by: r.by_name, at: iso(r.created_at), body: r.body.trim(),
      attachments: files.filter((f) => f.reply_id === r.reply_id).map((f) => ({
        id: f.id, kind: f.kind, name: f.name, mime: f.mime, size: f.size, ...(f.kind === 'link' ? { link: f.path } : {}),
        transcript: f.extracted_text && f.extracted_text.trim() ? f.extracted_text.trim() : null // UD-279: what was said in the audio or video of the reply
      }))
    }))
    const language = get(db, 'SELECT a.language FROM messages m JOIN members a ON a.id = m.author_id WHERE m.id = ?', messageId)?.language
    const { replyId: ack } = addReply({ db, events, now }, { messageId, authorId: agentId, kind: 'answer', body: LIVE_ACK_TEXTS[language] ?? LIVE_ACK_TEXTS['es-419'] })
    for (const r of rows) run(db, 'UPDATE reply_mentions SET pending = 0, job_id = ?, live_at = ?, live_ack_reply_id = ? WHERE reply_id = ? AND member_id = ?', jobId, now(), ack, r.reply_id, agentId)
  })
  return taken
}
