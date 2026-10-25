// What the analyzer says about each message beyond its text (UD-295), and what the system does with it.
//
// Kairós does not sort work into boxes. A request is a point in a space, described by continuous estimates with their reason, and only a Guard is boolean
// (KAIROS-PARA-TEAM-PLATFORM.md of the host §1 and §2: Vector, Filo, Contrapeso and Cadenas describe the space; the Guard is the only wall). So the analyzer returns, as
// structured parameters it interpreted (never a pattern over a person's words, invariant 11):
//   expectation          what is expected of Claude, in natural words: investigate, change code, both, or something nobody foresaw
//   guards_touched       ids of the Guards of the area that the request touches: the one boolean thing
//   understand_vs_create 0 to 1, Bloom as a scale: 0 is understanding or applying what is known, 1 is creating
//   irreversibility      0 to 1, Gravitas: what collapses if it is ignored or done wrong, and whether it can be undone
//   value_holder         `person` or `model`: who has the value that is missing to resolve it
//   certainty            0 to 1, how sure the analyzer is of its own estimates
//   estimate_reason      why, in a sentence
// The system reads them as numbers and ids. It never reads the words of `expectation` to decide anything: that text goes to the session as it is.
import { all, get } from '../db/index.js'
import { deciderOf } from './escalation.js'

export const VALUE_HOLDERS = Object.freeze(['person', 'model'])

const unit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

/** The estimates of a proposal message (flat, as the analyzer returns them), or null when any is missing or out of range: a message without them runs as before. */
export function readEstimates (m) {
  if (!unit(m?.understand_vs_create) || !unit(m?.irreversibility) || !unit(m?.certainty) || !VALUE_HOLDERS.includes(m?.value_holder)) return null
  return { understand_vs_create: m.understand_vs_create, irreversibility: m.irreversibility, value_holder: m.value_holder, certainty: m.certainty, reason: typeof m.estimate_reason === 'string' ? m.estimate_reason.trim() : '' }
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

/** Whether the work belongs, also, to a person: a Guard that is about a person (irreversible, money, a conflict) is touched, or the missing value is the person's. */
export function touchesPerson (db, areaId, { guards = [], estimates = null } = {}) {
  const person = new Set(guardsOf(db, areaId).filter((g) => g.person === true).map((g) => g.id))
  return guards.some((id) => person.has(id)) || estimates?.value_holder === 'person'
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
  if (decider === null || ids.includes(decider)) return false
  message.assignee_ids = [...ids, decider]
  return true
}

/** The stored assessment of a message as the API shows it. */
export function assessmentOf (row) {
  const parse = (text, fallback) => { try { return text ? JSON.parse(text) : fallback } catch { return fallback } }
  return { expectation: row.expectation ?? '', guards: parse(row.guards_json, []), estimates: parse(row.estimates_json, null), by: row.assessed_by ?? null }
}
