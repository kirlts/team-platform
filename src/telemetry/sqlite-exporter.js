// Exportador de spans a SQLite (MASTER-SPEC §7.10 bis, UD-014).
//
// La conexión llega por inyección: la base la abre el núcleo (§3) con sus `PRAGMA`. Este módulo
// no abre ni cierra nada. `node:sqlite` es síncrono, así que escribir un lote de 512 spans de una
// vez ocuparía el bucle de eventos. Por eso:
//   1. `BatchSpanProcessor` junta los spans y los entrega en lotes (nunca uno por uno).
//   2. El exportador parte cada lote en tajadas de `rowsPerSlice` filas, una transacción por
//      tajada, y cede el bucle con `setImmediate` entre una y otra. Lo que esté esperando
//      (una petición HTTP, un latido de la cola) corre entre tajadas.
//   3. Si el llamador ya tiene una transacción abierta en la misma conexión, las filas entran en
//      ella en vez de abrir otra (SQLite no anida `BEGIN`).
//
// Un fallo de escritura no llega a la aplicación: se informa por el canal de diagnóstico de
// OpenTelemetry y el lote se pierde. Medir no puede romper lo que se mide.
//
// Medición (2026-10-20, Node 24.20, SQLite en archivo con WAL y synchronous=FULL como el núcleo,
// `overhead.bench.mjs`): con tajadas de 16 filas la mediana de una tajada es 0,92 ms; sin bajar
// `synchronous` a NORMAL durante la tajada era 9,6 ms, porque cada COMMIT esperaba un fsync. El
// resto de las pausas largas (~30 ms) son puntos de control automáticos de WAL, ajenos al exportador.
// La cifra de sobrecarga por llamada está en la cabecera de `overhead.bench.mjs`.
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

// Niveles de `PRAGMA synchronous` de SQLite: 0 OFF, 1 NORMAL, 2 FULL, 3 EXTRA (sqlite.org/pragma.html).
const SYNCHRONOUS_NORMAL = 1;

const INSERT_SQL = `INSERT OR IGNORE INTO spans
  (trace_id, span_id, parent_id, name, kind, start_ns, end_ns, status, status_message, attributes_json, events_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Fila de la tabla `spans` para un span terminado del SDK. */
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
   * @param {import('node:sqlite').DatabaseSync} db conexión abierta por el núcleo, con la migración aplicada
   * @param {{rowsPerSlice?: number}} [options]
   */
  constructor(db, options = {}) {
    this.db = db;
    this.rowsPerSlice = options.rowsPerSlice ?? DEFAULTS.rowsPerSlice;
    this.relaxDurability = options.relaxDurability ?? true;
    this.statement = null;
    this.pending = []; // lotes por escribir: { spans, callback }
    this.running = false; // hay un vaciado programado o en curso
    this.stopped = false;
    this.waiters = [];
    this.slices = 0; // contador para las pruebas y las mediciones
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
            // Cede el bucle: lo que haya esperando corre antes de la tajada siguiente.
            if (batch.spans.length > 0) await new Promise((resolve) => setImmediate(resolve));
          }
        } catch (error) {
          ok = false;
          diag.error(`telemetría: no se pudieron escribir los spans en SQLite (${error?.message ?? error})`);
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
    // Con synchronous=FULL cada COMMIT espera un fsync (7 ms medidos) y eso es lo que ocupa el
    // bucle. Los spans son telemetría: perder los últimos tras un corte de luz es aceptable, un
    // archivo corrupto no lo es y WAL con NORMAL no se corrompe. Se baja a NORMAL sólo durante
    // esta tajada, que es síncrona, así que nadie más escribe con el ajuste cambiado.
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

  /** Baja `synchronous` a NORMAL y devuelve el nivel anterior; null si ya era NORMAL o más laxo. */
  #lowerDurability() {
    const current = this.db.prepare('PRAGMA synchronous').get().synchronous;
    if (current <= SYNCHRONOUS_NORMAL) return null;
    this.db.exec(`PRAGMA synchronous = ${SYNCHRONOUS_NORMAL}`);
    return current;
  }

  /** Resuelve cuando todo lo recibido hasta ahora ya está escrito. */
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

/** Borra los spans más viejos que `retentionDays` (misma retención que `job_events`, §7.10 bis). */
export function pruneSpans(db, { now = Date.now(), retentionDays = DEFAULTS.retentionDays } = {}) {
  const cutoffNs = BigInt(now - retentionDays * MS_PER_DAY) * NS_PER_MS;
  return Number(db.prepare('DELETE FROM spans WHERE end_ns < ?').run(cutoffNs).changes);
}
