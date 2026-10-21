#!/usr/bin/env node
// Coverage and stability of the classification stage (H-1900, H-1003). Reads the files of bench/classify-stage.mjs and the
// references in bench/private/<case>/expected.json (the two readers cut the same units, so one file defines the units that carry a point).
//
//   node bench/coverage-stats.mjs table <label>=<file>[,<file>...] ...      units without group, discards grouped by mistake, lost points, groups
//   node bench/coverage-stats.mjs stability <label>=<files> ...              groups per repetition and agreement between repetitions (adjusted Rand index)
//   node bench/coverage-stats.mjs pair <labelA>=<files> <labelB>=<files>     paired comparison by case: lost units, lost points, agreement
//   node bench/coverage-stats.mjs empty                                      reference units with no content of their own, per kind of input (H-1901)
//
// `--ignore-empty` (any command) measures by point: units with no content of their own (a speaker mark with its time, a list
// number; `isEmptyUnit` of src/analyze/units.js) leave the reference messages, and a message made only of them leaves the list.
// Without it the figures count every unit, as before.
//
// Everything printed is a count or a rate. Reads bench/private/ (env BENCH_PRIVATE_DIR), which never enters git.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEmptyUnit, numberUnits } from '../src/analyze/units.js';

const ignoreEmpty = process.argv.includes('--ignore-empty');
const dir = process.env.BENCH_PRIVATE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), 'private');
const refs = new Map();
/** Ids of the units of a case that say nothing by themselves, from the extraction the runs were measured against. */
export function emptyUnitsOf(id) {
  const file = join(dir, '.cache', `${id}.json`);
  if (!existsSync(file)) return new Set();
  return new Set(numberUnits(JSON.parse(readFileSync(file, 'utf8')).input).filter((u) => isEmptyUnit(u.text)).map((u) => u.id));
}
export function refOf(id) {
  if (!refs.has(id)) {
    const e = JSON.parse(readFileSync(join(dir, id, 'expected.json'), 'utf8'));
    const empty = ignoreEmpty ? emptyUnitsOf(id) : new Set();
    refs.set(id, {
      messages: e.messages.map((m) => m.unit_ids.filter((u) => !empty.has(u))).filter((m) => m.length > 0),
      discarded: new Set((e.discarded ?? []).flatMap((d) => d.unit_ids).filter((u) => !empty.has(u))),
    });
  }
  return refs.get(id);
}

/** Per run: units the reference puts in a message that the model left out of every group, etc. */
export function runMetrics(caseId, run) {
  const ref = refOf(caseId);
  const grouped = new Set(run.model_groups.flatMap((g) => g.unit_ids));
  const want = new Set(ref.messages.flat());
  const lost = [...want].filter((u) => !grouped.has(u)).length;
  const falseAdds = [...ref.discarded].filter((u) => grouped.has(u)).length;
  let zero = 0; let most = 0;
  for (const m of ref.messages) {
    const f = m.filter((u) => grouped.has(u)).length / m.length;
    if (f === 0) zero += 1;
    if (f <= 0.5) most += 1;
  }
  return { want: want.size, lost, falseAdds, refDiscarded: ref.discarded.size, msgs: ref.messages.length, zero, most, groups: run.model_groups.length, ms: run.ms, cost: run.cost_usd };
}

/** Adjusted Rand index between two partitions given as unit -> label maps over the same units. */
export function ari(p, q) {
  const units = [...p.keys()].filter((u) => q.has(u));
  const n = units.length;
  if (n < 2) return null;
  const table = new Map(); const rowSums = new Map(); const colSums = new Map();
  for (const u of units) {
    const k = `${p.get(u)}|${q.get(u)}`;
    table.set(k, (table.get(k) ?? 0) + 1);
    rowSums.set(p.get(u), (rowSums.get(p.get(u)) ?? 0) + 1);
    colSums.set(q.get(u), (colSums.get(q.get(u)) ?? 0) + 1);
  }
  const c2 = (x) => (x * (x - 1)) / 2;
  const sumTable = [...table.values()].reduce((s, x) => s + c2(x), 0);
  const sumRows = [...rowSums.values()].reduce((s, x) => s + c2(x), 0);
  const sumCols = [...colSums.values()].reduce((s, x) => s + c2(x), 0);
  const expected = (sumRows * sumCols) / c2(n);
  const max = (sumRows + sumCols) / 2;
  return max === expected ? 1 : (sumTable - expected) / (max - expected);
}

