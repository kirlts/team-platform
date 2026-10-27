// The Guards of an area that a message was never judged against (amendment of UD-313, 2026-10-27). The analyzer cites in `guards_touched` the Guards that were on the table when it read the
// message. A Guard installed in the area afterwards is not in that list, so the hold of the delivery (`openPersonGuards`, which reads the list) let the work through: the limit was
// declared and a message assessed before it was written never met it. `messages.guards_seen_json` keeps the ids the analyzer was shown; when a job starts, the Guards of the area that are
// not there are judged once, by the same kind of call as the Guard of the idea of a message that predates it (UD-307: `idea-guard.js`), and the ones that apply join `guards_json`.
// The model reads the spirit of the message; the system reads the ids it returns and checks that each is a Guard of the area (invariant 11 of the host: no pattern over the words).
import { get, run as runSql } from '../db/index.js'
import { audit } from '../domain/audit.js'
import { guardsOf } from '../domain/assessment.js'
import { infra } from '../domain/errors.js'
import { estimateCostUsd } from '../telemetry/pricing.js'

const idsOf = (text) => {
  try { const list = JSON.parse(text ?? 'null'); return Array.isArray(list) ? list.filter(Number.isInteger) : null } catch { return null }
}

/** The Guards of the area that the analyzer was never shown for this message: all of them when the message predates the record. */
export function unseenGuards (db, messageId) {
  const row = get(db, 'SELECT area_id, guards_seen_json FROM messages WHERE id = ? AND deleted_at IS NULL', messageId)
  if (!row) return []
  const seen = new Set(idsOf(row.guards_seen_json) ?? [])
  return guardsOf(db, row.area_id).filter((g) => !seen.has(g.id))
}

export const guardsJudgeSchema = (ids) => ({
  type: 'object',
  properties: { guards_touched: { type: 'array', items: { type: 'integer', enum: ids } } },
  required: ['guards_touched'],
  additionalProperties: false
})

/** The prompt of that one judgement: the area, the message and the Guards to judge, in the words the analyzer reads them. */
export function guardsJudgePrompt ({ message, areaTitle, areaDescription, guards }) {
  const fields = Object.entries(message.fields ?? {}).map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')
  return [
    'Eres el analizador de pedidos de un equipo. Un mensaje se analizó antes de que el área tuviera los límites de abajo y hace falta solo este juicio.',
    '',
    'Un límite no se cruza. Devuelve en guards_touched los ids de los límites que el pedido toca, entendiendo qué se pide y para qué; una lista vacía si no toca ninguna.',
    '',
    `<area>\n${areaTitle ?? ''}\n\n${areaDescription ?? ''}\n</area>`,
    `<guardias>\n${guards.map((g) => `- G${g.id}${g.person ? ' (de una persona)' : ''}: ${g.text}`).join('\n')}\n</guardias>`,
    `<mensaje>\n${message.title}\n\n${message.body}\n\n${fields}\n</mensaje>`
  ].join('\n')
}

/**
 * Judges the Guards the message was never judged against and saves the result next to what is there: `guards_json` gains the ones that apply, `guards_seen_json` becomes every Guard of
 * the area. Returns the cost of the call, or 0 when nothing was unseen. Like the Guard of the idea it fails the job as a service failure when the judgement cannot be made and waits
 * `retryAfterMs`: delivering through a limit nobody asked about is what this exists to prevent.
 */
export async function ensureGuardsJudged ({ db, signal, messageId, providers, retryAfterMs = 0, logger = null, now = Date.now }) {
  const guards = unseenGuards(db, messageId)
  if (guards.length === 0) return 0
  const unavailable = (why, cause = null) => {
    logger?.warn({ err: cause, messageId, why }, 'guards_judge_unavailable')
    return infra(`No se pudo juzgar si el pedido toca los límites del área${why ? ` (${why})` : ''}; se reintenta.`, 'guards_judge_unavailable', { retryAfterMs })
  }
  const row = get(db, `SELECT m.title, m.body, m.fields_json, m.guards_json, m.area_id, a.title AS area_title, a.description AS area_description
                         FROM messages m JOIN areas a ON a.id = m.area_id WHERE m.id = ?`, messageId)
  let fields = {}
  try { fields = JSON.parse(row.fields_json || '{}') } catch { /* no fields */ }
  const text = providers?.text
  if (typeof text?.complete !== 'function') throw unavailable('el proveedor de texto no está configurado')
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : unavailable('trabajo cancelado')
  const ids = guards.map((g) => g.id)
  let out = null
  let cost = 0
  try {
    const r = await text.complete({ messages: [{ role: 'user', content: guardsJudgePrompt({ message: { title: row.title, body: row.body, fields }, areaTitle: row.area_title, areaDescription: row.area_description, guards }) }], schema: guardsJudgeSchema(ids), effort: 'low', maxTokens: 1000 })
    out = r.json
    cost = estimateCostUsd({ provider: r.provider ?? text.name, model: r.model ?? text.model, usage: r.usage }) ?? 0
  } catch (error) {
    throw unavailable(String(error?.message ?? error).slice(0, 200), error)
  }
  if (!out || !Array.isArray(out.guards_touched)) throw unavailable('respuesta sin el juicio')
  const touchedNow = [...new Set(out.guards_touched.filter((id) => ids.includes(id)))].sort((a, b) => a - b) // the model cites, the system checks the set
  const before = idsOf(row.guards_json) ?? []
  const merged = [...new Set([...before, ...touchedNow])].sort((a, b) => a - b)
  const all = guardsOf(db, row.area_id).map((g) => g.id)
  runSql(db, 'UPDATE messages SET guards_json = ?, guards_seen_json = ? WHERE id = ?', JSON.stringify(merged), JSON.stringify(all), messageId)
  if (touchedNow.length > 0) audit(db, { memberId: null, action: 'message.guards_judged', entity: 'message', entityId: messageId, detail: { judged: ids, touched: touchedNow }, now })
  return cost
}
