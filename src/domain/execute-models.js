// The Claude models an area can run its unattended session with (UD-295), and which one runs a message.
//
// The list is closed: the current generation of the Claude API, with the ids exactly as the models overview gives them
// (platform.claude.com/docs/en/about-claude/models/overview, read 2026-10-25). Mythos 5.1 is left out (limited availability) and so are the
// legacy models. A host that sets EXECUTE_MODEL to another id keeps it as the escalation model of every area; the selector only offers these four.
import { get } from '../db/index.js'
import { modelFor } from './assessment.js'

export const EXECUTE_MODELS = Object.freeze([
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' }
])

export const EXECUTE_MODEL_IDS = Object.freeze(EXECUTE_MODELS.map((m) => m.id))

export const isExecuteModel = (id) => EXECUTE_MODEL_IDS.includes(id)

export const labelOfModel = (id) => EXECUTE_MODELS.find((m) => m.id === id)?.label ?? id

/**
 * The model that runs `messageId`'s session and why: `{ model, source, estimates }`.
 *   estimates present   the area's light model while the analyzer's estimates stay within `limits` (see `modelFor`), else the area's larger one.
 *   no estimates        the larger one (what every message ran with before UD-295).
 *   `escalated`         the session of the light model did not close (declared by the session, or the checks of its delivery stayed red: see the handler and deliver.js): the larger one, never the light one again.
 * `source` says which applied: `light`, `major`, `escalated` or `legacy`. The area's larger model defaults to `fallback` (EXECUTE_MODEL), its light one to `light` (EXECUTE_LIGHT_MODEL).
 */
export function resolveExecuteModel (db, { messageId, fallback, light, limits, escalated = false }) {
  const row = get(db, `SELECT m.estimates_json AS estimates, a.execute_model AS major, a.execute_model_light AS lightModel
                         FROM messages m JOIN areas a ON a.id = m.area_id WHERE m.id = ?`, messageId)
  const pick = (id, base) => (id && isExecuteModel(id) ? id : base)
  const major = pick(row?.major, fallback)
  let estimates = null
  try { estimates = row?.estimates ? JSON.parse(row.estimates) : null } catch { /* a damaged cell reads as no estimates */ }
  // UD-307: the Guard of the idea may be saved in an assessment that has no level estimates (a message judged later only for it): `idea` always carries what is stored, `estimates` only a complete one.
  const levels = estimates && typeof estimates.understand_vs_create === 'number' ? estimates : null
  if (escalated) return { model: major, source: 'escalated', estimates: levels, idea: estimates }
  if (!levels) return { model: major, source: 'legacy', estimates: null, idea: estimates }
  return modelFor(levels, limits) === 'light' ? { model: pick(row?.lightModel, light), source: 'light', estimates: levels, idea: estimates } : { model: major, source: 'major', estimates: levels, idea: estimates }
}

