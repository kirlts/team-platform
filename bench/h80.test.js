import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairedByPoint, percentile, pointOutcomes, pointRates } from './h80.js';

test('percentile uses the nearest rank', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
});

const run = (state, areaOk, exact) => ({
  score: {
    details: { points: [{ id: 'm1', state }] },
    assignment: { pair_list: [{ expected_id: 'm1', area_ok: areaOk, expected: [1], actual: exact ? [1] : [2] }] },
  },
});

test('pointOutcomes reads coverage, area and exact set per reference point', () => {
  const o = pointOutcomes(run('covered', true, false).score).get('m1');
  assert.deepEqual(o, { covered: true, area: true, exact: false });
});

test('pairedByPoint counts the points where each variant has the higher repetition rate', () => {
  const a = pointRates(new Map([['c', [run('covered', true, true), run('covered', true, true)]]]), 'exact');
  const b = pointRates(new Map([['c', [run('covered', true, true), run('covered', true, false)]]]), 'exact');
  assert.deepEqual(pairedByPoint(a, b), { a: 1, b: 0, tied: 0, p: 1 });
  assert.deepEqual(pairedByPoint(a, a), { a: 0, b: 0, tied: 1, p: 1 });
});
