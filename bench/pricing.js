// Costo de una llamada a partir de su uso. El analizador registra tokens, no dólares (src/analyze/api.js);
// el banco los convierte con la tarifa de lista del modelo. Un modelo sin tarifa da costo null.
//
// Groq `whisper-large-v3-turbo`: 0,04 USD por hora de audio (informe 01 y informe 06 §3.2, console.groq.com/docs/speech-to-text,
// consulta 2026-10-20; la misma cifra que `src/telemetry/pricing.js`). Se factura por segundo de audio, con mínimo de 10 s
// por solicitud: el extractor ya informa los segundos facturables (`audioSeconds`, con los solapamientos). No hay tokens.
//
// Haiku 5.5 (MASTER-SPEC §3, informe 02 [F2], consulta 2026-10-20), USD por millón de tokens:
//   entrada 0,10 hasta 100.000 tokens de entrada por solicitud y 0,50 sobre ese umbral (informe 02 §2.2);
//   salida 0,50; lectura de caché 0,01; escritura de caché 1,25 veces la entrada.
export const PRICES = {
  'claude-haiku-5-5': {
    input: 0.1,
    input_over_threshold: 0.5,
    threshold_tokens: 100_000,
    output: 0.5,
    cache_read: 0.01,
    cache_write_factor: 1.25,
  },
  'whisper-large-v3-turbo': { audio_per_hour: 0.04 },
};

const SECONDS_PER_HOUR = 3600;

/**
 * @param {{ model?: string, usage?: { audio_seconds?: number, input_tokens?: number, output_tokens?: number, cached_tokens?: number, cache_creation_tokens?: number } | null, cost_usd?: number | null }} call
 * @returns {number | null} dólares, o null si no hay tarifa ni costo informado
 */
export function costOf(call) {
  if (typeof call.cost_usd === 'number') return call.cost_usd;
  const price = PRICES[call.model];
  const u = call.usage;
  if (!price || !u) return null;
  if (price.audio_per_hour !== undefined) {
    return typeof u.audio_seconds === 'number' ? (u.audio_seconds / SECONDS_PER_HOUR) * price.audio_per_hour : null;
  }
  const input = u.input_tokens ?? 0;
  const inputPrice = input > price.threshold_tokens ? price.input_over_threshold : price.input;
  return (
    (input * inputPrice +
      (u.output_tokens ?? 0) * price.output +
      (u.cached_tokens ?? 0) * price.cache_read +
      (u.cache_creation_tokens ?? 0) * inputPrice * price.cache_write_factor) /
    1e6
  );
}

/**
 * Usage of a call recorded by an extractor (`meta.calls`, src/extract): a vision call carries `usage` in tokens; a
 * speech call carries its billable seconds (`audioSeconds`) and no tokens, which `costOf` prices per hour of audio.
 * @param {{ modality?: string, usage?: object | null, audioSeconds?: number }} call
 * @returns {object | null}
 */
export function usageOfCall(call) {
  if (call.usage) return call.usage;
  if (call.modality === 'speech' && typeof call.audioSeconds === 'number') return { audio_seconds: call.audioSeconds };
  return null;
}
