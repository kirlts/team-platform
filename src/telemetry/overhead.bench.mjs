// Measurement of telemetry overhead per model call (MASTER-SPEC §7.10 bis, UD-014).
// Run on demand: `node src/telemetry/overhead.bench.mjs` (it is not a test; `npm test` does not pick it up).
//
// What it measures, with a fake provider call that answers instantly (so what is measured is the
// telemetry and not the provider):
//   1. Hot path: extra cost per call with the SDK active versus the same call with no SDK
//      registered (no-op tracer). Alternating rounds and median, because a single round varies ±10 µs.
//   2. Writing: microseconds per span and duration of each `SqliteSpanExporter` slice, by
//      slice size, over SQLite on file with WAL and synchronous=FULL (like the core).
//   3. Event loop: the longest delay seen by a 1 ms timer while the spans are being
//      flushed.
//
// Result (2026-10-20, Node 24.20.0, SQLite 3.51+ of node:sqlite, Linux 7.2, file on local disk,
// WAL, synchronous=FULL, busy_timeout 5000 ms, call spans with 10 KB of content):
//   Hot path: 9.4 µs per call without SDK and 31.5 µs with SDK and exporter (median of 7 rounds
//   of 2000 calls; individual rounds between 21 and 40 µs). Overhead per call: 22 µs on the path
//   of the call, plus the deferred write to SQLite of 0.19 to 0.39 ms per span
//   (2000 spans in 771 ms in the flush, 187 µs per span in batches of 2048), spread over slices
//   of ~1 ms. A model call takes 6.8 s to 33.9 s in the bench (TEST.md, Metrics), so
//   telemetry adds less than 0.01 % to the latency of a call.
//   Slices of 16 rows: median 0.92 ms, p99 26.6 ms. The p99 and the maximum loop delay (~30 ms)
//   are the automatic WAL checkpoints (every 1000 pages, about 4 MiB, i.e. every ~400
//   spans of this size): with `PRAGMA wal_autocheckpoint = 0` in the same run, slices of 16
//   rows give median 0.42 ms, p99 1.21 ms, maximum loop delay 1.4 ms and 32 µs per span. The
//   checkpoint is triggered by any write on the core's connection, not by the exporter.
//   Without lowering `synchronous` to NORMAL during the slice (sqlite-exporter.js) the same slice
//   of 16 rows measured a median of 9.6 ms: the fsync of each COMMIT under FULL hogged the loop.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createFakeProviders } from '../providers/fake.js';
import { initTelemetry } from './index.js';
import { SqliteSpanExporter } from './sqlite-exporter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// A typical call: an 8 KB prompt (an input with already extracted attachments) and a 2 KB answer.
const PROMPT = 'p'.repeat(8 * 1024);
const ANSWER = 'r'.repeat(2 * 1024);
const CALLS_PER_ROUND = 2000;
const ROUNDS = 7;
const SLICES = [1, 4, 16, 64, 512];
const BATCH = 2048; // spans per batch in the writing section; it is the cap of the BatchSpanProcessor queue (config.js)

