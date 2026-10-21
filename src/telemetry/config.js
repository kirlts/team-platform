// Telemetry knobs (MASTER-SPEC §4.9: every number is born declared, with its source).

// Unit conversion, not a choice.
export const NS_PER_SECOND = 1_000_000_000n;
export const NS_PER_MS = 1_000_000n;
export const MS_PER_SECOND = 1000;

export const DEFAULTS = Object.freeze({
  // Default values of `BatchSpanProcessor` in the OpenTelemetry JS documentation
  // (opentelemetry.io/docs/specs/otel/trace/sdk/#batching-processor, consulted on 2026-10-20):
  // queue of 2048 spans, batches of 512, flush every 5000 ms, export timeout of 30000 ms.
  maxQueueSize: 2048,
  maxExportBatchSize: 512,
  scheduledDelayMs: 5000,
  exportTimeoutMs: 30000,
  // Byte budget of the span queues (H-40, budget.js). The count limit above does not bound memory: a call with
  // 48 video frames weighs 3,653,672 B in its span (3.48 MiB, `span-size.bench.mjs`, 2026-10-20: 48 frames of
  // 57.5 KB each, informe 06 section 8, 4/3 for base64). The soft threshold is that span rounded up to 4 MiB:
  // the queue holds one such call and is flushed early as soon as a second one arrives. Knob:
  // TELEMETRY_QUEUE_MAX_BYTES.
  queueMaxBytes: 4 * 1024 * 1024,
  // Hard threshold: the soft one plus the largest request a provider takes, 32 MB (informe 05 section 8.3), so the
  // blobs of a call are dropped only when the queue has a backlog and not for being large themselves. Knob:
  // TELEMETRY_QUEUE_HARD_BYTES.
  largestRequestBytes: 32 * 1024 * 1024,
  // Rows per transaction before yielding the event loop with `setImmediate`. Measured in
  // `overhead.bench.mjs` (measurement 2026-10-20): 4 rows, 0.29 ms slice and 279 µs per span; 16 rows,
  // 0.92 ms and 187 µs; 64 rows, 4.22 ms and 157 µs; 512 rows, 61.72 ms and 116 µs. 16 is chosen, the
  // largest whose median stays under 1 ms. Knob: TELEMETRY_SLICE_ROWS.
  rowsPerSlice: 16,
  // Span retention: the same as `job_events` and finished jobs, 7 days (§7.2).
  retentionDays: 7,
  // Maximum length of the status message of a span in error; the full error stays in the
  // `exception` event. It is a presentation cut, not an operational limit.
  statusMessageMaxChars: 500,
});

/** Soft and hard byte thresholds of the span queues from the environment (see `DEFAULTS`). */
export function queueBudgetFromEnv(env) {
  const positive = (name) => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  };
  const softBytes = positive('TELEMETRY_QUEUE_MAX_BYTES') ?? DEFAULTS.queueMaxBytes;
  const hardBytes = Math.max(softBytes, positive('TELEMETRY_QUEUE_HARD_BYTES') ?? softBytes + DEFAULTS.largestRequestBytes);
  return { softBytes, hardBytes };
}

export const MS_PER_DAY = 86_400_000;
