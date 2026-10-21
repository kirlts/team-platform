// Perillas de la telemetría (MASTER-SPEC §4.9: todo número nace declarado, con su fuente).

// Conversión de unidades, no una elección.
export const NS_PER_SECOND = 1_000_000_000n;
export const NS_PER_MS = 1_000_000n;
export const MS_PER_SECOND = 1000;

export const DEFAULTS = Object.freeze({
  // Valores por omisión de `BatchSpanProcessor` en la documentación de OpenTelemetry JS
  // (opentelemetry.io/docs/specs/otel/trace/sdk/#batching-processor, consultada el 2026-10-20):
  // cola de 2048 spans, lotes de 512, vaciado cada 5000 ms, plazo de exportación de 30000 ms.
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
  // Filas por transacción antes de ceder el bucle de eventos con `setImmediate`. Medido en
  // `overhead.bench.mjs` (2026-10-20): 4 filas, tajada de 0,29 ms y 279 µs por span; 16 filas,
  // 0,92 ms y 187 µs; 64 filas, 4,22 ms y 157 µs; 512 filas, 61,72 ms y 116 µs. Se elige 16, la
  // mayor cuya mediana sigue bajo 1 ms. Perilla: TELEMETRY_SLICE_ROWS.
  rowsPerSlice: 16,
  // Retención de los spans: la misma que `job_events` y los trabajos terminados, 7 días (§7.2).
  retentionDays: 7,
  // Largo máximo del mensaje de estado de un span en error; el error completo queda en el
  // evento `exception`. Es un recorte de presentación, no un límite operativo.
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
