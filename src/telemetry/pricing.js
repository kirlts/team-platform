// Estimated cost of a call, in USD, for `team.cost_usd`.
//
// Each price cites its source (MASTER-SPEC §4.9). A model that is not in the table returns
// `null`: an unknown cost is shown as unknown, never as zero nor as a value
// of another model. The provider may report the real cost (the harness does so with
// `total_cost_usd`); in that case `recordGenAiCall` receives `cost` and this table is not consulted.

const PER_MILLION = 1_000_000;
const SECONDS_PER_HOUR = 3600;

// Haiku 5.5: 0.10 USD input and 0.50 output per million tokens, cache read 0.01
// (MASTER-SPEC §3). Cache write at 1.25 times the input with 5 minutes and 2 times with 1 hour
// (report 02 [F2]). Above 100,000 input tokens the input rises to 0.50 (report 02 [F19],
// `src/analyze/config.js`); at that tier the cache price is not known and the cost is `null`.
const HAIKU_5_5 = Object.freeze({
  inputPerMTok: 0.1,
  outputPerMTok: 0.5,
  cacheReadPerMTok: 0.01,
  cacheWriteMultiplier: Object.freeze({ '5m': 1.25, '1h': 2 }),
  tier: Object.freeze({ aboveInputTokens: 100_000, inputPerMTok: 0.5 }),
});

// Groq `whisper-large-v3-turbo`: 0.04 USD per hour of audio (MASTER-SPEC §3, report 06 §3.2).
const WHISPER_TURBO = Object.freeze({ perAudioHour: 0.04 });

export const PRICES = Object.freeze({
  'anthropic/claude-haiku-5-5': HAIKU_5_5,
  'groq-speech/whisper-large-v3-turbo': WHISPER_TURBO,
});

function lookup(provider, model) {
  if (!provider || !model) return null;
  const exact = PRICES[`${provider}/${model}`];
  if (exact) return exact;
  // The provider may return the model with a date suffix (`claude-haiku-5-5-2026…`).
  const prefixes = Object.keys(PRICES).filter((key) => `${provider}/${model}`.startsWith(`${key}-`));
  prefixes.sort((a, b) => b.length - a.length);
  return prefixes.length > 0 ? PRICES[prefixes[0]] : null;
}

/**
 * @param {{provider: string, model: string, usage?: object, cacheTtl?: '5m'|'1h'}} call
 * @returns {number|null} USD, or null if the model has no declared price
 */
export function estimateCostUsd({ provider, model, usage, cacheTtl }) {
  const price = lookup(provider, model);
  if (!price || !usage) return null;
  if (price.perAudioHour !== undefined) {
    return typeof usage.audio_seconds === 'number' ? (usage.audio_seconds / SECONDS_PER_HOUR) * price.perAudioHour : null;
  }
  const uncached = usage.input_tokens ?? 0;
  const cacheRead = usage.cached_tokens ?? 0;
  const cacheWrite = usage.cache_creation_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  let inputPrice = price.inputPerMTok;
  if (uncached + cacheRead + cacheWrite > price.tier.aboveInputTokens) {
    if (cacheRead > 0 || cacheWrite > 0) return null;
    inputPrice = price.tier.inputPerMTok;
  }
  const writeMultiplier = price.cacheWriteMultiplier[cacheTtl ?? '5m'] ?? price.cacheWriteMultiplier['5m'];
  const usd =
    (uncached * inputPrice + cacheRead * price.cacheReadPerMTok + cacheWrite * inputPrice * writeMultiplier + output * price.outputPerMTok) /
    PER_MILLION;
  // Rounded to 12 decimals so as not to store floating-point noise.
  return Number(usd.toFixed(12));
}
