// Builds the provider slots (text, vision, transcription) from environment variables.
// MASTER-SPEC §3 (defaults), §4.6 (no key in the repository or the database) and §7.6.
//
// Variables (never written to the database: it only stores the provider name and the model):
//   TEXT_PROVIDER      anthropic | deepseek | groq | openrouter | gemini | openai-compatible   (default: anthropic)
//   TEXT_MODEL         (default: claude-haiku-5-5 with anthropic, deepseek-flash with deepseek)
//   TEXT_BASE_URL      overrides the provider address
//   TEXT_STRUCTURED    json_schema | tool | json_object  (OpenAI-compatible only)
//   TEXT_API_KEY       overrides the provider key
//   TEXT_FALLBACK_*    the same for the fallback provider (no fallback if not declared)
//   VISION_*           the same; whatever is missing is inherited from TEXT_*
//   SPEECH_PROVIDER    groq-speech  (default)
//   SPEECH_MODEL       (default: whisper-large-v3-turbo)   SPEECH_BASE_URL   SPEECH_API_KEY
//   ANTHROPIC_API_KEY · DEEPSEEK_API_KEY · GROQ_API_KEY · OPENROUTER_API_KEY · GEMINI_API_KEY · OPENAI_COMPATIBLE_API_KEY
//   ANTHROPIC_CACHE_TTL   5m | 1h      ANTHROPIC_THINKING   disabled | (empty)
//   Keys stored from Configuración (UD-121) arrive as `createProviders(env, { connections })` and win over these variables.
//   PROVIDER_TIMEOUT_MS   deadline per call (default: 900,000 ms, §7.3)
//   PROVIDER_MAX_INFLIGHT_ANTHROPIC · _GROQ · _OPENAI_COMPATIBLE   simultaneous requests of the process per provider (0 = no cap)
//   PROVIDER_BACKOFF_COOLDOWN_MS · PROVIDER_BACKOFF_RESTORE_STEP_MS   adaptive backoff after a cap 429 (limiter.js)
import { ANTHROPIC_DEFAULTS, createAnthropicClient } from './anthropic.js';
import { ProviderConfigError } from './errors.js';
import { createGroqSpeechClient, GROQ_SPEECH_DEFAULTS } from './groq-speech.js';
import { DEFAULT_TIMEOUT_MS } from './http.js';
import { limiterFor, PROVIDER_LIMIT_DEFAULTS } from './limiter.js';
import { createOpenAICompatibleClient, OPENAI_COMPATIBLE_PRESETS } from './openai-compatible.js';

export * from './errors.js';
export { createLimiter, limiterFor, limiterStats, PROVIDER_LIMIT_DEFAULTS, runInJobScope } from './limiter.js';
export { createFakeProviders } from './fake.js';
export { createAnthropicClient, createOpenAICompatibleClient, createGroqSpeechClient };
export { CHECK_CAUSES, probeConnection } from './probe.js';
export { OPENAI_COMPATIBLE_PRESETS, ANTHROPIC_DEFAULTS, GROQ_SPEECH_DEFAULTS };

const TEXT_PROVIDER_DEFAULT = 'anthropic';
const SPEECH_PROVIDER_DEFAULT = 'groq-speech';

function limitVar(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new ProviderConfigError(`${name} debe ser un entero mayor o igual a 0 (valor: «${raw}»)`);
  return n;
}

/** The simultaneous-request knobs of the environment, over the measured defaults (limiter.js). */
export function limitsFromEnv(env) {
  const d = PROVIDER_LIMIT_DEFAULTS;
  return {
    anthropic: limitVar(env, 'PROVIDER_MAX_INFLIGHT_ANTHROPIC', d.anthropic),
    groq: limitVar(env, 'PROVIDER_MAX_INFLIGHT_GROQ', d.groq),
    openaiCompatible: limitVar(env, 'PROVIDER_MAX_INFLIGHT_OPENAI_COMPATIBLE', d.openaiCompatible),
    cooldownMs: limitVar(env, 'PROVIDER_BACKOFF_COOLDOWN_MS', d.cooldownMs),
    restoreStepMs: limitVar(env, 'PROVIDER_BACKOFF_RESTORE_STEP_MS', d.restoreStepMs),
  };
}

