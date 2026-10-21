// El corredor del banco con el analizador falso: sin red, sin llaves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCases, loadFixtures, runCase, summarize, formatReport } from './lib.js';
import { createFakeAnalyze } from './fake-analyzer.js';

const cases = loadCases();
const fixtures = loadFixtures();
const run = (testCase, mode, latencyMs = 0) =>
  runCase({ analyze: createFakeAnalyze({ expected: testCase.expected, mode, latencyMs }), testCase, fixtures });

test('con el proveedor falso perfecto, los siete casos puntúan MECE con área y plantilla correctas', async () => {
  for (const c of cases) {
    const r = await run(c, 'perfect');
    assert.equal(r.score.mece, true, `${c.id}: ${JSON.stringify(r.score.counts)}`);
    assert.equal(r.score.area_ok, true, `${c.id} área`);
    assert.equal(r.score.template_ok, true, `${c.id} plantilla`);
  }
});

test('con el modo ruidoso, el banco detecta que la descomposición ya no es MECE', async () => {
  const c = cases.find((x) => x.id === '03-monologo-prueba');
  const r = await run(c, 'noisy');
  assert.equal(r.score.mece, false);
  assert.ok(r.score.counts.fused > 0, 'debe haber fusionados');
  assert.ok(r.score.counts.repeated > 0, 'debe haber repetidos');
  assert.ok(r.score.counts.extra > 0, 'debe haber mensajes de más');
});

test('el modo ruidoso parte un punto en el caso con puntos de varias unidades', async () => {
  const c = cases.find((x) => x.id === '01-chat-grupo');
  const r = await run(c, 'noisy');
  assert.ok(r.score.counts.split > 0 || r.score.counts.fused > 0);
  assert.equal(r.score.mece, false);
});

test('mide tiempo por paso, llamadas, tokens y costo', async () => {
  const c = cases.find((x) => x.id === '02-docx-40-puntos');
  const r = await run(c, 'perfect', 15);
  assert.deepEqual(r.steps.map((s) => s.phrase), ['clasificando', 'descomponiendo', 'validando']);
  const [classify, decompose] = r.steps;
  assert.ok(classify.ms >= 14, `clasificando ${classify.ms} ms`);
  assert.ok(decompose.ms >= 14, `descomponiendo ${decompose.ms} ms`);
  assert.ok(r.total_ms >= 29);
  assert.equal(r.usage.calls, 2);
  assert.ok(r.usage.input_tokens > 0 && r.usage.output_tokens > 0);
  assert.ok(r.usage.cost_usd > 0);
});

test('el costo de una llamada sale de los precios de lista de la especificación', async () => {
  const c = cases.find((x) => x.id === '05-idea-suelta');
  const r = await run(c, 'perfect');
  for (const call of r.calls) {
    const expectedCost = (call.input_tokens * 0.1 + call.output_tokens * 0.5 + call.cached_tokens * 0.01) / 1e6;
    assert.ok(Math.abs(call.cost_usd - expectedCost) < 1e-12);
  }
});

test('summarize agrega repeticiones y el reporte lista cada caso', async () => {
  const summaries = [];
  for (const c of cases) {
    const runs = [];
    for (let i = 0; i < 3; i += 1) runs.push(await run(c, 'perfect'));
    summaries.push(summarize(runs));
  }
  assert.ok(summaries.every((s) => s.repeats === 3 && s.mece_passes === 3));
  const text = formatReport(summaries);
  for (const c of cases) assert.ok(text.includes(c.id));
});

test('run.mjs --fake perfect termina bien y escribe el JSON pedido', () => {
  const script = fileURLToPath(new URL('./run.mjs', import.meta.url));
  const out = execFileSync(process.execPath, [script, '--fake', 'perfect', '--repeat', '2', '--case', '04-reporte-de-error', '--no-write'], { encoding: 'utf8' });
  assert.match(out, /04-reporte-de-error\s+2\/2/);
});

test('run.mjs sin analizador real explica cómo seguir', () => {
  const script = fileURLToPath(new URL('./run.mjs', import.meta.url));
  assert.throws(
    () => execFileSync(process.execPath, [script, '--analyzer', '/no/existe.js', '--no-write'], { encoding: 'utf8', stdio: 'pipe' }),
    (error) => /--fake perfect/.test(error.stderr),
  );
});
