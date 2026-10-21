// Tests for score.js: each report 02 §5.2 measure with a hand-built case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score } from './score.js';

const units = [1, 2, 3, 4, 5, 6];
const expected = {
  messages: [
    { id: 'g1', unit_ids: [1, 2], area_id: 2, template_id: 2 },
    { id: 'g2', unit_ids: [3], area_id: [3, 4], template_id: [3, 4] },
    { id: 'g3', unit_ids: [4, 5], area_id: 5, template_id: 5 },
  ],
};
const run = (actual) => score({ units, expected, actual });

test('exact decomposition: coverage 1, everything else at 0 and full classification', () => {
  const r = run({
    messages: [
      { unit_ids: [1, 2], area_id: 2, template_id: 2 },
      { unit_ids: [3], area_id: 4, template_id: 4 },
      { unit_ids: [4, 5], area_id: 5, template_id: 5 },
    ],
    discarded: [{ unit_ids: [6], reason: 'saludo' }],
  });
  assert.equal(r.rates.coverage, 1);
  assert.equal(r.counts.repeated, 0);
  assert.equal(r.counts.split, 0);
  assert.equal(r.counts.fused, 0);
  assert.equal(r.counts.extra, 0);
  assert.equal(r.counts.hole_units, 0);
  assert.equal(r.mece, true);
  assert.equal(r.rates.classification_accuracy, 1);
});

test('missing point: coverage drops and there is a hole per unit', () => {
  const r = run({ messages: [{ unit_ids: [1, 2] }, { unit_ids: [4, 5] }], discarded: [6] });
  assert.equal(r.counts.covered, 2);
  assert.equal(r.counts.missing, 1);
  assert.equal(r.rates.coverage, 2 / 3);
  assert.deepEqual(r.details.hole_units, [3]);
  assert.equal(r.mece, false);
});

test('repeated point: two messages contain the whole point', () => {
  const r = run({
    messages: [{ unit_ids: [1, 2] }, { unit_ids: [1, 2] }, { unit_ids: [3] }, { unit_ids: [4, 5] }],
    discarded: [6],
  });
  assert.equal(r.counts.repeated, 1);
  assert.equal(r.rates.repetition, 1 / 3);
  assert.deepEqual(r.details.overlap_units, [1, 2]);
  assert.equal(r.rates.coverage, 1);
});

test('a partial overlap also counts as repetition if the point was complete in another message', () => {
  const r = run({
    messages: [{ unit_ids: [1, 2] }, { unit_ids: [2, 3] }, { unit_ids: [4, 5] }],
    discarded: [6],
  });
  assert.equal(r.counts.repeated, 1);
  assert.equal(r.counts.fused, 1);
});

test('split point: its units are distributed without being complete in any', () => {
  const r = run({
    messages: [{ unit_ids: [1] }, { unit_ids: [2] }, { unit_ids: [3] }, { unit_ids: [4, 5] }],
    discarded: [6],
  });
  assert.equal(r.counts.split, 1);
  assert.equal(r.rates.split, 1 / 3);
  assert.equal(r.counts.covered, 2);
  assert.equal(r.counts.repeated, 0);
});

test('incomplete point: a single message with part of its units is not split', () => {
  const r = run({
    messages: [{ unit_ids: [1] }, { unit_ids: [3] }, { unit_ids: [4, 5] }],
    discarded: [6, 2],
  });
  assert.equal(r.counts.partial, 1);
  assert.equal(r.counts.split, 0);
  assert.equal(r.rates.coverage, 2 / 3);
});

test('fused message: one message covers two reference points', () => {
  const r = run({
    messages: [{ unit_ids: [1, 2, 3] }, { unit_ids: [4, 5] }],
    discarded: [6],
  });
  assert.equal(r.counts.fused, 1);
  assert.equal(r.rates.fused, 1 / 2);
  assert.equal(r.rates.coverage, 1);
  assert.equal(r.mece, false);
});

