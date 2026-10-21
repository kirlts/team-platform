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
  // Filas por transacción antes de ceder el bucle de eventos con `setImmediate`. Salió de la
  // medición de `overhead.bench.mjs` (cifras en la cabecera de `sqlite-exporter.js`).
  rowsPerSlice: 16,
  // Retención de los spans: la misma que `job_events` y los trabajos terminados, 7 días (§7.2).
  retentionDays: 7,
  // Largo máximo del mensaje de estado de un span en error; el error completo queda en el
  // evento `exception`. Es un recorte de presentación, no un límite operativo.
  statusMessageMaxChars: 500,
});

export const MS_PER_DAY = 86_400_000;
