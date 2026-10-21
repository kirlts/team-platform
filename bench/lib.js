// Shared bench pieces: case loading, bundle assembly, measured execution and report.
// The analyzer is the one in MASTER-SPEC §7.5: analyze(bundle, { providers, onProgress }) → result with
// status, proposal, units, calls and stats. Cases store the raw input; the units are numbered by the
// analyzer (src/analyze/units.js) and expected.json cites those numbers.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { score } from './score.js';
import { languageShare, tellsOfProposal } from './ai-tells.js';
import { costOf } from './pricing.js';
import { loadSeed } from '../src/analyze/seed.js';
import { numberUnits } from '../src/analyze/units.js';

const here = dirname(fileURLToPath(import.meta.url));
export const casesDir = join(here, 'cases');

/** Areas and templates of the initial set (templates/) plus the fictional team in bench/fixtures.json. */
export async function loadFixtures() {
  const { areas, templates } = await loadSeed();
  const { members } = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'));
  return { areas, templates, members };
}

/** Reads bench/cases/*: each folder with input.json and expected.json. */
export function loadCases(dir = casesDir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'input.json')))
    .map((d) => d.name)
    .sort()
    .map((name) => ({
      id: name,
      input: JSON.parse(readFileSync(join(dir, name, 'input.json'), 'utf8')),
      expected: JSON.parse(readFileSync(join(dir, name, 'expected.json'), 'utf8')),
    }));
}

/** Analyzer input bundle (§7.5) for a case. */
export function buildBundle(input, fixtures, { language } = {}) {
  return {
    ...(language ? { language } : {}),
    text: input.text,
    attachments: input.attachments.map((a) => ({ id: a.id, kind: a.kind, extracted: a.extracted })),
    areas: fixtures.areas,
    templates: fixtures.templates,
    members: fixtures.members,
  };
}

/** Units the analyzer numbers for a case: the numbering of expected.json. */
export const unitsOf = (input) => numberUnits({ text: input.text, attachments: input.attachments });

/**
 * Runs the analyzer measuring total time, time per step and model calls.
 * The steps come from the onProgress events (a step's time runs until the next event);
 * the calls, from result.calls (tokens and duration per provider call).
 * @param {(bundle: object, options: object) => Promise<object>} analyze
 * @param {object} providers  providers with the shape of §7.6
 */
