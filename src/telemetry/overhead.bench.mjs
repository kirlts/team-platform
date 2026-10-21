// Medición de la sobrecarga de la telemetría por llamada a un modelo (MASTER-SPEC §7.10 bis, UD-014).
// Se corre a pedido: `node src/telemetry/overhead.bench.mjs` (no es una prueba; `npm test` no lo toma).
//
// Qué mide, con una llamada de proveedor falso que responde al instante (así lo medido es la
// telemetría y no el proveedor):
//   1. Camino caliente: costo extra por llamada con el SDK activo frente a la misma llamada sin SDK
//      registrado (tracer nulo). Rondas alternadas y mediana, porque una sola ronda varía ±10 µs.
//   2. Escritura: microsegundos por span y duración de cada tajada de `SqliteSpanExporter`, por
//      tamaño de tajada, sobre SQLite en archivo con WAL y synchronous=FULL (como el núcleo).
//   3. Bucle de eventos: el retraso más largo que ve un temporizador de 1 ms mientras se vuelcan
//      los spans.
//
// Resultado (2026-10-20, Node 24.20.0, SQLite 3.51+ de node:sqlite, Linux 7.2, archivo en disco local,
// WAL, synchronous=FULL, busy_timeout 5000 ms, spans de llamada con 10 KB de contenido):
//   Camino caliente: 9,4 µs por llamada sin SDK y 31,5 µs con SDK y exportador (mediana de 7 rondas
//   de 2000 llamadas; rondas sueltas entre 21 y 40 µs). Sobrecarga por llamada: 22 µs en el camino
//   de la llamada, a lo que se suma la escritura diferida a SQLite de 0,19 a 0,39 ms por span
//   (2000 spans en 771 ms en el vaciado, 187 µs por span en lotes de 2048), repartida en tajadas
//   de ~1 ms. Una llamada a un modelo tarda de 6,8 s a 33,9 s en el banco (TEST.md, Métricas), así
//   que la telemetría añade menos de 0,01 % a la latencia de una llamada.
//   Tajadas de 16 filas: mediana 0,92 ms, p99 26,6 ms. El p99 y el retraso máximo del bucle (~30 ms)
//   son los puntos de control automáticos de WAL (cada 1000 páginas, unos 4 MiB, o sea cada ~400
//   spans de este tamaño): con `PRAGMA wal_autocheckpoint = 0` en la misma corrida, tajadas de 16
//   filas dan mediana 0,42 ms, p99 1,21 ms, retraso máximo del bucle 1,4 ms y 32 µs por span. El
//   punto de control lo dispara cualquier escritura de la conexión del núcleo, no el exportador.
//   Sin el ajuste de `synchronous` a NORMAL durante la tajada (sqlite-exporter.js) la misma tajada
//   de 16 filas medía 9,6 ms de mediana: el fsync de cada COMMIT con FULL ocupaba el bucle.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createFakeProviders } from '../providers/fake.js';
import { initTelemetry } from './index.js';
import { SqliteSpanExporter } from './sqlite-exporter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// Una llamada típica: un prompt de 8 KB (un input con adjuntos ya extraídos) y una respuesta de 2 KB.
const PROMPT = 'p'.repeat(8 * 1024);
const ANSWER = 'r'.repeat(2 * 1024);
const CALLS_PER_ROUND = 2000;
const ROUNDS = 7;
const SLICES = [1, 4, 16, 64, 512];
const BATCH = 2048; // spans por lote en la sección de escritura; es el tope de la cola de BatchSpanProcessor (config.js)

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
  return ((performance.now() - start) * 1000) / CALLS_PER_ROUND; // µs por llamada
}

// 1. Camino caliente: rondas alternadas sin SDK y con SDK.
const without = [];
const withSdk = [];
let spansWritten = 0;
let bytesWritten = 0;
let flushMs = 0;
await round(provider()); // calentamiento del JIT
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

console.log(`--- Camino caliente (µs por llamada; mediana de ${ROUNDS} rondas de ${CALLS_PER_ROUND} llamadas) ---`);
console.log(`sin SDK registrado (tracer nulo): ${median(without).toFixed(1)}   [rondas: ${without.map((v) => v.toFixed(0)).join(' ')}]`);
console.log(`con SDK y exportador a SQLite:    ${median(withSdk).toFixed(1)}   [rondas: ${withSdk.map((v) => v.toFixed(0)).join(' ')}]`);
console.log(`sobrecarga por llamada:           ${(median(withSdk) - median(without)).toFixed(1)}`);
console.log(`vaciado final de ${spansWritten} spans: ${flushMs.toFixed(0)} ms (${((flushMs * 1000) / spansWritten).toFixed(0)} µs por span, ${(bytesWritten / spansWritten / 1024).toFixed(1)} KB de contenido por span)`);

// 2 y 3. Escritura por tajadas y bucle de eventos.
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

console.log(`\n--- Escritura de ${BATCH} spans de llamada (10 KB de contenido) por tamaño de tajada ---`);
console.log('filas/tajada | µs por span | tajada p50 ms | tajada p99 ms | retraso máx. del bucle ms');
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
console.log(`\nbucle ocioso (referencia): retraso máx. ${(idle.max / 1e6).toFixed(1)} ms`);
