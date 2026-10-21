#!/usr/bin/env node
// Report of the model comparison (H-80) and of the classification effort (H-15). Reads the result files that
// run-private.mjs and run.mjs wrote into one folder and groups them by variant prefix. Calls no provider.
//
//   node bench/h80-report.mjs --dir bench/results/h80 --private-dir bench/private
//   groups: --private  name=prefix1,prefix2   a group of private result files (repetitions) whose names start with each prefix
//           --public   name=file1,file2       a group of public result files
//           --judges   file1,file2            pooled usefulness files (judge-usefulness.mjs --pooled), labels = variant names of the files
import { parseArgs } from 'node:util';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compareResults, formatComparison, median, poolResults, pctCi, wilson } from './compare.js';
import { mergeSecondLabeler } from './labels.js';
import { pairedByPoint, percentile, pointRates } from './h80.js';
import { PRICES } from './pricing.js';

const { values } = parseArgs({
  options: { dir: { type: 'string' }, 'private-dir': { type: 'string' }, private: { type: 'string', multiple: true }, public: { type: 'string', multiple: true }, judges: { type: 'string' } },
});
const dir = values.dir;
const privateDir = values['private-dir'];
const load = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const files = readdirSync(dir);
const groupSpec = (s) => { const [name, rest] = s.split('='); return { name, items: rest.split(',') }; };
/** Cost of a run if its cache writes had been cache reads (the prompt cache warm, as in a burst of jobs). */
const warmCost = (run) => {
  let cost = run.usage.cost_usd ?? 0;
  for (const call of run.calls ?? []) {
    const price = PRICES[call.model];
    const written = call.usage?.cache_creation_tokens ?? 0;
    if (price && written) cost += (written * (price.cache_read - price.input * price.cache_write_factor)) / 1e6;
  }
  return cost;
};
const f1 = (x, d = 1) => (x === null || x === undefined ? 'n/a' : x.toFixed(d));

// ---------- private ----------
const readExpected = (id) => {
  const base = join(privateDir, id);
  const first = JSON.parse(readFileSync(join(base, 'expected.json'), 'utf8'));
  return existsSync(join(base, 'expected-b.json')) ? mergeSecondLabeler(first, JSON.parse(readFileSync(join(base, 'expected-b.json'), 'utf8'))) : first;
};
const readCache = (id) => JSON.parse(readFileSync(join(privateDir, '.cache', `${id}.json`), 'utf8'));
const inputOf = (id) => { const c = readCache(id); return [c.input.text, ...c.input.attachments.map((a) => a.extracted)].join('\n'); };

const privGroups = (values.private ?? []).map(groupSpec).map(({ name, items }) => {
  const results = items.flatMap((prefix) => files.filter((f) => f.startsWith(`private-${prefix}-2026`) && !f.includes('usefulness')).map((f) => ({ file: f, ...load(f) })));
  return { name, results };
});
const allCaseSets = privGroups.map((g) => new Set(g.results.flatMap((r) => r.cases.map((c) => c.case_id))));
const common = [...allCaseSets[0]].filter((id) => allCaseSets.every((s) => s.has(id))).sort();
console.log(`Common private cases (${common.length}): ${common.join(', ')}\n`);
const pooled = privGroups.map(({ name, results }) => {
  const trimmed = results.map((r) => ({ ...r, variant: name, cases: r.cases.filter((c) => common.includes(c.case_id)) }));
  return poolResults(trimmed, () => name)[0];
});
// Repetition 1 must cover every case a group has: files of the same group hold different cases (the extra Sonnet run).
const cmp = compareResults(pooled, { inputOf, expectedOf: readExpected });
console.log('## Private cases: table of measures\n');
console.log(formatComparison(cmp).split('\n\n').slice(0, 1).join('\n\n'));

console.log('\n## Private cases: time and cost per entry (analysis only; the extraction is cached and equal for all)\n');
const timeRows = pooled.map((g) => {
  const runs = g.cases.flatMap((c) => c.runs);
  const ms = runs.map((r) => r.total_ms);
  const cost = runs.map((r) => r.usage.cost_usd ?? 0);
  const calls = runs.map((r) => r.usage.calls);
  const warm = runs.map(warmCost);
  const failed = runs.filter((r) => r.status !== 'ok').length;
  return `| ${g.variant} | ${runs.length} | ${failed} | ${f1(percentile(ms, 50) / 1000)} | ${f1(percentile(ms, 95) / 1000)} | ${f1(median(calls), 0)} | ${(cost.reduce((a, b) => a + b, 0) / runs.length).toFixed(4)} | ${(warm.reduce((a, b) => a + b, 0) / runs.length).toFixed(4)} | ${cost.reduce((a, b) => a + b, 0).toFixed(3)} |`;
});
console.log(['| Group | Entries | Not ok | p50 (s) | p95 (s) | Median calls | Mean cost per entry (USD) | Same with a warm cache | Total (USD) |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|', ...timeRows].join('\n'));

