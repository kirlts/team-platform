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
//   node bench/run-private.mjs compare <result.json> <result.json> ...   side-by-side table of variants
//   --team <file>      JSON array of { id, name, role, profile }: the members the analyzer receives (default: bench/fixtures.json)
//   --no-profile       send members with id and name only (the «name only» baseline)
//   --project <file>   markdown sent as bundle.project.description (default: no project); --project-name sets its name
//   --usefulness <f>   compare: scores by variant from a pooled judgment file instead of <result>.usefulness.json
//   --oracle           run: classification gets the reference groups (bench/oracle.mjs); every variant is scored on the same messages
//   --reference a|b|union  which reader's labels score area and assignees (default union: either reader's label is right)
//   --first-reader-only  same as --reference a
//   --common-cases     compare: restrict every variant to the cases all of them finished
//   --ceiling          compare: add the other reader scored against this reference, the ceiling of the readers' disagreement
//   --pool             compare: merge result files whose variant differs only by a «-b» suffix (a repetition) into one
//   --variant <label>  written into the result and its file name
//   --cases a,b,c      comma list of case ids (same as repeating --case)
//   --private-dir <d>  where the cases live (default bench/private; env BENCH_PRIVATE_DIR)
//   --results-dir <d>  where results and the spending ledger go (default bench/results)
//   --budget <USD>   spending cap accumulated over extraction and analysis (default 5)
//   --speech auto|groq|local|none   speech provider: auto uses Groq when there is a key, else the local one
//
// Manifest: { id, title, kind, source, text?, text_path?, attachments?: [{ id, kind, path, mime }] }
import { parseArgs } from 'node:util';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixtures, runCase, summarize, formatReport, unitsOf } from './lib.js';
import { score } from './score.js';
import { createSpend, withQueueRetries } from './spend.mjs';
import { runOracleCase } from './oracle.mjs';
import { mergeSecondLabeler, onlySecondLabeler, readerAsProposal } from './labels.js';
import { compareResults, formatComparison, poolResults } from './compare.js';
import { costOf, usageOfCall } from './pricing.js';
import { analyze } from '../src/analyze/index.js';
import { extract } from '../src/extract/index.js';
import { createProviders } from '../src/providers/index.js';
import { createLocalSpeech } from './local-speech.mjs';

const here = dirname(fileURLToPath(import.meta.url));

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
    team: { type: 'string' },
    project: { type: 'string' },
    'project-name': { type: 'string' },
    'no-profile': { type: 'boolean', default: false },
    variant: { type: 'string' },
    cases: { type: 'string' },
    'private-dir': { type: 'string' },
    'results-dir': { type: 'string' },
    pool: { type: 'boolean', default: false },
    usefulness: { type: 'string' },
    oracle: { type: 'boolean', default: false },
    'first-reader-only': { type: 'boolean', default: false },
    reference: { type: 'string', default: 'union' },
    'common-cases': { type: 'boolean', default: false },
    ceiling: { type: 'boolean', default: false },
  },
});
const command = positionals[0] ?? 'list';
const budgetUsd = Number(values.budget);
const privateDir = values['private-dir'] ?? process.env.BENCH_PRIVATE_DIR ?? join(here, 'private');
const cacheDir = join(privateDir, '.cache');
const resultsDir = values['results-dir'] ?? join(here, 'results');
const wantedCases = [...(values.case ?? []), ...(values.cases ? values.cases.split(',').map((x) => x.trim()).filter(Boolean) : [])];

// ---------- cases ----------

function loadPrivateCases() {
  if (!existsSync(privateDir)) throw new Error('No existe bench/private/');
  return readdirSync(privateDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(privateDir, d.name, 'manifest.json')))
    .map((d) => d.name)
    .sort()
    .filter((id) => !wantedCases.length || wantedCases.includes(id))
    .map((id) => ({
      id,
      manifest: JSON.parse(readFileSync(join(privateDir, id, 'manifest.json'), 'utf8')),
      expectedPath: join(privateDir, id, 'expected.json'),
    }));
}

