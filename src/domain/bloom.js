// The level of a message in the revised Bloom taxonomy (Anderson & Krathwohl, 2001) and who may work it (UD-292).
//
// The analyzer, which already reads each message with a model, returns `bloom_level` as a structured parameter (an enum). The system never
// reads the words of a message to decide it: it only maps the enum value to a tier with the fixed table below (invariant 11 of the
// repository: the interpretation is the model's, the system validates the form of a value).
//
//   remember, understand, apply  → `direct`   level 1: a known procedure on a clear case, one checkable output; the light model closes it alone
//   analyze, evaluate, create    → `complex`  level 2: separate symptom from cause, weigh options, design inside what is decided; the larger model works it and a person validates at the end
//   decide                       → `person`   level 3: only a person decides it (an irreversible commitment, strategic coherence, a perceptual judgement with no referent,
//                                             overriding a Guard, the weight of two goals, a conflict of interests, money, product direction); never given to an agent by the routing
// The three levels are those of docs/team-platform/KAIROS-PARA-TEAM-PLATFORM.md §3 (Anderson & Krathwohl 2001 for the cognitive levels; the kb-okos aptitude table
// LLM / MIX / HUM for who holds the authority). `decide` is not a Bloom level: it is the one value that says the work is not the model's to do.

export const BLOOM_LEVELS = Object.freeze(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create', 'decide'])

export const BLOOM_TIERS = Object.freeze(['direct', 'complex', 'person'])

const TIER_OF = Object.freeze({ remember: 'direct', understand: 'direct', apply: 'direct', analyze: 'complex', evaluate: 'complex', create: 'complex', decide: 'person' })

export const isBloomLevel = (value) => typeof value === 'string' && Object.hasOwn(TIER_OF, value)

/** The tier of a level; `null` for a message that has none (published before UD-292): it runs with the model of its area, as before. */
export const tierOf = (level) => (isBloomLevel(level) ? TIER_OF[level] : null)
