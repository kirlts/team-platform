#!/usr/bin/env node
// Classification stage of the real pipeline (src/analyze/api.js `classifyInput`) over the private cases, with nothing after it:
// groups and discards as the pipeline draws them, with the coverage pass and the context units when the config turns them on
// (H-1900, H-1003). It costs a fraction of a full run because the decomposition is not called. The result file has the shape
// that bench/areas-stats.mjs reads (reference groups with the readers' areas, `unit_pred`) plus the model's own groups and
// discards, which bench/coverage-stats.mjs reads.
//
//   node bench/classify-stage.mjs --label base --repeat 10 --cases a,b --project bench/private/project.md [--config '{"coveragePasses":1}']
//        [--budget 1.5] [--results-dir bench/results/reuniones] [--concurrency 6] [--plan]
//
// Reads bench/private/ (env BENCH_PRIVATE_DIR), which never enters git. Everything printed is a count or a rate.
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyInput, resolveConfig } from '../src/analyze/index.js';
import { loadSeed } from '../src/analyze/seed.js';
import { createProviders } from '../src/providers/index.js';
import { costOf } from './pricing.js';
import { createSpend } from './spend.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    label: { type: 'string' },
    repeat: { type: 'string', default: '1' },
    cases: { type: 'string' },
    config: { type: 'string', default: '{}' },
    budget: { type: 'string', default: '1.5' },
    'private-dir': { type: 'string' },
    'results-dir': { type: 'string' },
    concurrency: { type: 'string', default: '6' },
    project: { type: 'string' },
    plan: { type: 'boolean', default: false },
  },
});
if (!values.label) throw new Error('Uso: --label <nombre>');
const privateDir = values['private-dir'] ?? process.env.BENCH_PRIVATE_DIR ?? join(here, 'private');
const resultsDir = values['results-dir'] ?? join(here, 'results');
const overrides = JSON.parse(values.config);
const config = resolveConfig(overrides);
const seed = await loadSeed();
const project = values.project ? { name: 'Proyecto', description: readFileSync(values.project, 'utf8') } : null;
const readerOf = (file) => {
  if (!existsSync(file)) return null;
  return new Map(JSON.parse(readFileSync(file, 'utf8')).messages.map((m) => [m.id, [].concat(m.area_id)]));
};
const cases = readdirSync(privateDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(privateDir, d.name, 'manifest.json')) && existsSync(join(privateDir, '.cache', `${d.name}.json`)))
  .map((d) => d.name).sort().filter((id) => !values.cases || values.cases.split(',').includes(id));
const repeat = Number(values.repeat);
if (values.plan) {
  console.log(`${values.label}: ${cases.length} casos x ${repeat} repeticiones, config ${JSON.stringify(overrides)}, proyecto ${project ? 'sí' : 'no'}, tope ${values.budget} USD`);
  process.exit(0);
}

const ledger = createSpend({ resultsDir, budgetUsd: Number(values.budget) });
const env = Object.fromEntries(readFileSync(`${process.env.HOME}/.config/team-platform/env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const providers = createProviders({ ...env, ...process.env });

async function runCase(id) {
  ledger.assertBudget(id);
  const cache = JSON.parse(readFileSync(join(privateDir, '.cache', `${id}.json`), 'utf8'));
  const expected = JSON.parse(readFileSync(join(privateDir, id, 'expected.json'), 'utf8'));
  const a = readerOf(join(privateDir, id, 'expected.json'));
  const b = readerOf(join(privateDir, id, 'expected-b.json'));
  const attachments = (cache.input.attachments ?? []).map((x) => ({ id: x.id, kind: x.kind, extracted: x.extracted }));
  const bundle = { text: cache.input.text, attachments, areas: seed.areas, templates: seed.templates, project, members: [] };
  const started = Date.now();
  const stage = await classifyInput(bundle, { providers, config });
  const cost = stage.ctx.calls.reduce((s, c) => s + (costOf({ model: c.model, usage: c.usage }) ?? 0), 0);
  ledger.add(`stage ${values.label} ${id}`, cost);
  if (stage.failed) throw new Error(`${id}: ${stage.failed.status} ${stage.failed.step ?? ''}`);
  const unitPred = stage.groups.flatMap((g) => g.unit_ids.map((u) => [u, g.area_id]));
  return {
    case_id: id, cost_usd: cost, ms: Date.now() - started, calls: stage.ctx.calls.length, stats: stage.ctx.stats,
    model_groups: stage.groups.map((g) => ({ area_id: g.area_id, template_id: g.template_id, unit_ids: g.unit_ids })),
    discarded: stage.discarded.map((d) => ({ unit_ids: d.unit_ids })),
    unit_pred: unitPred,
    groups: expected.messages.map((m) => ({ id: m.id, unit_ids: m.unit_ids, a: a?.get(m.id) ?? null, b: b?.get(m.id) ?? null })),
  };
}

const results = cases.map((id) => ({ case_id: id, kind: JSON.parse(readFileSync(join(privateDir, id, 'manifest.json'), 'utf8')).kind, runs: [] }));
const jobs = results.flatMap((r) => Array.from({ length: repeat }, () => r));
let next = 0;
await Promise.all(Array.from({ length: Number(values.concurrency) }, async () => {
  while (next < jobs.length) {
    const r = jobs[next++];
    try { r.runs.push(await runCase(r.case_id)); } catch (e) { console.log(`${r.case_id}: ${e.message.slice(0, 120)}`); }
  }
}));
mkdirSync(resultsDir, { recursive: true });
const file = join(resultsDir, `stage-${values.label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), variant: values.label, config: overrides, project: Boolean(project), repeat, area_titles: Object.fromEntries(seed.areas.map((x) => [x.id, x.title])), cases: results }));
const runs = results.flatMap((r) => r.runs);
console.log(`${values.label}: ${runs.length} corridas -> ${file}`);
console.log(`costo ${runs.reduce((s, r) => s + r.cost_usd, 0).toFixed(4)} USD; gasto acumulado de la tarea ${ledger.read().total_usd.toFixed(4)} USD`);
