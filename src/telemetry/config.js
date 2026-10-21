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
  // Rows per transaction before yielding the event loop with `setImmediate`. Measured in
  // `overhead.bench.mjs` (2026-10-20): 4 rows, slice of 0.29 ms and 279 µs per span; 16 rows,
  // 0.92 ms and 187 µs; 64 rows, 4.22 ms and 157 µs; 512 rows, 61.72 ms and 116 µs. 16 is chosen, the
  // largest whose median stays under 1 ms. Knob: TELEMETRY_SLICE_ROWS.
  rowsPerSlice: 16,
  // Span retention: the same as `job_events` and finished jobs, 7 days (§7.2).
  retentionDays: 7,
  // Maximum length of the status message of a span in error; the full error stays in the
  // `exception` event. It is a presentation cut, not an operational limit.
  statusMessageMaxChars: 500,
});

export const MS_PER_DAY = 86_400_000;
