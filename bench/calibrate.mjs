#!/usr/bin/env node
// Reads result files of `bench/run-private.mjs` and prints the two calibrations of bench/calibrate.js. It calls no provider and needs no key.
//
//   node bench/calibrate.mjs bench/results/private-*.json [--chars-per-token 3] [--json]
//
// `--chars-per-token` is the value the runs were made with (the default is the current one of src/analyze/config.js).
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { KNOBS } from '../src/analyze/config.js';
import { charsPerTokenFit, outputByStep } from './calibrate.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'chars-per-token': { type: 'string' }, json: { type: 'boolean', default: false } },
});
if (positionals.length === 0) {
  console.error('Usage: node bench/calibrate.mjs <result.json> [<result.json> ...] [--chars-per-token N] [--json]');
  process.exit(2);
}
const used = values['chars-per-token'] === undefined ? KNOBS.charsPerToken.value : Number(values['chars-per-token']);
if (!Number.isFinite(used) || used <= 0) {
  console.error('--chars-per-token must be a positive number.');
  process.exit(2);
}
const results = positionals.map((file) => JSON.parse(readFileSync(file, 'utf8')));
const fits = charsPerTokenFit(results, { charsPerToken: used });
const output = outputByStep(results);

if (values.json) {
  console.log(JSON.stringify({ files: positionals.length, usedCharsPerToken: used, fits, output }, null, 2));
  process.exit(0);
}
const fixed = (value, digits = 2) => (value === null || value === undefined ? '-' : Number(value).toFixed(digits));
console.log(`Files: ${positionals.length}. charsPerToken of the runs: ${used}.\n`);
console.log('Input tokens of the classification call against the estimate (real ≈ intercept + slope × estimate):');
if (fits.length === 0) console.log('  no run with one classification chunk and an estimate.');
for (const f of fits) {
  console.log(`  ${f.model}: n=${f.n}, estimate ${f.estimateRange[0]}..${f.estimateRange[1]}, slope ${fixed(f.slope, 3)}, intercept ${fixed(f.intercept, 0)}, R² ${fixed(f.r2, 4)}, measured charsPerToken ${fixed(f.measuredCharsPerToken)}`);
}
console.log('\nOutput tokens per call:');
console.log('  step         model              effort   n    p50    p95    p99    max   cap   at cap');
for (const o of output) {
  console.log(`  ${o.step.padEnd(12)} ${String(o.model).padEnd(18)} ${String(o.effort).padEnd(7)} ${String(o.n).padStart(4)} ${String(o.p50).padStart(6)} ${String(o.p95).padStart(6)} ${String(o.p99).padStart(6)} ${String(o.max).padStart(6)} ${String(o.cap ?? '-').padStart(6)} ${String(o.atCap ?? '-').padStart(6)}`);
}
