// Calibration of charsPerToken and of the output cap: synthetic result files with a known answer, no real data.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { charsPerTokenFit, linearFit, outputByStep, percentile } from './calibrate.js';

const run = (estimate, real, calls = []) => ({
  stats: { classification_chunks: 1, partitioned: false, estimated_input_tokens: estimate },
  calls: [{ step: 'classify', modality: 'text', model: 'm', effort: 'low', max_tokens: 100, usage: { input_tokens: real - 40, cached_tokens: 30, cache_creation_tokens: 10, output_tokens: 5 } }, ...calls],
});
const file = (runs) => ({ cases: [{ case_id: 'c', runs }] });

describe('percentile', () => {
  it('is the nearest rank: the smallest value with at least p of the sample at or below it', () => {
    const sample = Array.from({ length: 20 }, (_, i) => i + 1);
    assert.equal(percentile(sample, 0.5), 10);
    assert.equal(percentile(sample, 0.95), 19);
    assert.equal(percentile(sample, 1), 20);
    assert.equal(percentile([7], 0.95), 7);
    assert.equal(percentile([], 0.95), null);
  });
});

describe('linearFit', () => {
  it('recovers the slope and the intercept of an exact line and says R² is 1', () => {
    const fit = linearFit([[1, 5], [2, 7], [3, 9]]);
    assert.ok(Math.abs(fit.slope - 2) < 1e-9 && Math.abs(fit.intercept - 3) < 1e-9 && Math.abs(fit.r2 - 1) < 1e-9);
  });
  it('has no answer with a single point or with every x equal', () => {
    assert.equal(linearFit([[1, 2]]), null);
    assert.equal(linearFit([[4, 1], [4, 9]]), null);
  });
});

describe('charsPerTokenFit', () => {
  it('the model counts 4/3 of the estimated tokens plus 2,500 of instructions: 3 chars per token estimated means 2.25 measured', () => {
    const runs = [400, 900, 2000, 5000, 12000].map((estimate) => run(estimate, 2500 + estimate * (4 / 3)));
    const [fit] = charsPerTokenFit([file(runs)], { charsPerToken: 3 });
    assert.equal(fit.model, 'm');
    assert.equal(fit.n, 5);
    assert.ok(Math.abs(fit.slope - 4 / 3) < 1e-9);
    assert.ok(Math.abs(fit.intercept - 2500) < 1e-6);
    assert.ok(Math.abs(fit.measuredCharsPerToken - 2.25) < 1e-9);
    assert.deepEqual(fit.estimateRange, [400, 12000]);
  });
  it('skips the runs that were partitioned or classified in several chunks', () => {
    const partitioned = { ...run(900, 3700), stats: { classification_chunks: 3, partitioned: true, estimated_input_tokens: 900 } };
    assert.deepEqual(charsPerTokenFit([file([partitioned])], { charsPerToken: 3 }), []);
  });
});

describe('outputByStep', () => {
  it('groups by step without the chunk suffix, model and effort, and counts the calls that reached the cap', () => {
    const decompose = (step, out) => ({ step, modality: 'text', model: 'm', effort: 'medium', max_tokens: 100, usage: { output_tokens: out } });
    const calls = [decompose('decompose[t1]', 10), decompose('decompose[t2]', 20), decompose('decompose[t3]', 100), { step: 'speech', modality: 'speech', usage: { output_tokens: 999 } }];
    const groups = outputByStep([file([run(500, 3200, calls)])]);
    const g = groups.find((x) => x.step === 'decompose');
    assert.equal(g.n, 3);
    assert.equal(g.effort, 'medium');
    assert.equal(g.p50, 20);
    assert.equal(g.max, 100);
    assert.equal(g.cap, 100);
    assert.equal(g.atCap, 1);
    assert.equal(groups.some((x) => x.step === 'speech'), false);
  });
});
