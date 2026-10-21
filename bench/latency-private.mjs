#!/usr/bin/env node
// Real latency of the providers by kind of file (TASK-013), over the private cases. Each attachment goes through
// src/extract/ with real providers whose calls are timed one by one (Anthropic vision, Groq speech); then the analyzer runs on
// the extracted text with the real text provider and the duration of each call comes from `result.calls`.
//
//   node bench/latency-private.mjs run [--cases a,b] [--repeat 3] [--analysis-repeat 1] [--budget 1] [--out file] [--results-dir d]
//   node bench/latency-private.mjs report <result.json>
//
// Reads bench/private/ (env BENCH_PRIVATE_DIR) and never writes there: the extraction of this script is not the one the
// references number (bench/private/.cache). Everything printed is a count, a duration or a rate.
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../src/analyze/index.js';
import { extract } from '../src/extract/index.js';
import { createProviders } from '../src/providers/index.js';
import { buildBundle, loadFixtures, unitsOf } from './lib.js';
import { costOf, usageOfCall } from './pricing.js';
import { createSpend } from './spend.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    cases: { type: 'string' },
    repeat: { type: 'string', default: '3' },
    'analysis-repeat': { type: 'string', default: '1' },
    budget: { type: 'string', default: '1' },
    out: { type: 'string' },
    'private-dir': { type: 'string' },
    'results-dir': { type: 'string' },
  },
});
const command = positionals[0] ?? 'run';

const pct = (xs, p) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};
const sec = (ms) => (ms === null || ms === undefined ? 'n/a' : `${(ms / 1000).toFixed(1)}`);

/** Format of the attachment, from the file name: the extractor's own `meta.format` only exists for documents. */
const formatOf = (path) => (basename(path).split('.').pop() ?? '').toLowerCase();

