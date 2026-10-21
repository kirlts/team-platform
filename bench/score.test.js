// Pruebas de score.js: cada medida del informe 02 §5.2 con un caso armado a mano.
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

test('descomposición exacta: cobertura 1, todo lo demás en 0 y clasificación completa', () => {
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

test('punto que falta: cobertura baja y hueco por unidad', () => {
  const r = run({ messages: [{ unit_ids: [1, 2] }, { unit_ids: [4, 5] }], discarded: [6] });
  assert.equal(r.counts.covered, 2);
  assert.equal(r.counts.missing, 1);
  assert.equal(r.rates.coverage, 2 / 3);
  assert.deepEqual(r.details.hole_units, [3]);
  assert.equal(r.mece, false);
});

test('punto repetido: dos mensajes contienen el punto completo', () => {
  const r = run({
    messages: [{ unit_ids: [1, 2] }, { unit_ids: [1, 2] }, { unit_ids: [3] }, { unit_ids: [4, 5] }],
    discarded: [6],
  });
  assert.equal(r.counts.repeated, 1);
  assert.equal(r.rates.repetition, 1 / 3);
  assert.deepEqual(r.details.overlap_units, [1, 2]);
  assert.equal(r.rates.coverage, 1);
});

test('un solape parcial también cuenta como repetición si el punto quedó completo en otro mensaje', () => {
  const r = run({
    messages: [{ unit_ids: [1, 2] }, { unit_ids: [2, 3] }, { unit_ids: [4, 5] }],
    discarded: [6],
  });
  assert.equal(r.counts.repeated, 1);
  assert.equal(r.counts.fused, 1);
});

test('punto partido: sus unidades se reparten sin quedar completas en ninguno', () => {
  const r = run({
    messages: [{ unit_ids: [1] }, { unit_ids: [2] }, { unit_ids: [3] }, { unit_ids: [4, 5] }],
    discarded: [6],
  });
  assert.equal(r.counts.split, 1);
  assert.equal(r.rates.split, 1 / 3);
  assert.equal(r.counts.covered, 2);
  assert.equal(r.counts.repeated, 0);
});

test('punto incompleto: un solo mensaje con parte de sus unidades no es partido', () => {
  const r = run({
    messages: [{ unit_ids: [1] }, { unit_ids: [3] }, { unit_ids: [4, 5] }],
    discarded: [6, 2],
  });
  assert.equal(r.counts.partial, 1);
  assert.equal(r.counts.split, 0);
  assert.equal(r.rates.coverage, 2 / 3);
});

test('mensaje fusionado: un mensaje cubre dos puntos de la referencia', () => {
  const r = run({
    messages: [{ unit_ids: [1, 2, 3] }, { unit_ids: [4, 5] }],
    discarded: [6],
  });
  assert.equal(r.counts.fused, 1);
  assert.equal(r.rates.fused, 1 / 2);
  assert.equal(r.rates.coverage, 1);
  assert.equal(r.mece, false);
});

test('mensaje de más: no toca ningún punto de la referencia, o no cita unidades', () => {
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

test('unidades inventadas por el analizador se ignoran y se cuentan', () => {
  const r = run({
    messages: [{ unit_ids: [1, 2, 99] }, { unit_ids: [3] }, { unit_ids: [4, 5] }],
    discarded: [6],
  });
  assert.equal(r.counts.invalid_unit_ids, 1);
  assert.deepEqual(r.details.invalid_unit_ids, [99]);
  assert.equal(r.rates.coverage, 1);
  assert.equal(r.mece, false);
});

test('clasificación: cuenta por unidad, con áreas y plantillas aceptadas como lista', () => {
  const r = run({
    messages: [
      { unit_ids: [1, 2], area_id: 2, template_id: 2 }, // correcto
      { unit_ids: [3], area_id: 3, template_id: 1 }, // área aceptada, plantilla no
      { unit_ids: [4, 5], area_id: 1, template_id: 5 }, // área errada, plantilla correcta
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
  assert.equal(r.mece, true, 'una clasificación errada no rompe la descomposición MECE');
});

test('clasificación: una unidad sin mensaje, o en dos mensajes con áreas distintas, cuenta como errada', () => {
  const r = run({
    messages: [
      { unit_ids: [1, 2], area_id: 2, template_id: 2 },
      { unit_ids: [2], area_id: 1, template_id: 1 },
      { unit_ids: [4, 5], area_id: 5, template_id: 5 },
    ],
    discarded: [6],
  });
  // u1 correcta; u2 en dos áreas; u3 en ningún mensaje; u4 y u5 correctas.
  assert.equal(r.counts.area_correct, 3);
});

test('sin área ni plantilla esperadas, la exactitud de clasificación es null', () => {
  const r = score({
    units,
    expected: { messages: [{ id: 'g', unit_ids: [1] }] },
    actual: { messages: [{ unit_ids: [1], area_id: 2, template_id: 2 }] },
  });
  assert.equal(r.rates.classification_accuracy, null);
});

test('los descartados aceptan ids sueltos, { unit_id } y { unit_ids, reason }', () => {
  const base = { messages: [{ unit_ids: [1, 2] }, { unit_ids: [3] }, { unit_ids: [4, 5] }] };
  assert.equal(run({ ...base, discarded: [6] }).counts.hole_units, 0);
  assert.equal(run({ ...base, discarded: [{ unit_id: 6 }] }).counts.hole_units, 0);
  assert.equal(run({ ...base, discarded: [{ unit_ids: [6], reason: 'x' }] }).counts.hole_units, 0);
  assert.equal(run({ ...base }).counts.hole_units, 1);
});

test('sin mensajes esperados ni obtenidos, las tasas son 0 y no hay división por cero', () => {
  const r = score({ units: [1], expected: { messages: [] }, actual: { messages: [], discarded: [1] } });
  assert.deepEqual(r.rates, { coverage: 0, repetition: 0, extra: 0, split: 0, fused: 0, area_accuracy: null, template_accuracy: null, classification_accuracy: null });
});

test('las unidades pueden venir como objetos con id', () => {
  const r = score({
    units: [{ id: 'a' }, { id: 'b' }],
    expected: { messages: [{ id: 'g', unit_ids: ['a', 'b'] }] },
    actual: { messages: [{ unit_ids: ['a', 'b'] }] },
  });
  assert.equal(r.mece, true);
});