export async function runCase({ analyze, providers, testCase, fixtures, options = {}, language }) {
  const bundle = buildBundle(testCase.input, fixtures, { language });
  const events = [];
  const startedAt = performance.now();
  const result = await analyze(bundle, { ...options, providers, onProgress: (e) => events.push({ ...e, t: performance.now() }) });
  const endedAt = performance.now();

  const steps = events.map((e, i) => ({
    phrase: e.phrase,
    percent: e.percent,
    ms: (i + 1 < events.length ? events[i + 1].t : endedAt) - e.t,
  }));
  const calls = (result.calls ?? []).map((c) => ({ ...c, cost_usd: costOf(c) }));
  const sumUsage = (key) => calls.reduce((acc, c) => acc + (c.usage?.[key] ?? 0), 0);
  const unpriced = calls.filter((c) => c.cost_usd === null).length;

  // If the analyzer fails with a draft, the draft is scored to see what failed.
  const scored = result.proposal ?? { messages: result.draft?.messages ?? [], discarded: result.draft?.discarded ?? [] };
  const units = result.units ?? unitsOf(testCase.input);
  const s = score({ units, expected: testCase.expected, actual: scored });
  if (result.status !== 'ok') s.mece = false;

  // Marks of generated writing in what the analyzer wrote (UD-019). A fragment that the input itself contains is not counted.
  const inputText = [testCase.input.text, ...testCase.input.attachments.map((a) => a.extracted)].join('\n');
  const tells = tellsOfProposal(scored, { input: inputText });
  const outputLanguage = language === 'en' ? 'en' : 'es';

  return {
    case_id: testCase.id,
    status: result.status,
    tells: { total: tells.total, per_message: tells.perMessage, by_pattern: tells.byPattern, found: tells.found, language_share: languageShare(scored, outputLanguage) },
    total_ms: endedAt - startedAt,
    steps,
    calls,
    usage: {
      calls: calls.length,
      input_tokens: sumUsage('input_tokens'),
      output_tokens: sumUsage('output_tokens'),
      cached_tokens: sumUsage('cached_tokens'),
      cost_usd: unpriced === calls.length && calls.length > 0 ? null : calls.reduce((acc, c) => acc + (c.cost_usd ?? 0), 0),
      model_ms: calls.reduce((acc, c) => acc + (c.duration_ms ?? 0), 0),
    },
    stats: result.stats,
    proposal: result.proposal ?? null,
    draft: result.draft ?? null,
    units,
    score: s,
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const medianOrNull = (xs) => (xs.some((x) => x === null) ? null : median(xs));

/** Summarizes N repetitions of the same case. */
export function summarize(runs) {
  const totals = runs.map((r) => r.total_ms);
  const stepNames = [...new Set(runs.flatMap((r) => r.steps.map((s) => s.phrase)))];
  return {
    case_id: runs[0].case_id,
    repeats: runs.length,
    statuses: Object.fromEntries([...new Set(runs.map((r) => r.status))].map((st) => [st, runs.filter((r) => r.status === st).length])),
    mece_passes: runs.filter((r) => r.score.mece).length,
    total_ms: { min: Math.min(...totals), median: median(totals), max: Math.max(...totals) },
    steps_ms_median: Object.fromEntries(
      stepNames.map((name) => [name, median(runs.map((r) => r.steps.find((s) => s.phrase === name)?.ms ?? 0))]),
    ),
    usage_median: {
      calls: median(runs.map((r) => r.usage.calls)),
      input_tokens: median(runs.map((r) => r.usage.input_tokens)),
      output_tokens: median(runs.map((r) => r.usage.output_tokens)),
      cached_tokens: median(runs.map((r) => r.usage.cached_tokens)),
      cost_usd: medianOrNull(runs.map((r) => r.usage.cost_usd)),
      model_ms: median(runs.map((r) => r.usage.model_ms)),
    },
    tells_per_message_median: median(runs.map((r) => r.tells.per_message)),
    tells_total_max: Math.max(...runs.map((r) => r.tells.total)),
    language_share_median: medianOrNull(runs.map((r) => r.tells.language_share)),
    messages_median: median(runs.map((r) => r.proposal?.messages.length ?? 0)),
    rates_median: Object.fromEntries(
      Object.keys(runs[0].score.rates).map((k) => [k, medianOrNull(runs.map((r) => r.score.rates[k]))]),
    ),
  };
}

const pct = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(0)}%`);
const ms = (x) => `${x.toFixed(0)} ms`;

/** Report text for the terminal. */
export function formatReport(summaries) {
  const rows = [
    ['case', 'status', 'MECE', 'cover.', 'repeat.', 'extra', 'split', 'fused', 'classif.', 'time (median)', 'calls', 'tokens i/o/c', 'cost USD', 'msgs', 'tells/msg', 'lang'],
  ];
  for (const s of summaries) {
    const u = s.usage_median;
    const r = s.rates_median;
    rows.push([
      s.case_id,
      Object.entries(s.statuses).map(([k, v]) => (s.repeats > 1 ? `${k}×${v}` : k)).join(','),
      `${s.mece_passes}/${s.repeats}`,
      pct(r.coverage),
      pct(r.repetition),
      pct(r.extra),
      pct(r.split),
      pct(r.fused),
      pct(r.classification_accuracy),
      ms(s.total_ms.median),
      String(u.calls),
      `${u.input_tokens}/${u.output_tokens}/${u.cached_tokens}`,
      u.cost_usd === null ? 'no price' : u.cost_usd.toFixed(6),
      String(s.messages_median),
      s.tells_per_message_median.toFixed(2),
      pct(s.language_share_median),
    ]);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const lines = rows.map((r) => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd());
  const steps = summaries.map((s) => {
    const parts = Object.entries(s.steps_ms_median).map(([k, v]) => `${k}: ${ms(v)}`);
    return `${s.case_id}  steps: ${parts.join(' | ') || 'no progress events'}  (model: ${ms(s.usage_median.model_ms)})`;
  });
  return [...lines, '', ...steps].join('\n');
}
