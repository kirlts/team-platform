import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustedRand, consensus } from './consensus.js';

const templates = [{ id: 1, area_id: 1 }, { id: 2, area_id: 2 }, { id: 3, area_id: 3 }];
const group = (area, ...ids) => ({ area_id: area, template_id: area, unit_ids: ids });
const draw = (groups, discarded = []) => ({ groups, discarded: discarded.map((ids) => ({ unit_ids: ids, reason: 'x' })) });

test('adjustedRand is 1 for the same partition and lower for a different one', () => {
  const p = new Map([[1, 'a'], [2, 'a'], [3, 'b'], [4, 'b']]);
  assert.equal(adjustedRand(p, new Map([[1, 'x'], [2, 'x'], [3, 'y'], [4, 'y']])), 1);
  assert.ok(adjustedRand(p, new Map([[1, 'x'], [2, 'y'], [3, 'x'], [4, 'y']])) < 0.1);
});

test('a single draw is returned as it is', () => {
  const d = draw([group(1, 1, 2)], [[3]]);
  assert.deepEqual(consensus([d], templates), { groups: d.groups, discarded: d.discarded, medoid: 0 });
});

test('the medoid is the draw that agrees most with the others and its groups take the majority area', () => {
  const a = draw([group(1, 1, 2, 3), group(2, 4, 5, 6)]);
  const b = draw([group(1, 1, 2, 3), group(3, 4, 5, 6)]);
  const c = draw([group(1, 1, 2, 3), group(3, 4, 5, 6)]);
  const odd = draw([group(1, 1, 2), group(3, 3, 4), group(2, 5, 6)]);
  const out = consensus([odd, a, b, c], templates);
  assert.deepEqual(out.groups.map((g) => [g.area_id, g.template_id, g.unit_ids]), [[1, 1, [1, 2, 3]], [3, 3, [4, 5, 6]]]);
  assert.notEqual(out.medoid, 0);
});

test('the discards come from the medoid and a tie keeps the medoid area', () => {
  const a = draw([group(1, 1, 2)], [[3]]);
  const b = draw([group(2, 1, 2)], [[3]]);
  const out = consensus([a, b], templates);
  assert.deepEqual(out.discarded.map((d) => d.unit_ids), [[3]]);
  assert.equal(out.groups[0].area_id, out.medoid === 0 ? 1 : 2);
});
