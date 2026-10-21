// Ejecuta `fn` sobre cada elemento con a lo sumo `limit` en vuelo y conserva el orden del resultado.
// Si una falla, no arranca las que faltan y rechaza con el primer error.

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
