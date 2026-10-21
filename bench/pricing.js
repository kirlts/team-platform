// Costo de una llamada a partir de su uso. El analizador registra tokens, no dólares (src/analyze/api.js);
// el banco los convierte con la tarifa de lista del modelo. Un modelo sin tarifa da costo null.
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
};

/**
 * @param {{ model?: string, usage?: { input_tokens?: number, output_tokens?: number, cached_tokens?: number, cache_creation_tokens?: number } | null, cost_usd?: number | null }} call
 * @returns {number | null} dólares, o null si no hay tarifa ni costo informado
 */
export function costOf(call) {
  if (typeof call.cost_usd === 'number') return call.cost_usd;
  const price = PRICES[call.model];
  const u = call.usage;
  if (!price || !u) return null;
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
