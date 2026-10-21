#!/usr/bin/env node
// Classification-only oracle for area descriptions (H-600 and later). The reference groups are given to the classification
// call (as in bench/oracle.mjs) and nothing else runs: no decomposition, so a run costs a few cents. The only thing that
// changes between variants is the catalog of areas and, optionally, the classification instructions, both declared by a
// variant module in bench/area-variants/. The result is the area accuracy per unit and per message against the first
// reader, the second reader and their union, with Wilson intervals, plus the confusion pairs.
//
//   node bench/areas-classify.mjs --variant long [--repeat 1] [--cases a,b] [--no-grouping] [--budget 1.5]
//   node bench/areas-classify.mjs report bench/results/areas-<variant>-<stamp>.json ...
//
// Reads bench/private/ (env BENCH_PRIVATE_DIR), which never enters git. Everything printed is a count or a rate.
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classifySystem, classifyUser } from '../src/analyze/prompts.js';
import * as es from '../src/analyze/prompts-es.js';
import { buildClassificationSchema, numberUnits, partitionUnits, resolveConfig } from '../src/analyze/index.js';
import { loadSeed } from '../src/analyze/seed.js';
import { estimateTokens } from '../src/analyze/units.js';
import { createProviders } from '../src/providers/index.js';
import { groupingNote, mapOntoReference } from './oracle.mjs';
import { costOf } from './pricing.js';
import { createSpend, withQueueRetries } from './spend.mjs';
import { wilson } from './compare.js';

