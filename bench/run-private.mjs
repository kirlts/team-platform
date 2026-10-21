#!/usr/bin/env node
// Benchmark with private cases (MASTER-SPEC §7.11): real inputs that never enter git.
// Extends run.mjs: attachments go through src/extract/ with real providers first, then through
// analyze(). Cases live in bench/private/<id>/ (manifest.json and expected.json), point to the
// original files by absolute path and never copy them. The extracted text is stored in
// bench/private/.cache/<id>.json because the unit numbering that expected.json cites depends on
// the extracted text (an image description changes between runs): the analysis is always
// scored against the stored extraction. Everything this script writes lands in bench/private/
// and bench/results/, both in .gitignore.
//
//   node bench/run-private.mjs list
//   node bench/run-private.mjs extract [--case id ...] [--force]      extract and store; measures time and cost
//   node bench/run-private.mjs units --case id                         print the numbered units
//   node bench/run-private.mjs check                                   every unit in exactly one expected message or discard
//   node bench/run-private.mjs run [--case id ...] [--repeat n] [--analyzer api|harness]
//   --budget <USD>   spending cap accumulated over extraction and analysis (default 5)
//   --speech auto|groq|local|none   speech provider: auto uses Groq when there is a key, else the local one
//
// Manifest: { id, title, kind, source, text?, text_path?, attachments?: [{ id, kind, path, mime }] }
import { parseArgs } from 'node:util';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixtures, runCase, summarize, formatReport, unitsOf } from './lib.js';
import { costOf, usageOfCall } from './pricing.js';
import { analyze } from '../src/analyze/index.js';
import { extract } from '../src/extract/index.js';
import { createProviders } from '../src/providers/index.js';
import { createLocalSpeech } from './local-speech.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const privateDir = join(here, 'private');
const cacheDir = join(privateDir, '.cache');
const resultsDir = join(here, 'results');
const spendFile = join(resultsDir, 'private-spend.jsonl');

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    case: { type: 'string', multiple: true },
    repeat: { type: 'string', default: '1' },
    analyzer: { type: 'string' },
    budget: { type: 'string', default: '5' },
    speech: { type: 'string', default: 'auto' },
    force: { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});
const command = positionals[0] ?? 'list';
const budgetUsd = Number(values.budget);

// ---------- cases ----------

function loadPrivateCases() {
  if (!existsSync(privateDir)) throw new Error('No existe bench/private/');
  return readdirSync(privateDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(privateDir, d.name, 'manifest.json')))
    .map((d) => d.name)
    .sort()
    .filter((id) => !values.case?.length || values.case.includes(id))
    .map((id) => ({
      id,
      manifest: JSON.parse(readFileSync(join(privateDir, id, 'manifest.json'), 'utf8')),
      expectedPath: join(privateDir, id, 'expected.json'),
    }));
}

const readExpected = (c) => (existsSync(c.expectedPath) ? JSON.parse(readFileSync(c.expectedPath, 'utf8')) : null);
const cachePath = (id) => join(cacheDir, `${id}.json`);
const readCache = (id) => (existsSync(cachePath(id)) ? JSON.parse(readFileSync(cachePath(id), 'utf8')) : null);

// ---------- spending ----------

