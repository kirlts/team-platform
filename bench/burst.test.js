import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateRuns, burstPlan, chooseConcurrency, chooseInflightCap, createFetchTally, formatMarkdown, percentile, planRuns } from './burst.mjs';

test('percentile: nearest rank on a small sample', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([7], 95), 7);
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8], 50), 4);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8], 95), 8);
});

test('planRuns: a cell with C >= N is the same run as C = N and runs once', () => {
  assert.deepEqual(planRuns([1], [1, 2, 4, 8]), [{ n: 1, concurrency: 1, stands: [1, 2, 4, 8] }]);
  assert.deepEqual(planRuns([3], [1, 2, 4, 8]), [
    { n: 3, concurrency: 1, stands: [1] },
    { n: 3, concurrency: 2, stands: [2] },
    { n: 3, concurrency: 3, stands: [4, 8] }
  ]);
  assert.equal(planRuns([1, 3, 5, 8], [1, 2, 4, 8]).length, 1 + 3 + 4 + 4);
});

test('burstPlan: the first input is a case, audio is second, and a burst larger than the set repeats from the start', () => {
  const cases = ['01', '03', '04', '05', '06'].map((id) => ({ id, input: { text: '', attachments: [] } }));
  const ids = (n) => burstPlan(n, cases, '/a.m4a').map((p) => p.id);
  assert.deepEqual(ids(1), ['01']);
  assert.deepEqual(ids(3), ['01', 'audio', '04']);
  assert.deepEqual(ids(8), ['01', 'audio', '04', '05', '06', '03', '01', 'audio']);
});

const row = (n, concurrency, p95, { a429 = 0, g429 = 0, failed = 0 } = {}) => ({ n, concurrency, p95_ms: p95, failed, providers: { anthropic: { s429: a429 }, groq: { s429: g429 } } });

test('chooseConcurrency: lowest p95 among the runs of the largest N with no 429 and no failed input', () => {
  const rows = [row(5, 1, 1), row(8, 1, 40), row(8, 2, 30), row(8, 4, 20, { a429: 1 }), row(8, 8, 25, { g429: 2 }), row(8, 4, 28)];
  assert.deepEqual(chooseConcurrency(rows), rows[5]);
  assert.equal(chooseConcurrency([row(8, 2, 30, { failed: 1 })]), null);
  assert.equal(chooseConcurrency([row(8, 2, 30), row(8, 4, 30)]).concurrency, 4); // a tie goes to the larger C
});

test('formatMarkdown: a row per run with the 429s over the requests of each provider', () => {
  const r = { n: 3, concurrency: 2, wall_ms: 12345, p50_ms: 5000, p95_ms: 9000, done: 3, queue_retries: 1, cost_usd: 0.01234, providers: { anthropic: { s429: 1, requests: 20, peak_in_flight: 9 }, groq: { s429: 0, requests: 1 } } };
  assert.match(formatMarkdown([r]), /\| 3 \| 2 \| default \| 1 \| 12\.3 \| 5\.0 \| 9\.0 \| 3\/3 \| 0 \| 1 \/ 20 \| 0 \/ 1 \| 1 \| 9 \| 0 \| 0\.0 \| n\/a \| 0\.0123 \|/);
});

test('aggregateRuns: median of the times, sum of the counts, peak of the simultaneous requests', () => {
  const run = (wall, p50, p95, a429, peak, retries) => ({ n: 8, concurrency: 4, stands: [4], wall_ms: wall, p50_ms: p50, p95_ms: p95, done: 8, failed: 0, queue_retries: retries, cost_usd: 0.01, providers: { anthropic: { s429: a429, requests: 40, peak_in_flight: peak }, groq: { s429: 0, requests: 2, peak_in_flight: 1 } } });
  const agg = aggregateRuns([run(10, 5, 9, 0, 30, 0), run(30, 7, 20, 1, 50, 1), run(20, 6, 12, 0, 40, 0)]);
  assert.deepEqual([agg.reps, agg.wall_ms, agg.p50_ms, agg.p95_ms], [3, 20, 6, 12]);
  assert.deepEqual([agg.done, agg.queue_retries, agg.providers.anthropic.s429, agg.providers.anthropic.requests, agg.providers.anthropic.peak_in_flight], [24, 1, 1, 120, 50]);
  assert.equal(agg.runs.length, 3);
  assert.ok(Math.abs(agg.cost_usd - 0.03) < 1e-12);
});