const here = dirname(fileURLToPath(import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    variant: { type: 'string' },
    repeat: { type: 'string', default: '1' },
    cases: { type: 'string' },
    'no-grouping': { type: 'boolean', default: false },
    budget: { type: 'string', default: '1.5' },
    'private-dir': { type: 'string' },
    'results-dir': { type: 'string' },
    concurrency: { type: 'string', default: '6' },
  },
});
const privateDir = values['private-dir'] ?? process.env.BENCH_PRIVATE_DIR ?? join(here, 'private');
const resultsDir = values['results-dir'] ?? join(here, 'results');
const pct = (n, d) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}`);
const ci = (n, d) => (d === 0 ? '' : ` [${wilson(n, d).map((x) => (100 * x).toFixed(0)).join('-')}]`);

const labelsOf = (file) => {
  if (!existsSync(file)) return null;
  const map = new Map();
  for (const m of JSON.parse(readFileSync(file, 'utf8')).messages ?? []) map.set(m.id, [].concat(m.area_id));
  return map;
};

/** Pure scoring of one result file; also used by `report`. Weighting: per reference message and per unit. */
export function scoreFile(data, { only } = {}) {
  const t = { msgs: 0, units: 0 };
  const keys = ['a', 'b', 'union'];
  for (const k of keys) { t[`m_${k}`] = 0; t[`u_${k}`] = 0; }
  const confusion = { a: new Map(), b: new Map() };
  for (const c of data.cases) {
    if (only && !only.has(c.case_id)) continue;
    for (const run of c.runs) {
      for (const g of run.groups) {
        const w = g.unit_ids.length;
        if (g.pred == null || !g.a || !g.b) continue;
        const hit = { a: g.a.includes(g.pred), b: g.b.includes(g.pred) };
        hit.union = hit.a || hit.b;
        t.msgs += 1; t.units += w;
        for (const k of keys) if (hit[k]) { t[`m_${k}`] += 1; t[`u_${k}`] += w; }
        for (const r of ['a', 'b']) {
          const key = `${g[r][0]}>${g.pred}`;
          confusion[r].set(key, (confusion[r].get(key) ?? 0) + 1);
        }
      }
    }
  }
  return { ...t, confusion };
}

function format(label, s, areaTitles) {
  const lines = [`${label}`];
  lines.push(`  mensajes ${s.msgs}, unidades ${s.units}`);
  lines.push(`  por unidad   A ${pct(s.u_a, s.units)}${ci(s.u_a, s.units)}   B ${pct(s.u_b, s.units)}${ci(s.u_b, s.units)}   unión ${pct(s.u_union, s.units)}${ci(s.u_union, s.units)}`);
  lines.push(`  por mensaje  A ${pct(s.m_a, s.msgs)}${ci(s.m_a, s.msgs)}   B ${pct(s.m_b, s.msgs)}${ci(s.m_b, s.msgs)}   unión ${pct(s.m_union, s.msgs)}${ci(s.m_union, s.msgs)}`);
  const name = (id) => areaTitles?.[id] ?? id;
  for (const r of ['a', 'b']) {
    const wrong = [...s.confusion[r]].filter(([k]) => k.split('>')[0] !== k.split('>')[1]).sort((x, y) => y[1] - x[1]).slice(0, 8);
    lines.push(`  confusión vs ${r.toUpperCase()} (referencia>obtenida): ${wrong.map(([k, n]) => `${k.split('>').map(name).join('>')}:${n}`).join('  ')}`);
  }
  return lines.join('\n');
}

if (positionals[0] === 'compare') {
  // Paired comparison on the same reference groups (union of readers): groups where only one file is right, sign test.
  const [fa, fb] = positionals.slice(1).map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const key = (c, g) => `${c.case_id}:${g.id}`;
  const index = (d) => new Map(d.cases.flatMap((c) => c.runs.slice(0, 1).flatMap((r) => r.groups.map((g) => [key(c, g), g]))));
  const ia = index(fa);
  const ib = index(fb);
  let onlyA = 0; let onlyB = 0; let uA = 0; let uB = 0;
  for (const [k, ga] of ia) {
    const gb = ib.get(k);
    if (!gb || ga.pred == null || gb.pred == null || !ga.a || !ga.b) continue;
    const ok = (g) => g.a.includes(g.pred) || g.b.includes(g.pred);
    if (ok(ga) && !ok(gb)) { onlyA += 1; uA += ga.unit_ids.length; }
    if (!ok(ga) && ok(gb)) { onlyB += 1; uB += ga.unit_ids.length; }
  }
  const n = onlyA + onlyB;
  const k = Math.min(onlyA, onlyB);
  let p = 0; // two-sided exact sign test
  const choose = (a, b) => { let r = 1; for (let i = 1; i <= b; i += 1) r = (r * (a - b + i)) / i; return r; };
  for (let i = 0; i <= k; i += 1) p += choose(n, i) / 2 ** n;
  console.log(`solo acierta ${fa.variant}: ${onlyA} mensajes (${uA} unidades); solo acierta ${fb.variant}: ${onlyB} (${uB}); p ${Math.min(1, 2 * p).toFixed(3)}`);
  process.exit(0);
}

if (positionals[0] === 'report') {
  for (const file of positionals.slice(1)) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    console.log(format(file, scoreFile(data), data.area_titles));
  }
  process.exit(0);
}

if (!values.variant) throw new Error('Uso: --variant <nombre> (bench/area-variants/<nombre>.mjs)');
const variant = (await import(pathToFileURL(join(here, 'area-variants', `${values.variant}.mjs`)).href)).default;
const seed = await loadSeed();
const areasJson = variant.areasFile ? JSON.parse(readFileSync(variant.areasFile, 'utf8')) : null;
let areas = seed.areas.map((a, i) => ({ ...a, description: areasJson ? areasJson[i].description : a.description }));
if (variant.areas) areas = variant.areas(areas);
const templates = seed.templates;
const instructions = variant.instructions ? variant.instructions(es.CLASSIFY_INSTRUCTIONS) : es.CLASSIFY_INSTRUCTIONS;
const system = [instructions, (variant.catalogBlock ?? es.catalogBlock)({ areas, templates })].filter(Boolean);
const areaTitles = Object.fromEntries(areas.map((a) => [a.id, a.title]));

const budgetUsd = Number(values.budget);
const ledger = createSpend({ resultsDir, budgetUsd });
const providers = createProviders({ ...Object.fromEntries(readFileSync(`${process.env.HOME}/.config/team-platform/env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])), ...process.env });
const config = resolveConfig({});
const schema = buildClassificationSchema({ areas, templates });
const cases = readdirSync(privateDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(privateDir, d.name, 'manifest.json')) && existsSync(join(privateDir, '.cache', `${d.name}.json`)))
  .map((d) => d.name).sort().filter((id) => !values.cases || values.cases.split(',').includes(id));

