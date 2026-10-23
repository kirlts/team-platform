// Which trace a new job joins (UD-262): the one of its input or message, otherwise the active span's. Also the span it
// links to: the latest job of the same kind for the same input or message (a reprocess or a second assignment).
import { get } from '../db/index.js'
import { currentTraceparent, traceIdOf } from '../telemetry/api.js'

export function traceContextFor (db, { kind, inputId = null, messageId = null }) {
  let traceparent = null
  if (messageId !== null) traceparent = get(db, 'SELECT traceparent FROM messages WHERE id = ?', messageId)?.traceparent ?? null
  if (!traceparent && inputId !== null) traceparent = get(db, 'SELECT traceparent FROM inputs WHERE id = ?', inputId)?.traceparent ?? null
  traceparent ??= currentTraceparent()
  const column = messageId !== null ? 'message_id' : 'input_id'
  const key = messageId !== null ? messageId : inputId
  const previous = key === null ? null : get(db, `SELECT last_span FROM jobs WHERE kind = ? AND ${column} = ? AND last_span IS NOT NULL ORDER BY id DESC LIMIT 1`, kind, key)
  return { traceId: traceIdOf(traceparent), traceparent, link: previous?.last_span ?? null }
}
