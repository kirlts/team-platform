// Arma las ranuras de proveedor (texto, visión, transcripción) desde variables de entorno.
// MASTER-SPEC §3 (valores por omisión), §4.6 (ninguna llave en el repositorio ni en la base) y §7.6.
//
// Variables (nunca se escriben en la base: ésta sólo guarda el nombre del proveedor y el modelo):
//   TEXT_PROVIDER      anthropic | deepseek | groq | openrouter | gemini | openai-compatible   (omisión: anthropic)
//   TEXT_MODEL         (omisión: claude-haiku-5-5 con anthropic, deepseek-flash con deepseek)
//   TEXT_BASE_URL      sobrescribe la dirección del proveedor
//   TEXT_STRUCTURED    json_schema | tool | json_object  (sólo compatibles con OpenAI)
//   TEXT_API_KEY       sobrescribe la llave del proveedor
//   TEXT_FALLBACK_*    lo mismo para el proveedor de respaldo (sin respaldo si no se declara)
//   VISION_*           lo mismo; lo que falte se hereda de TEXT_*
//   SPEECH_PROVIDER    groq-speech  (omisión)
//   SPEECH_MODEL       (omisión: whisper-large-v3-turbo)   SPEECH_BASE_URL   SPEECH_API_KEY
//   ANTHROPIC_API_KEY · DEEPSEEK_API_KEY · GROQ_API_KEY · OPENROUTER_API_KEY · GEMINI_API_KEY · OPENAI_COMPATIBLE_API_KEY
//   ANTHROPIC_CACHE_TTL   5m | 1h      ANTHROPIC_THINKING   disabled | (vacío)
//   PROVIDER_TIMEOUT_MS   plazo por llamada (omisión: 900.000 ms, §7.3)
//   PROVIDER_MAX_INFLIGHT_ANTHROPIC · _GROQ · _OPENAI_COMPATIBLE   peticiones simultáneas del proceso por proveedor (0 = sin tope)
//   PROVIDER_BACKOFF_COOLDOWN_MS · PROVIDER_BACKOFF_RESTORE_STEP_MS   retroceso adaptativo tras un 429 de tope (limiter.js)
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

/** Construye el cliente de texto o visión de una ranura. Devuelve null si el proveedor no está declarado. */
function buildModelClient(env, prefix, { inheritPrefix: wantedInherit, timeoutMs, limits }) {
  // Si la ranura declara su propio proveedor no hereda nada de TEXT_*: un modelo de otro proveedor no sirve.
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
        limiter: limiterFor('anthropic', limits),
      }),
    };
  }

  const preset = OPENAI_COMPATIBLE_PRESETS[provider];
  if (!preset) throw new ProviderConfigError(`Proveedor de texto desconocido «${provider}» en ${prefix}_PROVIDER`);
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
      limiter: limiterFor(provider, limits),
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
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ProviderConfigError('PROVIDER_TIMEOUT_MS debe ser un número positivo');

  const limits = limitsFromEnv(env);
  const text = textSlot(buildModelClient(env, 'TEXT', { timeoutMs, limits }), 'text');
  const textFallback = textSlot(buildModelClient(env, 'TEXT_FALLBACK', { timeoutMs, limits }), 'text_fallback');
  const vision = visionSlot(buildModelClient(env, 'VISION', { inheritPrefix: 'TEXT', timeoutMs, limits }), 'vision');

  const speechProvider = env.SPEECH_PROVIDER || SPEECH_PROVIDER_DEFAULT;
  let speech;
  if (speechProvider !== 'groq-speech') {
    throw new ProviderConfigError(`Proveedor de transcripción desconocido «${speechProvider}» en SPEECH_PROVIDER`);
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
      limiter: limiterFor('groq-speech', limits),
    });
    speech = { name: client.name, model: client.model, transcribe: client.transcribe };
  }

  return {
    text,
    vision,
    speech,
    textFallback,
    /** Lo que puede mostrar Configuración: nombres y modelos, nunca llaves. */
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