async function runCase(id) {
  const cache = JSON.parse(readFileSync(join(privateDir, '.cache', `${id}.json`), 'utf8'));
  const a = labelsOf(join(privateDir, id, 'expected.json'));
  const b = labelsOf(join(privateDir, id, 'expected-b.json'));
  const expected = JSON.parse(readFileSync(join(privateDir, id, 'expected.json'), 'utf8'));
  const attachments = (cache.input.attachments ?? []).map((x) => ({ id: x.id, kind: x.kind, extracted: x.extracted }));
  const units = numberUnits({ text: cache.input.text, attachments });
  const all = expected.messages.map((m) => ({ id: m.id, unit_ids: [...m.unit_ids].sort((x, y) => x - y) }));
  const chunks = partitionUnits(units, { budgetTokens: config.partitionThresholdTokens - estimateTokens(system.join('\n'), config.charsPerToken), charsPerToken: config.charsPerToken });
  const mapped = new Map();
  let cost = 0;
  for (const chunk of chunks) {
    const scope = new Set(chunk.map((u) => u.id));
    const groups = all.map((g) => ({ ...g, unit_ids: g.unit_ids.filter((u) => scope.has(u)) })).filter((g) => g.unit_ids.length);
    const discarded = (expected.discarded ?? []).map((d) => ({ ...d, unit_ids: d.unit_ids.filter((u) => scope.has(u)) })).filter((d) => d.unit_ids.length);
    ledger.assertBudget(id);
    const out = await withQueueRetries(() => providers.text.complete({
      system,
      messages: [{ role: 'user', content: classifyUser({ units: chunk, attachments }) + (values['no-grouping'] ? '' : groupingNote(groups, discarded)) }],
      schema, effort: config.classifyEffort, maxTokens: config.maxTokens, cacheTtl: config.cacheTtl,
      ...(config.classifyThinking ? { thinking: config.classifyThinking } : {}),
    }), { attempts: 6 });
    const usd = costOf({ model: out.model, usage: out.usage }) ?? 0;
    cost += usd;
    ledger.add(`areas ${values.variant} ${id}`, usd);
    for (const g of mapOntoReference(out.json?.groups ?? [], groups).groups) mapped.set(g.id, g);
  }
  return {
    case_id: id, cost_usd: cost,
    groups: all.map((g) => ({ id: g.id, unit_ids: g.unit_ids, pred: mapped.get(g.id)?.area_id ?? null, a: a?.get(g.id) ?? null, b: b?.get(g.id) ?? null })),
  };
}

const repeat = Number(values.repeat);
const results = cases.map((id) => ({ case_id: id, runs: [] }));
const jobs = results.flatMap((r) => Array.from({ length: repeat }, () => r));
let next = 0;
await Promise.all(Array.from({ length: Number(values.concurrency) }, async () => {
  while (next < jobs.length) {
    const r = jobs[next++];
    try { r.runs.push(await runCase(r.case_id)); } catch (e) { console.log(`${r.case_id}: ${e.message.slice(0, 100)}`); }
  }
}));
mkdirSync(resultsDir, { recursive: true });
const out = join(resultsDir, `areas-${values.variant}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const data = { at: new Date().toISOString(), variant: values.variant, no_grouping: values['no-grouping'], repeat, area_titles: areaTitles, cases: results };
writeFileSync(out, JSON.stringify(data));
console.log(format(`${values.variant}${values['no-grouping'] ? ' (sin agrupación)' : ''} -> ${out}`, scoreFile(data), areaTitles));
console.log(`costo de esta corrida ${results.flatMap((r) => r.runs).reduce((s, r) => s + r.cost_usd, 0).toFixed(4)} USD; gasto acumulado de la tarea ${ledger.read().total_usd.toFixed(4)} USD`);
