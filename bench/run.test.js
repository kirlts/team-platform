// The bench runner with the real analyzer from src/analyze and fake providers: no network, no keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCases, loadFixtures, runCase, summarize, formatReport } from './lib.js';
import { createBenchProviders } from './fake-providers.js';
import { costOf, PRICES } from './pricing.js';
import { analyze } from '../src/analyze/index.js';

const cases = loadCases();
const fixtures = await loadFixtures();
const run = (testCase, mode = 'perfect', latencyMs = 0) =>
  runCase({ analyze, providers: createBenchProviders({ expected: testCase.expected, mode, latencyMs }), testCase, fixtures });
const byId = (id) => cases.find((c) => c.id === id);

test('with perfect fake providers, the seven cases score MECE and classify correctly', async () => {
  for (const c of cases) {
    const r = await run(c);
    assert.equal(r.status, 'ok', c.id);
    assert.equal(r.score.mece, true, `${c.id}: ${JSON.stringify(r.score.counts)}`);
    assert.equal(r.score.rates.classification_accuracy, 1, c.id);
  }
});

test('in noisy mode, the bench detects that the decomposition is no longer MECE', async () => {
  for (const id of ['02-docx-40-puntos', '03-monologo-prueba']) {
    const r = await run(byId(id), 'noisy');
    assert.notEqual(r.status, 'ok', `${id}: the analyzer was supposed to reject the corrupted output`);
    assert.equal(r.score.mece, false, id);
    assert.ok(r.score.counts.fused > 0, `${id}: there must be fused messages`);
    assert.ok(r.score.counts.repeated > 0, `${id}: there must be repeated points`);
    assert.ok(r.score.rates.coverage < 1, `${id}: a point must be missing`);
  }
});

test('noisy mode lowers the classification accuracy even if the case has a single message', async () => {
  const r = await run(byId('04-reporte-de-error'), 'noisy');
  assert.equal(r.score.rates.classification_accuracy, 0);
  assert.equal(r.score.mece, true, 'the classification does not change the MECE score');
});

test('measures time per step, calls, tokens and cost', async () => {
  const r = await run(byId('02-docx-40-puntos'), 'perfect', 15);
  assert.ok(r.steps.length >= 4, 'the analyzer reports several steps');
  assert.ok(r.steps.every((s) => typeof s.phrase === 'string' && s.ms >= 0));
  assert.ok(r.steps.reduce((acc, s) => acc + s.ms, 0) <= r.total_ms + 1);
  assert.ok(r.total_ms >= 29, `two rounds of 15 ms: ${r.total_ms}`);
  assert.ok(r.usage.calls >= 2);
  assert.ok(r.usage.model_ms >= 30);
  assert.ok(r.usage.input_tokens > 0 && r.usage.output_tokens > 0);
  assert.ok(r.usage.cost_usd > 0);
  assert.equal(r.stats.groups > 1, true);
});

test('the cost comes from the specification list price and is null without a price', () => {
  const p = PRICES['claude-haiku-5-5'];
  const model = 'claude-haiku-5-5';
  const usage = { input_tokens: 1000, output_tokens: 200, cached_tokens: 3000, cache_creation_tokens: 400 };
  const expected = (1000 * p.input + 200 * p.output + 3000 * p.cache_read + 400 * p.input * p.cache_write_factor) / 1e6;
  assert.ok(Math.abs(costOf({ model, usage }) - expected) < 1e-12);
  assert.ok(Math.abs(costOf({ model, usage: { input_tokens: 200_000 } }) - 200_000 * p.input_over_threshold / 1e6) < 1e-12);
  assert.equal(costOf({ model: 'otro-modelo', usage }), null);
  assert.equal(costOf({ model: 'otro-modelo', usage, cost_usd: 0.5 }), 0.5);
});

test('summarize aggregates repetitions and the report lists each case', async () => {
  const summaries = [];
  for (const c of cases) {
    const runs = [];
    for (let i = 0; i < 3; i += 1) runs.push(await run(c));
    summaries.push(summarize(runs));
  }
  assert.ok(summaries.every((s) => s.repeats === 3 && s.mece_passes === 3));
  const text = formatReport(summaries);
  for (const c of cases) assert.ok(text.includes(c.id));
});

test('run.mjs --fake perfect finishes well with repetitions and a case filter', () => {
  const script = fileURLToPath(new URL('./run.mjs', import.meta.url));
  const out = execFileSync(process.execPath, [script, '--fake', 'perfect', '--repeat', '2', '--case', '04-reporte-de-error', '--no-write'], { encoding: 'utf8' });
  assert.match(out, /04-reporte-de-error\s+ok×2\s+2\/2/);
});

test('run.mjs rejects an unknown fake mode', () => {
  const script = fileURLToPath(new URL('./run.mjs', import.meta.url));
  assert.throws(
    () => execFileSync(process.execPath, [script, '--fake', 'raro', '--no-write'], { encoding: 'utf8', stdio: 'pipe' }),
    (error) => /perfect or noisy/.test(error.stderr),
  );
});
