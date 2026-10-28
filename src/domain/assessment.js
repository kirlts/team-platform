// What the analyzer says about each message beyond its text (UD-295), and what the system does with it.
//
// Work is not sorted into boxes. A request is a point in a space, described by continuous estimates with their reason, and only a Guard is boolean
// (the space is described by estimates; the Guard is the only wall). So the analyzer returns, as
// structured parameters it interpreted (never a pattern over a person's words, invariant 11):
//   expectation          what is expected of Claude, in natural words: investigate, change code, both, or something nobody foresaw
//   guards_touched       ids of the Guards of the area that the request touches: the one boolean thing
//   understand_vs_create 0 to 1, Bloom as a scale: 0 is understanding or applying what is known, 1 is creating
//   irreversibility      0 to 1: what collapses if it is ignored or done wrong, and whether it can be undone
//   value_holder         `person` or `model`: who has the value that is missing to resolve it
//   certainty            0 to 1, how sure the analyzer is of its own estimates
//   estimate_reason      why, in a sentence
//   idea_guard           boolean (UD-307): the Guard «nothing changes permanently without the approval of a person when what is asked is to explore an idea» applies. The analyzer judges it
//                        reading the spirit of the message and of who wrote it; the system obeys the boolean, no threshold, no knob. `idea_reason` says why, in a sentence
//   idea                 0 to 1: how much of it is an idea. Context for the session and for the job judgement; it decides nothing
// The system reads them as numbers and ids. It never reads the words of `expectation` to decide anything: that text goes to the session as it is.
import { all, get } from '../db/index.js'
import { audit } from './audit.js'
import { deciderOf } from './escalation.js'

export const VALUE_HOLDERS = Object.freeze(['person', 'model'])

const unit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

/** The estimates of a proposal message (flat, as the analyzer returns them), or null when any is missing or out of range: a message without them runs as before. */
export function readEstimates (m) {
  if (!unit(m?.understand_vs_create) || !unit(m?.irreversibility) || !unit(m?.certainty) || !VALUE_HOLDERS.includes(m?.value_holder)) return null
  // UD-307: `idea` is optional so that the estimates of a message from before it existed still read; without it the message is not an idea (null).
  return { understand_vs_create: m.understand_vs_create, irreversibility: m.irreversibility, value_holder: m.value_holder, certainty: m.certainty, reason: typeof m.estimate_reason === 'string' ? m.estimate_reason.trim() : '', idea: unit(m.idea) ? m.idea : null, idea_guard: typeof m.idea_guard === 'boolean' ? m.idea_guard : null, // null: never judged (the worker asks for it, UD-307)
     idea_reason: typeof m.idea_reason === 'string' ? m.idea_reason.trim() : '' }
}

export const readExpectation = (m) => (typeof m?.expectation === 'string' ? m.expectation.trim() : '')

/** The Guards of an area as stored: `[{ id, text, mechanism, person }]`. */
export function guardsOf (db, areaId) {
  try {
    const list = JSON.parse(get(db, 'SELECT guards_json FROM areas WHERE id = ?', areaId)?.guards_json ?? '[]')
    return Array.isArray(list) ? list.filter((g) => Number.isInteger(g?.id) && typeof g?.text === 'string') : []
  } catch { return [] }
}

/** The ids of `m.guards_touched` that are Guards of the area: an id that is not one is dropped (the model cites, the system checks the set). */
export function touchedGuards (db, areaId, m) {
  const known = new Set(guardsOf(db, areaId).map((g) => g.id))
  return [...new Set((Array.isArray(m?.guards_touched) ? m.guards_touched : []).filter((id) => known.has(id)))].sort((a, b) => a - b)
}

/**
 * The Guards of the area that the session says it touched: the booleans `touches_<key>` of its output (the name a template gives a Guard, `key` of the Guard, or its id: `touches_3`). A
 * second reading next to the analyzer's `guards_touched`, taken from the work and not from the request. The system reads booleans and checks that each name is a Guard of the area; a field
 * that names none is ignored.
 */
export function declaredGuards (guards, output) {
  return guards.filter((g) => [`touches_${g.id}`, ...(typeof g.key === 'string' && g.key ? [`touches_${g.key}`] : [])].some((name) => output?.[name] === true)).map((g) => g.id).sort((a, b) => a - b)
}

/** Whether the work belongs, also, to a person: a Guard that is about a person (irreversible, money, a conflict) is touched, or the missing value is the person's. */
export function touchesPerson (db, areaId, { guards = [], estimates = null } = {}) {
  const person = new Set(guardsOf(db, areaId).filter((g) => g.person === true).map((g) => g.id))
  return guards.some((id) => person.has(id)) || estimates?.value_holder === 'person'
}

