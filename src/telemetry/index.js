// team-platform telemetry (MASTER-SPEC §7.10 bis, UD-014): initializes the OpenTelemetry SDK
// for Node and re-exports the lightweight part (`api.js`) that the other modules use.
//
// Versions and sources, consulted on 2026-10-20:
//   @opentelemetry/sdk-node                  0.300.0  (published 2026-10-20)  npm registry, Apache-2.0
//   @opentelemetry/api                       1.10.0   (published 2026-10-20)  Apache-2.0
//   @opentelemetry/exporter-trace-otlp-http  0.300.0  (published 2026-10-20)  Apache-2.0
//   @opentelemetry/sdk-trace                 3.0.0    (replaces sdk-trace-base since the 0.300 series)
//   @opentelemetry/core 3.0.0 · @opentelemetry/resources 3.0.0
//   Peer of sdk-node 0.300.0: @opentelemetry/api >=1.10.0 <1.11.0; Node >=22.15.0.
//   Previous stable of sdk-node: 0.223.0 (2026-10-06).
//   GenAI semantic conventions: no longer at opentelemetry.io/docs/specs/semconv/gen-ai/
//   (the page warns that it moved); they live at github.com/open-telemetry/semantic-conventions-genai,
//   status «Development», no published version (the «Releases» section is empty). Current today:
//     gen_ai.operation.name, gen_ai.provider.name, gen_ai.request.model, gen_ai.response.model,
//     gen_ai.response.finish_reasons, gen_ai.usage.input_tokens (includes the cache),
//     gen_ai.usage.output_tokens, gen_ai.usage.cache_read.input_tokens,
//     gen_ai.usage.cache_write.input_tokens, error.type;
//     content (opt-in): gen_ai.input.messages, gen_ai.output.messages, gen_ai.system_instructions,
//     in the gen_ai.client.inference.operation.details event. Span name: «{operation} {model}»,
//     kind CLIENT; tools, «execute_tool {name}», INTERNAL.
//   The names that MASTER-SPEC §7.10 bis wrote before this consultation (gen_ai.system,
//   gen_ai.content.prompt, gen_ai.content.completion, gen_ai.usage.cache_read_input_tokens) do not
//   appear in the current convention; the new ones govern here and that section is corrected.
//
// Two span destinations, both batched:
//   1. SQLite, always: `SqliteSpanExporter` over the connection the core injects.
//   2. OTLP over HTTP, only if OTEL_EXPORTER_OTLP_ENDPOINT (or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) exists.
//
// HP-001 (TEST.md): without that endpoint no connection goes out. `NodeSDK` alone, with no options,
// builds OTLP exporters for traces, metrics and logs from the environment variables; that is why here
// it is given explicit span processors and empty lists of metric readers and of
// log record processors, and resource detection is turned off.
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

// Attributes a span inherits from its parent, so that `llm_calls.job_id` and the search by job
// work without each caller repeating the identifier on every child span.
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

/** OTLP traces address from the environment, or null if no collector is configured. */
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
 * @param {import('node:sqlite').DatabaseSync} options.db connection opened by the core with `migration.sql` applied
 * @param {Record<string, string|undefined>} [options.env]
 * @param {string} [options.serviceName]
 * @param {string} [options.serviceVersion]
 * @returns {{flush: () => Promise<void>, shutdown: () => Promise<void>, otlp: boolean, sqlite: SqliteSpanExporter}}
 */
export function initTelemetry({ db, env = process.env, serviceName = 'team-platform', serviceVersion } = {}) {
  if (!db) throw new Error('initTelemetry needs the SQLite connection («db»)');
  if (current) throw new Error('Telemetry is already initialized; call shutdown() before starting it again');

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
    /** Writes out right now whatever is queued: to read the tree of a job that just finished. */
    async flush() {
      // A downed destination (the table, the collector) cannot break whoever asks for the flush: the
      // error already went out through the OpenTelemetry diagnostic channel.
      const settled = await Promise.allSettled([sqliteProcessor.forceFlush(), otlpProcessor?.forceFlush()]);
      await sqlite.forceFlush();
      for (const outcome of settled) if (outcome.status === 'rejected') diag.warn(`telemetry: incomplete flush (${outcome.reason?.message ?? outcome.reason})`);
    },
    /** Empties the queues, closes the SDK and leaves the API ready for another initialization. */
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