console.log('\n## Private cases: paired by point (rate over repetitions per point; points where the row has the higher rate / the column / equal; sign test)\n');
const byCase = (g) => new Map(g.cases.map((c) => [c.case_id, c.runs]));
for (const metric of ['covered', 'area', 'exact']) {
  console.log(`Metric: ${metric}`);
  const head = ['', ...pooled.map((g) => g.variant)];
  const rows = pooled.map((a) => [a.variant, ...pooled.map((b) => {
    if (a === b) return '-';
    const r = pairedByPoint(pointRates(byCase(a), metric), pointRates(byCase(b), metric));
    return `${r.a} / ${r.b} / ${r.tied} (p ${r.p < 0.001 ? '<0.001' : r.p.toFixed(3)})`;
  })]);
  console.log([`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n'), '\n');
}

console.log('## Private cases: between repetitions (each repetition on its own, over the common cases)\n');
for (const g of privGroups) {
  g.results = g.results.filter((r) => r.cases.length >= 5); // an extra file that only completes a few cases is not a repetition
  const reps = g.results.map((r) => ({ ...r, cases: r.cases.filter((c) => common.includes(c.case_id)) }));
  const c = compareResults(reps.map((r, i) => ({ ...r, variant: `${g.name}-rep${i + 1}` })), { inputOf, expectedOf: readExpected });
  for (const v of c.variants) {
    const a = v.by_message;
    console.log(`${v.label}: coverage ${f1(v.coverage * 100)} %, area per message ${f1((a.area_correct / a.with_message) * 100)} %, exact set ${f1(v.assignment.accuracy * 100)} %, recall ${f1(v.assignment.recall * 100)} %, tells ${f1(v.tells_per_message, 3)}, cost ${v.cost_usd?.toFixed(4)}`);
  }
}

// ---------- public ----------
console.log('\n## Public cases\n');
const pubGroups = (values.public ?? []).map(groupSpec).map(({ name, items }) => ({ name, runsByCase: items.map((f) => load(f)) }));
const pubPooled = pubGroups.map(({ name, runsByCase }) => ({ file: name, variant: name, cases: runsByCase.flatMap((r) => r.cases.map((c) => ({ case_id: c.runs[0].case_id, runs: c.runs }))) }));
const pubCmp = compareResults(pubPooled, { inputOf: () => '' });
const rows = pubCmp.variants.map((v, i) => {
  const runs = pubPooled[i].cases.flatMap((c) => c.runs);
  const ms = runs.map((r) => r.total_ms);
  const cost = runs.map((r) => r.usage.cost_usd ?? 0);
  const total = cost.reduce((a, b) => a + b, 0);
  const warmTotal = runs.map(warmCost).reduce((a, b) => a + b, 0);
  const failed = runs.filter((r) => r.status !== 'ok').length;
  const cl = pctCi(v.given_message_units.both_correct, v.given_message_units.units, 1);
  const cov = pctCi(Math.round(v.coverage * v.expected_messages), v.expected_messages, v.reps);
  return `| ${v.label} | ${v.runs} | ${failed} | ${v.mece}/${v.runs} | ${cov} | ${cl} | ${f1(v.tells_per_message, 3)} | ${f1(percentile(ms, 50) / 1000)} | ${f1(percentile(ms, 95) / 1000)} | ${(total / runs.length).toFixed(4)} | ${(warmTotal / runs.length).toFixed(4)} | ${total.toFixed(3)} |`;
});
console.log(['| Group | Runs | Not ok | MECE | Coverage | Classification (units that got a message) | Tells/msg | p50 (s) | p95 (s) | Mean cost per entry (USD) | Same with a warm cache | Total (USD) |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|', ...rows].join('\n'));
console.log('\nPublic cases per case (coverage % / MECE runs / area-and-template % of units):');
for (const g of pubPooled) console.log(`${g.variant}: ` + g.cases.map((c) => { const s = c.runs.map((r) => r.score); const cov = s.reduce((a, x) => a + x.counts.covered, 0) / s.reduce((a, x) => a + x.counts.expected_messages, 0); return `${c.case_id.slice(0, 2)} ${f1(cov * 100, 0)}/${s.filter((x) => x.mece).length}/${f1((s.reduce((a, x) => a + x.counts.both_correct, 0) / s.reduce((a, x) => a + x.counts.units, 0)) * 100, 0)}`; }).join(' | '));
const pubRates = (g, metric) => pointRates(new Map(g.cases.map((c) => [c.case_id, c.runs])), metric);
console.log('\nPublic paired by point (coverage; row higher / column higher / equal; sign test):');
for (const a of pubPooled) for (const b of pubPooled) if (a !== b && a.variant < b.variant) { const r = pairedByPoint(pubRates(a, 'covered'), pubRates(b, 'covered')); console.log(`${a.variant} vs ${b.variant}: ${r.a} / ${r.b} / ${r.tied} (p ${r.p.toFixed(3)})`); }

// ---------- judges ----------
if (values.judges) {
  console.log('\n## Usefulness (pooled blind judgments, same messages for every variant, 1 to 5)\n');
  for (const f of values.judges.split(',')) {
    const j = load(f);
    console.log(`Judge ${j.model} (effort ${j.effort}, per-run cap ${j.per_run_cap}, project in prompt ${j.project_in_prompt}, cost ${j.cost_usd.toFixed(3)} USD)`);
    for (const [label, v] of Object.entries(j.variants)) {
      const all = v.cases.flatMap((c) => c.scores.map((s) => s.score));
      const good = all.filter((s) => s >= 4).length;
      const [lo, hi] = wilson(good, all.length);
      console.log(`  ${label}: ${all.length} messages, mean ${f1(v.mean, 2)}, median ${v.median}, rated 4 or 5: ${good}/${all.length} (${f1((good / all.length) * 100)} % [${f1(lo * 100, 0)}–${f1(hi * 100, 0)}])`);
    }
  }
}