// Reference by --reference: «a» the first reader (expected.json), «b» the second reader (expected-b.json), «union» both
// (a label is right if either reader gave it; default). Without expected-b.json only the first reader exists.
const readSecond = (c) => {
  const secondPath = join(dirname(c.expectedPath), 'expected-b.json');
  return existsSync(secondPath) ? JSON.parse(readFileSync(secondPath, 'utf8')) : null;
};
function readExpected(c, mode = values['first-reader-only'] ? 'a' : values.reference) {
  if (!existsSync(c.expectedPath)) return null;
  const first = JSON.parse(readFileSync(c.expectedPath, 'utf8'));
  const second = mode === 'a' ? null : readSecond(c);
  if (!second) return first;
  return mode === 'b' ? onlySecondLabeler(first, second) : mergeSecondLabeler(first, second);
}
const cachePath = (id) => join(cacheDir, `${id}.json`);
const readCache = (id) => (existsSync(cachePath(id)) ? JSON.parse(readFileSync(cachePath(id), 'utf8')) : null);

// ---------- spending ----------

const ledger = createSpend({ resultsDir, budgetUsd });
const addSpend = (label, usd, unpriced = 0) => ledger.add(label, usd, unpriced);
const assertBudget = (label) => ledger.assertBudget(label);

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

// ---------- context under test (H-77) ----------

/**
 * The analyzer context of this run, shaped as `src/domain/pipeline.js` builds the bundle: members `{ id, name, profile }`
 * and `project = { name, description }`. `--team` replaces the built-in members, `--no-profile` drops the profile of
 * every member (the «name only» baseline) and `--project` sends the markdown file as the project description.
 */
async function buildContextFixtures() {
  const fixtures = await loadFixtures();
  let members = fixtures.members;
  if (values.team) {
    const team = JSON.parse(readFileSync(values.team, 'utf8'));
    if (!Array.isArray(team) || team.some((m) => !Number.isInteger(m.id) || typeof m.name !== 'string')) throw new Error('--team: se espera un arreglo de { id, name, role, profile }');
    members = team;
  }
  members = members.map((m) => (values['no-profile'] ? { id: m.id, name: m.name } : { id: m.id, name: m.name, profile: m.profile }));
  const project = values.project
    ? { name: values['project-name'] ?? process.env.PROJECT_NAME ?? 'Team', description: readFileSync(values.project, 'utf8') }
    : undefined;
  return { ...fixtures, members, ...(project ? { project } : {}) };
}

/** What the result file records about the context, without its text (the file lives in a git-ignored folder anyway). */
const describeContext = (fixtures) => ({
  members: fixtures.members.map((m) => ({ id: m.id, name: m.name, profile_chars: (m.profile ?? '').length })),
  project: fixtures.project ? { name: fixtures.project.name, description_chars: fixtures.project.description.length, file: values.project } : null,
  team_file: values.team ?? null,
  no_profile: values['no-profile'],
});

