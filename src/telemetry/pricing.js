// Costo estimado de una llamada, en USD, para `team.cost_usd`.
//
// Cada precio cita su fuente (MASTER-SPEC §4.9). Un modelo que no figura en la tabla devuelve
// `null`: un costo desconocido se muestra como desconocido, nunca como cero ni como un valor
// de otro modelo. El proveedor puede informar el costo real (el harness lo hace con
// `total_cost_usd`); en ese caso `recordGenAiCall` recibe `cost` y esta tabla no se consulta.

const PER_MILLION = 1_000_000;
const SECONDS_PER_HOUR = 3600;

// Haiku 5.5: 0,10 USD de entrada y 0,50 de salida por millón de tokens, lectura de caché 0,01
// (MASTER-SPEC §3). Escritura de caché a 1,25 veces la entrada con 5 minutos y 2 veces con 1 hora
// (informe 02 [F2]). Sobre 100.000 tokens de entrada la entrada sube a 0,50 (informe 02 [F19],
// `src/analyze/config.js`); a ese escalón no se conoce el precio de la caché y el costo es `null`.
const HAIKU_5_5 = Object.freeze({
  inputPerMTok: 0.1,
  outputPerMTok: 0.5,
  cacheReadPerMTok: 0.01,
  cacheWriteMultiplier: Object.freeze({ '5m': 1.25, '1h': 2 }),
  tier: Object.freeze({ aboveInputTokens: 100_000, inputPerMTok: 0.5 }),
});

// Groq `whisper-large-v3-turbo`: 0,04 USD por hora de audio (MASTER-SPEC §3, informe 06 §3.2).
const WHISPER_TURBO = Object.freeze({ perAudioHour: 0.04 });

export const PRICES = Object.freeze({
  'anthropic/claude-haiku-5-5': HAIKU_5_5,
  'groq-speech/whisper-large-v3-turbo': WHISPER_TURBO,
});

function lookup(provider, model) {
  if (!provider || !model) return null;
  const exact = PRICES[`${provider}/${model}`];
  if (exact) return exact;
  // El proveedor puede devolver el modelo con sufijo de fecha (`claude-haiku-5-5-2026…`).
  const prefixes = Object.keys(PRICES).filter((key) => `${provider}/${model}`.startsWith(`${key}-`));
  prefixes.sort((a, b) => b.length - a.length);
  return prefixes.length > 0 ? PRICES[prefixes[0]] : null;
}

/**
 * @param {{provider: string, model: string, usage?: object, cacheTtl?: '5m'|'1h'}} call
 * @returns {number|null} USD, o null si el modelo no tiene precio declarado
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
  // Se redondea a 12 decimales para no guardar el ruido de la coma flotante.
  return Number(usd.toFixed(12));
}
