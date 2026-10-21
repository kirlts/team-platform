// Telemetría de team-platform (MASTER-SPEC §7.10 bis, UD-014): inicializa el SDK de OpenTelemetry
// para Node y reexporta la parte liviana (`api.js`) que usan los demás módulos.
//
// Versiones y fuentes, consultadas el 2026-10-20:
//   @opentelemetry/sdk-node                  0.300.0  (publicada 2026-10-20)  registry de npm, Apache-2.0
//   @opentelemetry/api                       1.10.0   (publicada 2026-10-20)  Apache-2.0
//   @opentelemetry/exporter-trace-otlp-http  0.300.0  (publicada 2026-10-20)  Apache-2.0
//   @opentelemetry/sdk-trace                 3.0.0    (sustituye a sdk-trace-base desde la serie 0.300)
//   @opentelemetry/core 3.0.0 · @opentelemetry/resources 3.0.0
//   Peer de sdk-node 0.300.0: @opentelemetry/api >=1.10.0 <1.11.0; Node >=22.15.0.
//   Anterior estable de sdk-node: 0.223.0 (2026-10-06).
//   Convenciones semánticas de GenAI: ya no están en opentelemetry.io/docs/specs/semconv/gen-ai/
//   (la página avisa que se mudó); viven en github.com/open-telemetry/semantic-conventions-genai,
//   estado «Development», sin versión publicada (la sección «Releases» está vacía). Vigentes hoy:
//     gen_ai.operation.name, gen_ai.provider.name, gen_ai.request.model, gen_ai.response.model,
//     gen_ai.response.finish_reasons, gen_ai.usage.input_tokens (incluye la caché),
//     gen_ai.usage.output_tokens, gen_ai.usage.cache_read.input_tokens,
//     gen_ai.usage.cache_write.input_tokens, error.type;
//     contenido (opt-in): gen_ai.input.messages, gen_ai.output.messages, gen_ai.system_instructions,
//     en el evento gen_ai.client.inference.operation.details. Nombre del span: «{operación} {modelo}»,
//     tipo CLIENT; las herramientas, «execute_tool {nombre}», INTERNAL.
//   Los nombres que MASTER-SPEC §7.10 bis escribió antes de esta consulta (gen_ai.system,
//   gen_ai.content.prompt, gen_ai.content.completion, gen_ai.usage.cache_read_input_tokens) no
//   aparecen en la convención vigente; acá rigen los nuevos y esa sección queda corregida.
//
// Dos destinos de spans, ambos por lotes:
//   1. SQLite, siempre: `SqliteSpanExporter` sobre la conexión que inyecta el núcleo.
//   2. OTLP por HTTP, sólo si existe OTEL_EXPORTER_OTLP_ENDPOINT (o OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).
//
// HP-001 (TEST.md): sin ese endpoint no sale ninguna conexión. `NodeSDK` por sí solo, sin opciones,
// arma exportadores OTLP de trazas, métricas y registros desde las variables de entorno; por eso acá
// se le pasan procesadores de spans explícitos y listas vacías de lectores de métricas y de
// procesadores de registros, y se desactiva la detección de recursos.
import { context, diag, metrics, propagation, trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace';
import { configureCapture } from './api.js';
import { DEFAULTS } from './config.js';
import { SqliteSpanExporter } from './sqlite-exporter.js';

export * from './api.js';
export { estimateCostUsd, PRICES } from './pricing.js';
export { SqliteSpanExporter, pruneSpans, spanToRow } from './sqlite-exporter.js';
export { traceOfJob } from './trace.js';

// Atributos que un span hereda de su padre, para que `llm_calls.job_id` y la búsqueda por trabajo
// funcionen sin que cada llamador repita el identificador en cada span hijo.
const INHERITED = Object.freeze(['team.job_id', 'team.input_id']);

class InheritTeamAttributes {
  onStart(span, parentContext) {
    const parent = trace.getSpan(parentContext);
    const inherited = parent?.attributes;
    if (!inherited) return;
    for (const key of INHERITED) {
      if (inherited[key] !== undefined && span.attributes[key] === undefined) span.setAttribute(key, inherited[key]);
    }
  }

  onEnd() {}

  forceFlush() {
    return Promise.resolve();
  }

  shutdown() {
    return Promise.resolve();
  }
}

function parseHeaders(raw) {
  const headers = {};
  for (const pair of String(raw ?? '').split(',')) {
    const at = pair.indexOf('=');
    if (at > 0) headers[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  }
  return headers;
}

/** Dirección de trazas OTLP desde el entorno, o null si no hay colector configurado. */
export function otlpTracesUrl(env) {
  const specific = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (specific) return specific;
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/v1/traces`;
}

let current = null;

/**
 * @param {object} options
 * @param {import('node:sqlite').DatabaseSync} options.db conexión abierta por el núcleo con `migration.sql` aplicada
 * @param {Record<string, string|undefined>} [options.env]
 * @param {string} [options.serviceName]
 * @param {string} [options.serviceVersion]
 * @returns {{flush: () => Promise<void>, shutdown: () => Promise<void>, otlp: boolean, sqlite: SqliteSpanExporter}}
 */
export function initTelemetry({ db, env = process.env, serviceName = 'team-platform', serviceVersion } = {}) {
  if (!db) throw new Error('initTelemetry necesita la conexión a SQLite («db»)');
  if (current) throw new Error('La telemetría ya está inicializada; llamar a shutdown() antes de volver a iniciarla');

  configureCapture({ inlineBlobs: env.TELEMETRY_INLINE_BLOBS !== '0' });

  const batchOptions = {
    maxQueueSize: DEFAULTS.maxQueueSize,
    maxExportBatchSize: DEFAULTS.maxExportBatchSize,
    scheduledDelayMillis: Number(env.TELEMETRY_FLUSH_MS) || DEFAULTS.scheduledDelayMs,
    exportTimeoutMillis: DEFAULTS.exportTimeoutMs,
  };

  const sqlite = new SqliteSpanExporter(db, { rowsPerSlice: Number(env.TELEMETRY_SLICE_ROWS) || DEFAULTS.rowsPerSlice });
  const sqliteProcessor = new BatchSpanProcessor({ exporter: sqlite, ...batchOptions });
  const processors = [new InheritTeamAttributes(), sqliteProcessor];

  let otlpProcessor = null;
  const otlpUrl = otlpTracesUrl(env);
  if (otlpUrl) {
    const headers = parseHeaders(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS ?? env.OTEL_EXPORTER_OTLP_HEADERS);
    otlpProcessor = new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url: otlpUrl, headers }), ...batchOptions });
    processors.push(otlpProcessor);
  }

  const sdk = new NodeSDK({
    serviceName,
    resource: resourceFromAttributes({
      'service.name': serviceName,
      ...(serviceVersion ? { 'service.version': serviceVersion } : {}),
    }),
    autoDetectResources: false,
    spanProcessors: processors,
    metricReaders: [],
    logRecordProcessors: [],
    instrumentations: [],
    textMapPropagator: null,
  });
  sdk.start();

  const handle = {
    otlp: otlpProcessor !== null,
    sqlite,
    /** Escribe ya lo que esté en cola: para leer el árbol de un trabajo recién terminado. */
    async flush() {
      // Un destino caído (la tabla, el colector) no puede romper a quien pide el vaciado: el
      // error ya salió por el canal de diagnóstico de OpenTelemetry.
      const settled = await Promise.allSettled([sqliteProcessor.forceFlush(), otlpProcessor?.forceFlush()]);
      await sqlite.forceFlush();
      for (const outcome of settled) if (outcome.status === 'rejected') diag.warn(`telemetría: vaciado incompleto (${outcome.reason?.message ?? outcome.reason})`);
    },
    /** Vacía las colas, cierra el SDK y deja la API lista para otra inicialización. */
    async shutdown() {
      if (current !== handle) return;
      await handle.flush();
      await sdk.shutdown();
      trace.disable();
      metrics.disable();
      context.disable();
      propagation.disable();
      current = null;
    },
  };
  current = handle;
  return handle;
}
