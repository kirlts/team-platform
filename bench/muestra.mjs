#!/usr/bin/env node
// Runner of the heterogeneous sample of ten real inputs (docs/investigaciones/mediciones/2026-10-23-documentos-largos.md).
// The data never enters git: bench/private/muestra-10/ holds bundle-NN.json (the bundle the `analyze` job builds) and
// verdad-NN.json (each real request with its units). Without those files the script prints a notice and exits 0.
//
//   node bench/muestra.mjs --label base --elements 07,08,09 --runs 3 [--stage classify|full] [--config '<json>']
//        [--budget 2] [--concurrency 3] [--private-dir <d>] [--results-dir <d>] [--from <out-file>]
//
//   --stage classify  only the classification (the groups are scored as messages); it costs a fraction of a full run
//   --stage full      the whole analysis; the messages are scored by their unit_ids
//   --from            scores a saved result file again (no calls)
//
// Per element and run it prints the counts of bench/muestra.js plus calls, cost and seconds, and writes the result file
// `<private>/muestra-10/lab/out/<label>.json`. The spending goes to bench/results/private-spend.jsonl.
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTruth, scoreMessages, totalOf } from './muestra.js';
import { createSpend, withQueueRetries } from './spend.mjs';
import { costOf } from './pricing.js';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    label: { type: 'string' },
    elements: { type: 'string', default: '01,02,03,04,05,06,07,08,09,10' },
    runs: { type: 'string', default: '1' },
    stage: { type: 'string', default: 'full' },
    config: { type: 'string', default: '{}' },
    budget: { type: 'string', default: '2' },
    concurrency: { type: 'string', default: '3' },
    'private-dir': { type: 'string' },
    'results-dir': { type: 'string' },
    from: { type: 'string' },
  },
});
if (!values.label && !values.from) throw new Error('Uso: --label <nombre>');
const dir = join(values['private-dir'] ?? process.env.BENCH_PRIVATE_DIR ?? join(here, 'private'), 'muestra-10');
if (!existsSync(dir)) {
  console.log(`Sin datos de la muestra en ${dir}: nada que medir.`);
  process.exit(0);
}
const elements = values.elements.split(',');
const load = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const truths = Object.fromEntries(elements.filter((n) => existsSync(join(dir, `verdad-${n}.json`))).map((n) => [n, buildTruth(load(`verdad-${n}.json`))]));

const row = (n, run, s, extra = {}) => `${n} #${run} msgs ${String(s.messages).padStart(3)} solos ${String(s.solo).padStart(2)}/${String(s.requests).padEnd(2)} mezclados ${String(s.mixed).padStart(2)} enterrados ${String(s.buried).padStart(2)} perdidos ${s.lost} sobrantes ${s.surplus} partidos ${s.split} gemelos ${s.twins}${extra.cost !== undefined ? ` | ${extra.calls} llamadas ${extra.cost.toFixed(3)} USD ${extra.secs} s` : ''}${extra.groups !== undefined ? ` | grupos ${extra.groups}` : ''}`;

