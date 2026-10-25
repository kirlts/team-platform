#!/usr/bin/env node
// Runs the analyzer on bench/cases/* and reports MECE, classification, total and per-step time,
// tokens and cost (MASTER-SPEC §7.11).
//
//   node bench/run.mjs --fake perfect                   fake providers with the reference, no network
//   node bench/run.mjs                                  real providers, configured by environment (src/providers)
//   node bench/run.mjs --cli claude-haiku-5-5          real model through `claude -p` (the subscription of the account, no API key)
//   node bench/run.mjs --repeat 5 --case 03-monologo-prueba --analyzer harness
//   node bench/run.mjs --language en                    prompts and output in English (default es-419, UD-018)
//   node bench/run.mjs --config '{"decomposeEffort":"low","decomposeThinking":"disabled"}'   analyzer knobs (src/analyze/config.js)
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases, loadFixtures, runCase, summarize, formatReport } from './lib.js';
import { createBenchProviders } from './fake-providers.js';
import { analyze } from '../src/analyze/index.js';
import { createProviders } from '../src/providers/index.js';
import { createClaudeCliProviders } from './claude-cli-provider.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    fake: { type: 'string' },
    cli: { type: 'string' },
    'latency-ms': { type: 'string', default: '0' },
    analyzer: { type: 'string' },
    config: { type: 'string' },
    repeat: { type: 'string', default: '1' },
    case: { type: 'string', multiple: true },
    language: { type: 'string' },
    out: { type: 'string' },
    'no-write': { type: 'boolean', default: false },
  },
});

const repeat = Number(values.repeat);
if (!Number.isInteger(repeat) || repeat < 1) throw new Error('--repeat must be a positive integer');
if (values.fake && !['perfect', 'noisy'].includes(values.fake)) throw new Error('--fake accepts perfect or noisy');

const fixtures = await loadFixtures();
let cases = loadCases();
if (values.case?.length) cases = cases.filter((c) => values.case.includes(c.id));
if (cases.length === 0) throw new Error('No case matches --case');

const providersFor = values.fake
  ? (testCase) => createBenchProviders({ expected: testCase.expected, mode: values.fake, latencyMs: Number(values['latency-ms']) })
  : values.cli
    ? (() => {
        const viaCli = createClaudeCliProviders({ model: values.cli });
        return () => viaCli;
      })()
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
      language: values.language,
      options: { ...(values.analyzer ? { analyzer: values.analyzer } : {}), ...(values.config ? { config: JSON.parse(values.config) } : {}) },
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
  console.log(`\nFull result: ${out}`);
}
