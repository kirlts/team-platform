import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAudioBudget } from './audio-budget.js';

const HOUR = 3_600_000;

test('el presupuesto por omisión es de 7.200 s por hora', () => {
  const budget = createAudioBudget();
  assert.equal(budget.check(7200, 0).allowed, true);
  assert.equal(budget.check(7201, 0).allowed, false);
  assert.equal(budget.check(7201, 0).reason, 'exceeds_budget');
});

test('seis videos de 20 minutos caben en una hora y el séptimo espera', () => {
  const budget = createAudioBudget({ secondsPerHour: 7200 });
  for (let i = 0; i < 6; i++) {
    assert.equal(budget.check(1200, i * 1000).allowed, true);
    budget.record(1200, i * 1000);
  }
  const seventh = budget.check(1200, 10_000);
  assert.equal(seventh.allowed, false);
  // Libera lugar cuando vence el primero, registrado en el milisegundo 0.
  assert.equal(seventh.waitMs, HOUR - 10_000);
  assert.equal(budget.check(1200, HOUR).allowed, true);
});

test('la espera es la del primer evento que libera lo suficiente', () => {
  const budget = createAudioBudget({ secondsPerHour: 1000 });
  budget.record(300, 0);
  budget.record(300, 1_000_000);
  budget.record(300, 2_000_000);
  // Usado: 900. Para pedir 500 hay que liberar 400: vencen los dos primeros.
  assert.equal(budget.check(500, 3_000_000).waitMs, 1_000_000 + HOUR - 3_000_000);
  assert.equal(budget.used(3_000_000), 900);
});