test('createFetchTally: counts requests, 429 with Retry-After, peak in flight and the cost of Anthropic', async () => {
  const hit = [];
  const base = async (url) => {
    hit.push(String(url));
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (String(url).includes('groq')) return new Response('{}', { status: 429, headers: { 'retry-after': '2', 'x-ratelimit-limit-requests': '20', 'x-ratelimit-remaining-requests': '0' } });
    return new Response(JSON.stringify({ model: 'claude-haiku-5-5', usage: { input_tokens: 1_000_000, output_tokens: 0 } }), { status: 200, headers: { 'anthropic-ratelimit-requests-limit': '50', 'anthropic-ratelimit-requests-remaining': '48' } });
  };
  const tally = createFetchTally(base);
  await Promise.all([tally('https://api.anthropic.com/v1/messages'), tally('https://api.anthropic.com/v1/messages'), tally('https://api.groq.com/openai/v1/audio/transcriptions'), tally('https://example.org/x')]);
  const snap = tally.snapshot();
  assert.equal(hit.length, 4);
  assert.equal(snap.anthropic.requests, 2);
  assert.equal(snap.anthropic.peak_in_flight, 2);
  assert.equal(snap.anthropic.cost_usd, 1); // 2 x 1M input tokens at 0.50 USD per million above the 100k step
  assert.deepEqual(snap.anthropic.limits, { requests: 50 });
  assert.deepEqual(snap.anthropic.min_remaining, { requests: 48 });
  assert.equal(snap.groq.s429, 1);
  assert.deepEqual(snap.groq.retry_after_ms, [2000]);
  assert.deepEqual(snap.groq.min_remaining, { requests: 0 });
  assert.equal(tally.snapshot().anthropic.requests, 0); // a snapshot starts a new window
});

test('runBurst with fake modules: every input of the burst reaches its proposal and the report has the measured fields', async () => {
  const { runBurst } = await import('./burst.mjs');
  const { loadCases } = await import('./lib.js');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'burst-test-'));
  const audio = join(dir, 'voz.m4a');
  writeFileSync(audio, 'fake audio bytes');
  const cases = ['01-chat-grupo', '03-monologo-prueba', '04-reporte-de-error', '05-idea-suelta', '06-mensaje-mezclado'].map((id) => loadCases().find((c) => c.id === id));
  try {
    const row = await runBurst({ n: 5, concurrency: 2, cases, audio, fake: true, latencyMs: 20, tally: createFetchTally(globalThis.fetch), runTimeoutS: 30 });
    assert.equal(row.done, 5);
    assert.equal(row.failed, 0);
    assert.equal(row.timed_out, null);
    assert.ok(row.wall_ms >= 20 && row.p95_ms >= row.p50_ms && row.p50_ms > 0);
    assert.equal(row.inputs.length, 5);
    assert.ok(row.inputs.every((i) => i.status === 'proposed' && i.attempts === 1 && i.wait_ms !== null));
    // With two at a time, the last input waits for at least one earlier one to finish.
    assert.ok(Math.max(...row.inputs.map((i) => i.wait_ms)) >= 20);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chooseConcurrency: with allow429 a 429 the cap absorbed does not disqualify, a failed input still does', () => {
  const rows = [row(16, 3, 30), row(16, 6, 20, { a429: 2 }), row(16, 8, 10, { failed: 1 })];
  assert.equal(chooseConcurrency(rows).concurrency, 3);
  assert.equal(chooseConcurrency(rows, { allow429: true }).concurrency, 6);
});

test('chooseInflightCap: highest clean level below the first 429 of any repetition, minus one', () => {
  const rep = (...pairs) => pairs.map(([level, s429]) => ({ level, s429 }));
  const reps = [rep([4, 0], [8, 0], [12, 0], [16, 3]), rep([4, 0], [8, 0], [12, 2]), rep([4, 0], [8, 0], [12, 0], [16, 0], [24, 5])];
  assert.deepEqual(chooseInflightCap(reps), { highest_clean: 8, first_429_level: 12, cap: 7 });
  assert.deepEqual(chooseInflightCap([rep([4, 0], [8, 0])]), { highest_clean: 8, first_429_level: null, cap: 7 });
  assert.equal(chooseInflightCap([rep([4, 1])]), null);
});
