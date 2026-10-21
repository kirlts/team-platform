import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChunks, billableSeconds, mergeSegments } from './lib/chunks.js';
import { DEFAULTS } from './config.js';

const cfg = DEFAULTS.audio;

test('a short audio is a single chunk without overlap', () => {
  const plan = planChunks(240, cfg);
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0], { index: 0, start: 0, length: 240, cutStart: 0, cutEnd: Infinity });
});

test('20 minutes are 3 chunks of 600 s that start 5 s before the previous cut', () => {
  const plan = planChunks(1200, cfg);
  assert.deepEqual(plan.map((c) => [c.start, c.length]), [[0, 600], [595, 600], [1190, 10]]);
  // The cut is at the midpoint of each overlap.
  assert.equal(plan[1].cutStart, 597.5);
  assert.equal(plan[0].cutEnd, 597.5);
  assert.equal(plan[2].cutStart, (1190 + 1195) / 2);
});

test('a last chunk shorter than the billable minimum is absorbed by the previous one', () => {
  const plan = planChunks(1190 + 6, cfg); // the last chunk would last 6 s
  assert.equal(plan.length, 2);
  assert.equal(plan[1].start + plan[1].length, 1196);
  assert.equal(plan[1].cutEnd, Infinity);
});

test('chunks cover the whole audio without gaps', () => {
  for (const duration of [601, 900, 1190, 1195, 1500, 3600, 7321]) {
    const plan = planChunks(duration, cfg);
    assert.equal(plan[0].start, 0);
    for (let i = 1; i < plan.length; i++) {
      assert.ok(plan[i].start <= plan[i - 1].start + plan[i - 1].length - cfg.overlapSeconds + 1e-9, `gap at ${duration}`);
    }
    const last = plan.at(-1);
    assert.equal(last.start + last.length, duration);
  }
});

test('an overlap greater than or equal to the chunk is rejected', () => {
  assert.throws(() => planChunks(100, { chunkSeconds: 10, overlapSeconds: 10, minChunkSeconds: 1 }));
});

test('the 10 s minimum per request is billed and overlaps are counted', () => {
  const plan = planChunks(1200, cfg);
  assert.equal(billableSeconds(plan, 10), 600 + 600 + 10);
  assert.equal(billableSeconds(planChunks(4, cfg), 10), 10);
});

test('merging adds the offset, cuts at the midpoint and does not repeat the overlap', () => {
  const plan = planChunks(40, { chunkSeconds: 20, overlapSeconds: 5, minChunkSeconds: 10 });
  assert.deepEqual(plan.map((c) => c.start), [0, 15, 30]);
  // Each chunk hears one segment every 5 s of its own clock.
  const byChunk = plan.map((c) => {
    const segs = [];
    for (let t = 0; t < c.length; t += 5) segs.push({ start: t, end: t + 5, text: `s${c.start + t}` });
    return segs;
  });
  const merged = mergeSegments(plan, byChunk);
  assert.deepEqual(merged.map((s) => s.start), [0, 5, 10, 15, 20, 25, 30, 35]);
  assert.equal(new Set(merged.map((s) => s.text)).size, merged.length, 'no segment repeated');
  for (let i = 1; i < merged.length; i++) assert.ok(merged[i].start > merged[i - 1].start);
});