/**
 * The Guards about a person that a message touches and that no person has lifted yet (UD-313). A Guard is a wall that is not crossed by default: while one of these is open the delivery
 * to production waits for a person (`deliver.js`). `message` is a row of `messages` (`id`, `area_id`, `guards_json`). The system reads ids and booleans, never words.
 */
export function openPersonGuards (db, message, extraTouched = []) {
  let touched = []
  try { touched = JSON.parse(message.guards_json || '[]') } catch { /* none */ }
  touched = [...new Set([...touched, ...extraTouched])]
  const person = new Set(guardsOf(db, message.area_id).filter((g) => g.person === true).map((g) => g.id))
  const lifted = new Set()
  for (const row of all(db, "SELECT detail_json FROM audit_log WHERE action = 'message.guard_lifted' AND entity = 'message' AND entity_id = ?", message.id)) {
    try { for (const id of JSON.parse(row.detail_json)?.guards ?? []) lifted.add(id) } catch { /* a damaged row lifts nothing */ }
  }
  return touched.filter((id) => person.has(id) && !lifted.has(id)).sort((a, b) => a - b)
}

/** The ids of the Guards whose warning (consequence and alternative, limit-notice.js) was shown to the people of a message: the platform records `message.limit_notice` when the session hands the work over. */
export function noticedGuards (db, messageId) {
  const shown = new Set()
  for (const row of all(db, "SELECT detail_json FROM audit_log WHERE action = 'message.limit_notice' AND entity = 'message' AND entity_id = ?", messageId)) {
    try { for (const id of JSON.parse(row.detail_json)?.guards ?? []) shown.add(id) } catch { /* a damaged row shows nothing */ }
  }
  return shown
}

/**
 * A person lifts the Guards about a person that a message touches (UD-313): the act is the explicit one of the review (UD-275, UD-286): approving the held branch, by hand or in the thread. It is
 * audited as `message.guard_lifted` with who, which Guards and the delivery it let through, and it holds for that message and not for the next one. Returns whether it recorded anything:
 * only a member of kind `person` who is active can lift (an agent never does), and only Guards that are open and whose warning was shown (third audit of the method, 2026-10-27: a person could approve
 * a delivery whose reply never named the risk). If any open Guard was not shown, nothing is lifted: the work is launched again and the session owes the warning.
 */
export function liftPersonGuards (db, message, { memberId, jobId = null, now = Date.now }) {
  const lifter = get(db, 'SELECT kind, active FROM members WHERE id = ?', memberId)
  if (lifter?.kind !== 'person' || lifter.active !== 1) return false
  const open = openPersonGuards(db, message)
  if (open.length === 0) return false
  const shown = noticedGuards(db, message.id)
  if (!open.every((id) => shown.has(id))) return false
  audit(db, { memberId, action: 'message.guard_lifted', entity: 'message', entityId: message.id, detail: { guards: open, job_id: jobId }, now })
  return true
}

/**
 * Which model the estimates call for: the light one unless a dimension passes its limit, then the area's larger one. The limits come from the measurement of the light model
 * (the measurement of bench/model-limits.mjs, UD-295), not from a hand-picked number; without estimates (a message from before they existed) it is the larger one.
 * `limits`: { create, irreversibility, certainty }: above the first two, or below the third, the light model does not take it.
 */
export function modelFor (estimates, limits) {
  if (!estimates) return 'major'
  if (estimates.understand_vs_create > limits.create || estimates.irreversibility > limits.irreversibility || estimates.certainty < limits.certainty) return 'major'
  return 'light'
}

/**
 * A touched person Guard or a value only a person has: an active person must be among the assignees. The agents stay as the analyzer chose them (Claude may investigate or
 * prepare and the person decides); the one who decides in the area joins when no active person is there. Returns whether it changed the assignees.
 */
export function ensurePersonWhenTouched (db, message, authorId = null) {
  if (!touchesPerson(db, message.area_id, { guards: touchedGuards(db, message.area_id, message), estimates: readEstimates(message) })) return false
  const ids = Array.isArray(message.assignee_ids) ? message.assignee_ids : []
  const people = ids.length === 0 ? [] : all(db, `SELECT id FROM members WHERE kind = 'person' AND active = 1 AND id IN (${ids.map(() => '?').join(',')})`, ...ids)
  if (people.length > 0) return false
  const decider = deciderOf(db, message.area_id, authorId)
  if (decider === null || ids.includes(decider) || decider === authorId) return false
  message.assignee_ids = [...ids, decider]
  return true
}

/** The stored assessment of a message as the API shows it. */
export function assessmentOf (row) {
  const parse = (text, fallback) => { try { return text ? JSON.parse(text) : fallback } catch { return fallback } }
  return { expectation: row.expectation ?? '', guards: parse(row.guards_json, []), estimates: parse(row.estimates_json, null), by: row.assessed_by ?? null }
}
