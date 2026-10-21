// Span exporter to SQLite (MASTER-SPEC §7.10 bis, UD-014).
//
// The connection arrives by injection: the core opens the database (§3) with its `PRAGMA`s. This module
// opens and closes nothing. `node:sqlite` is synchronous, so writing a batch of 512 spans at
// once would hog the event loop. Therefore:
//   1. `BatchSpanProcessor` gathers the spans and delivers them in batches (never one by one).
//   2. The exporter splits each batch into slices of `rowsPerSlice` rows, one transaction per
//      slice, and yields the loop with `setImmediate` between slices. Whatever is waiting
//      (an HTTP request, a queue heartbeat) runs between slices.
//   3. If the caller already has a transaction open on the same connection, the rows go into
//      it instead of opening another (SQLite does not nest `BEGIN`).
//
// A write failure does not reach the application: it is reported through the OpenTelemetry
// diagnostic channel and the batch is lost. Measuring cannot break what is measured.
//
// Measurement (2026-10-20, Node 24.20, SQLite on file with WAL and synchronous=FULL like the core,
// `overhead.bench.mjs`): with slices of 16 rows the median of a slice is 0.92 ms; without lowering
// `synchronous` to NORMAL during the slice it was 9.6 ms, because each COMMIT waited for an fsync. The
// remaining long pauses (~30 ms) are automatic WAL checkpoints, unrelated to the exporter.
// The per-call overhead figure is in the header of `overhead.bench.mjs`.
import { ExportResultCode } from '@opentelemetry/core';
import { diag, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { DEFAULTS, MS_PER_DAY, NS_PER_MS, NS_PER_SECOND } from './config.js';

const KIND_NAMES = Object.freeze({
  [SpanKind.INTERNAL]: 'INTERNAL',
  [SpanKind.SERVER]: 'SERVER',
  [SpanKind.CLIENT]: 'CLIENT',
  [SpanKind.PRODUCER]: 'PRODUCER',
  [SpanKind.CONSUMER]: 'CONSUMER',
});

const STATUS_NAMES = Object.freeze({
  [SpanStatusCode.UNSET]: 'unset',
  [SpanStatusCode.OK]: 'ok',
  [SpanStatusCode.ERROR]: 'error',
});

const hrToNs = ([seconds, nanos]) => BigInt(seconds) * NS_PER_SECOND + BigInt(nanos);

// SQLite `PRAGMA synchronous` levels: 0 OFF, 1 NORMAL, 2 FULL, 3 EXTRA (sqlite.org/pragma.html).
const SYNCHRONOUS_NORMAL = 1;

const INSERT_SQL = `INSERT OR IGNORE INTO spans
  (trace_id, span_id, parent_id, name, kind, start_ns, end_ns, status, status_message, attributes_json, events_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Row of the `spans` table for a finished SDK span. */
export function spanToRow(span) {
  const ctx = span.spanContext();
  const events = span.events.map((e) => ({ name: e.name, time_ns: hrToNs(e.time).toString(), attributes: e.attributes ?? {} }));
  return [
    ctx.traceId,
    ctx.spanId,
    span.parentSpanContext?.spanId ?? null,
    span.name,
    KIND_NAMES[span.kind] ?? 'INTERNAL',
    hrToNs(span.startTime),
    hrToNs(span.endTime),
    STATUS_NAMES[span.status.code] ?? 'unset',
    span.status.message || null,
    JSON.stringify(span.attributes),
    JSON.stringify(events),
  ];
}

export class SqliteSpanExporter {
  /**
   * @param {import('node:sqlite').DatabaseSync} db connection opened by the core, with the migration applied
   * @param {{rowsPerSlice?: number}} [options]
   */
  constructor(db, options = {}) {
    this.db = db;
    this.rowsPerSlice = options.rowsPerSlice ?? DEFAULTS.rowsPerSlice;
    this.relaxDurability = options.relaxDurability ?? true;
    this.statement = null;
    this.pending = []; // batches to write: { spans, callback }
    this.running = false; // a drain is scheduled or in progress
    this.stopped = false;
    this.waiters = [];
    this.slices = 0; // counter for tests and measurements
  }

  export(spans, resultCallback) {
    if (this.stopped) return resultCallback({ code: ExportResultCode.FAILED });
    this.pending.push({ spans, callback: resultCallback });
    if (!this.running) {
      this.running = true;
      setImmediate(() => this.#drain());
    }
  }

  async #drain() {
    try {
      while (this.pending.length > 0) {
        const batch = this.pending[0];
        let ok = true;
        try {
          while (batch.spans.length > 0) {
            this.#writeSlice(batch.spans.splice(0, this.rowsPerSlice));
            // Yield the loop: whatever is waiting runs before the next slice.
            if (batch.spans.length > 0) await new Promise((resolve) => setImmediate(resolve));
          }
        } catch (error) {
          ok = false;
          diag.error(`telemetry: could not write the spans to SQLite (${error?.message ?? error})`);
        }
        this.pending.shift();
        batch.callback({ code: ok ? ExportResultCode.SUCCESS : ExportResultCode.FAILED });
      }
    } finally {
      this.running = false;
      for (const done of this.waiters.splice(0)) done();
    }
  }

  #writeSlice(spans) {
    this.statement ??= this.db.prepare(INSERT_SQL);
    const own = !this.db.isTransaction;
    // With synchronous=FULL each COMMIT waits for an fsync (7 ms measured) and that is what hogs
    // the loop. Spans are telemetry: losing the last ones after a power cut is acceptable, a
    // corrupt file is not and WAL with NORMAL does not get corrupted. It is lowered to NORMAL only during
    // this slice, which is synchronous, so nobody else writes with the setting changed.
    const previous = own && this.relaxDurability ? this.#lowerDurability() : null;
    if (own) this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const span of spans) this.statement.run(...spanToRow(span));
      if (own) this.db.exec('COMMIT');
    } catch (error) {
      if (own && this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    } finally {
      if (previous !== null) this.db.exec(`PRAGMA synchronous = ${previous}`);
    }
    this.slices += 1;
  }

  /** Lowers `synchronous` to NORMAL and returns the previous level; null if it was already NORMAL or looser. */
  #lowerDurability() {
    const current = this.db.prepare('PRAGMA synchronous').get().synchronous;
    if (current <= SYNCHRONOUS_NORMAL) return null;
    this.db.exec(`PRAGMA synchronous = ${SYNCHRONOUS_NORMAL}`);
    return current;
  }

  /** Resolves when everything received so far has been written. */
  forceFlush() {
    if (!this.running && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async shutdown() {
    await this.forceFlush();
    this.stopped = true;
    this.statement = null;
  }
}

/** Deletes spans older than `retentionDays` (same retention as `job_events`, §7.10 bis). */
export function pruneSpans(db, { now = Date.now(), retentionDays = DEFAULTS.retentionDays } = {}) {
  const cutoffNs = BigInt(now - retentionDays * MS_PER_DAY) * NS_PER_MS;
  return Number(db.prepare('DELETE FROM spans WHERE end_ns < ?').run(cutoffNs).changes);
}