test('extra message: touches no reference point, or cites no units', () => {
  const r = run({
    messages: [
      { unit_ids: [1, 2] },
      { unit_ids: [3] },
      { unit_ids: [4, 5] },
      { unit_ids: [6] },
      { unit_ids: [] },
    ],
  });
  assert.equal(r.counts.extra, 2);
  assert.equal(r.rates.extra, 2 / 5);
  assert.deepEqual(r.details.extra_messages, [3, 4]);
});

test('units invented by the analyzer are ignored and counted', () => {
  const r = run({
    messages: [{ unit_ids: [1, 2, 99] }, { unit_ids: [3] }, { unit_ids: [4, 5] }],
    discarded: [6],
  });
  assert.equal(r.counts.invalid_unit_ids, 1);
  assert.deepEqual(r.details.invalid_unit_ids, [99]);
  assert.equal(r.rates.coverage, 1);
  assert.equal(r.mece, false);
});

test('classification: counts per unit, with accepted areas and templates as a list', () => {
  const r = run({
    messages: [
      { unit_ids: [1, 2], area_id: 2, template_id: 2 }, // correct
      { unit_ids: [3], area_id: 3, template_id: 1 }, // accepted area, template not
      { unit_ids: [4, 5], area_id: 1, template_id: 5 }, // wrong area, correct template
    ],
    discarded: [6],
  });
  assert.equal(r.counts.units, 5);
  assert.equal(r.counts.area_correct, 3);
  assert.equal(r.counts.template_correct, 4);
  assert.equal(r.counts.both_correct, 2);
  assert.equal(r.rates.area_accuracy, 3 / 5);
  assert.equal(r.rates.template_accuracy, 4 / 5);
  assert.equal(r.rates.classification_accuracy, 2 / 5);
  assert.equal(r.mece, true, 'a wrong classification does not break the MECE decomposition');
});

test('classification: a unit without a message, or in two messages with different areas, counts as wrong', () => {
  const r = run({
    messages: [
      { unit_ids: [1, 2], area_id: 2, template_id: 2 },
      { unit_ids: [2], area_id: 1, template_id: 1 },
      { unit_ids: [4, 5], area_id: 5, template_id: 5 },
    ],
    discarded: [6],
  });
  // u1 correct; u2 in two areas; u3 in no message; u4 and u5 correct.
  assert.equal(r.counts.area_correct, 3);
});

test('without expected area or template, the classification accuracy is null', () => {
  const r = score({
    units,
    expected: { messages: [{ id: 'g', unit_ids: [1] }] },
    actual: { messages: [{ unit_ids: [1], area_id: 2, template_id: 2 }] },
  });
  assert.equal(r.rates.classification_accuracy, null);
});

test('discarded items accept bare ids, { unit_id } and { unit_ids, reason }', () => {
  const base = { messages: [{ unit_ids: [1, 2] }, { unit_ids: [3] }, { unit_ids: [4, 5] }] };
  assert.equal(run({ ...base, discarded: [6] }).counts.hole_units, 0);
  assert.equal(run({ ...base, discarded: [{ unit_id: 6 }] }).counts.hole_units, 0);
  assert.equal(run({ ...base, discarded: [{ unit_ids: [6], reason: 'x' }] }).counts.hole_units, 0);
  assert.equal(run({ ...base }).counts.hole_units, 1);
});

test('without expected or obtained messages, the rates are 0 and there is no division by zero', () => {
  const r = score({ units: [1], expected: { messages: [] }, actual: { messages: [], discarded: [1] } });
  assert.deepEqual(r.rates, { coverage: 0, repetition: 0, extra: 0, split: 0, fused: 0, area_accuracy: null, template_accuracy: null, classification_accuracy: null });
});

test('units can come as objects with an id', () => {
  const r = score({
    units: [{ id: 'a' }, { id: 'b' }],
    expected: { messages: [{ id: 'g', unit_ids: ['a', 'b'] }] },
    actual: { messages: [{ unit_ids: ['a', 'b'] }] },
  });
  assert.equal(r.mece, true);
});
