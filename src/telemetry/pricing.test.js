// Costo estimado por llamada: cada precio sale de la tabla de pricing.js (MASTER-SPEC §3, informe 02 y 06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCostUsd } from './pricing.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} ≠ ${expected}`);

test('Haiku 5.5: entrada, salida y lectura de caché a los precios de MASTER-SPEC §3', () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cached_tokens: 1_000_000 };
  // Un millón de cada uno supera el escalón de 100.000 tokens y trae caché: el precio de ese escalón no se conoce.
  assert.equal(estimateCostUsd({ provider: 'anthropic', model: 'claude-haiku-5-5', usage }), null);
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-haiku-5-5', usage: { input_tokens: 10_000, output_tokens: 2_000, cached_tokens: 50_000 } }), 0.0001 * 10 + 0.0005 * 2 + 0.00001 * 50);
});

test('la escritura de caché cuesta 1,25 veces la entrada a 5 minutos y 2 veces a 1 hora', () => {
  const usage = { input_tokens: 0, output_tokens: 0, cached_tokens: 0, cache_creation_tokens: 10_000 };
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-haiku-5-5', usage }), 0.1 * 1.25 * 0.01);
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-haiku-5-5', usage, cacheTtl: '1h' }), 0.1 * 2 * 0.01);
});

test('sobre 100.000 tokens de entrada sin caché rige el precio del escalón superior', () => {
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-haiku-5-5', usage: { input_tokens: 200_000, output_tokens: 0 } }), 0.5 * 0.2);
});

test('un modelo con sufijo de fecha usa el precio de su base', () => {
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-haiku-5-5-20261001', usage: { input_tokens: 50_000, output_tokens: 0 } }), 0.1 * 0.05);
});

test('transcripción: 0,04 USD por hora de audio', () => {
  close(estimateCostUsd({ provider: 'groq-speech', model: 'whisper-large-v3-turbo', usage: { audio_seconds: 1800 } }), 0.02);
});

test('un modelo sin precio declarado es costo desconocido (null), nunca cero ni el de otro modelo', () => {
  assert.equal(estimateCostUsd({ provider: 'deepseek', model: 'deepseek-flash', usage: { input_tokens: 1000, output_tokens: 1000 } }), null);
  assert.equal(estimateCostUsd({ provider: 'fake', model: 'fake-model', usage: { input_tokens: 1000, output_tokens: 1000 } }), null);
  assert.equal(estimateCostUsd({ provider: 'anthropic', model: 'claude-haiku-5-5', usage: undefined }), null);
});