// Spending is appended as JSON lines so concurrent runs do not overwrite each other.
function readSpend() {
  if (!existsSync(spendFile)) return { total_usd: 0, unpriced_calls: 0 };
  const rows = readFileSync(spendFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { total_usd: rows.reduce((a, r) => a + r.usd, 0), unpriced_calls: rows.reduce((a, r) => a + (r.unpriced ?? 0), 0) };
}
function addSpend(label, usd, unpriced = 0) {
  mkdirSync(resultsDir, { recursive: true });
  appendFileSync(spendFile, `${JSON.stringify({ at: new Date().toISOString(), label, usd, unpriced })}\n`);
  return readSpend().total_usd;
}
// Cuts before spending once the accumulated total reaches 90 % of the cap.
function assertBudget(label) {
  const { total_usd: spent } = readSpend();
  if (spent >= budgetUsd * 0.9) throw new Error(`Presupuesto: gastado ${spent.toFixed(4)} USD de ${budgetUsd}; se corta antes de «${label}»`);
}

// ---------- providers ----------

function buildProviders() {
  const providers = createProviders(process.env);
  const mode = values.speech;
  const useLocal = mode === 'local' || (mode === 'auto' && providers.speech.unavailable);
  if (mode === 'none') {
    providers.speech = { name: null, model: null, transcribe: async () => ({ text: '', segments: [] }) };
    providers.speechMode = 'none (sin transcripción)';
  } else if (useLocal) {
    providers.speech = createLocalSpeech();
    providers.speechMode = `local (${providers.speech.name} ${providers.speech.model}); sin GROQ_API_KEY`;
  } else {
    providers.speechMode = `${providers.speech.name} ${providers.speech.model}`;
  }
  return providers;
}

// ---------- extraction ----------

async function extractCase(c, providers) {
  const m = c.manifest;
  const started = performance.now();
  let text = m.text ?? '';
  if (m.text_path) text = readFileSync(m.text_path, 'utf8');
  const attachments = [];
  const metrics = [];
  let costUsd = 0;
  let unpriced = 0;
  for (const att of m.attachments ?? []) {
    assertBudget(`${c.id}/${basename(att.path)}`);
    const t0 = performance.now();
    const steps = [];
    const r = await extract(att, {
      providers,
      onProgress: (percent, phrase) => steps.push({ percent, phrase, at_ms: Math.round(performance.now() - t0) }),
    });
    const ms = Math.round(performance.now() - t0);
    const calls = (r.meta.calls ?? []).map((call) => {
      const model = call.modality === 'vision' ? providers.vision.model : call.modality === 'speech' ? providers.speech.model : null;
      const usage = usageOfCall(call); // a speech call has billable seconds, not tokens: Groq charges per hour of audio
      const cost = usage ? costOf({ model, usage }) : null;
      if (usage) {
        if (cost === null) unpriced += 1;
        else costUsd += cost;
      }
      return { ...call, model, cost_usd: cost };
    });
    attachments.push({ id: att.id, kind: att.kind, extracted: r.text });
    metrics.push({ id: att.id, kind: att.kind, file: basename(att.path), bytes: statSync(att.path).size, ms, steps, calls, meta: { ...r.meta, calls: undefined } });
  }
  return {
    case_id: c.id,
    extracted_at: new Date().toISOString(),
    speech: providers.speechMode,
    input: { text, attachments },
    extraction: { total_ms: Math.round(performance.now() - started), cost_usd: costUsd, unpriced_calls: unpriced, attachments: metrics },
  };
}

// ---------- commands ----------

if (command === 'list') {
  for (const c of loadPrivateCases()) {
    const cache = readCache(c.id);
    const exp = readExpected(c);
    console.log([c.id.padEnd(34), (c.manifest.kind ?? '').padEnd(10), `extraído: ${cache ? 'sí' : 'no'}`, `referencia: ${exp ? `${exp.messages.length} mensajes` : 'no'}`].join('  '));
  }
} else if (command === 'extract') {
  const providers = buildProviders();
  console.log(`Voz: ${providers.speechMode}`);
  for (const c of loadPrivateCases()) {
    if (readCache(c.id) && !values.force) {
      console.log(`${c.id}: ya extraído (usar --force para repetir)`);
      continue;
    }
    try {
      const out = await extractCase(c, providers);
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cachePath(c.id), JSON.stringify(out, null, 2));
      const total = addSpend(`extract ${c.id}`, out.extraction.cost_usd, out.extraction.unpriced_calls);
      const units = unitsOf(out.input).length;
      console.log(`${c.id}: ${(out.extraction.total_ms / 1000).toFixed(1)} s, ${units} unidades, ${out.extraction.cost_usd.toFixed(5)} USD (acumulado ${total.toFixed(4)})`);
    } catch (e) {
      console.log(`${c.id}: FALLÓ ${e.code ?? ''} ${e.message}`);
      if (/Presupuesto/.test(e.message)) process.exit(2);
    }
  }
} else if (command === 'units') {
  for (const c of loadPrivateCases()) {
    const cache = readCache(c.id);
    if (!cache) throw new Error(`${c.id} sin extraer`);
    for (const u of unitsOf(cache.input)) console.log(`[u${u.id}] ${u.text.replace(/\n/g, ' / ')}`);
  }
} else if (command === 'check') {
  let bad = 0;
  for (const c of loadPrivateCases()) {
    const cache = readCache(c.id);
    const exp = readExpected(c);
    if (!cache || !exp) {
      console.log(`${c.id}: falta ${!cache ? 'extracción' : 'referencia'}`);
      continue;
    }
    const ids = unitsOf(cache.input).map((u) => u.id);
    const seen = new Map();
    const errors = [];
    const place = (id, where) => {
      if (!ids.includes(id)) errors.push(`${where} cita ${id}, que no existe`);
      else if (seen.has(id)) errors.push(`${id} en ${where} y en ${seen.get(id)}`);
      else seen.set(id, where);
    };
    for (const m of exp.messages) m.unit_ids.forEach((id) => place(id, m.id));
    for (const d of exp.discarded ?? []) d.unit_ids.forEach((id) => place(id, 'descartadas'));
    const missing = ids.filter((id) => !seen.has(id));
    if (missing.length) errors.push(`sin asignar: ${missing.join(',')}`);
    console.log(`${c.id}: ${errors.length ? 'MAL ' + errors.join('; ') : `ok (${ids.length} unidades, ${exp.messages.length} mensajes)`}`);
    if (errors.length) bad += 1;
  }
  process.exit(bad ? 1 : 0);
} else if (command === 'run') {
  const repeat = Number(values.repeat);
  const fixtures = await loadFixtures();
  const providers = buildProviders();
  const all = [];
  for (const c of loadPrivateCases()) {
    const cache = readCache(c.id);
    const expected = readExpected(c);
    if (!cache || !expected) {
      console.log(`${c.id}: se omite (${!cache ? 'sin extraer' : 'sin referencia'})`);
      continue;
    }
    const runs = [];
    for (let i = 0; i < repeat; i += 1) {
      assertBudget(`${c.id} #${i + 1}`);
      const run = await runCase({
        analyze,
        providers,
        testCase: { id: c.id, input: cache.input, expected },
        fixtures,
        options: values.analyzer ? { analyzer: values.analyzer } : {},
      });
      const total = addSpend(`analyze ${c.id}`, run.usage.cost_usd ?? 0, run.usage.cost_usd === null ? run.usage.calls : 0);
      console.log(`${c.id} #${i + 1}: ${run.status}, ${(run.total_ms / 1000).toFixed(1)} s, ${run.usage.calls} llamadas, ${run.usage.cost_usd?.toFixed(5) ?? 'sin tarifa'} USD (acumulado ${total.toFixed(4)})`);
      runs.push(run);
    }
    all.push({ case_id: c.id, kind: c.manifest.kind, source: c.manifest.source, extraction: cache.extraction, speech: cache.speech, summary: summarize(runs), runs });
  }
  if (all.length) {
    console.log(`\n${formatReport(all.map((x) => x.summary))}`);
    mkdirSync(resultsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = values.out ?? join(resultsDir, `private-${stamp}.json`);
    writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), repeat, models: providers.describe(), speech: providers.speechMode, cases: all }, null, 2));
    console.log(`\nResultado completo: ${out}`);
  }
} else {
  throw new Error(`Orden desconocida «${command}»`);
}