function openDb() {
  mkdirSync(join(HERE, '.tmp'), { recursive: true });
  const dir = mkdtempSync(join(HERE, '.tmp', 'bench-'));
  const db = new DatabaseSync(join(dir, 'team.db'), { timeout: 5000 });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec(readFileSync(join(HERE, 'migration.sql'), 'utf8'));
  return {
    db,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const provider = () =>
  createFakeProviders({ text: () => ({ json: { r: ANSWER }, usage: { input_tokens: 2000, output_tokens: 500, cached_tokens: 0 } }) }).text;
const request = { system: ['sistema'], messages: [{ role: 'user', content: PROMPT }], schema: { type: 'object' } };
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

async function round(p) {
  const start = performance.now();
  for (let i = 0; i < CALLS_PER_ROUND; i++) await p.complete(request);
  return ((performance.now() - start) * 1000) / CALLS_PER_ROUND; // µs per call
}

// 1. Hot path: alternating rounds without SDK and with SDK.
const without = [];
const withSdk = [];
let spansWritten = 0;
let bytesWritten = 0;
let flushMs = 0;
await round(provider()); // JIT warm-up
for (let r = 0; r < ROUNDS; r++) {
  without.push(await round(provider()));
  const store = openDb();
  const telemetry = initTelemetry({ db: store.db, env: {} });
  withSdk.push(await round(provider()));
  const t0 = performance.now();
  await telemetry.flush();
  flushMs = performance.now() - t0;
  spansWritten = store.db.prepare('SELECT COUNT(*) AS n FROM spans').get().n;
  bytesWritten = store.db.prepare('SELECT SUM(LENGTH(attributes_json) + LENGTH(events_json)) AS b FROM spans').get().b;
  await telemetry.shutdown();
  store.cleanup();
}

console.log(`--- Hot path (µs per call; median of ${ROUNDS} rounds of ${CALLS_PER_ROUND} calls) ---`);
console.log(`without SDK registered (no-op tracer): ${median(without).toFixed(1)}   [rounds: ${without.map((v) => v.toFixed(0)).join(' ')}]`);
console.log(`with SDK and SQLite exporter:         ${median(withSdk).toFixed(1)}   [rounds: ${withSdk.map((v) => v.toFixed(0)).join(' ')}]`);
console.log(`overhead per call:                    ${(median(withSdk) - median(without)).toFixed(1)}`);
console.log(`final flush of ${spansWritten} spans: ${flushMs.toFixed(0)} ms (${((flushMs * 1000) / spansWritten).toFixed(0)} µs per span, ${(bytesWritten / spansWritten / 1024).toFixed(1)} KB of content per span)`);

// 2 and 3. Slice writing and event loop.
const sample = (i) => ({
  name: `chat m${i}`,
  kind: 2,
  spanContext: () => ({ traceId: 'a'.repeat(32), spanId: i.toString(16).padStart(16, '0') }),
  parentSpanContext: undefined,
  startTime: [1792548000, 0],
  endTime: [1792548000, 500000],
  status: { code: 0 },
  attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.usage.input_tokens': 2000, 'team.job_id': '1' },
  events: [{ name: 'gen_ai.client.inference.operation.details', time: [1792548000, 100], attributes: { 'gen_ai.input.messages': PROMPT, 'gen_ai.output.messages': ANSWER } }],
});

console.log(`\n--- Writing ${BATCH} call spans (10 KB of content) by slice size ---`);
console.log('rows/slice | µs per span | slice p50 ms | slice p99 ms | max loop delay ms');
for (const rows of SLICES) {
  const store = openDb();
  const exporter = new SqliteSpanExporter(store.db, { rowsPerSlice: rows });
  const durations = [];
  let began = 0;
  const exec = store.db.exec.bind(store.db);
  store.db.exec = (sql) => {
    if (sql === 'BEGIN IMMEDIATE') began = performance.now();
    const out = exec(sql);
    if (sql === 'COMMIT') durations.push(performance.now() - began);
    return out;
  };
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  histogram.enable();
  const batch = Array.from({ length: BATCH }, (_, i) => sample(i));
  const start = performance.now();
  await new Promise((resolve) => exporter.export(batch, resolve));
  const total = performance.now() - start;
  histogram.disable();
  durations.sort((a, b) => a - b);
  console.log(
    `${String(rows).padStart(12)} | ${String(Math.round((total * 1000) / BATCH)).padStart(11)} | ${pct(durations, 0.5).toFixed(2).padStart(13)} | ${pct(durations, 0.99).toFixed(2).padStart(13)} | ${(histogram.max / 1e6).toFixed(1).padStart(25)}`,
  );
  store.cleanup();
}

const idle = monitorEventLoopDelay({ resolution: 1 });
idle.enable();
await new Promise((resolve) => setTimeout(resolve, 200));
idle.disable();
console.log(`\nidle loop (reference): max delay ${(idle.max / 1e6).toFixed(1)} ms`);
