// H-1600: the coverage measurement of bench/probe-compound.mjs and the public case that exercises it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverage, SENTENCES } from './probe-compound.mjs';
import { loadCases } from './lib.js';

test('coverage: one message that names both points covers them; one that names a point does not', () => {
  const both = { messages: [{ title: 'Corregir el menú cortado y la lentitud de ajustes', body: 'x', fields: {} }] };
  const one = { messages: [{ title: 'Corregir el menú cortado', body: 'El menú se corta.', fields: { where: 'teléfono' } }] };
  assert.equal(coverage(both, ['menú', 'ajustes']).all, true);
  assert.deepEqual(coverage(one, ['menú', 'ajustes']).found, [true, false]);
  assert.equal(coverage({ messages: [] }, ['menú']).all, false);
});

test('case 09: every expected message mentions at least two points and the sentences of the probe are in its text', () => {
  const c = loadCases().find((x) => x.id === '09-oracion-compuesta');
  assert.ok(c, 'case 09 exists');
  for (const m of c.expected.messages) assert.ok(m.mentions.length >= 2, `${m.id} lists the points its unit carries`);
  const probed = SENTENCES.filter((s) => c.input.text.includes(s.text.replace(/^Me encanta/, 'Me encanta')));
  assert.ok(probed.length >= 1, 'the probe repeats a sentence of the case');
});
