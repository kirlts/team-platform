// Piezas compartidas del banco: carga de casos, armado del paquete, ejecución medida y reporte.
// El analizador es una función con la firma de MASTER-SPEC §7.5: analyze(bundle, { onProgress }) → Proposal.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { score } from './score.js';

const here = dirname(fileURLToPath(import.meta.url));
export const casesDir = join(here, 'cases');

export function loadFixtures() {
  return JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'));
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

/**
 * Paquete de entrada del analizador (§7.5). Las unidades con fuente "t" son el texto que escribió
 * la persona; las demás son la extracción del adjunto con ese id. `units` lleva la numeración que
 * usa la referencia, para que unit_ids de la salida se comparen con expected.json.
 */
export function buildBundle(input, fixtures = loadFixtures()) {
  const bySource = (source) => input.units.filter((u) => u.source === source).map((u) => u.text).join('\n');
  return {
    text: bySource('t'),
    attachments: input.attachments.map((a) => ({ id: a.id, kind: a.kind, extracted: bySource(a.id) })),
    areas: fixtures.areas,
    templates: fixtures.templates,
    members: fixtures.members,
    units: input.units.map((u) => ({ id: u.id, text: u.text })),
  };
}

/**
 * Ejecuta el analizador midiendo tiempo total, tiempo por paso y llamadas a modelo.
 * Los pasos salen de los eventos onProgress; las llamadas, de onCall (una por llamada al proveedor).
 * @param {(bundle: object, options: object) => Promise<object>} analyze
 */
export async function runCase({ analyze, testCase, fixtures = loadFixtures(), options = {} }) {
  const bundle = buildBundle(testCase.input, fixtures);
  const events = [];
  const calls = [];
  const startedAt = performance.now();
  const proposal = await analyze(bundle, {
    ...options,
    onProgress: (e) => events.push({ ...e, t: performance.now() }),
    onCall: (c) => calls.push(c),
  });
  const endedAt = performance.now();
  // Una llamada que el analizador devuelve en el propio resultado también cuenta.
  for (const c of proposal?.llm_calls ?? []) calls.push(c);

  const steps = events.map((e, i) => ({
    phrase: e.phrase,
    percent: e.percent,
    ms: (i + 1 < events.length ? events[i + 1].t : endedAt) - e.t,
  }));
  const sum = (key) => calls.reduce((acc, c) => acc + (c[key] ?? 0), 0);
  return {
    case_id: testCase.id,
    total_ms: endedAt - startedAt,
    steps,
    calls,
    usage: {
      calls: calls.length,
      input_tokens: sum('input_tokens'),
      output_tokens: sum('output_tokens'),
      cached_tokens: sum('cached_tokens'),
      cost_usd: sum('cost_usd'),
    },
    proposal,
    score: score({ units: testCase.input.units, expected: testCase.expected, actual: proposal }),
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Resume N repeticiones de un mismo caso. */
export function summarize(runs) {
  const totals = runs.map((r) => r.total_ms);
  const stepNames = [...new Set(runs.flatMap((r) => r.steps.map((s) => s.phrase)))];
  return {
    case_id: runs[0].case_id,
    repeats: runs.length,
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
      cost_usd: median(runs.map((r) => r.usage.cost_usd)),
    },
    rates_median: Object.fromEntries(
      Object.keys(runs[0].score.rates).map((k) => [k, median(runs.map((r) => r.score.rates[k]))]),
    ),
    area_ok: runs.filter((r) => r.score.area_ok === true).length,
    template_ok: runs.filter((r) => r.score.template_ok === true).length,
  };
}

const pct = (x) => `${(x * 100).toFixed(0)}%`;
const ms = (x) => `${x.toFixed(0)} ms`;

/** Texto del reporte para la terminal. */
export function formatReport(summaries) {
  const rows = [
    ['caso', 'MECE', 'cobert.', 'repet.', 'de más', 'partidos', 'fusion.', 'tiempo (mediana)', 'llamadas', 'tokens e/s/c', 'costo USD'],
  ];
  for (const s of summaries) {
    const u = s.usage_median;
    const r = s.rates_median;
    rows.push([
      s.case_id,
      `${s.mece_passes}/${s.repeats}`,
      pct(r.coverage),
      pct(r.repetition),
      pct(r.extra),
      pct(r.split),
      pct(r.fused),
      ms(s.total_ms.median),
      String(u.calls),
      `${u.input_tokens}/${u.output_tokens}/${u.cached_tokens}`,
      u.cost_usd.toFixed(6),
    ]);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const lines = rows.map((r) => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd());
  const steps = summaries.map((s) => {
    const parts = Object.entries(s.steps_ms_median).map(([k, v]) => `${k}: ${ms(v)}`);
    return `${s.case_id}  pasos: ${parts.join(' | ') || 'sin eventos de progreso'}`;
  });
  return [...lines, '', ...steps].join('\n');
}
