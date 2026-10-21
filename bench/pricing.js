// Cost of a call from its usage. The analyzer records tokens, not dollars (src/analyze/api.js);
// the bench converts them with the model's list price. A model without a price yields cost null.
//
// Haiku 5.5 (MASTER-SPEC §3, report 02 [F2], queried 2026-10-20), USD per million tokens:
//   input 0.10 up to 100,000 input tokens per request and 0.50 above that threshold (report 02 §2.2);
//   output 0.50; cache read 0.01; cache write 1.25 times the input.
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
 * @returns {number | null} dollars, or null if there is no price and no reported cost
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
