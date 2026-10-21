// Spending ledger of the private bench: one JSON line per paid call, summed on read so that concurrent processes
// (several variants, the judge) append without overwriting each other. `assertBudget` cuts before a call once the
// accumulated total reaches 90 % of the cap.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {{ resultsDir: string, budgetUsd: number }} opts
 */
export function createSpend({ resultsDir, budgetUsd }) {
  const file = join(resultsDir, 'private-spend.jsonl');
  const read = () => {
    if (!existsSync(file)) return { total_usd: 0, unpriced_calls: 0 };
    const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return { total_usd: rows.reduce((a, r) => a + r.usd, 0), unpriced_calls: rows.reduce((a, r) => a + (r.unpriced ?? 0), 0) };
  };
  return {
    file,
    read,
    add(label, usd, unpriced = 0) {
      mkdirSync(resultsDir, { recursive: true });
      appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), label, usd, unpriced })}\n`);
      return read().total_usd;
    },
    assertBudget(label) {
      const { total_usd: spent } = read();
      if (spent >= budgetUsd * 0.9) throw new Error(`Presupuesto: gastado ${spent.toFixed(4)} USD de ${budgetUsd}; se corta antes de «${label}»`);
    },
  };
}

/**
 * Retries a call that failed with a provider error marked retryable (429, 5xx, network), as the job queue does in the
 * product (MASTER-SPEC §7.3: max_attempts 3). It waits for the provider's `retry-after` or, without it, for a growing pause.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ attempts?: number, pauseMs?: number, onRetry?: (error: Error, attempt: number) => void }} [opts]
 */
export async function withQueueRetries(fn, { attempts = 3, pauseMs = 5000, onRetry = () => {} } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!error.retryable || attempt >= attempts) throw error;
      onRetry(error, attempt);
      await new Promise((resolve) => setTimeout(resolve, error.retryAfterMs ?? pauseMs * attempt));
    }
  }
}
