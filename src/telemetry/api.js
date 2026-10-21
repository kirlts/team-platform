// Telemetría, parte liviana (MASTER-SPEC §7.10 bis, UD-014): sólo depende de `@opentelemetry/api`.
//
// Los proveedores, los extractores y el analizador importan de acá y no de `index.js`, que trae
// el SDK completo. Sin SDK registrado la API de OpenTelemetry entrega un tracer nulo: `withSpan`
// ejecuta la función y `recordGenAiCall` no serializa nada (`isRecording()` es falso), así que
// el código instrumentado funciona igual en las pruebas que no inicializan la telemetría.
//
// Convenciones: GenAI de OpenTelemetry, repositorio `semantic-conventions-genai`, estado
// «Development», consultadas el 2026-10-20 (ver la cabecera de `index.js`). Donde la especificación
// del proyecto (§7.10 bis) usa un nombre anterior, acá rige el vigente:
//   gen_ai.system                  → gen_ai.provider.name
//   gen_ai.usage.cache_read_input_tokens → gen_ai.usage.cache_read.input_tokens
//   gen_ai.content.prompt/completion → un solo evento gen_ai.client.inference.operation.details
//                                      con gen_ai.input.messages y gen_ai.output.messages
import { SpanKind, SpanStatusCode, diag, trace } from '@opentelemetry/api';
import { estimateCostUsd } from './pricing.js';

export { SpanKind, SpanStatusCode };

export const TRACER_NAME = 'team-platform';

/** Nombre del evento que lleva el contenido completo de una llamada (convención vigente). */
export const CONTENT_EVENT = 'gen_ai.client.inference.operation.details';

/** Nombres de atributo propios del proyecto (los `gen_ai.*` los fija OpenTelemetry). */
export const TEAM = Object.freeze({
  jobId: 'team.job_id',
  inputId: 'team.input_id',
  step: 'team.step',
  costUsd: 'team.cost_usd',
  provider: 'team.provider',
  modality: 'team.modality',
  // Blobs of the call that kept their size and lost their content because the span queue was over its hard cap (H-40).
  blobsDropped: 'team.telemetry.blobs_dropped',
});

// Nombre del proveedor del proyecto → valor conocido de `gen_ai.provider.name`.
// Lo que no figura se manda tal cual, que la convención permite para valores propios.
const PROVIDER_NAMES = Object.freeze({
  anthropic: 'anthropic',
  deepseek: 'deepseek',
  groq: 'groq',
  'groq-speech': 'groq',
  openai: 'openai',
  gemini: 'gcp.gemini',
});

// Ajustes de captura. `inlineBlobs` decide si los bytes en memoria (imágenes, fotogramas) viajan
// dentro del evento; `index.js` lo fija desde TELEMETRY_INLINE_BLOBS. Los archivos en disco
// (audio) siempre van por referencia: viven en el volumen o en un directorio temporal.
// `blobsOverBudget(extraBytes)` is the byte budget of the queues (budget.js): true when the queue is over its hard
// cap with `extraBytes` more, and then the blob keeps its size and loses its content (H-40).
const capture = { inlineBlobs: true, blobsOverBudget: null, onBlobsDropped: null };

export function configureCapture(options) {
  if (typeof options.inlineBlobs === 'boolean') capture.inlineBlobs = options.inlineBlobs;
  if ('blobsOverBudget' in options) capture.blobsOverBudget = options.blobsOverBudget ?? null;
  if ('onBlobsDropped' in options) capture.onBlobsDropped = options.onBlobsDropped ?? null;
}

const tracer = () => trace.getTracer(TRACER_NAME);

function cleanAttributes(attributes) {
  const out = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

/** Valor bajo de cardinalidad para `error.type`: el código tipado del error, si no su clase. */
export function errorType(error) {
  if (typeof error?.code === 'string' && error.code !== '') return error.code;
  return error?.name ?? 'Error';
}

function markError(span, error) {
  span.setAttribute('error.type', errorType(error));
  if (error instanceof Error) span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: String(error?.message ?? error).slice(0, 500) });
}