async function main() {
  const out = { at: new Date().toISOString(), label: values.label, stage: values.stage, config: JSON.parse(values.config), runs: [] };
  if (values.from) {
    const saved = JSON.parse(readFileSync(values.from, 'utf8'));
    for (const r of saved.runs) {
      if (!truths[r.n] || !r.messages) continue;
      const s = scoreMessages(r.messages, truths[r.n]);
      console.log(row(r.n, r.run, s, { cost: r.cost_usd, calls: r.calls, secs: r.secs }));
    }
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY && existsSync(`${process.env.HOME}/.config/team-platform/env`)) {
    for (const l of readFileSync(`${process.env.HOME}/.config/team-platform/env`, 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0) process.env[l.slice(0, i).replace(/^export /, '')] = l.slice(i + 1).replace(/^["']|["']$/g, ''); }
  }
  const { analyze, classifyInput, resolveConfig } = await import('../src/analyze/index.js');
  const { createProviders } = await import('../src/providers/index.js');
  process.env.TEXT_MODEL ||= 'claude-sonnet-5-5';
  const providers = createProviders(process.env);
  if (providers.text?.unavailable) throw new Error(`Sin proveedor de texto: ${providers.text.unavailable}`);
  const resultsDir = values['results-dir'] ?? join(here, 'results');
  const ledger = createSpend({ resultsDir, budgetUsd: Infinity });
  const before = ledger.read().total_usd;
  const budget = Number(values.budget);
  const config = JSON.parse(values.config);
  const jobs = elements.flatMap((n) => Array.from({ length: Number(values.runs) }, (_, i) => ({ n, run: i + 1 })));
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { n, run } = jobs[next]; next += 1;
      const spent = ledger.read().total_usd - before;
      if (spent >= budget * 0.9) { console.log(`Presupuesto: ${spent.toFixed(3)} de ${budget} USD; se corta antes de ${n} #${run}`); return; }
      const bundle = load(`bundle-${n}.json`);
      const t0 = performance.now();
      try {
        let messages;
        let calls;
        let extra = {};
        if (values.stage === 'classify') {
          const stage = await withQueueRetries(() => classifyInput(bundle, { providers, config: resolveConfig(config) }));
          if (stage.failed) throw new Error(`${stage.failed.status} ${stage.failed.step} ${JSON.stringify((stage.failed.errors ?? []).slice(0, 3))}`);
          messages = stage.groups.map((g) => ({ unit_ids: g.unit_ids, title: (g.requests ?? []).join('; '), requests: g.requests ?? [] }));
          calls = stage.ctx.calls;
          extra = { groups: messages.length, requests_declared: messages.map((g) => g.requests.length), stats: stage.ctx.stats };
        } else {
          const result = await withQueueRetries(() => analyze(bundle, { providers, analyzer: 'api', config }));
          if (result.status !== 'ok') throw new Error(`${result.status} ${result.step} ${JSON.stringify((result.errors ?? []).slice(0, 3))}`);
          messages = result.proposal.messages.map((m) => ({ unit_ids: m.unit_ids, title: m.title, body: m.body }));
          calls = result.calls;
          extra = { stats: result.stats };
        }
        const usd = calls.reduce((a, c) => a + (costOf(c) ?? 0), 0);
        ledger.add(`muestra-10/${values.label} ${n} #${run} (${values.stage})`, +usd.toFixed(4));
        const secs = Math.round((performance.now() - t0) / 1000);
        const entry = { n, run, secs, calls: calls.length, cost_usd: +usd.toFixed(4), messages, ...extra, usage: calls.map((c) => ({ step: c.step, effort: c.effort, usage: c.usage, outcome: c.outcome, ms: c.duration_ms })) };
        out.runs.push(entry);
        if (truths[n]) { entry.score = scoreMessages(messages, truths[n]); console.log(row(n, run, entry.score, { cost: usd, calls: calls.length, secs, groups: extra.groups })); } else console.log(`${n} #${run} msgs ${messages.length} | ${calls.length} llamadas ${usd.toFixed(3)} USD ${secs} s`);
      } catch (e) {
        console.log(`${n} #${run} FALLO: ${String(e.message).slice(0, 200)}`);
        out.runs.push({ n, run, failure: String(e.message).slice(0, 400) });
      }
    }
  };
  await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));
  const ok = out.runs.filter((r) => r.score);
  for (let run = 1; run <= Number(values.runs); run += 1) {
    const set = ok.filter((r) => r.run === run && truths[r.n]);
    if (set.length > 1) { const t = totalOf(set.map((r) => r.score)); console.log(`TOTAL #${run}: ${JSON.stringify(t)} costo ${set.reduce((a, r) => a + r.cost_usd, 0).toFixed(3)}`); }
  }
  mkdirSync(join(dir, 'lab', 'out'), { recursive: true });
  const file = join(dir, 'lab', 'out', `${values.label}.json`);
  writeFileSync(file, JSON.stringify(out));
  console.log(`Resultado: ${file}; gastado en esta invocación ${(ledger.read().total_usd - before).toFixed(4)} USD`);
}

await main();
