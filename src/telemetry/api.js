// Telemetry, lightweight part (MASTER-SPEC §7.10 bis, UD-014): depends only on `@opentelemetry/api`.
//
// Providers, extractors and the analyzer import from here and not from `index.js`, which brings
// in the full SDK. With no SDK registered, the OpenTelemetry API hands out a no-op tracer: `withSpan`
// runs the function and `recordGenAiCall` serializes nothing (`isRecording()` is false), so
// instrumented code works the same in tests that do not initialize telemetry.
//
// Conventions: OpenTelemetry GenAI, repository `semantic-conventions-genai`, status
// «Development», consulted on 2026-10-20 (see the header of `index.js`). Where the project
// specification (§7.10 bis) uses an earlier name, the current one governs here:
//   gen_ai.system                  → gen_ai.provider.name
//   gen_ai.usage.cache_read_input_tokens → gen_ai.usage.cache_read.input_tokens
//   gen_ai.content.prompt/completion → a single gen_ai.client.inference.operation.details event
//                                      with gen_ai.input.messages and gen_ai.output.messages
import { SpanKind, SpanStatusCode, diag, trace } from '@opentelemetry/api';
import { estimateCostUsd } from './pricing.js';

export { SpanKind, SpanStatusCode };
export { contextFromTraceparent, currentTraceparent, formatTraceparent, inTrace, linkTo, parseTraceparent, traceIdOf } from './propagation.js';

export const TRACER_NAME = 'team-platform';

/** Name of the event that carries the full content of a call (current convention). */
export const CONTENT_EVENT = 'gen_ai.client.inference.operation.details';

/** Project-specific attribute names (the `gen_ai.*` ones are set by OpenTelemetry). */
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

// Project provider name → known value of `gen_ai.provider.name`.
// Anything not listed is sent as is, which the convention allows for custom values.
const PROVIDER_NAMES = Object.freeze({
  anthropic: 'anthropic',
  deepseek: 'deepseek',
  groq: 'groq',
  'groq-speech': 'groq',
  openai: 'openai',
  gemini: 'gcp.gemini',
});

// Capture settings. `inlineBlobs` decides whether the in-memory bytes (images, frames) travel
// inside the event; `index.js` sets it from TELEMETRY_INLINE_BLOBS. Files on disk
// (audio) always go by reference: they live on the volume or in a temporary directory.
// `blobsOverBudget(extraBytes)` is the byte budget of the queues (budget.js): true when the queue is over its hard
// cap with `extraBytes` more, and then the blob keeps its size and loses its content (H-40).
const capture = { inlineBlobs: true, blobsOverBudget: null, onBlobsDropped: null };

export function configureCapture(options) {
  if (typeof options.inlineBlobs === 'boolean') capture.inlineBlobs = options.inlineBlobs;
  if ('blobsOverBudget' in options) capture.blobsOverBudget = options.blobsOverBudget ?? null;
  if ('onBlobsDropped' in options) capture.onBlobsDropped = options.onBlobsDropped ?? null;
}

const tracer = () => trace.getTracer(TRACER_NAME);

/** Start time in the unit the SDK expects (see `now` below), for spans opened and closed by hand. */
export const clockMs = () => performance.timeOrigin + performance.now();

/** Opens a span that the caller ends (tools of a session: opened on `tool_use`, closed on `tool_result`). */
export function startManualSpan(name, attributes, parentContext, options = {}) {
  return tracer().startSpan(name, { kind: options.kind ?? SpanKind.INTERNAL, attributes: cleanAttributes(attributes), startTime: options.startTime ?? clockMs() }, parentContext);
}

/** Closes a span opened by `startManualSpan`; `error` marks it failed. */
export function endManualSpan(span, { error = null, endTime = clockMs() } = {}) {
  if (error) markError(span, error);
  span.end(endTime);
}

function cleanAttributes(attributes) {
  const out = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

/** Low-cardinality value for `error.type`: the error's typed code, otherwise its class. */
export function errorType(error) {
  if (typeof error?.code === 'string' && error.code !== '') return error.code;
  return error?.name ?? 'Error';
}

function markError(span, error) {
  span.setAttribute('error.type', errorType(error));
  if (error instanceof Error) span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: String(error?.message ?? error).slice(0, 500) });
}

// SDK 0.300.0 ends with millisecond resolution if it is not given the time; with
// `performance` the duration of a short span keeps its microseconds.
const now = () => performance.timeOrigin + performance.now();
const finish = (span) => span.end(now());

const isThenable = (value) => value !== null && typeof value === 'object' && typeof value.then === 'function';

