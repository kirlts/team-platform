// What the level of a message decides about who gets it (UD-292).
//
// The analyzer assigns members by reading their profiles, and an agent member can be among them. A message whose level is `create` (the work is to
// decide something only a person decides) is never given to an agent by that automatic routing: the agent leaves the assignees and, when no active
// person is left among them, the person who decides in the area takes it. The level is the model's reading, an enum; this reads the enum and the
// kind of each member, never a word of the message.
// A person's own choice prevails: recipients picked in «Para» (UD-291), an agent added in the proposal by hand, a mention or a forward are not
// automatic routing and do not pass through here.
import { all } from '../db/index.js'
import { tierOf } from './bloom.js'
import { deciderOf } from './escalation.js'

/** `message` is a proposal message (`area_id`, `bloom_level`, `assignee_ids`). Returns whether it changed the assignees. */
export function keepPersonLevelFromAgents (db, message, authorId = null) {
  if (tierOf(message.bloom_level) !== 'person') return false
  const ids = Array.isArray(message.assignee_ids) ? message.assignee_ids : []
  const kinds = new Map(ids.length === 0 ? [] : all(db, `SELECT id, kind, active FROM members WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).map((m) => [m.id, m]))
  const kept = ids.filter((id) => kinds.get(id)?.kind !== 'agent')
  const hasPerson = kept.some((id) => kinds.get(id)?.kind === 'person' && kinds.get(id)?.active === 1)
  const decider = hasPerson ? null : deciderOf(db, message.area_id, authorId)
  const next = decider === null ? kept : [...kept, decider]
  const changed = next.length !== ids.length || next.some((id, i) => id !== ids[i])
  if (changed) message.assignee_ids = next
  return changed
}
