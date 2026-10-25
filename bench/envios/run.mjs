#!/usr/bin/env node
// Runs the bank of sends against the real analyzer and prints one row per send.
//
//   node bench/envios/run.mjs --model claude-haiku-5-5            real model through `claude -p` (this account's subscription)
//   node bench/envios/run.mjs --model claude-sonnet-5-5 --repeat 3 --case e05
//   node bench/envios/run.mjs --fake                              fake providers that answer with the reference (no model)
// The cost of each call goes to `--spend` (JSONL) and the total is printed at the end.
import { parseArgs } from 'node:util';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../../src/analyze/index.js';
import { buildBundle } from '../lib.js';
import { createBenchProviders } from '../fake-providers.js';
import { createClaudeCliProviders } from '../claude-cli-provider.mjs';
import { ENVIOS } from './cases.js';
import { loadEnvioFixtures } from './fixtures.js';
import { formatTable, scoreEnvio } from './score.js';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: { model: { type: 'string', default: 'claude-haiku-5-5' }, repeat: { type: 'string', default: '1' }, case: { type: 'string', multiple: true }, fake: { type: 'boolean', default: false }, out: { type: 'string' }, config: { type: 'string' }, parallel: { type: 'string', default: '3' } },
});
const fixtures = await loadEnvioFixtures();
const cases = ENVIOS.filter((c) => !values.case?.length || values.case.some((x) => c.id.startsWith(x)));
const spend = join(here, 'results', `spend-${Date.now()}.jsonl`);
mkdirSync(dirname(spend), { recursive: true });
const repeat = Number(values.repeat);

async function once(testCase) {
  const providers = values.fake ? createBenchProviders({ expected: testCase.expected, mode: 'perfect' }) : createClaudeCliProviders({ model: values.model, spendLog: spend });
  const bundle = buildBundle(testCase.input, fixtures);
  const started = performance.now();
  const result = await analyze(bundle, { providers, analyzer: 'api', ...(values.config ? { config: JSON.parse(values.config) } : {}) });
  const s = scoreEnvio(testCase, { units: result.units, proposal: result.proposal ?? { messages: result.draft?.messages ?? [], discarded: result.draft?.discarded ?? [] }, templates: fixtures.templates, status: result.status });
  return { id: testCase.id, s, ms: Math.round(performance.now() - started), result: { status: result.status, errors: result.errors, proposal: result.proposal }, calls: result.calls?.length ?? 0 };
}

const jobs = cases.flatMap((c) => Array.from({ length: repeat }, () => c));
const rows = [];
const limit = Number(values.parallel);
let cursor = 0;
await Promise.all(Array.from({ length: limit }, async () => {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    try { rows.push(await once(job)); } catch (e) { rows.push({ id: job.id, s: { status: `error:${String(e.message).slice(0, 40)}`, expected: job.expected.messages.length, got: 0, area_ok: 0, template_ok: 0, fields_ok: 0, attachments_ok: 0, ordered: false, pass: false }, ms: 0, calls: 0 }); }
  }
}));
rows.sort((a, b) => a.id.localeCompare(b.id));
console.log(formatTable(rows));
console.log(`\npassed ${rows.filter((r) => r.s.pass).length}/${rows.length}`);
const out = values.out ?? join(here, 'results', `run-${values.fake ? 'fake' : values.model}-${Date.now()}.json`);
writeFileSync(out, JSON.stringify(rows, null, 2));
console.log(`result: ${out}`);
