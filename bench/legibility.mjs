#!/usr/bin/env node
// Reads the text of one frame at 540, 720 and 1080 px with the vision model and prints how much of it comes back (TASK-013, bench/legibility.js).
//
//   node bench/legibility.mjs --plan                          builds the frames, prints what it would send and what it would cost; calls nothing
//   node bench/legibility.mjs [--widths 540,720,1080] [--budget 0.5] [--results-dir <d>]
//
// The real run calls the vision provider of the environment once per width (three images of about 60 KB). `--plan` needs no key and
// exits 1 when the real run would stop: no ffmpeg, no font, or a model without a price in bench/pricing.js.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULTS as EXTRACT } from '../src/extract/config.js';
import { createProviders } from '../src/providers/index.js';
import { buildFrames, LINES, measure } from './legibility.js';
import { costOf } from './pricing.js';
import { createSpend } from './spend.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    widths: { type: 'string', default: '540,720,1080' },
    budget: { type: 'string', default: '0.5' },
    'results-dir': { type: 'string', default: join(here, 'results') },
    plan: { type: 'boolean', default: false },
  },
});
const widths = values.widths.split(',').map(Number);
if (widths.some((w) => !Number.isInteger(w) || w <= 0)) {
  console.error('--widths: a comma list of positive integers.');
  process.exit(2);
}

const SCHEMA = {
  type: 'object',
  properties: { frames: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, description: { type: 'string' } }, required: ['index', 'description'], additionalProperties: false } } },
  required: ['frames'],
  additionalProperties: false,
};

const problems = [];
let fontFile = '';
try {
  fontFile = execFileSync('fc-match', ['-f', '%{file}', 'sans'], { encoding: 'utf8' }).trim();
} catch {
  problems.push('no hay fc-match para encontrar una fuente');
}
const tmp = process.env.TMPDIR ?? tmpdir();
const dir = mkdtempSync(join(tmp, 'legibility-'));
let frames = [];
try {
  frames = await buildFrames({ dir, widths, quality: EXTRACT.video.frameQuality, fontFile });
} catch (error) {
  problems.push(`ffmpeg no pudo armar los fotogramas: ${String(error.stderr ?? error.message).trim().slice(0, 200)}`);
}
const model = process.env.VISION_MODEL || process.env.TEXT_MODEL || 'claude-haiku-5-5';
console.log(`Fotogramas en ${dir}: ${frames.map((f) => `${f.width} px, ${readFileSync(f.path).length} bytes`).join('; ')}`);
console.log(`Líneas dibujadas: ${LINES.map((l) => `${l.size} px`).join(', ')}. Modelo de visión: ${model}.`);
if (values.plan) {
  if (problems.length > 0) {
    for (const p of problems) console.log(`PROBLEMA: ${p}`);
    console.log('Plan: NO ejecutable');
    process.exit(1);
  }
  console.log(`Llamadas: ${frames.length}, una imagen cada una. Plan: ejecutable`);
  process.exit(0);
}
if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}

const providers = createProviders(process.env);
if (providers.vision?.unavailable || !providers.vision?.describe) {
  console.error('No hay un proveedor de visión configurado: falta la llave (node scripts/llave.mjs ANTHROPIC_API_KEY).');
  process.exit(1);
}
const resultsDir = values['results-dir'];
mkdirSync(resultsDir, { recursive: true });
const ledger = createSpend({ resultsDir, budgetUsd: Number(values.budget) });
ledger.assertBudget('legibility');
const withData = frames.map((f) => ({ ...f, data: readFileSync(f.path) }));
const rows = await measure({ frames: withData, vision: providers.vision, prompt: EXTRACT.video.prompt, schema: SCHEMA });
let spent = 0;
for (const row of rows) {
  const usd = costOf({ model: providers.vision.model, usage: row.usage });
  spent += usd ?? 0;
  ledger.add(`legibility ${row.width}`, usd ?? 0, usd === null ? 1 : 0);
}
console.log('\nAncho   ' + LINES.map((l) => `${String(l.size).padStart(4)} px`).join(' ') + '   media');
for (const row of rows) console.log(`${String(row.width).padStart(5)}   ` + row.lines.map((l) => `${(l.recall * 100).toFixed(0).padStart(5)} %`).join(' ') + `   ${(row.mean * 100).toFixed(0)} %`);
const out = join(resultsDir, `legibility-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), model: providers.vision.model, spent_usd: spent, rows }, null, 2));
console.log(`\nGasto ${spent.toFixed(4)} USD. Resultado: ${out}`);
