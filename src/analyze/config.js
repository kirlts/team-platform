// Analyzer knobs, each with its default value and its source (MASTER-SPEC §4.9 and rule 3 of RULES).
// «Provisional» means the source gives a bound and the reference bench (§7.11) fixes the value.
// The sources are from report 02 (consulted on 2026-10-20) and from the MASTER-SPEC; the [Fn] keys are those of that report.

export const KNOBS = Object.freeze({
  // Classification effort: the cheapest and fastest level, for simple high-volume tasks.
  // Report 02 §10.2, [F4][F5].
  classifyEffort: { value: 'low', source: 'Report 02 §10.2 [F4][F5]; MASTER-SPEC §7.5 (1: classify, effort low)' },

  // Decomposition effort (and of the rescue pass, which is the same task over fewer units).
  // Report 02 §10.2 [F4][F5] set `medium` until the bench showed that `low` keeps the coverage.
  // The 2026-10-20 measurement (docs/investigaciones/mediciones/2026-10-20-primera-corrida-real.md) shows it:
  // with the classification grouping one point per group, `low` without thinking keeps the coverage and
  // cuts the time from 6 to 12 s per call down to 1 to 3 s.
  decomposeEffort: { value: 'low', source: 'Measurement 2026-10-20 (docs/investigaciones/mediciones/2026-10-20-primera-corrida-real.md); report 02 §10.2 [F4][F5]' },

  // Thinking per call: `null` leaves the model's adaptive thinking; `'disabled'` turns it off (only with effort `high` or
  // lower, and with the line «The JSON output format applies to your final answer only.», report 02 §10.2 [F4]).
  // The bench compares adaptive `low`, `low` without thinking and adaptive `medium` (report 02 §8).
  classifyThinking: { value: 'disabled', source: 'Measurement 2026-10-20 (docs/investigaciones/mediciones/2026-10-20-primera-corrida-real.md); report 02 §8 and §10.2 [F4]' },
  decomposeThinking: { value: 'disabled', source: 'Measurement 2026-10-20 (docs/investigaciones/mediciones/2026-10-20-primera-corrida-real.md); report 02 §8 and §10.2 [F4]' },

  // Output cap per call. Provisional: the bench fixes the p95 of output per message.
  // Report 02 §10.2 [F1][F3]; MASTER-SPEC §7.5 (provisional: 16,000 and 32,000).
  maxTokens: { value: 16_000, source: 'Report 02 §10.2 [F1][F3]; MASTER-SPEC §7.5' },

  // A cut at max_tokens retries once with double. Same sources.
  maxTokensRetry: { value: 32_000, source: 'Report 02 §10.2 [F1][F3]; MASTER-SPEC §7.5' },

  // Retries for an invalid output: one, with the error as context; then the job fails with the reason.
  // MASTER-SPEC §7.5; report 02 §10.2.
  invalidOutputRetries: { value: 1, source: 'MASTER-SPEC §7.5; report 02 §10.2' },

  // Rescue passes: one at most, only if the overlap or gap computation is not empty.
  // Gain measured in open extraction: +40 % of relations. Report 02 §3.1 [F21] and §10.2.
  rescuePasses: { value: 1, source: 'Report 02 §3.1 and §10.2 [F21]; MASTER-SPEC §7.5' },

  // Input partition threshold, in input tokens. Provisional: price boundary of Haiku 5.5
  // (the input price rises from 0.10 to 0.50 USD per million above 100,000 tokens). Report 02 §2.2 and §10.2 [F2][F19].
  partitionThresholdTokens: { value: 100_000, source: 'Report 02 §2.2 and §10.2 [F2]; MASTER-SPEC §7.5 (provisional)' },

  // Token estimate from characters, only to decide whether a split is needed.
  // Provisional assumption: about 4 characters per token in Spanish with the previous tokenizer, and the
  // Haiku 5.5 tokenizer produces about 30 % more tokens for the same text (Haiku 5.5 migration
  // guide, consulted on 2026-10-20): 4 / 1.3 ≈ 3. The calls return real `usage`; the bench calibrates this value.
  charsPerToken: { value: 3, source: 'Provisional assumption; Haiku 5.5 migration guide (tokenizer with ~30 % more tokens); calibrated by the bench §7.11' },

  // Classification and decomposition calls at once (one group or one chunk each). Measured with the
  // 40-point docx (40 groups) and real providers on 2026-10-20: 4 at once, 26 s; 8, 16 s; 16, 10.5 s,
  // with no 429 errors (docs/investigaciones/mediciones/2026-10-20-primera-corrida-real.md). The rate limit of
  // another account may be lower: it is lowered through configuration.
  partitionConcurrency: { value: 16, source: 'Measurement 2026-10-20 (docs/investigaciones/mediciones/2026-10-20-primera-corrida-real.md)' },

  // Lifetime of the prompt cache: 5 minutes by default, 1 hour if the hit rate measured with
  // `cache_read_input_tokens` is low. Report 02 §7 and §10.2 [F2].
  cacheTtl: { value: '5m', source: 'Report 02 §7 and §10.2 [F2]' },

  // Minimum size of the system prompt for it to be cached on Haiku 5.5. Report 02 §7 [F2].
  minCacheableSystemTokens: { value: 512, source: 'Report 02 §7 and §10.2 [F2]; MASTER-SPEC §7.5' },

  // Harness executable. It must be on the container PATH or be an absolute path. MASTER-SPEC §3.
  harnessBin: { value: 'claude', source: 'MASTER-SPEC §3 (alternative analyzer); UD-008' },

  // Harness timeout: the maximum duration of a job is 900 s. MASTER-SPEC §7.3.
  harnessTimeoutMs: { value: 900_000, source: 'MASTER-SPEC §7.3 (maximum duration per job 900 s)' },

  // Tools the harness may use: read-only, over its working directory. MASTER-SPEC §7.5 («read tools allowed»).
  harnessTools: { value: Object.freeze(['Read']), source: 'MASTER-SPEC §7.5 (read tools allowed)' },

  // Directory under which the empty working directory of each analysis is created, owned by that analysis (UD-008).
  // null = the system temporary directory.
  harnessWorkRoot: { value: null, source: 'UD-008 (empty working directory owned by the adapter)' },

  // Retries of a call that fails with a retryable HTTP error (429, 5xx, network) before the fallback or the failure.
  // The wait is the provider's own `retry-after` when it sends one; otherwise `httpRetryBaseMs` doubled at each retry.
  // Anthropic documents 429 with retry-after and a limit on concurrent requests shared by every process of the account.
  httpRetries: { value: 2, source: 'Measurement 2026-10-21 (docs/investigaciones/mediciones/2026-10-21-prompts-en-ingles-y-marcas-de-ia.md): 429 for concurrent requests with several processes on one key' },
  httpRetryBaseMs: { value: 1000, source: 'declared courtesy: the base of the doubling wait when the provider sends no retry-after' },

  // Assignment experiments (H-85, H-86), decided by the private bench: members in the cached system prompt after the project
  // block, and a grammar that requires at least one assignee per message when the team has members.
  membersInSystem: { value: false, source: 'Measurement 2026-10-21 (docs/investigaciones/mediciones/2026-10-21-prompts-en-ingles-y-marcas-de-ia.md)' },
  requireAssignee: { value: false, source: 'Measurement 2026-10-21 (docs/investigaciones/mediciones/2026-10-21-prompts-en-ingles-y-marcas-de-ia.md)' },

  // Units per window in the classification of a long input: the units are classified in contiguous windows, in parallel, so
  // that a group is a stretch of the conversation and not every unit of the same area spread over the whole input.
  // Provisional until the private bench fixes it (see `docs/investigaciones/mediciones/2026-10-21-prompts-en-ingles-y-marcas-de-ia.md`).
  classifyWindowUnits: { value: 200, source: 'Measurement 2026-10-21 (docs/investigaciones/mediciones/2026-10-21-prompts-en-ingles-y-marcas-de-ia.md)' },

  // Units per section in the second reading (UD-021), which runs only when the first one found nothing: the input is
  // read again section by section (a heading or a change of source also cuts). Provisional: the bench calibrates it.
  secondPassSectionUnits: { value: 20, source: 'UD-021 (provisional; calibrated by the bench §7.11)' },

  // Extra environment variables for the harness process.
  harnessEnv: { value: Object.freeze({}), source: 'UD-008' },
});

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/** Default values, without the sources. */
export const DEFAULT_CONFIG = Object.freeze(Object.fromEntries(Object.entries(KNOBS).map(([k, v]) => [k, v.value])));

