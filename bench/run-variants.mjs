#!/usr/bin/env node
// Runs variants A, B and C of the analyzer (bench/variants.mjs) on bench/cases/* with the real providers and prints the report of
// run.mjs for each, plus how often the speculation of C hit. TASK-015.
//
//   node bench/run-variants.mjs [--variant A --variant B --variant C] [--repeat 1] [--case id] [--out file]
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { analyze } from '../src/analyze/index.js';
import { createProviders } from '../src/providers/index.js';
import { analyzeB, analyzeC } from './variants.mjs';
import { formatReport, loadCases, loadFixtures, runCase, summarize } from './lib.js';

const { values } = parseArgs({ options: { variant: { type: 'string', multiple: true }, repeat: { type: 'string', default: '1' }, case: { type: 'string', multiple: true }, out: { type: 'string' } } });
const variants = values.variant?.length ? values.variant : ['A', 'B', 'C'];
const fns = { A: analyze, B: analyzeB, C: analyzeC };
const fixtures = await loadFixtures();
let cases = loadCases();
if (values.case?.length) cases = cases.filter((c) => values.case.includes(c.id));
const providers = createProviders(process.env);
const all = {};
for (const variant of variants) {
  const summaries = [];
  all[variant] = [];
  for (const testCase of cases) {
    const runs = [];
    for (let i = 0; i < Number(values.repeat); i += 1) runs.push(await runCase({ analyze: fns[variant], providers, testCase, fixtures }));
    summaries.push(summarize(runs));
    all[variant].push({ case_id: testCase.id, runs });
  }
  console.log(`\n== Variante ${variant}`);
  console.log(formatReport(summaries));
  if (variant === 'C') {
    const hits = all.C.flatMap((c) => c.runs).filter((r) => r.stats?.speculation_hit === true).length;
    console.log(`Especulación acertada en ${hits} de ${all.C.flatMap((c) => c.runs).length} corridas`);
  }
}
if (values.out) {
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, JSON.stringify({ at: new Date().toISOString(), repeat: Number(values.repeat), variants: all }));
}
