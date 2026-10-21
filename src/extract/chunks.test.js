import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChunks, billableSeconds, mergeSegments } from './lib/chunks.js';
import { DEFAULTS } from './config.js';

const cfg = DEFAULTS.audio;

test('un audio corto es un solo trozo sin solapamiento', () => {
  const plan = planChunks(240, cfg);
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0], { index: 0, start: 0, length: 240, cutStart: 0, cutEnd: Infinity });
});

test('20 minutos son 3 trozos de 600 s que empiezan 5 s antes del corte anterior', () => {
  const plan = planChunks(1200, cfg);
  assert.deepEqual(plan.map((c) => [c.start, c.length]), [[0, 600], [595, 600], [1190, 10]]);
  // El corte está en el punto medio de cada solapamiento.
  assert.equal(plan[1].cutStart, 597.5);
  assert.equal(plan[0].cutEnd, 597.5);
  assert.equal(plan[2].cutStart, (1190 + 1195) / 2);
});

test('un último trozo menor que el mínimo facturable lo absorbe el anterior', () => {
  const plan = planChunks(1190 + 6, cfg); // el último trozo duraría 6 s
  assert.equal(plan.length, 2);
  assert.equal(plan[1].start + plan[1].length, 1196);
  assert.equal(plan[1].cutEnd, Infinity);
});

test('los trozos cubren todo el audio sin huecos', () => {
  for (const duration of [601, 900, 1190, 1195, 1500, 3600, 7321]) {
    const plan = planChunks(duration, cfg);
    assert.equal(plan[0].start, 0);
    for (let i = 1; i < plan.length; i++) {
      assert.ok(plan[i].start <= plan[i - 1].start + plan[i - 1].length - cfg.overlapSeconds + 1e-9, `hueco en ${duration}`);
    }
    const last = plan.at(-1);
    assert.equal(last.start + last.length, duration);
  }
});

test('un solapamiento mayor o igual que el trozo se rechaza', () => {
  assert.throws(() => planChunks(100, { chunkSeconds: 10, overlapSeconds: 10, minChunkSeconds: 1 }));
});

test('se factura el mínimo de 10 s por solicitud y se cuentan los solapamientos', () => {
  const plan = planChunks(1200, cfg);
  assert.equal(billableSeconds(plan, 10), 600 + 600 + 10);
  assert.equal(billableSeconds(planChunks(4, cfg), 10), 10);
});

test('la fusión suma el desfase, corta en el punto medio y no repite el solapamiento', () => {
  const plan = planChunks(40, { chunkSeconds: 20, overlapSeconds: 5, minChunkSeconds: 10 });
  assert.deepEqual(plan.map((c) => c.start), [0, 15, 30]);
  // Cada trozo oye un segmento cada 5 s de su propio reloj.
  const byChunk = plan.map((c) => {
    const segs = [];
    for (let t = 0; t < c.length; t += 5) segs.push({ start: t, end: t + 5, text: `s${c.start + t}` });
    return segs;
  });
  const merged = mergeSegments(plan, byChunk);
  assert.deepEqual(merged.map((s) => s.start), [0, 5, 10, 15, 20, 25, 30, 35]);
  assert.equal(new Set(merged.map((s) => s.text)).size, merged.length, 'ningún segmento repetido');
  for (let i = 1; i < merged.length; i++) assert.ok(merged[i].start > merged[i - 1].start);
});
