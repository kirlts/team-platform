// The level of a message in the revised Bloom taxonomy (Anderson & Krathwohl, 2001) and who may work it (UD-292).
//
// The analyzer, which already reads each message with a model, returns `bloom_level` as a structured parameter (an enum). The system never
// reads the words of a message to decide it: it only maps the enum value to a tier with the fixed table below (invariant 11 of the
// repository: the interpretation is the model's, the system validates the form of a value).
//
//   remember, understand, apply  → `direct`   a direct fix: a known procedure on a clear case
//   analyze, evaluate            → `complex`  needs a diagnosis or a judgement between options
//   create                       → `person`   the work is to decide something only a person decides: product, money, an irreversible action, a business criterion

export const BLOOM_LEVELS = Object.freeze(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'])

export const BLOOM_TIERS = Object.freeze(['direct', 'complex', 'person'])

const TIER_OF = Object.freeze({ remember: 'direct', understand: 'direct', apply: 'direct', analyze: 'complex', evaluate: 'complex', create: 'person' })

export const isBloomLevel = (value) => typeof value === 'string' && Object.hasOwn(TIER_OF, value)

/** The tier of a level; `null` for a message that has none (published before UD-292): it runs with the model of its area, as before. */
export const tierOf = (level) => (isBloomLevel(level) ? TIER_OF[level] : null)