function slotUnavailable(slot, reason) {
  const fail = () => {
    throw new ProviderConfigError(reason, { provider: null });
  };
  return { name: null, model: null, unavailable: reason, schemaProfile: 'anthropic', complete: fail, describe: fail, transcribe: fail, slot };
}

function pick(env, prefix, field, inheritPrefix) {
  const own = env[`${prefix}_${field}`];
  if (own !== undefined && own !== '') return own;
  if (inheritPrefix) {
    const inherited = env[`${inheritPrefix}_${field}`];
    if (inherited !== undefined && inherited !== '') return inherited;
  }
  return undefined;
}

/**
 * What a text or vision slot needs to be built or probed: provider, kind, key, address, model and structured mode.
 * `connections` are the keys and addresses stored from Configuración (UD-121): they take precedence over the environment,
 * which stays the value an installation starts with. Returns null if the provider is not declared; `unavailable` names
 * what is missing.
 */
function modelPlan(env, prefix, { inheritPrefix: wantedInherit, connections = {} }) {
  // If the slot declares its own provider it inherits nothing from TEXT_*: a model from another provider is useless.
  const inheritPrefix = env[`${prefix}_PROVIDER`] ? undefined : wantedInherit;
  const provider = pick(env, prefix, 'PROVIDER', inheritPrefix) ?? (prefix === 'TEXT_FALLBACK' ? undefined : TEXT_PROVIDER_DEFAULT);
  if (!provider) return null;
  const stored = connections[provider];

  if (provider === 'anthropic') {
    const apiKey = stored?.apiKey ?? pick(env, prefix, 'API_KEY', inheritPrefix) ?? env.ANTHROPIC_API_KEY;
    return {
      provider, kind: 'anthropic', apiKey, keyVar: 'ANTHROPIC_API_KEY',
      model: pick(env, prefix, 'MODEL', inheritPrefix) ?? ANTHROPIC_DEFAULTS.model,
      baseUrl: pick(env, prefix, 'BASE_URL', inheritPrefix) ?? ANTHROPIC_DEFAULTS.baseUrl,
      structured: null,
    };
  }

  const preset = OPENAI_COMPATIBLE_PRESETS[provider];
  if (!preset && !stored?.custom) throw new ProviderConfigError(`Unknown text provider «${provider}» in ${prefix}_PROVIDER`);
  return {
    provider, kind: 'openai-compatible', keyVar: preset?.keyVar ?? null,
    apiKey: stored?.apiKey ?? pick(env, prefix, 'API_KEY', inheritPrefix) ?? (preset ? env[preset.keyVar] : undefined),
    model: pick(env, prefix, 'MODEL', inheritPrefix) ?? preset?.model ?? null,
    baseUrl: pick(env, prefix, 'BASE_URL', inheritPrefix) ?? stored?.baseUrl ?? preset?.baseUrl ?? null,
    structured: pick(env, prefix, 'STRUCTURED', inheritPrefix) ?? stored?.structured ?? preset?.structured ?? 'json_schema',
  };
}

function speechPlan(env, connections = {}) {
  const provider = env.SPEECH_PROVIDER || SPEECH_PROVIDER_DEFAULT;
  if (provider !== 'groq-speech') throw new ProviderConfigError(`Unknown transcription provider «${provider}» in SPEECH_PROVIDER`);
  return {
    provider, kind: 'groq-speech', keyVar: 'GROQ_API_KEY',
    apiKey: connections[provider]?.apiKey ?? env.SPEECH_API_KEY ?? env.GROQ_API_KEY,
    model: env.SPEECH_MODEL || GROQ_SPEECH_DEFAULTS.model,
    baseUrl: env.SPEECH_BASE_URL || GROQ_SPEECH_DEFAULTS.baseUrl,
    structured: null,
  };
}

/**
 * The plan of one function ('text', 'vision' or 'speech') over an environment and the stored connections: what a probe
 * needs to exercise it. `apiKey` is undefined if no key exists anywhere.
 */