/**
 * Runs `fn(span)` inside an active span: the spans that `fn` opens become children.
 * A thrown error, or a rejected promise, marks the span as an error and is rethrown.
 * @template T
 * @param {string} name
 * @param {Record<string, string|number|boolean|string[]|null|undefined>} attributes
 * @param {(span: import('@opentelemetry/api').Span) => T} fn
 * @param {{kind?: number, links?: import('@opentelemetry/api').Link[]}} [options]
 * @returns {T}
 */
export function withSpan(name, attributes, fn, options = {}) {
  // Explicit start time for the same reason as `finish`: measured on 2026-10-20, without it a
  // duration comes out inflated by up to 1 ms.
  const startTime = now();
  return tracer().startActiveSpan(name, { kind: options.kind ?? SpanKind.INTERNAL, attributes: cleanAttributes(attributes), startTime, ...(options.links?.length ? { links: options.links } : {}) }, (span) => {
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

/** Adds attributes to the active span, if there is one that records (for example the size of an output only known afterwards). */
export function annotate(attributes) {
  const span = trace.getActiveSpan();
  if (span?.isRecording()) span.setAttributes(cleanAttributes(attributes));
}

/** A tool use (`execute_tool`): the harness, a binary, a search. Does not count in `llm_calls`. */
export function withToolSpan(toolName, attributes, fn) {
  return withSpan(
    `execute_tool ${toolName}`,
    { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': toolName, ...attributes },
    fn,
  );
}

// ---------------------------------------------------------------------------------------------
// Content of a model call

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

/** `[{role, parts}]` in the shape of `gen_ai.input.messages`. */
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
 * Sets on `span` the `gen_ai.*` attributes and the content event of a model call.
 * Never throws: telemetry cannot change the result of the call it measures.
 *
 * @param {import('@opentelemetry/api').Span} span
 * @param {object} call
 * @param {string} call.provider  project provider name (anthropic, groq-speech, deepseek…)
 * @param {string} call.model     configured model
 * @param {'text'|'vision'|'speech'} [call.modality]
 * @param {string} [call.operation]  'chat' by default; 'transcription' for audio
 * @param {object} [call.request]    neutral request of the §7.6 contract ({system, messages, schema, effort, maxTokens, audioPath…})
 * @param {object} [call.response]   contract response ({text, json, segments, model, stop_reason, request_id})
 * @param {object} [call.usage]      {input_tokens (uncached), output_tokens, cached_tokens, cache_creation_tokens, audio_seconds}
 * @param {number|null} [call.cost]  USD; undefined = computed with `pricing.js`; null = unknown
 * @param {unknown} [call.error]     the error of the call, if it failed
 * @param {'5m'|'1h'} [call.cacheTtl]
 * @param {Record<string, unknown>} [call.extra] event attributes (for example the input size)
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
      // The convention counts cache reads and writes within `input_tokens`; the project's
      // providers report them separately (Anthropic convention), so they are added up here.
      attrs['gen_ai.usage.input_tokens'] = uncached + cacheRead + cacheWrite;
      attrs['gen_ai.usage.output_tokens'] = usage.output_tokens ?? 0;
      if (cacheRead > 0) attrs['gen_ai.usage.cache_read.input_tokens'] = cacheRead;
      if (cacheWrite > 0) attrs['gen_ai.usage.cache_write.input_tokens'] = cacheWrite;
      if (finite(usage.audio_seconds) !== undefined) attrs['team.audio_seconds'] = usage.audio_seconds;
    }

    const cost = call.cost === undefined ? estimateCostUsd({ provider, model, usage, cacheTtl: call.cacheTtl }) : call.cost;
    if (cost !== null && cost !== undefined) attrs[TEAM.costUsd] = cost;

    span.setAttributes(cleanAttributes(attrs));

    // Content event: full input and output, always (UD-014). Values go as JSON
    // because the attributes of an event in JavaScript do not admit structures.
    const eventAttrs = {
      'gen_ai.operation.name': operation,
      'gen_ai.provider.name': attrs['gen_ai.provider.name'],
      'gen_ai.request.model': model,
    };
    const pressure = { keptBytes: 0, dropped: 0 };
    if (request) {
      const system = systemToSemconv(request.system);
      if (system) eventAttrs['gen_ai.system_instructions'] = JSON.stringify(system);
      // `describe` of the contract (§7.6) carries images and a prompt instead of messages.
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
    diag.warn(`telemetry: could not record the model call (${cause?.message ?? cause})`);
  }
}

/**
 * One CLIENT span per call to a provider: runs `fn`, records the call with `recordGenAiCall`
 * and, if `fn` throws a typed error (rejection, cutoff, HTTP…), leaves it as the span's status with the
 * tokens that error already carries.
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

/** Identifiers of the current context, for whoever wants to show or store them. */
export function currentTraceIds() {
  const ctx = trace.getActiveSpan()?.spanContext();
  return ctx ? { trace_id: ctx.traceId, span_id: ctx.spanId } : null;
}
