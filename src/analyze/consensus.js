// Consensus over several independent classifications of the same input (H-1003). The model draws different groups on each
// repetition, most of all in long meetings where a point is a stretch and the stretch has no fixed edges. The system keeps the
// draw that agrees most with the others (the medoid, by adjusted Rand index) and gives each of its groups the area that the
// majority of the draws gave to the group's units. Set arithmetic only: no text is read and no group is invented.

/** Adjusted Rand index between two partitions of the same units, each a Map unit -> label. 1 when they are the same partition. */
export function adjustedRand(p, q) {
  const units = [...p.keys()].filter((u) => q.has(u));
  const n = units.length;
  if (n < 2) return 1;
  const table = new Map();
  const rows = new Map();
  const cols = new Map();
  for (const u of units) {
    const key = `${p.get(u)}|${q.get(u)}`;
    table.set(key, (table.get(key) ?? 0) + 1);
    rows.set(p.get(u), (rows.get(p.get(u)) ?? 0) + 1);
    cols.set(q.get(u), (cols.get(q.get(u)) ?? 0) + 1);
  }
  const pairs = (x) => (x * (x - 1)) / 2;
  const sum = (m) => [...m.values()].reduce((s, x) => s + pairs(x), 0);
  const sumTable = sum(table);
  const expected = (sum(rows) * sum(cols)) / pairs(n);
  const max = (sum(rows) + sum(cols)) / 2;
  return max === expected ? 1 : (sumTable - expected) / (max - expected);
}

/** unit -> label of its group (`g<i>`) or `D` when it was discarded. */
function partitionOf(draw, scope) {
  const map = new Map(scope.map((u) => [u, 'D']));
  draw.groups.forEach((g, i) => g.unit_ids.forEach((u) => map.set(u, `g${i}`)));
  return map;
}

/**
 * @param {{groups: {area_id: number, template_id: number, unit_ids: number[]}[], discarded: {unit_ids: number[], reason: string}[]}[]} draws
 *   at least one; every draw covers the same units
 * @param {{id: number, area_id: number}[]} templates
 * @returns {{groups: object[], discarded: object[], medoid: number}}
 */
export function consensus(draws, templates) {
  if (draws.length === 1) return { groups: draws[0].groups, discarded: draws[0].discarded, medoid: 0 };
  const scope = [...new Set(draws.flatMap((d) => [...d.groups.flatMap((g) => g.unit_ids), ...d.discarded.flatMap((x) => x.unit_ids)]))].sort((a, b) => a - b);
  const parts = draws.map((d) => partitionOf(d, scope));
  const score = parts.map((p, i) => parts.reduce((s, q, j) => (i === j ? s : s + adjustedRand(p, q)), 0));
  const medoid = score.indexOf(Math.max(...score));
  const votes = new Map(); // unit -> Map area -> count
  const templateVotes = new Map(); // `${area}` -> Map template -> count
  for (const d of draws) {
    for (const g of d.groups) {
      for (const u of g.unit_ids) {
        const byArea = votes.get(u) ?? new Map();
        byArea.set(g.area_id, (byArea.get(g.area_id) ?? 0) + 1);
        votes.set(u, byArea);
      }
      const byTemplate = templateVotes.get(g.area_id) ?? new Map();
      byTemplate.set(g.template_id, (byTemplate.get(g.template_id) ?? 0) + g.unit_ids.length);
      templateVotes.set(g.area_id, byTemplate);
    }
  }
  const best = (counts, prefer) => [...counts].reduce((top, [key, n]) => (n > top[1] || (n === top[1] && key === prefer) ? [key, n] : top), [prefer, -1])[0];
  const groups = draws[medoid].groups.map((g) => {
    const tally = new Map();
    for (const u of g.unit_ids) for (const [area, n] of votes.get(u) ?? []) tally.set(area, (tally.get(area) ?? 0) + n);
    const area = tally.size > 0 ? best(tally, g.area_id) : g.area_id;
    if (area === g.area_id) return g;
    const own = templates.filter((t) => t.area_id === area).map((t) => t.id);
    const counts = new Map([...(templateVotes.get(area) ?? [])].filter(([id]) => own.includes(id)));
    return { ...g, area_id: area, template_id: counts.size > 0 ? best(counts, own[0]) : own[0] };
  });
  return { groups, discarded: draws[medoid].discarded, medoid };
}