/** unit -> group label over the units of the case; discarded units share one label. */
function partition(run, allUnits) {
  const map = new Map(allUnits.map((u) => [u, 'D']));
  run.model_groups.forEach((g, i) => g.unit_ids.forEach((u) => map.set(u, `g${i}`)));
  return map;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => (xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1)));
const parse = (arg) => { const i = arg.indexOf('='); return [arg.slice(0, i), arg.slice(i + 1).split(',').filter(Boolean)]; };

/** Merges the files of one label: case -> runs. */
export function load(files) {
  const byCase = new Map(); const kinds = new Map();
  for (const f of files) {
    for (const c of JSON.parse(readFileSync(f, 'utf8')).cases) {
      byCase.set(c.case_id, [...(byCase.get(c.case_id) ?? []), ...c.runs]);
      kinds.set(c.case_id, c.kind);
    }
  }
  return { byCase, kinds };
}

/** Mean over repetitions of one metric per case. */
function perCase(data, fn) {
  return new Map([...data.byCase].map(([id, runs]) => [id, mean(runs.map((r) => fn(id, r)))]));
}

function caseAri(id, runs) {
  const units = [...new Set(runs.flatMap((r) => r.model_groups.flatMap((g) => g.unit_ids)).concat(runs.flatMap((r) => r.unit_pred.map((x) => x[0]))))];
  const all = Array.from({ length: Math.max(...units, 0) }, (_, i) => i + 1);
  const parts = runs.map((r) => partition(r, all));
  const vals = [];
  for (let i = 0; i < parts.length; i += 1) for (let j = i + 1; j < parts.length; j += 1) { const v = ari(parts[i], parts[j]); if (v !== null) vals.push(v); }
  return vals.length ? mean(vals) : null;
}

