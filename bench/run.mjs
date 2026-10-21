#!/usr/bin/env node
// Corre el analizador sobre bench/cases/* y reporta MECE, clasificación, tiempo total y por paso,
// tokens y costo (MASTER-SPEC §7.11).
//
//   node bench/run.mjs --fake perfect                   proveedores falsos con la referencia, sin red
//   node bench/run.mjs                                  proveedores reales, configurados por entorno (src/providers)
//   node bench/run.mjs --repeat 5 --case 03-monologo-prueba --analyzer harness
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases, loadFixtures, runCase, summarize, formatReport } from './lib.js';
import { createBenchProviders } from './fake-providers.js';
import { analyze } from '../src/analyze/index.js';
import { createProviders } from '../src/providers/index.js';

const here = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    fake: { type: 'string' },
    'latency-ms': { type: 'string', default: '0' },
    analyzer: { type: 'string' },
    repeat: { type: 'string', default: '1' },
    case: { type: 'string', multiple: true },
    out: { type: 'string' },
    'no-write': { type: 'boolean', default: false },
  },
});

const repeat = Number(values.repeat);
if (!Number.isInteger(repeat) || repeat < 1) throw new Error('--repeat debe ser un entero positivo');
if (values.fake && !['perfect', 'noisy'].includes(values.fake)) throw new Error('--fake acepta perfect o noisy');

const fixtures = await loadFixtures();
let cases = loadCases();
if (values.case?.length) cases = cases.filter((c) => values.case.includes(c.id));
if (cases.length === 0) throw new Error('Ningún caso coincide con --case');

const providersFor = values.fake
  ? (testCase) => createBenchProviders({ expected: testCase.expected, mode: values.fake, latencyMs: Number(values['latency-ms']) })
  : (() => {
      const real = createProviders(process.env);
      return () => real;
    })();

const all = [];
for (const testCase of cases) {
  const runs = [];
  for (let i = 0; i < repeat; i += 1) {
    runs.push(await runCase({
      analyze,
      providers: providersFor(testCase),
      testCase,
      fixtures,
      options: values.analyzer ? { analyzer: values.analyzer } : {},
    }));
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
