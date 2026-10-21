// Pure helpers of the model comparison (H-80, H-15): percentiles, paired tests per point over repetitions, and the
// per-point outcomes read from a scored run. Measurement only: nothing here runs inside the product.
import { signTestP } from './compare.js';

/** Nearest-rank percentile (p in 0..100) of a list of numbers; null for an empty list. */
export function percentile(xs, p) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * s.length));
  return s[Math.min(s.length, rank) - 1];
}

/**
 * Outcomes per reference point of one scored run: covered (the point is complete in one message) and, for the points
 * that got a message, whether the area was right and whether the assignee set matched exactly.
 * @returns {Map<string, { covered: boolean, area?: boolean, exact?: boolean }>}
 */
export function pointOutcomes(score) {
  const out = new Map();
  for (const p of score.details?.points ?? []) out.set(p.id, { covered: p.state === 'covered' });
  for (const q of score.assignment?.pair_list ?? []) {
    const cur = out.get(q.expected_id) ?? { covered: false };
    cur.area = Boolean(q.area_ok);
    if (Array.isArray(q.expected)) {
      const set = (v) => JSON.stringify([...(v ?? [])].sort());
      cur.exact = set(q.actual) === set(q.expected) || (q.alt ? set(q.actual) === set(q.alt) : false);
    }
    out.set(q.expected_id, cur);
  }
  return out;
}

/**
 * Per point (case and reference id), the share of repetitions in which `metric` held. `runsByCase`: Map(case_id -> runs).
 * @returns {Map<string, number>}
 */
export function pointRates(runsByCase, metric) {
  const out = new Map();
  for (const [caseId, runs] of runsByCase) {
    const acc = new Map();
    for (const run of runs) {
      for (const [id, o] of pointOutcomes(run.score)) {
        if (o[metric] === undefined) continue;
        const a = acc.get(id) ?? { k: 0, n: 0 };
        a.n += 1;
        if (o[metric]) a.k += 1;
        acc.set(id, a);
      }
    }
    for (const [id, a] of acc) out.set(`${caseId}:${id}`, a.k / a.n);
  }
  return out;
}

/**
 * Paired comparison over the points both variants have: how many points the first has a higher repetition rate on, how
 * many the second, and the two-sided sign-test p-value over those that differ.
 */
export function pairedByPoint(ratesA, ratesB) {
  let a = 0;
  let b = 0;
  let tied = 0;
  for (const [k, x] of ratesA) {
    if (!ratesB.has(k)) continue;
    const y = ratesB.get(k);
    if (x > y) a += 1;
    else if (y > x) b += 1;
    else tied += 1;
  }
  return { a, b, tied, p: signTestP(a, b) };
}
