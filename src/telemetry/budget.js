// Byte budget of the span queues (HALLAZGOS H-40).
// `BatchSpanProcessor` bounds its queue by span count (2048), not by size, and a span of a call to a
// model carries its inputs: the span of a vision call with 48 video frames weighs 3.65 MB
// (span-size.bench.mjs). 2048 of them would be 7 GB in memory. The budget bounds the queue by bytes
// with two thresholds:
//   - above `softBytes` the queue is flushed at once instead of waiting for the batch timer;
//   - above `hardBytes` the calls that are about to be recorded keep the size of their inline blobs
//     and not their content (`team.telemetry.blobs_dropped` on their span counts them). The flush
//     is not keeping up (the database is busy, the collector is down), and memory is what is at stake.
// Bytes enter when a span ends and leave when its batch was exported, whether the export worked or not.

/** Characters of a value, as JSON would write it (a close estimate, not a serialization). */
function valueBytes(value) {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + valueBytes(item), 0);
  return String(value ?? '').length;
}

function attributesBytes(attributes) {
  let sum = 0;
  for (const [key, value] of Object.entries(attributes ?? {})) sum += key.length + valueBytes(value);
  return sum;
}

/** Estimated size of a finished span in `events_json` plus `attributes_json`. Strings are counted by length, O(1). */
export function spanBytes(span) {
  let sum = span.name.length + attributesBytes(span.attributes) + (span.status?.message?.length ?? 0);
  for (const event of span.events ?? []) sum += event.name.length + attributesBytes(event.attributes);
  return sum;
}

export class ByteBudget {
  /**
   * @param {{softBytes: number, hardBytes: number, maxQueueSize: number}} limits
   */
  constructor({ softBytes, hardBytes, maxQueueSize }) {
    this.softBytes = softBytes;
    this.hardBytes = hardBytes;
    this.maxQueueSize = maxQueueSize;
    this.queuedBytes = 0;
    this.queuedSpans = 0;
    this.peakBytes = 0;
    this.forcedFlushes = 0;
    this.sizes = new WeakMap();
  }

  /** The queue would be over the hard cap with `extraBytes` more (the blobs of the call being recorded). */
  wouldExceedHard(extraBytes = 0) {
    return this.queuedBytes + extraBytes > this.hardBytes;
  }

  add(span) {
    // Same condition under which BatchSpanProcessor drops a span: a dropped span never leaves the queue.
    if (this.queuedSpans >= this.maxQueueSize) return;
    const size = spanBytes(span);
    this.sizes.set(span, size);
    this.queuedBytes += size;
    this.queuedSpans += 1;
    this.peakBytes = Math.max(this.peakBytes, this.queuedBytes);
  }

  release(spans) {
    for (const span of spans) {
      const size = this.sizes.get(span);
      if (size === undefined) continue;
      this.sizes.delete(span);
      this.queuedBytes -= size;
      this.queuedSpans -= 1;
    }
  }
}

/** `SpanProcessor` that wraps a `BatchSpanProcessor`, counts the bytes it queues and flushes early over the soft threshold. */
export class BudgetedProcessor {
  constructor(inner, budget) {
    this.inner = inner;
    this.budget = budget;
    this.flushing = null;
  }

  onStart(span, parentContext) {
    this.inner.onStart(span, parentContext);
  }

  onEnd(span) {
    this.budget.add(span);
    this.inner.onEnd(span);
    if (this.budget.queuedBytes > this.budget.softBytes && !this.flushing) {
      this.budget.forcedFlushes += 1;
      // Out of the call that ends the span: ending a span stays cheap.
      this.flushing = new Promise((resolve) => setImmediate(resolve))
        .then(() => this.inner.forceFlush())
        .catch(() => {}) // the failure already went out through the diagnostics channel of OpenTelemetry
        .finally(() => { this.flushing = null; });
    }
  }

  forceFlush() {
    return this.inner.forceFlush();
  }

  shutdown() {
    return this.inner.shutdown();
  }
}

/** Exporter that releases the bytes of each batch when the wrapped exporter is done with it. */
export class BudgetedExporter {
  constructor(inner, budget) {
    this.inner = inner;
    this.budget = budget;
  }

  export(spans, resultCallback) {
    // A copy: SqliteSpanExporter empties the array it receives while it writes it, slice by slice.
    const batch = [...spans];
    this.inner.export(spans, (result) => {
      this.budget.release(batch);
      resultCallback(result);
    });
  }

  forceFlush() {
    return this.inner.forceFlush?.();
  }

  shutdown() {
    return this.inner.shutdown();
  }
}
