#!/usr/bin/env node
// Statistics over repeated area-classification runs (H-602, H-1000 onward). Reads result files written by
// bench/areas-classify.mjs --no-grouping (one file per repetition, or one file with --repeat n), pools the files that share
// a label, and reports per-repetition accuracy by unit (union of readers, reader A, reader B), the confusion matrix, and the
// paired comparison of two labels. The comparison resamples whole cases (units of a case move together), so its interval
// is wider than the Wilson interval by unit and honest about the 4-point noise between runs.
//
//   node bench/areas-stats.mjs table <label>=<file>[,<file>...] ... [--all]
//   node bench/areas-stats.mjs pair <labelA>=<files> <labelB>=<files>
//   node bench/areas-stats.mjs confusion <label>=<files>
import { readFileSync } from 'node:fs';

/** Per run: Map case -> {hits, hitsA, hitsB, units, ms, cost}; one entry per repetition found in the files. */
export function loadRuns(files) {
  const reps = [];
  for (const f of files) {
    const d = JSON.parse(readFileSync(f, 'utf8'));
    const n = Math.max(0, ...d.cases.map((c) => c.runs.length));
    for (let r = 0; r < n; r += 1) {
      const rep = new Map();
      for (const c of d.cases) {
        const run = c.runs[r];
        if (!run) continue;
        const lab = new Map(run.groups.flatMap((g) => (g.a && g.b ? g.unit_ids.map((u) => [u, g]) : [])));
        const t = { hits: 0, hitsA: 0, hitsB: 0, units: 0, refUnits: lab.size, ms: run.ms ?? null, cost: run.cost_usd ?? 0, conf: new Map() };
        for (const [u, area] of run.unit_pred ?? []) {
          const g = lab.get(u);
          if (!g) continue;
          t.units += 1;
          const ha = g.a.includes(area); const hb = g.b.includes(area);
          if (ha) t.hitsA += 1; if (hb) t.hitsB += 1; if (ha || hb) t.hits += 1;
          if (!(ha || hb)) { const k = `${g.a[0]}>${area}`; t.conf.set(k, (t.conf.get(k) ?? 0) + 1); }
        }
        rep.set(c.case_id, t);
      }
      reps.push({ rep, titles: d.area_titles });
    }
  }
  return reps;
}

const sum = (rep, key) => [...rep.values()].reduce((a, t) => a + t[key], 0);
// `--all` (H-1900): the denominator is every unit the references put in a message, so a unit the model left out of every group counts as a miss.
const ALL = process.argv.includes('--all');
const denominator = ALL ? 'refUnits' : 'units';
const acc = (rep, key = 'hits') => (100 * sum(rep, key)) / sum(rep, denominator);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => (xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1)));

/** Cases that at least one repetition of every set has: a run that failed (an invalid output after its retry) leaves a case with one repetition fewer. */
function common(sets) {
  const ids = [...new Set(sets.flatMap((reps) => reps.flatMap((r) => [...r.rep.keys()])))];
  return ids.filter((id) => sets.every((reps) => reps.some((r) => r.rep.has(id))));
}

/** Mean per case over the repetitions that have it: {hits, units}. */
function perCase(reps, ids, key = 'hits') {
  return new Map(ids.map((id) => {
    const have = reps.filter((r) => r.rep.has(id));
    return [id, { h: mean(have.map((r) => r.rep.get(id)[key])), n: mean(have.map((r) => r.rep.get(id)[denominator])) }];
  }));
}

function bootstrapDiff(a, b, ids, iterations = 20000) {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const stat = (pick) => {
    let ha = 0; let na = 0; let hb = 0; let nb = 0;
    for (const id of pick) { ha += a.get(id).h; na += a.get(id).n; hb += b.get(id).h; nb += b.get(id).n; }
    return 100 * (hb / nb - ha / na);
  };
  const point = stat(ids);
  const draws = [];
  for (let i = 0; i < iterations; i += 1) draws.push(stat(ids.map(() => ids[Math.floor(rnd() * ids.length)])));
  draws.sort((x, y) => x - y);
  const below = draws.filter((x) => x <= 0).length / iterations;
  const above = draws.filter((x) => x >= 0).length / iterations;
  return { point, lo: draws[Math.floor(0.025 * iterations)], hi: draws[Math.floor(0.975 * iterations)], p: Math.min(1, 2 * Math.min(below, above)) };
}

const parse = (arg) => { const i = arg.indexOf('='); return [arg.slice(0, i), arg.slice(i + 1).split(',').filter(Boolean)]; };

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...args] = process.argv.slice(2).filter((a) => a !== '--all');
  if (cmd === 'table') {
    for (const arg of args) {
      const [label, files] = parse(arg);
      const reps = loadRuns(files);
      const u = reps.map((r) => acc(r.rep)); const ua = reps.map((r) => acc(r.rep, 'hitsA')); const ub = reps.map((r) => acc(r.rep, 'hitsB'));
      const ms = reps.map((r) => mean([...r.rep.values()].map((t) => t.ms).filter(Boolean)) / 1000);
      const cost = reps.map((r) => sum(r.rep, 'cost'));
      console.log(`${label.padEnd(26)} n=${reps.length}  unión ${mean(u).toFixed(1)} (${u.map((x) => x.toFixed(1)).join('; ')}) sd ${sd(u).toFixed(1)}  A ${mean(ua).toFixed(1)}  B ${mean(ub).toFixed(1)}  casos/rep ${reps[0].rep.size}  s/caso ${mean(ms).toFixed(1)}  USD/rep ${mean(cost).toFixed(3)}`);
    }
  } else if (cmd === 'pair') {
    const [la, fa] = parse(args[0]); const [lb, fb] = parse(args[1]);
    const A = loadRuns(fa); const B = loadRuns(fb);
    const ids = common([A, B]);
    const r = bootstrapDiff(perCase(A, ids), perCase(B, ids), ids);
    console.log(`${lb} menos ${la}: ${r.point >= 0 ? '+' : ''}${r.point.toFixed(2)} puntos, IC95 [${r.lo.toFixed(2)}; ${r.hi.toFixed(2)}], p ${r.p.toFixed(3)}  (${ids.length} casos, ${A.length} y ${B.length} repeticiones)`);
  } else if (cmd === 'confusion') {
    const [label, files] = parse(args[0]);
    const reps = loadRuns(files);
    const total = new Map();
    for (const r of reps) for (const t of r.rep.values()) for (const [k, n] of t.conf) total.set(k, (total.get(k) ?? 0) + n / reps.length);
    const titles = reps[0].titles ?? {};
    const rows = [...total].sort((x, y) => y[1] - x[1]).slice(0, 12);
    console.log(`${label}: unidades erradas por repetición (referencia A > obtenida)`);
    for (const [k, n] of rows) console.log(`  ${k.split('>').map((x) => titles[x] ?? x).join(' > ')}: ${n.toFixed(1)}`);
  } else {
    console.error('Uso: table | pair | confusion');
    process.exit(2);
  }
}
