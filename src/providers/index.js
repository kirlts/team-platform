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
//   PROVIDER_TIMEOUT_MS   deadline per call (default: 900,000 ms, §7.3)
import { ANTHROPIC_DEFAULTS, createAnthropicClient } from './anthropic.js';
import { ProviderConfigError } from './errors.js';
import { createGroqSpeechClient, GROQ_SPEECH_DEFAULTS } from './groq-speech.js';
import { DEFAULT_TIMEOUT_MS } from './http.js';
import { createOpenAICompatibleClient, OPENAI_COMPATIBLE_PRESETS } from './openai-compatible.js';

export * from './errors.js';
export { createFakeProviders } from './fake.js';
export { createAnthropicClient, createOpenAICompatibleClient, createGroqSpeechClient };

const TEXT_PROVIDER_DEFAULT = 'anthropic';
const SPEECH_PROVIDER_DEFAULT = 'groq-speech';

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

/** Builds the text or vision client of a slot. Returns null if the provider is not declared. */
function buildModelClient(env, prefix, { inheritPrefix: wantedInherit, timeoutMs }) {
  // If the slot declares its own provider it inherits nothing from TEXT_*: a model from another provider is useless.
  const inheritPrefix = env[`${prefix}_PROVIDER`] ? undefined : wantedInherit;
  const provider = pick(env, prefix, 'PROVIDER', inheritPrefix) ?? (prefix === 'TEXT_FALLBACK' ? undefined : TEXT_PROVIDER_DEFAULT);
  if (!provider) return null;

  if (provider === 'anthropic') {
    const apiKey = pick(env, prefix, 'API_KEY', inheritPrefix) ?? env.ANTHROPIC_API_KEY;
    if (!apiKey) return { unavailable: 'Falta ANTHROPIC_API_KEY' };
    return {
      client: createAnthropicClient({
        apiKey,
        model: pick(env, prefix, 'MODEL', inheritPrefix) ?? ANTHROPIC_DEFAULTS.model,
        baseUrl: pick(env, prefix, 'BASE_URL', inheritPrefix),
        cacheTtl: env.ANTHROPIC_CACHE_TTL || undefined,
        thinking: env.ANTHROPIC_THINKING === 'disabled' ? 'disabled' : undefined,
        timeoutMs,
      }),
    };
  }

  const preset = OPENAI_COMPATIBLE_PRESETS[provider];
  if (!preset) throw new ProviderConfigError(`Unknown text provider «${provider}» in ${prefix}_PROVIDER`);
  const apiKey = pick(env, prefix, 'API_KEY', inheritPrefix) ?? env[preset.keyVar];
  if (!apiKey) return { unavailable: `Falta ${preset.keyVar}` };
  const model = pick(env, prefix, 'MODEL', inheritPrefix) ?? preset.model;
  if (!model) return { unavailable: `Falta ${prefix}_MODEL para ${provider}` };
  const baseUrl = pick(env, prefix, 'BASE_URL', inheritPrefix) ?? preset.baseUrl;
  if (!baseUrl) return { unavailable: `Falta ${prefix}_BASE_URL para ${provider}` };
  return {
    client: createOpenAICompatibleClient({
      name: provider,
      apiKey,
      model,
      baseUrl,
      structured: pick(env, prefix, 'STRUCTURED', inheritPrefix) ?? preset.structured,
      timeoutMs,
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
export function createProviders(env = process.env) {
  const timeoutMs = env.PROVIDER_TIMEOUT_MS ? Number(env.PROVIDER_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ProviderConfigError('PROVIDER_TIMEOUT_MS must be a positive number');

  const text = textSlot(buildModelClient(env, 'TEXT', { timeoutMs }), 'text');
  const textFallback = textSlot(buildModelClient(env, 'TEXT_FALLBACK', { timeoutMs }), 'text_fallback');
  const vision = visionSlot(buildModelClient(env, 'VISION', { inheritPrefix: 'TEXT', timeoutMs }), 'vision');

  const speechProvider = env.SPEECH_PROVIDER || SPEECH_PROVIDER_DEFAULT;
  let speech;
  if (speechProvider !== 'groq-speech') {
    throw new ProviderConfigError(`Unknown transcription provider «${speechProvider}» in SPEECH_PROVIDER`);
  }
  const speechKey = env.SPEECH_API_KEY || env.GROQ_API_KEY;
  if (!speechKey) {
    speech = slotUnavailable('speech', 'Falta GROQ_API_KEY');
  } else {
    const client = createGroqSpeechClient({
      apiKey: speechKey,
      model: env.SPEECH_MODEL || GROQ_SPEECH_DEFAULTS.model,
      baseUrl: env.SPEECH_BASE_URL || undefined,
      timeoutMs,
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
