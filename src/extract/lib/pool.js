// Runs `fn` over each item with at most `limit` in flight and keeps the result order.
// If one fails, it does not start the remaining ones and rejects with the first error.

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(lanes);
  return results;
}