/** One case in oracle mode (bench/oracle.mjs), scored like runCase: the reference groups are the points. */
async function runOracleScored({ cache, expected, fixtures, providers, caseId }) {
  const run = await runOracleCase({
    providers,
    input: cache.input,
    context: fixtures,
    expected,
    onRetry: (e, attempt) => console.log(`${caseId}: reintento ${attempt} (${e.message.slice(0, 90)})`),
  });
  return { case_id: caseId, ...run, score: score({ units: run.units, expected, actual: run.proposal }) };
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
  const fixtures = await buildContextFixtures();
  const providers = buildProviders();
  const all = [];
  mkdirSync(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = values.out ?? join(resultsDir, `private-${values.variant ? `${values.variant.replace(/[^\w+.-]/g, '_')}-` : ''}${stamp}.json`);
  // The file is rewritten after every case, so a run that stops (spending cap, crash) keeps what it finished.
  const save = (complete) => writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), variant: values.variant ?? null, mode: values.oracle ? 'oracle' : 'full', complete, repeat, context: describeContext(fixtures), models: providers.describe(), speech: providers.speechMode, cases: all }, null, 2));
  let stoppedByBudget = false;
  for (const c of loadPrivateCases()) {
    if (stoppedByBudget) break;
    const cache = readCache(c.id);
    const expected = readExpected(c);
    if (!cache || !expected) {
      console.log(`${c.id}: se omite (${!cache ? 'sin extraer' : 'sin referencia'})`);
      continue;
    }
    const runs = [];
    for (let i = 0; i < repeat; i += 1) {
      try {
        assertBudget(`${c.id} #${i + 1}`);
      } catch (e) {
        console.log(e.message);
        stoppedByBudget = true;
        break;
      }
      // A retryable provider error (rate limit, overload) repeats the whole case, as the job queue does in the product.
      const run = values.oracle
        ? await runOracleScored({ cache, expected, fixtures, providers, caseId: c.id })
        : await withQueueRetries(
          () => runCase({
            analyze,
            providers,
            testCase: { id: c.id, input: cache.input, expected },
            fixtures,
            options: values.analyzer ? { analyzer: values.analyzer } : {},
          }),
          { attempts: 6, onRetry: (e, attempt) => console.log(`${c.id}: reintento ${attempt} (${e.message.slice(0, 90)})`) },
        );
      const total = addSpend(`analyze ${c.id}`, run.usage.cost_usd ?? 0, run.usage.cost_usd === null ? run.usage.calls : 0);
      console.log(`${c.id} #${i + 1}: ${run.status}, ${(run.total_ms / 1000).toFixed(1)} s, ${run.usage.calls} llamadas, ${run.usage.cost_usd?.toFixed(5) ?? 'sin tarifa'} USD (acumulado ${total.toFixed(4)})`);
      runs.push(run);
    }
    if (runs.length > 0) {
      all.push({ case_id: c.id, kind: c.manifest.kind, source: c.manifest.source, extraction: cache.extraction, speech: cache.speech, summary: summarize(runs), runs });
      save(false);
    }
  }
  if (all.length) {
    console.log(`\n${formatReport(all.map((x) => x.summary))}`);
    save(!stoppedByBudget);
    console.log(`\nResultado completo: ${out}${stoppedByBudget ? ' (incompleto: tope de gasto)' : ''}`);
  }
} else if (command === 'compare') {
  const files = positionals.slice(1);
  if (files.length < 1) throw new Error('compare: faltan archivos de resultado');
  const results = files.map((file) => {
    const usefulnessFile = file.replace(/\.json$/, '.usefulness.json');
    return { file, ...JSON.parse(readFileSync(file, 'utf8')), usefulness: existsSync(usefulnessFile) ? JSON.parse(readFileSync(usefulnessFile, 'utf8')) : null };
  });
  const allCases = loadPrivateCases();
  if (values['common-cases']) {
    // A run that stopped at the spending cap covers fewer cases: every variant is cut to the cases all of them finished.
    const common = results.reduce((acc, r) => (acc ? new Set([...acc].filter((id) => r.cases.some((c) => c.case_id === id))) : new Set(r.cases.map((c) => c.case_id))), null);
    for (const r of results) r.cases = r.cases.filter((c) => common.has(c.case_id));
    console.error(`Common cases: ${common.size}`);
  }
  const compared = values.pool ? poolResults(results, (r) => (r.variant ?? r.file).replace(/-b$/, '')) : results;
  if (values.usefulness) {
    // A pooled judgment file (judge-usefulness.mjs --pooled) holds the scores by variant label.
    const judged = JSON.parse(readFileSync(values.usefulness, 'utf8'));
    for (const r of compared) r.usefulness = judged.variants[r.variant ?? r.file] ? { cost_usd: null, cases: judged.variants[r.variant ?? r.file].cases } : null;
  }
  const inputOf = (caseId) => {
    const cache = readCache(caseId);
    return cache ? [cache.input.text, ...cache.input.attachments.map((a) => a.extracted)].join('\n') : '';
  };
  if (values.ceiling) {
    // Reader B scored against A (or A against B with --reference b) as if it were a variant: the ceiling that the
    // disagreement between readers puts on any analyzer.
    const asReader = values.reference === 'b' ? 'a' : 'b';
    const cases = loadPrivateCases().filter((c) => readSecond(c)).map((c) => {
      const reference = readExpected(c, asReader === 'b' ? 'a' : 'b');
      const proposal = readerAsProposal(reference, asReader === 'b' ? readSecond(c) : JSON.parse(readFileSync(c.expectedPath, 'utf8')));
      const units = [...new Set(reference.messages.flatMap((m) => m.unit_ids).concat((reference.discarded ?? []).flatMap((d) => d.unit_ids)))];
      return { case_id: c.id, runs: [{ status: 'ok', total_ms: 0, usage: { cost_usd: 0 }, proposal, units, score: score({ units, expected: reference, actual: proposal }) }] };
    });
    compared.push({ file: `reader-${asReader}`, variant: `reader ${asReader.toUpperCase()}`, context: compared[0]?.context, cases, usefulness: null });
  }
  console.log(formatComparison(compareResults(compared, { inputOf, expectedOf: (id) => { const c = allCases.find((x) => x.id === id); return c ? readExpected(c) : null; } })));
} else {
  throw new Error(`Orden desconocida «${command}»`);
}
