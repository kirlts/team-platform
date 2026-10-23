// W3C trace context helpers (UD-262): a `traceparent` string is how a trace crosses a database row, a queue job and the
// environment of the unattended session. Depends only on `@opentelemetry/api`.
import { ROOT_CONTEXT, TraceFlags, context, trace } from '@opentelemetry/api';

const PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function formatTraceparent(spanContext) {
  const flags = (spanContext.traceFlags ?? TraceFlags.SAMPLED).toString(16).padStart(2, '0');
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

/** `{ traceId, spanId, traceFlags }` of a valid `traceparent`, otherwise `null`. */
export function parseTraceparent(value) {
  const m = PATTERN.exec(String(value ?? ''));
  if (!m || /^0+$/.test(m[1]) || /^0+$/.test(m[2])) return null;
  return { traceId: m[1], spanId: m[2], traceFlags: Number.parseInt(m[3], 16) };
}

/** `traceparent` of the active span, or `null` when nothing records. */
export function currentTraceparent() {
  const span = trace.getActiveSpan();
  const ctx = span?.spanContext();
  return ctx && trace.isSpanContextValid(ctx) ? formatTraceparent(ctx) : null;
}

export const traceIdOf = (traceparent) => parseTraceparent(traceparent)?.traceId ?? null;

/** A context whose active span is the remote one named by `traceparent` (the parent of whatever starts inside it). */
export function contextFromTraceparent(traceparent) {
  const p = parseTraceparent(traceparent);
  if (!p) return ROOT_CONTEXT;
  return trace.setSpanContext(ROOT_CONTEXT, { ...p, isRemote: true });
}

/** A span link to the span named by `traceparent`, or `null`. */
export function linkTo(traceparent, attributes = {}) {
  const p = parseTraceparent(traceparent);
  return p ? { context: { ...p, isRemote: true }, attributes } : null;
}

/** Runs `fn` inside the trace of `traceparent`, unless the active span already belongs to it (then it nests there). */
export function inTrace(traceparent, fn) {
  const p = parseTraceparent(traceparent);
  if (!p) return fn();
  const active = trace.getActiveSpan()?.spanContext();
  if (active && active.traceId === p.traceId) return fn();
  return context.with(contextFromTraceparent(traceparent), fn);
}