function bootstrap(a, b, ids, iterations = 20000) {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const stat = (pick) => mean(pick.map((id) => b.get(id) - a.get(id)));
  const point = stat(ids); const draws = [];
  for (let i = 0; i < iterations; i += 1) draws.push(stat(ids.map(() => ids[Math.floor(rnd() * ids.length)])));
  draws.sort((x, y) => x - y);
  const below = draws.filter((x) => x <= 0).length / iterations; const above = draws.filter((x) => x >= 0).length / iterations;
  return { point, lo: draws[Math.floor(0.025 * iterations)], hi: draws[Math.floor(0.975 * iterations)], p: Math.min(1, 2 * Math.min(below, above)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...args] = process.argv.slice(2).filter((a) => a !== '--ignore-empty');
  if (cmd === 'table') {
    for (const arg of args) {
      const [label, files] = parse(arg); const data = load(files);
      const reps = Math.min(...[...data.byCase.values()].map((r) => r.length));
      const rows = [];
      for (let r = 0; r < reps; r += 1) {
        const t = { want: 0, lost: 0, falseAdds: 0, refDiscarded: 0, msgs: 0, zero: 0, most: 0, groups: 0, ms: 0, cost: 0 };
        for (const [id, runs] of data.byCase) { const m = runMetrics(id, runs[r]); for (const k of Object.keys(t)) t[k] += m[k] ?? 0; }
        rows.push(t);
      }
      const pct = (k, d) => rows.map((t) => (100 * t[k]) / t[d]);
      const f = (xs) => `${mean(xs).toFixed(2)} (sd ${sd(xs).toFixed(2)})`;
      console.log(`${label.padEnd(18)} n=${reps}  sin grupo ${f(pct('lost', 'want'))} % de las unidades con mensaje  descartes agrupados ${f(pct('falseAdds', 'refDiscarded'))} %  mensajes sin cubrir ${mean(rows.map((t) => t.zero)).toFixed(1)}/${rows[0].msgs}  cubiertos a lo sumo la mitad ${mean(rows.map((t) => t.most)).toFixed(1)}  grupos/rep ${mean(rows.map((t) => t.groups)).toFixed(0)}  USD/rep ${mean(rows.map((t) => t.cost)).toFixed(3)}  s/caso ${(mean(rows.map((t) => t.ms)) / data.byCase.size / 1000).toFixed(1)}`);
    }
  } else if (cmd === 'stability') {
    for (const arg of args) {
      const [label, files] = parse(arg); const data = load(files);
      console.log(`${label}`);
      const aris = [];
      for (const [id, runs] of data.byCase) {
        const g = runs.map((r) => r.model_groups.length);
        const v = caseAri(id, runs);
        if (v !== null) aris.push(v);
        console.log(`  ${id.slice(0, 22).padEnd(22)} grupos por repetición ${g.join(' ')}  (media ${mean(g).toFixed(1)}, sd ${sd(g).toFixed(1)})  acuerdo entre repeticiones (ARI) ${v === null ? 'n/a' : v.toFixed(3)}`);
      }
      console.log(`  media de los casos: ARI ${mean(aris).toFixed(3)}`);
    }
  } else if (cmd === 'pair') {
    const [la, fa] = parse(args[0]); const [lb, fb] = parse(args[1]);
    const A = load(fa); const B = load(fb);
    const ids = [...A.byCase.keys()].filter((id) => B.byCase.has(id));
    const lostRate = (data) => perCase(data, (id, r) => { const m = runMetrics(id, r); return (100 * m.lost) / m.want; });
    const adds = (data) => perCase(data, (id, r) => { const m = runMetrics(id, r); return m.refDiscarded ? (100 * m.falseAdds) / m.refDiscarded : 0; });
    const ariOf = (data) => new Map(ids.map((id) => [id, caseAri(id, data.byCase.get(id)) ?? 1]));
    for (const [name, fn] of [['unidades sin grupo (puntos de %, media por caso)', lostRate], ['descartes agrupados (puntos de %)', adds], ['acuerdo entre repeticiones (ARI)', ariOf]]) {
      const r = bootstrap(fn(A), fn(B), ids);
      console.log(`${name}: ${lb} menos ${la} = ${r.point >= 0 ? '+' : ''}${r.point.toFixed(3)}  IC95 [${r.lo.toFixed(3)}; ${r.hi.toFixed(3)}]  p ${r.p.toFixed(3)}  (${ids.length} casos)`);
    }
  } else if (cmd === 'empty') {
    const byKind = new Map();
    for (const id of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'expected.json'))).map((d) => d.name).sort()) {
      const e = JSON.parse(readFileSync(join(dir, id, 'expected.json'), 'utf8'));
      const empty = emptyUnitsOf(id);
      const kind = JSON.parse(readFileSync(join(dir, id, 'manifest.json'), 'utf8')).kind;
      const inMessage = e.messages.flatMap((m) => m.unit_ids);
      const row = byKind.get(kind) ?? { cases: 0, units: 0, empty: 0, messages: 0, only: 0, withEmpty: 0 };
      row.cases += 1; row.units += inMessage.length; row.empty += inMessage.filter((u) => empty.has(u)).length;
      row.messages += e.messages.length;
      row.only += e.messages.filter((m) => m.unit_ids.every((u) => empty.has(u))).length;
      row.withEmpty += e.messages.filter((m) => m.unit_ids.some((u) => empty.has(u))).length;
      byKind.set(kind, row);
    }
    const total = { cases: 0, units: 0, empty: 0, messages: 0, only: 0, withEmpty: 0 };
    for (const [kind, r] of byKind) {
      for (const k of Object.keys(total)) total[k] += r[k];
      console.log(`${kind.padEnd(10)} casos ${r.cases}  unidades en mensajes ${r.units}  sin contenido ${r.empty} (${((100 * r.empty) / r.units).toFixed(1)} %)  mensajes ${r.messages}  con alguna unidad vacía ${r.withEmpty}  sólo vacías ${r.only}`);
    }
    console.log(`${'total'.padEnd(10)} casos ${total.cases}  unidades en mensajes ${total.units}  sin contenido ${total.empty} (${((100 * total.empty) / total.units).toFixed(1)} %)  mensajes ${total.messages}  con alguna unidad vacía ${total.withEmpty}  sólo vacías ${total.only}`);
  } else {
    console.error('Uso: table | stability | pair | empty');
    process.exit(2);
  }
}