// El SDK 0.300.0 pone el fin con resolución de milisegundo si no se le da la hora; con
// `performance` la duración de un span corto conserva sus microsegundos.
const now = () => performance.timeOrigin + performance.now();
const finish = (span) => span.end(now());

const isThenable = (value) => value !== null && typeof value === 'object' && typeof value.then === 'function';

/**
 * Corre `fn(span)` dentro de un span activo: los spans que `fn` abra quedan como hijos.
 * Un error lanzado, o una promesa rechazada, marca el span como error y se vuelve a lanzar.
 * @template T
 * @param {string} name
 * @param {Record<string, string|number|boolean|string[]|null|undefined>} attributes
 * @param {(span: import('@opentelemetry/api').Span) => T} fn
 * @param {{kind?: number}} [options]
 * @returns {T}
 */
export function withSpan(name, attributes, fn, options = {}) {
  // Hora de inicio explícita por la misma razón que `finish`: medido el 2026-10-20, sin ella una
  // duración sale inflada hasta 1 ms.
  const startTime = now();
  return tracer().startActiveSpan(name, { kind: options.kind ?? SpanKind.INTERNAL, attributes: cleanAttributes(attributes), startTime }, (span) => {
    let result;
    try {
      result = fn(span);
    } catch (error) {
      markError(span, error);
      finish(span);
      throw error;
    }
    if (!isThenable(result)) {
      finish(span);
      return result;
    }
    return result.then(
      (value) => {
        finish(span);
        return value;
      },
      (error) => {
        markError(span, error);
        finish(span);
        throw error;
      },
    );
  });
}

/** Agrega atributos al span activo, si hay uno que registre (por ejemplo el tamaño de una salida que recién se conoce). */
export function annotate(attributes) {
  const span = trace.getActiveSpan();
  if (span?.isRecording()) span.setAttributes(cleanAttributes(attributes));
}

