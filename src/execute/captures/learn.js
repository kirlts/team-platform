// What a page shows about people comes from JSON responses of its own server: from them the tool learns which values to cover (`mask.js`).
// A value is learned when it sits under a key that names a person, or under a generic key (`name`, `title`…) inside something that is about people.
// The host widens the three rules in `mask` of its adapter (its keys, in its language).

/** Keys that name a person by themselves. */
export const DEFAULT_PERSON_KEY = /^(full_?name|patient_?name|first_?name|last_?name|surname|contact_?name|display_?name|author_?name|person|national_?id|tax_?id|phone|mobile|email|wa_?id|contact|from|to)$|phone|email/i
/** Keys that name a person only inside something about people. */
export const DEFAULT_GENERIC_KEY = /^(name|title|label|display)$/i
/** Something is about people when the key that holds it, or the path of the response, says so. */
export const DEFAULT_PERSON_CONTEXT = /patient|person|people|user|team|contact|member|doctor|staff|owner|customer|client|thread|lead|author/i

// Declared courtesy, not measured: depth and list length bound the walk over a response; the length of a value bounds what counts as a name.
const MAX_DEPTH = 8
const MAX_ITEMS = 500
const MIN_LENGTH = 3
const MAX_LENGTH = 80

/** The rules with the host's on top of the defaults (a host RegExp replaces its default: pass the union when widening). */
export const personRules = (host = {}) => ({
  personKey: host.personKey ?? DEFAULT_PERSON_KEY,
  genericKey: host.genericKey ?? DEFAULT_GENERIC_KEY,
  personContext: host.personContext ?? DEFAULT_PERSON_CONTEXT
})

/** Walks a parsed response. `inPersonContext`: the path of the request already says it is about people. */
export function learn (learned, payload, rules, inPersonContext = false, key = '', depth = 0) {
  if (depth > MAX_DEPTH || payload == null) return
  if (Array.isArray(payload)) { for (const item of payload.slice(0, MAX_ITEMS)) learn(learned, item, rules, inPersonContext, key, depth + 1); return }
  if (typeof payload === 'object') { for (const [k, v] of Object.entries(payload)) learn(learned, v, rules, inPersonContext || rules.personContext.test(k), k, depth + 1); return }
  const isPerson = rules.personKey.test(key) || (inPersonContext && rules.genericKey.test(key))
  if (typeof payload === 'string' && isPerson && payload.length >= MIN_LENGTH && payload.length <= MAX_LENGTH && !/^\d{4}-\d\d-\d\d/.test(payload)) { learned.values.add(payload); learned.count++ }
}

/** What the tool has learned so far: `values` to cover and `count` of how many sources that makes. */
export const newLearned = () => ({ values: new Set(), count: 0 })
