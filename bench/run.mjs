#!/usr/bin/env node
// Corre el analizador sobre bench/cases/* y reporta MECE, tiempo total y por paso, tokens y costo (MASTER-SPEC §7.11).
//
//   node bench/run.mjs --fake perfect                   analizador falso, sin red
//   node bench/run.mjs                                  src/analyze/index.js con los proveedores configurados
//   node bench/run.mjs --repeat 5 --case 03-monologo-prueba
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCases, loadFixtures, runCase, summarize, formatReport } from './lib.js';
import { createFakeAnalyze } from './fake-analyzer.js';

const here = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    analyzer: { type: 'string', default: join(here, '..', 'src', 'analyze', 'index.js') },
    fake: { type: 'string' },
    'latency-ms': { type: 'string', default: '0' },
    repeat: { type: 'string', default: '1' },
    case: { type: 'string', multiple: true },
    out: { type: 'string' },
    'no-write': { type: 'boolean', default: false },
  },
});

const repeat = Number(values.repeat);
if (!Number.isInteger(repeat) || repeat < 1) throw new Error('--repeat debe ser un entero positivo');

const fixtures = loadFixtures();
let cases = loadCases();
if (values.case?.length) cases = cases.filter((c) => values.case.includes(c.id));
if (cases.length === 0) throw new Error('Ningún caso coincide con --case');

let analyzerFor;
if (values.fake) {
  if (!['perfect', 'noisy'].includes(values.fake)) throw new Error('--fake acepta perfect o noisy');
  analyzerFor = (testCase) => createFakeAnalyze({ expected: testCase.expected, mode: values.fake, latencyMs: Number(values['latency-ms']) });
} else {
  const modulePath = resolve(values.analyzer);
  let mod;
  try {
    mod = await import(pathToFileURL(modulePath).href);
  } catch (error) {
    throw new Error(`No se pudo cargar el analizador en ${modulePath} (${error.code ?? error.message}). Con --fake perfect corre sin él.`);
  }
  const analyze = mod.analyze ?? mod.default;
  if (typeof analyze !== 'function') throw new Error(`${modulePath} no exporta analyze(bundle, { onProgress })`);
  analyzerFor = () => analyze;
}

const all = [];
for (const testCase of cases) {
  const runs = [];
  for (let i = 0; i < repeat; i += 1) {
    runs.push(await runCase({ analyze: analyzerFor(testCase), testCase, fixtures }));
  }
  all.push({ summary: summarize(runs), runs });
}

console.log(formatReport(all.map((x) => x.summary)));

if (!values['no-write']) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = values.out ?? join(here, 'results', `${stamp}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), repeat, mode: values.fake ?? 'real', cases: all }, null, 2));
  console.log(`\nResultado completo: ${out}`);
}
