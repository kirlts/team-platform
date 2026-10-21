import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAudioBudget } from './audio-budget.js';

const HOUR = 3_600_000;

test('the default budget is 7,200 s per hour', () => {
  const budget = createAudioBudget();
  assert.equal(budget.check(7200, 0).allowed, true);
  assert.equal(budget.check(7201, 0).allowed, false);
  assert.equal(budget.check(7201, 0).reason, 'exceeds_budget');
});

test('six 20-minute videos fit in one hour and the seventh waits', () => {
  const budget = createAudioBudget({ secondsPerHour: 7200 });
  for (let i = 0; i < 6; i++) {
    assert.equal(budget.check(1200, i * 1000).allowed, true);
    budget.record(1200, i * 1000);
  }
  const seventh = budget.check(1200, 10_000);
  assert.equal(seventh.allowed, false);
  // Room frees up when the first one expires, recorded at millisecond 0.
  assert.equal(seventh.waitMs, HOUR - 10_000);
  assert.equal(budget.check(1200, HOUR).allowed, true);
});

test('the wait is that of the first event that frees enough', () => {
  const budget = createAudioBudget({ secondsPerHour: 1000 });
  budget.record(300, 0);
  budget.record(300, 1_000_000);
  budget.record(300, 2_000_000);
  // Used: 900. To ask for 500, 400 must be freed: the first two expire.
  assert.equal(budget.check(500, 3_000_000).waitMs, 1_000_000 + HOUR - 3_000_000);
  assert.equal(budget.used(3_000_000), 900);
});
