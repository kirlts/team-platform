// Pruebas de score.js: cada medida del informe 02 §5.2 con un caso armado a mano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score } from './score.js';

const units = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
const expected = {
  area: 'error',
  template: ['tpl-error', 'tpl-error-corto'],
  messages: [
    { id: 'g1', unit_ids: ['u1', 'u2'] },
    { id: 'g2', unit_ids: ['u3'] },
    { id: 'g3', unit_ids: ['u4', 'u5'] },
  ],
  discarded: ['u6'],
};
const run = (actual) => score({ units, expected, actual });

test('descomposición exacta: cobertura 1 y todo lo demás en 0', () => {
  const r = run({
    area_id: 'error',
    template_id: 'tpl-error',
    messages: [{ unit_ids: ['u1', 'u2'] }, { unit_ids: ['u3'] }, { unit_ids: ['u4', 'u5'] }],
    discarded: [{ unit_id: 'u6', reason: 'saludo' }],
  });
  assert.equal(r.rates.coverage, 1);
  assert.equal(r.counts.repeated, 0);
  assert.equal(r.counts.split, 0);
  assert.equal(r.counts.fused, 0);
  assert.equal(r.counts.extra, 0);
  assert.equal(r.counts.hole_units, 0);
  assert.equal(r.mece, true);
  assert.equal(r.area_ok, true);
  assert.equal(r.template_ok, true);
});

test('punto que falta: cobertura baja y hueco por unidad', () => {
  const r = run({ messages: [{ unit_ids: ['u1', 'u2'] }, { unit_ids: ['u4', 'u5'] }], discarded: ['u6'] });
  assert.equal(r.counts.covered, 2);
  assert.equal(r.counts.missing, 1);
  assert.equal(r.rates.coverage, 2 / 3);
  assert.deepEqual(r.details.hole_units, ['u3']);
  assert.equal(r.mece, false);
});

test('punto repetido: dos mensajes contienen el punto completo', () => {
  const r = run({
    messages: [{ unit_ids: ['u1', 'u2'] }, { unit_ids: ['u1', 'u2'] }, { unit_ids: ['u3'] }, { unit_ids: ['u4', 'u5'] }],
    discarded: ['u6'],
  });
  assert.equal(r.counts.repeated, 1);
  assert.equal(r.rates.repetition, 1 / 3);
  assert.deepEqual(r.details.overlap_units, ['u1', 'u2']);
  assert.equal(r.rates.coverage, 1);
});

test('un solape parcial también cuenta como repetición si el punto quedó completo en otro mensaje', () => {
  const r = run({
    messages: [{ unit_ids: ['u1', 'u2'] }, { unit_ids: ['u2', 'u3'] }, { unit_ids: ['u4', 'u5'] }],
    discarded: ['u6'],
  });
  assert.equal(r.counts.repeated, 1);
  assert.equal(r.counts.fused, 1);
});

test('punto partido: sus unidades se reparten sin quedar completas en ninguno', () => {
  const r = run({
    messages: [{ unit_ids: ['u1'] }, { unit_ids: ['u2'] }, { unit_ids: ['u3'] }, { unit_ids: ['u4', 'u5'] }],
    discarded: ['u6'],
  });
  assert.equal(r.counts.split, 1);
  assert.equal(r.rates.split, 1 / 3);
  assert.equal(r.counts.covered, 2);
  assert.equal(r.counts.repeated, 0);
});

test('punto incompleto: un solo mensaje con parte de sus unidades no es partido', () => {
  const r = run({
    messages: [{ unit_ids: ['u1'] }, { unit_ids: ['u3'] }, { unit_ids: ['u4', 'u5'] }],
    discarded: ['u6', 'u2'],
  });
  assert.equal(r.counts.partial, 1);
  assert.equal(r.counts.split, 0);
  assert.equal(r.rates.coverage, 2 / 3);
});

test('mensaje fusionado: un mensaje cubre dos puntos de la referencia', () => {
  const r = run({
    messages: [{ unit_ids: ['u1', 'u2', 'u3'] }, { unit_ids: ['u4', 'u5'] }],
    discarded: ['u6'],
  });
  assert.equal(r.counts.fused, 1);
  assert.equal(r.rates.fused, 1 / 2);
  assert.equal(r.rates.coverage, 1);
  assert.equal(r.mece, false);
});

test('mensaje de más: no toca ningún punto de la referencia, o no cita unidades', () => {
  const r = run({
    messages: [
      { unit_ids: ['u1', 'u2'] },
      { unit_ids: ['u3'] },
      { unit_ids: ['u4', 'u5'] },
      { unit_ids: ['u6'] },
      { unit_ids: [] },
    ],
  });
  assert.equal(r.counts.extra, 2);
  assert.equal(r.rates.extra, 2 / 5);
  assert.deepEqual(r.details.extra_messages, [3, 4]);
});

test('unidades inventadas por el analizador se ignoran y se cuentan', () => {
  const r = run({
    messages: [{ unit_ids: ['u1', 'u2', 'u99'] }, { unit_ids: ['u3'] }, { unit_ids: ['u4', 'u5'] }],
    discarded: ['u6'],
  });
  assert.equal(r.counts.invalid_unit_ids, 1);
  assert.deepEqual(r.details.invalid_unit_ids, ['u99']);
  assert.equal(r.rates.coverage, 1);
  assert.equal(r.mece, false);
});

test('área y plantilla: coincidencia exacta o dentro del conjunto aceptado', () => {
  const base = { messages: [] };
  assert.equal(run({ ...base, area_id: 'idea', template_id: 'tpl-error-corto' }).area_ok, false);
  assert.equal(run({ ...base, area_id: 'error', template_id: 'tpl-error-corto' }).template_ok, true);
  assert.equal(run({ ...base, area_id: 'error', template_id: 'otra' }).template_ok, false);
});

test('sin área esperada, area_ok es null', () => {
  const r = score({ units, expected: { messages: expected.messages }, actual: { messages: [], area_id: 'error' } });
  assert.equal(r.area_ok, null);
});

test('sin mensajes esperados ni obtenidos, las tasas son 0 y no hay división por cero', () => {
  const r = score({ units: ['u1'], expected: { messages: [] }, actual: { messages: [], discarded: ['u1'] } });
  assert.deepEqual(r.rates, { coverage: 0, repetition: 0, extra: 0, split: 0, fused: 0 });
});

test('las unidades pueden venir como objetos con id', () => {
  const r = score({
    units: [{ id: 'a' }, { id: 'b' }],
    expected: { messages: [{ id: 'g', unit_ids: ['a', 'b'] }] },
    actual: { messages: [{ unit_ids: ['a', 'b'] }] },
  });
  assert.equal(r.mece, true);
});