export function slotPlan(env, slot, connections = {}) {
  if (slot === 'speech') return speechPlan(env, connections);
  return modelPlan(env, slot === 'text' ? 'TEXT' : 'VISION', { inheritPrefix: slot === 'vision' ? 'TEXT' : undefined, connections });
}

/** Builds the text or vision client of a slot. Returns null if the provider is not declared. */
function buildModelClient(env, prefix, { inheritPrefix, timeoutMs, limits, connections }) {
  const plan = modelPlan(env, prefix, { inheritPrefix, connections });
  if (!plan) return null;
  if (!plan.apiKey) return { unavailable: `Falta ${plan.keyVar ?? `la clave de ${plan.provider}`}` };

  if (plan.kind === 'anthropic') {
    return {
      client: createAnthropicClient({
        apiKey: plan.apiKey,
        model: plan.model,
        baseUrl: pick(env, prefix, 'BASE_URL', env[`${prefix}_PROVIDER`] ? undefined : inheritPrefix),
        cacheTtl: env.ANTHROPIC_CACHE_TTL || undefined,
        cacheWarmup: env.ANTHROPIC_CACHE_WARMUP === 'off' ? false : undefined,
        thinking: env.ANTHROPIC_THINKING === 'disabled' ? 'disabled' : undefined,
        timeoutMs,
        limiter: limiterFor('anthropic', limits),
      }),
    };
  }

  if (!plan.model) return { unavailable: `Falta ${prefix}_MODEL para ${plan.provider}` };
  if (!plan.baseUrl) return { unavailable: `Falta ${prefix}_BASE_URL para ${plan.provider}` };
  return {
    client: createOpenAICompatibleClient({
      name: plan.provider,
      apiKey: plan.apiKey,
      model: plan.model,
      baseUrl: plan.baseUrl,
      structured: plan.structured,
      timeoutMs,
      limiter: limiterFor(plan.provider, limits),
    }),
  };
}

function textSlot(built, slot) {
  if (!built) return null;
  if (built.unavailable) return slotUnavailable(slot, built.unavailable);
  const { client } = built;
  return { name: client.name, model: client.model, schemaProfile: client.schemaProfile, complete: client.complete };
}

function visionSlot(built, slot) {
  if (built.unavailable) return slotUnavailable(slot, built.unavailable);
  const { client } = built;
  return { name: client.name, model: client.model, describe: client.describe };
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{text: object, vision: object, speech: object, textFallback: object | null, describe: () => object[]}}
 */
export function createProviders(env = process.env, { connections = {} } = {}) {
  const timeoutMs = env.PROVIDER_TIMEOUT_MS ? Number(env.PROVIDER_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ProviderConfigError('PROVIDER_TIMEOUT_MS must be a positive number');

  const limits = limitsFromEnv(env);
  const text = textSlot(buildModelClient(env, 'TEXT', { timeoutMs, limits, connections }), 'text');
  const textFallback = textSlot(buildModelClient(env, 'TEXT_FALLBACK', { timeoutMs, limits, connections }), 'text_fallback');
  const vision = visionSlot(buildModelClient(env, 'VISION', { inheritPrefix: 'TEXT', timeoutMs, limits, connections }), 'vision');

  const plan = speechPlan(env, connections);
  let speech;
  if (!plan.apiKey) {
    speech = slotUnavailable('speech', 'Falta GROQ_API_KEY');
  } else {
    const client = createGroqSpeechClient({
      apiKey: plan.apiKey,
      model: plan.model,
      baseUrl: env.SPEECH_BASE_URL || undefined,
      timeoutMs,
      limiter: limiterFor('groq-speech', limits),
    });
    speech = { name: client.name, model: client.model, transcribe: client.transcribe };
  }

  return {
    text,
    vision,
    speech,
    textFallback,
    /** What Configuration can show: names and models, never keys. */
    describe() {
      return [
        ['text', text],
        ['text_fallback', textFallback],
        ['vision', vision],
        ['speech', speech],
      ]
        .filter(([, s]) => s)
        .map(([slot, s]) => ({ slot, provider: s.name, model: s.model, available: !s.unavailable, reason: s.unavailable ?? null }));
    },
  };
}
