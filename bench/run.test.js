// El corredor del banco con el analizador real de src/analyze y proveedores falsos: sin red, sin llaves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCases, loadFixtures, runCase, summarize, formatReport } from './lib.js';
import { createBenchProviders } from './fake-providers.js';
import { costOf, PRICES, usageOfCall } from './pricing.js';
import { analyze } from '../src/analyze/index.js';

const cases = loadCases();
const fixtures = await loadFixtures();
const run = (testCase, mode = 'perfect', latencyMs = 0) =>
  runCase({ analyze, providers: createBenchProviders({ expected: testCase.expected, mode, latencyMs }), testCase, fixtures });
const byId = (id) => cases.find((c) => c.id === id);

test('con los proveedores falsos perfectos, los siete casos puntúan MECE y clasifican bien', async () => {
  for (const c of cases) {
    const r = await run(c);
    assert.equal(r.status, 'ok', c.id);
    assert.equal(r.score.mece, true, `${c.id}: ${JSON.stringify(r.score.counts)}`);
    assert.equal(r.score.rates.classification_accuracy, 1, c.id);
  }
});

test('con el modo ruidoso, el banco detecta que la descomposición ya no es MECE', async () => {
  for (const id of ['02-docx-40-puntos', '03-monologo-prueba']) {
    const r = await run(byId(id), 'noisy');
    assert.notEqual(r.status, 'ok', `${id}: el analizador debía rechazar la salida corrupta`);
    assert.equal(r.score.mece, false, id);
    assert.ok(r.score.counts.fused > 0, `${id}: debe haber fusionados`);
    assert.ok(r.score.counts.repeated > 0, `${id}: debe haber repetidos`);
    assert.ok(r.score.rates.coverage < 1, `${id}: debe faltar un punto`);
  }
});

test('el modo ruidoso baja la exactitud de clasificación aunque el caso tenga un solo mensaje', async () => {
  const r = await run(byId('04-reporte-de-error'), 'noisy');
  assert.equal(r.score.rates.classification_accuracy, 0);
  assert.equal(r.score.mece, true, 'la clasificación no cambia el puntaje MECE');
});

test('mide tiempo por paso, llamadas, tokens y costo', async () => {
  const r = await run(byId('02-docx-40-puntos'), 'perfect', 15);
  assert.ok(r.steps.length >= 4, 'el analizador informa varios pasos');
  assert.ok(r.steps.every((s) => typeof s.phrase === 'string' && s.ms >= 0));
  assert.ok(r.steps.reduce((acc, s) => acc + s.ms, 0) <= r.total_ms + 1);
  assert.ok(r.total_ms >= 29, `dos rondas de 15 ms: ${r.total_ms}`);
  assert.ok(r.usage.calls >= 2);
  assert.ok(r.usage.model_ms >= 30);
  assert.ok(r.usage.input_tokens > 0 && r.usage.output_tokens > 0);
  assert.ok(r.usage.cost_usd > 0);
  assert.equal(r.stats.groups > 1, true);
});

test('el costo sale de la tarifa de lista de la especificación y es null sin tarifa', () => {
  const p = PRICES['claude-haiku-5-5'];
  const model = 'claude-haiku-5-5';
  const usage = { input_tokens: 1000, output_tokens: 200, cached_tokens: 3000, cache_creation_tokens: 400 };
  const expected = (1000 * p.input + 200 * p.output + 3000 * p.cache_read + 400 * p.input * p.cache_write_factor) / 1e6;
  assert.ok(Math.abs(costOf({ model, usage }) - expected) < 1e-12);
  assert.ok(Math.abs(costOf({ model, usage: { input_tokens: 200_000 } }) - 200_000 * p.input_over_threshold / 1e6) < 1e-12);
  assert.equal(costOf({ model: 'otro-modelo', usage }), null);
  assert.equal(costOf({ model: 'otro-modelo', usage, cost_usd: 0.5 }), 0.5);
});

test('H-71: el costo de voz de Groq es 0,04 USD por hora de audio y no es null', () => {
  const model = 'whisper-large-v3-turbo';
  assert.equal(PRICES[model].audio_per_hour, 0.04);
  assert.ok(Math.abs(costOf({ model, usage: { audio_seconds: 3600 } }) - 0.04) < 1e-12);
  assert.ok(Math.abs(costOf({ model, usage: { audio_seconds: 1210 } }) - (1210 / 3600) * 0.04) < 1e-12); // el audio de 20 minutos de la medición de extractores
  assert.equal(costOf({ model, usage: { input_tokens: 5 } }), null, 'sin segundos de audio no hay cifra que inventar');
  // Una llamada de voz de un extractor trae los segundos facturables y ningún token.
  const speech = { modality: 'speech', audioSeconds: 1210, requests: 3 };
  assert.deepEqual(usageOfCall(speech), { audio_seconds: 1210 });
  assert.deepEqual(usageOfCall({ modality: 'vision', usage: { input_tokens: 1 } }), { input_tokens: 1 });
  assert.equal(usageOfCall({ modality: 'vision', images: 1 }), null);
  assert.notEqual(costOf({ model, usage: usageOfCall(speech) }), null);
});

test('H-71: runCase suma el costo de voz al de las llamadas de texto', async () => {
  const analyzeWithSpeech = async () => ({
    status: 'ok',
    proposal: { messages: [], discarded: [] },
    units: [],
    stats: {},
    calls: [
      { model: 'whisper-large-v3-turbo', usage: { audio_seconds: 7200 } },
      { model: 'claude-haiku-5-5', usage: { input_tokens: 50_000, output_tokens: 0 } },
    ],
  });
  const r = await runCase({ analyze: analyzeWithSpeech, providers: {}, testCase: byId('04-reporte-de-error'), fixtures });
  const haiku = (50_000 * PRICES['claude-haiku-5-5'].input) / 1e6; // bajo el escalón de 100.000 tokens
  assert.ok(Math.abs(r.usage.cost_usd - (0.08 + haiku)) < 1e-9, `costo ${r.usage.cost_usd}`);
  assert.equal(r.calls[0].cost_usd !== null, true);
});

test('summarize agrega repeticiones y el reporte lista cada caso', async () => {
  const summaries = [];
  for (const c of cases) {
    const runs = [];
    for (let i = 0; i < 3; i += 1) runs.push(await run(c));
    summaries.push(summarize(runs));
  }
  assert.ok(summaries.every((s) => s.repeats === 3 && s.mece_passes === 3));
  const text = formatReport(summaries);
  for (const c of cases) assert.ok(text.includes(c.id));
});

test('run.mjs --fake perfect termina bien con repeticiones y filtro de caso', () => {
  const script = fileURLToPath(new URL('./run.mjs', import.meta.url));
  const out = execFileSync(process.execPath, [script, '--fake', 'perfect', '--repeat', '2', '--case', '04-reporte-de-error', '--no-write'], { encoding: 'utf8' });
  assert.match(out, /04-reporte-de-error\s+ok×2\s+2\/2/);
});

test('run.mjs rechaza un modo falso desconocido', () => {
  const script = fileURLToPath(new URL('./run.mjs', import.meta.url));
  assert.throws(
    () => execFileSync(process.execPath, [script, '--fake', 'raro', '--no-write'], { encoding: 'utf8', stdio: 'pipe' }),
    (error) => /perfect o noisy/.test(error.stderr),
  );
});
