// Piezas compartidas del banco: carga de casos, armado del paquete, ejecución medida y reporte.
// El analizador es el de MASTER-SPEC §7.5: analyze(bundle, { providers, onProgress }) → resultado con
// status, proposal, units, calls y stats. Los casos guardan el input crudo; las unidades las numera el
// analizador (src/analyze/units.js) y expected.json cita esos números.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { score } from './score.js';
import { costOf } from './pricing.js';
import { loadSeed } from '../src/analyze/seed.js';
import { numberUnits } from '../src/analyze/units.js';

const here = dirname(fileURLToPath(import.meta.url));
export const casesDir = join(here, 'cases');

/** Áreas y plantillas del juego inicial (templates/) más el equipo ficticio de bench/fixtures.json. */
export async function loadFixtures() {
  const { areas, templates } = await loadSeed();
  const { members } = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'));
  return { areas, templates, members };
}

/** Lee bench/cases/*: cada carpeta con input.json y expected.json. */
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

/** Paquete de entrada del analizador (§7.5) para un caso. */
export function buildBundle(input, fixtures) {
  return {
    text: input.text,
    attachments: input.attachments.map((a) => ({ id: a.id, kind: a.kind, extracted: a.extracted })),
    areas: fixtures.areas,
    templates: fixtures.templates,
    members: fixtures.members,
    // As the pipeline builds it (src/domain/pipeline.js): the author's language and the project (UD-018, UD-024).
    language: fixtures.language ?? 'es-419',
    ...(fixtures.project ? { project: fixtures.project } : {}),
  };
}

/** Unidades que numera el analizador para un caso: la numeración de expected.json. */
export const unitsOf = (input) => numberUnits({ text: input.text, attachments: input.attachments });

/**
 * Ejecuta el analizador midiendo tiempo total, tiempo por paso y llamadas a modelo.
 * Los pasos salen de los eventos onProgress (el tiempo de un paso corre hasta el siguiente evento);
 * las llamadas, de result.calls (tokens y duración por llamada al proveedor).
 * @param {(bundle: object, options: object) => Promise<object>} analyze
 * @param {object} providers  proveedores con la forma de §7.6
 */
export async function runCase({ analyze, providers, testCase, fixtures, options = {} }) {
  const bundle = buildBundle(testCase.input, fixtures);
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

  // Si el analizador falla con un borrador, se puntúa el borrador para ver qué falló.
  const scored = result.proposal ?? { messages: result.draft?.messages ?? [], discarded: result.draft?.discarded ?? [] };
  const units = result.units ?? unitsOf(testCase.input);
  const s = score({ units, expected: testCase.expected, actual: scored });
  if (result.status !== 'ok') s.mece = false;

  return {
    case_id: testCase.id,
    status: result.status,
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

/** Resume N repeticiones de un mismo caso. */
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
    rates_median: Object.fromEntries(
      Object.keys(runs[0].score.rates).map((k) => [k, medianOrNull(runs.map((r) => r.score.rates[k]))]),
    ),
  };
}

const pct = (x) => (x === null ? 'n/d' : `${(x * 100).toFixed(0)}%`);
const ms = (x) => `${x.toFixed(0)} ms`;

/** Texto del reporte para la terminal. */
export function formatReport(summaries) {
  const rows = [
    ['caso', 'estado', 'MECE', 'cobert.', 'repet.', 'de más', 'partidos', 'fusion.', 'clasif.', 'tiempo (mediana)', 'llamadas', 'tokens e/s/c', 'costo USD'],
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
      u.cost_usd === null ? 'sin tarifa' : u.cost_usd.toFixed(6),
    ]);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const lines = rows.map((r) => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd());
  const steps = summaries.map((s) => {
    const parts = Object.entries(s.steps_ms_median).map(([k, v]) => `${k}: ${ms(v)}`);
    return `${s.case_id}  pasos: ${parts.join(' | ') || 'sin eventos de progreso'}  (modelo: ${ms(s.usage_median.model_ms)})`;
  });
  return [...lines, '', ...steps].join('\n');
}
