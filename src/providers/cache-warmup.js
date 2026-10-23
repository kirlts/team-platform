// Single flight for the prompt cache of parallel calls (docs/investigaciones/mediciones/2026-10-23-tokens-y-cache.md).
//
// The API documents that a cache entry exists only after the first response starts, so N calls that leave at the same time with the
// same prefix write the prefix N times, each at 1.25 times the input price, and none reads it. Measured on 2026-10-23 with
// `bench/cache-probe.mjs` (Sonnet 5.5 and Haiku 5.5, 5.1 thousand tokens of prefix): four simultaneous calls wrote four times; one
// call whose stream was open (first event after 1.2 to 1.9 s) followed by three that left at that moment wrote once and read three times.
//
// What this module does: of the calls that share a prefix, the first is the leader. It sends its request as a stream and the
// followers wait until the leader's `message_start`, then leave and read. A prefix known to be warm (a call started it less than
// its TTL ago) sends everything at once. A leader that fails before starting releases the followers, who then go as before, so the
// worst case is the old behavior plus the wait, bounded by `maxWaitMs`.
//
// The key is a hash of what the API treats as the prefix: model, system blocks with their cache points, output format and effort,
// thinking and tools (measured: a different `output_config.format` is another prefix, the same system with another schema writes again).
import { createHash } from 'node:crypto';

const MAX_ENTRIES = 512;

/** Stable key of the prefix of a Messages request body (everything but the messages). */
export function prefixKey(body) {
  const { messages: _messages, max_tokens: _maxTokens, stream: _stream, ...prefix } = body;
  return createHash('sha256').update(JSON.stringify(prefix)).digest('hex');
}

/**
 * @param {{ now?: () => number, maxWaitMs?: number }} [opts]
 */
export function createCacheWarmup({ now = () => Date.now(), maxWaitMs = 15_000 } = {}) {
  const entries = new Map(); // key -> { warmUntil: number, leader: Promise<void> | null }

  const prune = () => {
    if (entries.size <= MAX_ENTRIES) return;
    for (const [key, entry] of entries) if (!entry.leader && entry.warmUntil <= now()) entries.delete(key);
  };

  /** Resolves when `promise` does, after `maxWaitMs`, or when `signal` aborts, whichever comes first. */
  const waitFor = (promise, signal, limitMs) => new Promise((resolve) => {
    const timer = setTimeout(done, limitMs);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
    promise.then(done, done);
  });

  return {
    /**
     * @param {string} key  `prefixKey` of the request
     * @param {{ signal?: AbortSignal, maxWaitMs?: number }} [opts]
     * @returns {Promise<{ role: 'warm'|'follower'|'leader', waitedMs: number, started: (ttlMs: number) => void, finish: () => void }>}
     *   A leader calls `started(ttlMs)` when its response starts and `finish()` when it ends or fails (idempotent).
     */
    async enter(key, { signal, maxWaitMs: limitMs = maxWaitMs } = {}) {
      const noop = () => {};
      const entry = entries.get(key);
      if (entry && !entry.leader && entry.warmUntil > now()) return { role: 'warm', waitedMs: 0, started: noop, finish: noop };
      if (entry?.leader) {
        const t0 = now();
        await waitFor(entry.leader, signal, limitMs);
        return { role: 'follower', waitedMs: now() - t0, started: noop, finish: noop };
      }
      let release;
      const leader = new Promise((resolve) => { release = resolve; });
      const own = entry ?? { warmUntil: 0, leader: null };
      own.leader = leader;
      entries.set(key, own);
      prune();
      let settled = false;
      const settle = (ttlMs) => {
        if (settled) return;
        settled = true;
        if (ttlMs > 0) own.warmUntil = now() + ttlMs;
        own.leader = null;
        release();
      };
      return { role: 'leader', waitedMs: 0, started: (ttlMs) => settle(ttlMs), finish: () => settle(0) };
    },
  };
}

/** The warm-up shared by every Anthropic client of the process. */
export const processCacheWarmup = createCacheWarmup();
