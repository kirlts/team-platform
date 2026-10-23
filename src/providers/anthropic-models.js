// Declared capabilities of the Anthropic models for `thinking` and `effort` (H-1100).
//
// Source: Anthropic documentation, consulted on 2026-10-21:
//  - https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting
//    («Thinking support, defaults, and rejected configurations by model»)
//  - https://platform.claude.com/docs/en/build-with-claude/effort («Effort levels» and the per-model sections)
//
// Why a table: the same request is valid on one model and a 400 on the next. Claude Sonnet 5.5 rejects
// `thinking: {type: "disabled"}` at every effort level and asks for `between_tools`; Claude Haiku 5.5 and
// Claude Opus 5 accept `disabled` only at effort `high` or below; Claude Opus 5.5 and the Fable and Mythos
// models cannot turn thinking off. The provider decides the shape from this table, so no caller needs to know.
//
// Fields:
//  - thinkingDefault: 'on' | 'off' | 'always-on' (what the model does when `thinking` is omitted).
//  - offForm: the `thinking.type` that turns thinking off, or null when omitting the field is the only valid way
//    (the model is always on, or it is off by default).
//  - offMaxEffort: highest effort at which `offForm` is accepted (null = any).
//  - efforts: effort levels the model accepts in `output_config.effort` (empty = the parameter is not supported).

const ALL = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
const NO_XHIGH = Object.freeze(['low', 'medium', 'high', 'max']);
const BASIC = Object.freeze(['low', 'medium', 'high']);
const NONE = Object.freeze([]);

const model = (thinkingDefault, offForm, offMaxEffort, efforts) =>
  Object.freeze({ thinkingDefault, offForm, offMaxEffort, efforts });

export const MODEL_SOURCE = Object.freeze({
  consulted: '2026-10-21',
  urls: Object.freeze([
    'https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting',
    'https://platform.claude.com/docs/en/build-with-claude/effort',
  ]),
});

export const MODEL_CAPABILITIES = Object.freeze({
  'claude-fable-5-1': model('always-on', null, null, ALL),
  'claude-mythos-5-1': model('always-on', null, null, ALL),
  'claude-fable-5': model('always-on', null, null, ALL),
  'claude-mythos-5': model('always-on', null, null, ALL),
  'claude-opus-5-5': model('always-on', null, null, ALL),
  'claude-opus-5': model('on', 'disabled', 'high', ALL),
  'claude-opus-4-8': model('off', null, null, ALL),
  'claude-opus-4-7': model('off', null, null, ALL),
  'claude-sonnet-5-5': model('on', 'between_tools', 'high', ALL),
  'claude-sonnet-5': model('on', 'disabled', null, ALL),
  'claude-haiku-5-5': model('on', 'disabled', 'high', ALL),
  'claude-opus-4-6': model('off', null, null, NO_XHIGH),
  'claude-sonnet-4-6': model('off', null, null, NO_XHIGH),
  'claude-opus-4-5': model('off', null, null, BASIC),
  'claude-haiku-4-5': model('off', null, null, NONE),
  'claude-sonnet-4-5': model('off', null, null, NONE),
});

const EFFORT_ORDER = ALL;

/** Capabilities of a model id, accepting a dated suffix (`claude-opus-4-5-20251101`). `null` = not in the table. */
export function capabilitiesFor(modelId) {
  const id = String(modelId ?? '');
  if (Object.hasOwn(MODEL_CAPABILITIES, id)) return MODEL_CAPABILITIES[id];
  const undated = id.replace(/-\d{8}$/, '');
  return Object.hasOwn(MODEL_CAPABILITIES, undated) ? MODEL_CAPABILITIES[undated] : null;
}

/**
 * The `thinking` and `effort` a request may carry for a model.
 *
 * `wantOff` is the caller's intent (turn thinking off). The result never contains something the table lists as
 * rejected, and for an unknown model it contains neither field: omitting both is valid on every model.
 *
 * @returns {{thinking: object|undefined, effort: string|undefined, thinkingOff: boolean}}
 *   `thinkingOff` is true when the request will run without up-front thinking (the JSON line applies).
 */
export function resolveThinkingAndEffort(modelId, { wantOff = false, effort } = {}) {
  const caps = capabilitiesFor(modelId);
  if (!caps) return { thinking: undefined, effort: undefined, thinkingOff: false };
  const sentEffort = effort !== undefined && caps.efforts.includes(effort) ? effort : undefined;
  if (!wantOff) return { thinking: undefined, effort: sentEffort, thinkingOff: false };
  if (caps.thinkingDefault === 'off') return { thinking: undefined, effort: sentEffort, thinkingOff: true };
  if (caps.offForm === null) return { thinking: undefined, effort: sentEffort, thinkingOff: false };
  // The effort that will be in effect: the one sent, or the model's default (unknown here: assume it is within the limit).
  const limited = caps.offMaxEffort !== null && sentEffort !== undefined
    && EFFORT_ORDER.indexOf(sentEffort) > EFFORT_ORDER.indexOf(caps.offMaxEffort);
  if (limited) return { thinking: undefined, effort: sentEffort, thinkingOff: false };
  return { thinking: { type: caps.offForm }, effort: sentEffort, thinkingOff: true };
}

// Smallest prompt the API caches, in tokens, per model. Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching,
// section «Cache limitations», consulted on 2026-10-23: «Shorter prompts cannot be cached, even if marked with `cache_control`»
// (no error is returned). The page lists 512 tokens for the 5.x models below, 1,024 for Opus 4.8, Sonnet 5 and Sonnet 4.6,
// 2,048 for Opus 4.7 and 4,096 for Opus 4.6, Opus 4.5 and Haiku 4.5. A model that is not here gets the highest value, so
// nothing is waited for on a prompt the API may not cache.
const MIN_CACHEABLE = Object.freeze({
  'claude-fable-5-1': 512,
  'claude-mythos-5-1': 512,
  'claude-fable-5': 512,
  'claude-mythos-5': 512,
  'claude-opus-5-5': 512,
  'claude-opus-5': 512,
  'claude-sonnet-5-5': 512,
  'claude-haiku-5-5': 512,
  'claude-opus-4-8': 1024,
  'claude-sonnet-5': 1024,
  'claude-sonnet-4-6': 1024,
  'claude-opus-4-7': 2048,
  'claude-opus-4-6': 4096,
  'claude-opus-4-5': 4096,
  'claude-haiku-4-5': 4096,
});
export const MIN_CACHEABLE_UNKNOWN = 4096;

/** Smallest cacheable prompt of a model id, accepting a dated suffix. */
export function minCacheableTokens(modelId) {
  const id = String(modelId ?? '');
  if (Object.hasOwn(MIN_CACHEABLE, id)) return MIN_CACHEABLE[id];
  const undated = id.replace(/-\d{8}$/, '');
  return Object.hasOwn(MIN_CACHEABLE, undated) ? MIN_CACHEABLE[undated] : MIN_CACHEABLE_UNKNOWN;
}
