// The transcript of the audio and video attached to a reply (UD-277). A reply is stored and served, never analyzed; the only thing the platform reads from
// it is the speech of its audio and video, so a person can answer by talking and an agent called by a mention receives that speech as text. It is the
// `extract` job of the pipeline with `reply_attachment_id` in its payload (same extractors, same providers, same hourly audio budget as the files of a
// send), enqueued in the transaction of the reply and never in the way of sending it.

import { get, run } from '../db/index.js'
import { jobDefaults, queueWake } from '../queue/wake.js'
import { traceContextFor } from '../queue/trace-context.js'

/** The media whose speech is read. Images and documents of a reply are only stored. */
export const SPOKEN_KINDS = ['audio', 'video']

/** Enqueues the `extract` job of one attachment of a reply. The job carries the message id: the agent called by a mention waits for it (`attendPendingMentions`). */
export function enqueueReplyExtract (db, { messageId, replyAttachmentId, now = Date.now }) {
  const t = now()
  const tc = traceContextFor(db, { kind: 'extract', messageId })
  const r = run(db, `INSERT INTO jobs (kind, message_id, payload_json, status, priority, attempts, max_attempts, run_at, created_at, trace_id, traceparent, link_traceparent)
                     VALUES ('extract', ?, ?, 'queued', 0, 0, ?, ?, ?, ?, ?, ?)`,
  messageId, JSON.stringify({ reply_attachment_id: replyAttachmentId, message_id: messageId }), jobDefaults.extractMaxAttempts, t, t, tc.traceId, tc.traceparent, tc.link)
  const id = Number(r.lastInsertRowid)
  queueMicrotask(() => queueWake.emit('enqueued', id))
  return id
}

/** Whether a transcript of the message is still being read: an `extract` job of its replies queued or running. */
export const readingTranscripts = (db, messageId) => Boolean(get(db, "SELECT 1 AS ok FROM jobs WHERE kind = 'extract' AND message_id = ? AND status IN ('queued', 'running') LIMIT 1", messageId))