/**
 * Merges overrides over the default values and validates types. An unknown knob is an error:
 * a misspelled name must not go through silently.
 */
export function resolveConfig(overrides = {}) {
  const config = { ...DEFAULT_CONFIG };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (!(key in KNOBS)) throw new TypeError(`Unknown analyzer knob: «${key}»`);
    if (value !== undefined) config[key] = value;
  }
  for (const key of ['classifyEffort', 'decomposeEffort']) {
    if (!EFFORTS.has(config[key])) throw new TypeError(`${key} must be one of ${[...EFFORTS].join(', ')}`);
  }
  for (const key of ['maxTokens', 'maxTokensRetry', 'partitionThresholdTokens', 'charsPerToken', 'partitionConcurrency', 'minCacheableSystemTokens', 'harnessTimeoutMs', 'secondPassSectionUnits', 'classifyWindowUnits', 'httpRetryBaseMs']) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) throw new TypeError(`${key} must be a positive number`);
  }
  for (const key of ['invalidOutputRetries', 'rescuePasses', 'httpRetries']) {
    if (!Number.isInteger(config[key]) || config[key] < 0) throw new TypeError(`${key} must be an integer greater than or equal to 0`);
  }
  for (const key of ['classifyThinking', 'decomposeThinking']) {
    if (config[key] !== null && config[key] !== 'disabled') throw new TypeError(`${key} must be null or «disabled»`);
  }
  if (config.cacheTtl !== '5m' && config.cacheTtl !== '1h') throw new TypeError('cacheTtl must be «5m» or «1h»');
  return config;
}
