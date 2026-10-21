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

export const MS_PER_DAY = 86_400_000;
