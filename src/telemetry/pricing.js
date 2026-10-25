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

// Sonnet 5.5: 2 USD input and 10 output per million tokens, cache read 0.10 (0.05 times the input: the
// pricing page sets that ratio for Sonnet 5.5, unlike the 0.1 of Haiku), cache write 2.50 at 5 minutes and 4 at
// 1 hour (1.25 and 2 times the input). No long-prompt tier: the page prices a 900K-token request at the same
// rate as a 9K one for every model but Haiku 5.5. Source: platform.claude.com/docs/en/about-claude/pricing,
// read on 2026-10-24 (same figures in report 01 §3, read on 2026-10-20).
const SONNET_5_5 = Object.freeze({
  inputPerMTok: 2,
  outputPerMTok: 10,
  cacheReadPerMTok: 0.1,
  cacheWriteMultiplier: Object.freeze({ '5m': 1.25, '1h': 2 }),
  tier: null,
});

// Opus 5.5: 4 USD input and 20 output per million tokens, cache read 0.20, cache write 5 at 5 minutes and 8 at 1 hour (1.25 and 2 times the input), no
// long-prompt tier. Fable 5.1: 10 USD input and 50 output, cache read 0.25, cache write 12.50 and 20, no tier. Both for the models an area can run its
// unattended session with (UD-295). Source: platform.claude.com/docs/en/about-claude/pricing, read on 2026-10-25.
const OPUS_5_5 = Object.freeze({
  inputPerMTok: 4,
  outputPerMTok: 20,
  cacheReadPerMTok: 0.2,
  cacheWriteMultiplier: Object.freeze({ '5m': 1.25, '1h': 2 }),
  tier: null,
});
const FABLE_5_1 = Object.freeze({
  inputPerMTok: 10,
  outputPerMTok: 50,
  cacheReadPerMTok: 0.25,
  cacheWriteMultiplier: Object.freeze({ '5m': 1.25, '1h': 2 }),
  tier: null,
});

// Groq `whisper-large-v3-turbo`: 0.04 USD per hour of audio (MASTER-SPEC §3, report 06 §3.2).
const WHISPER_TURBO = Object.freeze({ perAudioHour: 0.04 });

export const PRICES = Object.freeze({
  'anthropic/claude-haiku-5-5': HAIKU_5_5,
  'anthropic/claude-sonnet-5-5': SONNET_5_5,
  'anthropic/claude-opus-5-5': OPUS_5_5,
  'anthropic/claude-fable-5-1': FABLE_5_1,
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
  if (price.tier && uncached + cacheRead + cacheWrite > price.tier.aboveInputTokens) {
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

/** Whether the table has a price for this provider and model (a date suffix counts as its base). */
export function hasPrice(provider, model) {
  return lookup(provider, model) !== null;
}

/**
 * The available functions (the `describe()` of the providers) whose model has no price in the table: their calls
 * leave `team.cost_usd` empty. Used by the startup notice.
 * @param {{slot: string, provider: string, model: string, available: boolean}[]} slots
 */
export function unpricedSlots(slots) {
  return slots.filter((s) => s.available && !hasPrice(s.provider, s.model));
}

/**
 * The cost and the tokens of a whole `claude -p` run, from the `modelUsage` of its result (`{ model: { inputTokens, outputTokens,
 * cacheReadInputTokens, cacheCreationInputTokens, costUSD, costBasis } }`). `modelUsage` adds the subagents' requests; the result's
 * top-level `usage` counts only the session's own turns. The CLI prices a model it does not know («costBasis: "unknown"», measured
 * with 2.1.284 and `claude-haiku-5-5`) at a fallback rate about 30 times Haiku 5.5's, so for those models the table is the source:
 * a model with a «list» basis keeps the CLI's figure, a model of unknown basis and with a price here gets the table's, and one with
 * neither keeps the CLI's. The long-prompt tier of Haiku 5.5 applies per request and an aggregate cannot tell which ones crossed it,
 * so a tiered model carries `cost_min_usd` (every request below the tier) and `cost_usd` is the upper bound (every request above,
 * cache at the same ratios to the input as below the tier).
 * @param {Record<string, object>|undefined} modelUsage
 * @returns {{ tokens: {input: number, output: number, cache_read: number, cache_write: number}, cost_usd: number, cost_min_usd: number, models: object[] }|null}
 *   null when `modelUsage` carries no token counts
 */
export function costOfModelUsage(modelUsage) {
  const entries = Object.entries(modelUsage ?? {}).filter(([, m]) => m && typeof m === 'object' && ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens'].some((k) => typeof m[k] === 'number'));
  if (entries.length === 0) return null;
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let cost = 0;
  let costMin = 0;
  const models = entries.map(([model, m]) => {
    const t = { input: m.inputTokens ?? 0, output: m.outputTokens ?? 0, cache_read: m.cacheReadInputTokens ?? 0, cache_write: m.cacheCreationInputTokens ?? 0 };
    tokens.input += t.input + t.cache_read + t.cache_write; // same convention as the `input_tokens` column: everything the model read
    tokens.output += t.output;
    tokens.cache_read += t.cache_read;
    tokens.cache_write += t.cache_write;
    const cli = typeof m.costUSD === 'number' ? m.costUSD : null;
    const price = lookup('anthropic', model);
    let max = cli;
    let min = cli;
    let source = 'cli';
    if (m.costBasis === 'unknown' && price && price.perAudioHour === undefined) {
      const at = (inputPrice) => (t.input * inputPrice + t.cache_read * inputPrice * (price.cacheReadPerMTok / price.inputPerMTok) + t.cache_write * inputPrice * price.cacheWriteMultiplier['5m'] + t.output * price.outputPerMTok) / PER_MILLION;
      min = Number(at(price.inputPerMTok).toFixed(12));
      max = price.tier ? Number(at(price.tier.inputPerMTok).toFixed(12)) : min;
      source = price.tier ? 'table_bounds' : 'table';
    }
    cost += max ?? 0;
    costMin += min ?? 0;
    return { model, ...t, cli_cost_usd: cli, cost_basis: m.costBasis ?? null, cost_usd: max, cost_min_usd: min, source };
  });
  return { tokens, cost_usd: Number(cost.toFixed(12)), cost_min_usd: Number(costMin.toFixed(12)), models };
}

/** What a `claude -p` run cost: the priced figure of its `modelUsage` (subagents included, a model the CLI does not know priced by the table), else the CLI's own `total_cost_usd`. */
export function costOfResult(result) {
  return costOfModelUsage(result?.modelUsage)?.cost_usd ?? (typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null);
}