/** Un uso de herramienta (`execute_tool`): el harness, un binario, una búsqueda. No cuenta en `llm_calls`. */
export function withToolSpan(toolName, attributes, fn) {
  return withSpan(
    `execute_tool ${toolName}`,
    { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': toolName, ...attributes },
    fn,
  );
}

// ---------------------------------------------------------------------------------------------
// Contenido de una llamada a un modelo

// `pressure` accumulates, over the blobs of one call, the bytes already kept and the count of the ones dropped for
// the byte budget (not for TELEMETRY_INLINE_BLOBS=0, which is a choice and not a loss).
function partToSemconv(part, pressure = { keptBytes: 0, dropped: 0 }) {
  if (part.type === 'text') return { type: 'text', content: String(part.text ?? '') };
  const modality = part.type === 'document' ? 'document' : 'image';
  const base = { modality, mime_type: part.mime ?? null, ...(part.label ? { label: part.label } : {}) };
  if (part.data !== undefined && part.data !== null) {
    const size = Buffer.isBuffer(part.data) ? part.data.length : String(part.data).length;
    if (!capture.inlineBlobs) return { type: 'blob', ...base, size_bytes: size, content: null };
    if (capture.blobsOverBudget?.(pressure.keptBytes + size)) {
      pressure.dropped += 1;
      return { type: 'blob', ...base, size_bytes: size, content: null };
    }
    pressure.keptBytes += size;
    const content = Buffer.isBuffer(part.data) ? part.data.toString('base64') : String(part.data);
    return { type: 'blob', ...base, size_bytes: size, content };
  }
  if (part.path) return { type: 'uri', ...base, uri: `file://${part.path}` };
  return { type: 'blob', ...base, content: null };
}

/** `[{role, parts}]` en la forma de `gen_ai.input.messages`. */
function messagesToSemconv(messages, pressure) {
  return (messages ?? []).map((m) => {
    const content = m.content;
    const parts = typeof content === 'string' ? [{ type: 'text', content }] : (Array.isArray(content) ? content : []).map((part) => partToSemconv(part, pressure));
    return { role: m.role, parts };
  });
}

function systemToSemconv(system) {
  if (system === undefined || system === null) return null;
  const list = Array.isArray(system) ? system : [system];
  return list.map((s) => ({ type: 'text', content: String(s) }));
}

function outputToSemconv(response, finishReason) {
  if (!response) return [];
  let content = '';
  if (typeof response.text === 'string' && response.text !== '') content = response.text;
  else if (response.json !== undefined) content = JSON.stringify(response.json);
  const message = { role: 'assistant', parts: [{ type: 'text', content }] };
  if (finishReason) message.finish_reason = finishReason;
  return [message];
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * Pone en `span` los atributos `gen_ai.*` y el evento de contenido de una llamada a un modelo.
 * Nunca lanza: la telemetría no puede cambiar el resultado de la llamada que mide.
 *
 * @param {import('@opentelemetry/api').Span} span
 * @param {object} call
 * @param {string} call.provider  nombre del proveedor del proyecto (anthropic, groq-speech, deepseek…)
 * @param {string} call.model     modelo configurado
 * @param {'text'|'vision'|'speech'} [call.modality]
 * @param {string} [call.operation]  'chat' por omisión; 'transcription' para audio
 * @param {object} [call.request]    pedido neutro del contrato de §7.6 ({system, messages, schema, effort, maxTokens, audioPath…})
 * @param {object} [call.response]   respuesta del contrato ({text, json, segments, model, stop_reason, request_id})
 * @param {object} [call.usage]      {input_tokens (sin caché), output_tokens, cached_tokens, cache_creation_tokens, audio_seconds}
 * @param {number|null} [call.cost]  USD; indefinido = se calcula con `pricing.js`; null = desconocido
 * @param {unknown} [call.error]     el error de la llamada, si falló
 * @param {'5m'|'1h'} [call.cacheTtl]
 * @param {Record<string, unknown>} [call.extra] atributos del evento (por ejemplo el tamaño de la entrada)
 */
export function recordGenAiCall(span, call) {
  if (!span?.isRecording?.()) return;
  try {
    const { provider, model, request, response, usage, error } = call;
    const modality = call.modality ?? 'text';
    const operation = call.operation ?? 'chat';
    const finishReason = response?.stop_reason ?? undefined;
    const attrs = {
      'gen_ai.operation.name': operation,
      'gen_ai.provider.name': PROVIDER_NAMES[provider] ?? provider,
      [TEAM.provider]: provider,
      [TEAM.modality]: modality,
      'gen_ai.request.model': model,
      'gen_ai.response.model': response?.model ?? undefined,
      'gen_ai.response.id': response?.request_id ?? undefined,
      'gen_ai.response.finish_reasons': finishReason ? [finishReason] : undefined,
      'gen_ai.request.max_tokens': finite(request?.maxTokens),
      'team.effort': request?.effort ?? undefined,
      'team.provider_duration_ms': finite(response?.duration_ms ?? error?.duration_ms),
    };

    if (usage) {
      const uncached = usage.input_tokens ?? 0;
      const cacheRead = usage.cached_tokens ?? 0;
      const cacheWrite = usage.cache_creation_tokens ?? 0;
      // La convención cuenta en `input_tokens` lo leído y lo escrito en la caché; los proveedores
      // del proyecto lo informan aparte (convención de Anthropic), así que se suman acá.
      attrs['gen_ai.usage.input_tokens'] = uncached + cacheRead + cacheWrite;
      attrs['gen_ai.usage.output_tokens'] = usage.output_tokens ?? 0;
      if (cacheRead > 0) attrs['gen_ai.usage.cache_read.input_tokens'] = cacheRead;
      if (cacheWrite > 0) attrs['gen_ai.usage.cache_write.input_tokens'] = cacheWrite;
      if (finite(usage.audio_seconds) !== undefined) attrs['team.audio_seconds'] = usage.audio_seconds;
    }

    const cost = call.cost === undefined ? estimateCostUsd({ provider, model, usage, cacheTtl: call.cacheTtl }) : call.cost;
    if (cost !== null && cost !== undefined) attrs[TEAM.costUsd] = cost;

    span.setAttributes(cleanAttributes(attrs));

    // Evento de contenido: entrada y salida completas, siempre (UD-014). Los valores van como JSON
    // porque los atributos de un evento en JavaScript no admiten estructuras.
    const eventAttrs = {
      'gen_ai.operation.name': operation,
      'gen_ai.provider.name': attrs['gen_ai.provider.name'],
      'gen_ai.request.model': model,
    };
    const pressure = { keptBytes: 0, dropped: 0 };
    if (request) {
      const system = systemToSemconv(request.system);
      if (system) eventAttrs['gen_ai.system_instructions'] = JSON.stringify(system);
      // `describe` del contrato (§7.6) trae imágenes y un prompt en vez de mensajes.
      const messages =
        request.messages ?? (request.images ? [{ role: 'user', content: [...request.images.map((img) => ({ type: 'image', ...img })), { type: 'text', text: request.prompt ?? '' }] }] : null);
      if (messages) eventAttrs['gen_ai.input.messages'] = JSON.stringify(messagesToSemconv(messages, pressure));
      if (request.schema) eventAttrs['team.request.schema'] = JSON.stringify(request.schema);
      if (request.audioPath) {
        eventAttrs['gen_ai.input.messages'] = JSON.stringify([
          { role: 'user', parts: [{ type: 'uri', modality: 'audio', uri: `file://${request.audioPath}` }] },
        ]);
        if (request.language) eventAttrs['team.request.language'] = request.language;
        if (request.prompt) eventAttrs['team.request.vocabulary'] = request.prompt;
      }
    }
    const output = response ?? (error?.raw ? { text: String(error.raw) } : undefined);
    if (output) {
      eventAttrs['gen_ai.output.messages'] = JSON.stringify(outputToSemconv(output, finishReason));
      if (Array.isArray(response?.segments)) eventAttrs['team.response.segments'] = JSON.stringify(response.segments);
    }
    if (error?.explanation) eventAttrs['team.error.explanation'] = String(error.explanation);
    if (error?.category) eventAttrs['team.error.category'] = String(error.category);
    if (error?.status !== undefined && error?.status !== null) eventAttrs['http.response.status_code'] = error.status;
    Object.assign(eventAttrs, cleanAttributes(call.extra));
    span.addEvent(CONTENT_EVENT, cleanAttributes(eventAttrs));
    if (pressure.dropped > 0) {
      span.setAttribute(TEAM.blobsDropped, pressure.dropped);
      capture.onBlobsDropped?.(pressure.dropped);
    }
  } catch (cause) {
    diag.warn(`telemetría: no se pudo registrar la llamada al modelo (${cause?.message ?? cause})`);
  }
}

/**
 * Un span CLIENT por llamada a un proveedor: corre `fn`, registra la llamada con `recordGenAiCall`
 * y, si `fn` lanza un error tipado (rechazo, corte, HTTP…), lo deja como estado del span con los
 * tokens que ese error ya traiga.
 * @template T
 * @param {Parameters<typeof recordGenAiCall>[1] & {attributes?: Record<string, unknown>}} call
 * @param {(span: import('@opentelemetry/api').Span) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withGenAiCall(call, fn) {
  const { attributes, ...rest } = call;
  const operation = rest.operation ?? 'chat';
  return withSpan(
    `${operation} ${rest.model}`,
    attributes,
    async (span) => {
      let response;
      try {
        response = await fn(span);
      } catch (error) {
        recordGenAiCall(span, { ...rest, error, usage: error?.usage ?? undefined });
        throw error;
      }
      recordGenAiCall(span, { ...rest, response, usage: response?.usage });
      return response;
    },
    { kind: SpanKind.CLIENT },
  );
}

/** Identificadores del contexto actual, para quien quiera mostrarlos o guardarlos. */
export function currentTraceIds() {
  const ctx = trace.getActiveSpan()?.spanContext();
  return ctx ? { trace_id: ctx.traceId, span_id: ctx.spanId } : null;
}
