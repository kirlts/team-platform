#!/usr/bin/env node
// Does a message that fuses two reference points lose assignment and area? (H-1904)
//
//   node bench/fused-stats.mjs <result.json> [<result.json> ...]
//
// Reads full-run result files of bench/run-private.mjs (they carry `proposal.messages` and the paired list of
// `score.assignment`) and the references in bench/private/<case>/expected.json (env BENCH_PRIVATE_DIR). A reference point is
// paired with the tightest obtained message that holds all its units, as score.js does. The pair is «fused» when that message
// also holds all the non-empty units of another reference point (`isEmptyUnit` leaves out speaker marks and list numbers), and
// «single» when it holds one point only. Area counts as right when the message's area is one of the reference's areas;
// assignment as exact when the sets of recipients are equal (to either reader's set). The difference is resampled by case.
// A second comparison holds the point fixed: the points that came out fused in some runs and single in others, with a sign test.
// Everything printed is a count or a rate.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignmentFromPairs } from './score.js';
import { emptyUnitsOf } from './coverage-stats.mjs';

const dir = process.env.BENCH_PRIVATE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), 'private');
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Pairs of one run, each with `fused` and the correctness of its area and recipients. */
export function pairsOfRun(caseId, run, reference) {
  const empty = emptyUnitsOf(caseId);
  const points = reference.messages.map((m) => ({ id: m.id, units: new Set(m.unit_ids.filter((u) => !empty.has(u))), area: [].concat(m.area_id ?? []) }));
  const messages = run.proposal?.messages ?? [];
  return (run.score?.assignment?.pair_list ?? []).flatMap((p) => {
    const msg = messages[p.actual_index];
    const point = points.find((x) => x.id === p.expected_id);
    if (!msg || !point || point.units.size === 0) return [];
    const held = new Set(msg.unit_ids);
    const touched = points.filter((x) => x.units.size > 0 && [...x.units].every((u) => held.has(u))).length;
    return [{ id: p.expected_id, fused: touched >= 2, areaOk: point.area.length === 0 ? null : point.area.includes(msg.area_id), pair: { expected: p.expected, alt: p.alt, actual: p.actual } }];
  });
}

const rates = (items) => {
  const a = assignmentFromPairs(items.map((x) => x.pair));
  const withArea = items.filter((x) => x.areaOk !== null);
  return { n: items.length, exact: a.accuracy, recall: a.recall, precision: a.precision, area: withArea.length ? withArea.filter((x) => x.areaOk).length / withArea.length : null };
};

function bootstrap(byCase, pick, iterations = 5000) {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const ids = [...byCase.keys()];
  const stat = (chosen) => {
    const all = chosen.flatMap((id) => byCase.get(id));
    const f = all.filter((x) => x.fused); const s = all.filter((x) => !x.fused);
    if (f.length === 0 || s.length === 0) return null;
    return pick(rates(f)) - pick(rates(s));
  };
  const draws = [];
  for (let i = 0; i < iterations; i += 1) {
    const v = stat(ids.map(() => ids[Math.floor(rnd() * ids.length)]));
    if (v !== null && Number.isFinite(v)) draws.push(v);
  }
  draws.sort((x, y) => x - y);
  const point = stat(ids);
  const below = draws.filter((x) => x <= 0).length / draws.length; const above = draws.filter((x) => x >= 0).length / draws.length;
  return { point, lo: draws[Math.floor(0.025 * draws.length)], hi: draws[Math.floor(0.975 * draws.length)], p: Math.min(1, 2 * Math.min(below, above)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2);
  if (files.length === 0) { console.error('Uso: fused-stats.mjs <resultado.json> ...'); process.exit(2); }
  const byCase = new Map(); let runs = 0;
  for (const file of files) {
    for (const c of JSON.parse(readFileSync(file, 'utf8')).cases) {
      const refFile = join(dir, c.case_id, 'expected.json');
      if (!existsSync(refFile)) continue;
      const reference = JSON.parse(readFileSync(refFile, 'utf8'));
      for (const run of c.runs ?? []) {
        runs += 1;
        byCase.set(c.case_id, [...(byCase.get(c.case_id) ?? []), ...pairsOfRun(c.case_id, run, reference)]);
      }
    }
  }
  const all = [...byCase.values()].flat();
  const fused = all.filter((x) => x.fused); const single = all.filter((x) => !x.fused);
  const pct = (v) => (v === null ? 'n/a' : `${(100 * v).toFixed(1)} %`);
  console.log(`${files.length} archivos, ${runs} corridas, ${byCase.size} casos, ${all.length} pares con destinatarios; fundidos ${fused.length}, sueltos ${single.length}`);
  const same = (x, y) => x.length === y.length && x.every((id) => y.includes(id));
  const exactOf = (x) => (same(x.pair.expected, x.pair.actual) || (x.pair.alt && same(x.pair.alt, x.pair.actual)) ? 1 : 0);
  const byPoint = new Map();
  for (const [id, items] of byCase) for (const x of items) byPoint.set(`${id}/${x.id}`, [...(byPoint.get(`${id}/${x.id}`) ?? []), x]);
  const both = [...byPoint.values()].filter((xs) => xs.some((x) => x.fused) && xs.some((x) => !x.fused));
  const delta = both.map((xs) => mean(xs.filter((x) => x.fused).map(exactOf)) - mean(xs.filter((x) => !x.fused).map(exactOf)));
  const worse = delta.filter((d) => d < 0).length; const better = delta.filter((d) => d > 0).length;
  const sign = (k, n) => { let p = 0; for (let i = 0; i <= k; i += 1) { let c = 1; for (let j = 0; j < i; j += 1) c = (c * (n - j)) / (j + 1); p += c / 2 ** n; } return Math.min(1, 2 * p); };
  console.log(`mismo punto, fundido en unas corridas y suelto en otras: ${both.length} puntos; asignación exacta media ${both.length ? `${(100 * mean(delta)).toFixed(1)} puntos (fundido menos suelto)` : 'n/a'}; peor fundido ${worse}, mejor fundido ${better}, p de signos ${worse + better ? sign(Math.min(worse, better), worse + better).toFixed(3) : 'n/a'}`);
  const rf = rates(fused); const rs = rates(single);
  console.log(`${'medida'.padEnd(26)} ${'sueltos'.padStart(9)} ${'fundidos'.padStart(9)}  diferencia (fundidos menos sueltos)  IC95  p`);
  for (const [name, key] of [['asignación exacta', 'exact'], ['recall de destinatarios', 'recall'], ['precisión de destinatarios', 'precision'], ['área acertada', 'area']]) {
    const b = bootstrap(byCase, (r) => r[key]);
    console.log(`${name.padEnd(26)} ${pct(rs[key]).padStart(9)} ${pct(rf[key]).padStart(9)}  ${b.point === null ? 'n/a' : `${b.point >= 0 ? '+' : ''}${(100 * b.point).toFixed(1)} puntos  [${(100 * b.lo).toFixed(1)}; ${(100 * b.hi).toFixed(1)}]  p ${b.p.toFixed(3)}`}`);
  }
}