async function run() {
  const privateDir = values['private-dir'] ?? process.env.BENCH_PRIVATE_DIR ?? join(here, 'private');
  const resultsDir = values['results-dir'] ?? join(here, 'results');
  const ledger = createSpend({ resultsDir, budgetUsd: Number(values.budget) });
  const wanted = values.cases ? values.cases.split(',') : null;
  const cases = readdirSync(privateDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(privateDir, d.name, 'manifest.json')))
    .map((d) => ({ id: d.name, manifest: JSON.parse(readFileSync(join(privateDir, d.name, 'manifest.json'), 'utf8')) }))
    .filter((c) => (c.manifest.attachments ?? []).length > 0 && (!wanted || wanted.includes(c.id)))
    .sort((a, b) => a.id.localeCompare(b.id));
  const providers = createProviders(process.env);
  const timed = { vision: [], speech: [] };
  const describe = providers.vision.describe.bind(providers.vision);
  providers.vision.describe = async (req) => {
    const t0 = performance.now();
    try { return await describe(req); } finally { timed.vision.push({ ms: Math.round(performance.now() - t0), images: req.images?.length ?? 0 }); }
  };
  const transcribe = providers.speech.transcribe.bind(providers.speech);
  providers.speech.transcribe = async (req) => {
    const t0 = performance.now();
    try { return await transcribe(req); } finally { timed.speech.push({ ms: Math.round(performance.now() - t0) }); }
  };
  const fixtures = await loadFixtures();
  const repeat = Number(values.repeat);
  const analysisRepeat = Number(values['analysis-repeat']);
  const rows = [];
  for (const c of cases) {
    for (let rep = 1; rep <= repeat; rep += 1) {
      ledger.assertBudget(`${c.id} #${rep}`);
      const attachments = [];
      const extractions = [];
      let cost = 0;
      for (const att of c.manifest.attachments) {
        timed.vision.length = 0; timed.speech.length = 0;
        const t0 = performance.now();
        const r = await extract(att, { providers, onProgress: () => {} });
        const ms = Math.round(performance.now() - t0);
        const calls = (r.meta.calls ?? []).map((call) => {
          const model = call.modality === 'vision' ? providers.vision.model : call.modality === 'speech' ? providers.speech.model : null;
          const usage = usageOfCall(call);
          return usage ? costOf({ model, usage }) ?? 0 : 0;
        });
        cost += calls.reduce((a, b) => a + b, 0);
        attachments.push({ id: att.id, kind: att.kind, extracted: r.text });
        extractions.push({
          kind: att.kind, format: formatOf(att.path), bytes: statSync(att.path).size, ms,
          vision_calls: timed.vision.map((v) => ({ ...v })), speech_calls: timed.speech.map((v) => ({ ...v })),
          audio_seconds: r.meta.durationSeconds ?? null, frames_described: r.meta.dedupedFrames ?? null,
        });
      }
      let analysis = null;
      if (rep <= analysisRepeat) {
        const input = { text: c.manifest.text ?? (c.manifest.text_path ? readFileSync(c.manifest.text_path, 'utf8') : ''), attachments };
        const t0 = performance.now();
        const result = await analyze(buildBundle(input, fixtures), { providers });
        const total = Math.round(performance.now() - t0);
        const calls = (result.calls ?? []).map((call) => ({ step: call.step, ms: call.duration_ms, cost: costOf(call) ?? 0 }));
        cost += calls.reduce((a, b) => a + b.cost, 0);
        analysis = { status: result.status, total_ms: total, units: unitsOf(input).length, calls: calls.map(({ step, ms }) => ({ step, ms })) };
      }
      ledger.add(`latency ${c.id} #${rep}`, cost);
      rows.push({ case_id: c.id, kind: c.manifest.kind, rep, extractions, analysis, cost_usd: cost });
      console.log(`${c.id} #${rep}: ${extractions.map((e) => `${e.kind} ${sec(e.ms)} s`).join(', ')}${analysis ? `; análisis ${sec(analysis.total_ms)} s (${analysis.status})` : ''}; ${cost.toFixed(5)} USD`);
    }
  }
  mkdirSync(resultsDir, { recursive: true });
  const file = values.out ?? join(resultsDir, `latency-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), models: { text: providers.text.model, vision: providers.vision.model, speech: providers.speech.model }, repeat, analysis_repeat: analysisRepeat, rows }));
  console.log(`Resultado: ${file}; gasto acumulado ${ledger.read().total_usd.toFixed(4)} USD`);
}

function report(file) {
  const d = JSON.parse(readFileSync(file, 'utf8'));
  const groups = new Map();
  const add = (key, row, ext) => groups.set(key, [...(groups.get(key) ?? []), { row, ext }]);
  for (const row of d.rows) for (const ext of row.extractions) add(`${ext.kind} ${ext.format}`, row, ext);
  console.log(`Modelos: texto ${d.models.text}, visión ${d.models.vision}, voz ${d.models.speech}; ${d.rows.length} corridas de caso`);
  console.log('\nExtracción por tipo de archivo (segundos)');
  console.log('tipo | archivos | corridas | peso medio (MB) | extracción p50 | extracción p95 | Anthropic visión por llamada p50 | Groq voz por llamada p50 | voz: segundos de audio por segundo');
  for (const [key, list] of [...groups].sort()) {
    const ms = list.map((x) => x.ext.ms);
    const vision = list.flatMap((x) => x.ext.vision_calls.map((v) => v.ms));
    const speech = list.flatMap((x) => x.ext.speech_calls.map((v) => v.ms));
    const rt = list.filter((x) => x.ext.speech_calls.length && x.ext.audio_seconds).map((x) => x.ext.audio_seconds / (x.ext.speech_calls.reduce((a, v) => a + v.ms, 0) / 1000));
    const files = new Set(list.map((x) => x.row.case_id)).size;
    console.log(`${key} | ${files} | ${list.length} | ${(list.reduce((a, x) => a + x.ext.bytes, 0) / list.length / 1e6).toFixed(1)} | ${sec(pct(ms, 0.5))} | ${sec(pct(ms, 0.95))} | ${vision.length ? sec(pct(vision, 0.5)) : '-'} | ${speech.length ? sec(pct(speech, 0.5)) : '-'} | ${rt.length ? pct(rt, 0.5).toFixed(0) : '-'}`);
  }
  console.log('\nAnálisis con Anthropic por tipo de caso (segundos)');
  console.log('tipo de caso | análisis | unidades medias | total p50 | total p95 | llamada p50 | llamada p95');
  const byKind = new Map();
  for (const row of d.rows.filter((r) => r.analysis)) byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row.analysis]);
  for (const [kind, list] of [...byKind].sort()) {
    const calls = list.flatMap((a) => a.calls.map((c) => c.ms).filter((x) => x !== null && x !== undefined));
    console.log(`${kind} | ${list.length} | ${(list.reduce((a, x) => a + x.units, 0) / list.length).toFixed(0)} | ${sec(pct(list.map((a) => a.total_ms), 0.5))} | ${sec(pct(list.map((a) => a.total_ms), 0.95))} | ${sec(pct(calls, 0.5))} | ${sec(pct(calls, 0.95))}`);
  }
  console.log(`\nGasto de la corrida: ${d.rows.reduce((a, r) => a + r.cost_usd, 0).toFixed(4)} USD`);
}

if (command === 'run') await run();
else if (command === 'report') report(positionals[1]);
else { console.error('Uso: run | report <resultado.json>'); process.exit(2); }
