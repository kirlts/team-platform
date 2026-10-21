#!/usr/bin/env node
// Banco con casos privados (MASTER-SPEC §7.11): inputs reales que nunca entran a git.
// Extiende run.mjs: los adjuntos pasan primero por src/extract/ con proveedores reales y después
// por analyze(). Los casos viven en bench/private/<id>/ (manifest.json y expected.json), apuntan a
// los archivos originales por ruta absoluta y no los copian. Lo extraído se guarda en
// bench/private/.cache/<id>.json, porque la numeración de unidades de expected.json depende del
// texto extraído (una descripción de imagen cambia entre corridas): el análisis mide siempre contra
// la extracción guardada. Todo lo que este guion escribe queda en bench/private/ y bench/results/,
// ambos en .gitignore.
//
//   node bench/run-private.mjs list
//   node bench/run-private.mjs extract [--case id ...] [--force]      extrae y guarda; mide tiempo y costo
//   node bench/run-private.mjs units --case id                         imprime las unidades numeradas
//   node bench/run-private.mjs check                                   verifica que cada expected.json cubra cada unidad una vez
//   node bench/run-private.mjs run [--case id ...] [--repeat n] [--analyzer api|harness]
//   --budget <USD>   tope de gasto acumulado entre extracción y análisis (omisión 5)
//   --speech auto|groq|local|none   proveedor de voz: auto usa Groq si hay llave y si no el local
//
// Manifest: { id, title, kind, source, text?, text_path?, attachments?: [{ id, kind, path, mime }] }
import { parseArgs } from 'node:util';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixtures, runCase, summarize, formatReport, unitsOf } from './lib.js';
import { costOf } from './pricing.js';
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

// ---------- casos ----------

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

// ---------- gasto ----------

// El gasto se anota como líneas JSON añadidas al final (append), así varias corridas a la vez no se pisan.
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
// Corta antes de gastar si lo ya gastado llega al 90 % del tope.
function assertBudget(label) {
  const { total_usd: spent } = readSpend();
  if (spent >= budgetUsd * 0.9) throw new Error(`Presupuesto: gastado ${spent.toFixed(4)} USD de ${budgetUsd}; se corta antes de «${label}»`);
}

// ---------- proveedores ----------

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

// ---------- extracción ----------

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
      const cost = call.usage ? costOf({ model, usage: call.usage }) : null;
      if (call.usage) {
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

// ---------- órdenes ----------

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
