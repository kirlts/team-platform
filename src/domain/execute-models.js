// The Claude models an area can run its unattended session with (UD-292), and which one runs a message.
//
// The list is closed: the current generation of the Claude API, with the ids exactly as the models overview gives them
// (platform.claude.com/docs/en/about-claude/models/overview, read 2026-10-25). Mythos 5.1 is left out (limited availability) and so are the
// legacy models. A host that sets EXECUTE_MODEL to another id keeps it as the default of every area; the selector only offers these four.
import { get } from '../db/index.js'
import { tierOf } from './bloom.js'

export const EXECUTE_MODELS = Object.freeze([
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' }
])

export const EXECUTE_MODEL_IDS = Object.freeze(EXECUTE_MODELS.map((m) => m.id))

export const isExecuteModel = (id) => EXECUTE_MODEL_IDS.includes(id)

/**
 * The model that runs `messageId`'s session and why: `{ model, tier, source }`.
 *   `direct` tier     the area's «Arreglo directo» model when it has one, else the area's model.
 *   `complex` tier    the area's model. A message with no level (published before UD-292) too.
 *   `escalated`       a retry of a session that ran on the direct model and failed (UD-292): the area's model, never the lighter one again.
 * The area's model defaults to `fallback` (EXECUTE_MODEL), which is what every area ran with before.
 */
export function resolveExecuteModel (db, { messageId, fallback, escalated = false }) {
  const row = get(db, `SELECT m.bloom_level AS level, a.execute_model AS model, a.execute_model_direct AS direct
                         FROM messages m JOIN areas a ON a.id = m.area_id WHERE m.id = ?`, messageId)
  const areaModel = row?.model && isExecuteModel(row.model) ? row.model : fallback
  const tier = tierOf(row?.level)
  if (tier === 'direct' && !escalated && row?.direct && isExecuteModel(row.direct)) return { model: row.direct, tier, source: 'direct' }
  return { model: areaModel, tier, source: row?.model && isExecuteModel(row.model) ? 'area' : 'default' }
}
