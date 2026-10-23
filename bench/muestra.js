// Scorer of the heterogeneous sample (docs/investigaciones/mediciones/2026-10-22-muestra-heterogenea.md and
// 2026-10-23-documentos-largos.md). Pure functions over unit ids: no text is read.
//
// Truth of one element (`verdad-NN.json`, private): `{ pedidos: [{ n, unit_ids }] }`, each real request with every unit that
// states or details it. A unit listed under two requests is shared. The core of a request is the units no other request lists;
// a request with no core joins the request it shares most units with and is not scored on its own (its text cannot be
// separated from the other one, rule 4 of the decomposition).
//
// A message is the object `{ unit_ids, title? }`: a message of the proposal or a group of the classification stage.
//
//   main(request)     the message that holds most of its core units (the first on a tie)
//   alone             the main message of the request owns no other request
//   mixed             the main message owns other requests and this request weighs at least half of the heaviest one
//   buried            the main message owns other requests and this request weighs less than half of the heaviest one
//   lost              no core unit of the request is in any message (all discarded)
//   surplus message   holds no unit of any request: context made into a task
//   split request     its core units are in two or more messages
//   twin messages     two messages whose titles share most of their words (a repeated request)

/**
 * @param {{ pedidos: { n: number, unit_ids: number[] }[] }} raw
 * @returns {{ pedidos: { n: number, units: Set<number>, core: Set<number>, joins: number|null }[], pedidoUnits: Set<number> }}
 */
export function buildTruth(raw) {
  const holders = new Map();
  for (const p of raw.pedidos) for (const id of new Set(p.unit_ids)) holders.set(id, [...(holders.get(id) ?? []), p.n]);
  const pedidos = raw.pedidos.map((p) => {
    const units = new Set(p.unit_ids);
    const core = new Set([...units].filter((id) => holders.get(id).length === 1));
    return { n: p.n, units, core, joins: null };
  });
  for (const p of pedidos) {
    if (p.core.size > 0 || p.units.size === 0) continue;
    const share = new Map();
    for (const id of p.units) for (const other of holders.get(id)) if (other !== p.n) share.set(other, (share.get(other) ?? 0) + 1);
    p.joins = [...share.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
  }
  return { pedidos, pedidoUnits: new Set(holders.keys()) };
}

const words = (title) => new Set(String(title ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3));

/** Share of the words of the shorter title that the other title has. */
export function titleOverlap(a, b) {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common += 1;
  return common / Math.min(wa.size, wb.size);
}

/**
 * @param {{ unit_ids: number[], title?: string }[]} messages
 * @param {ReturnType<typeof buildTruth>} truth
 */
export function scoreMessages(messages, truth) {
  const where = new Map();
  messages.forEach((m, i) => m.unit_ids.forEach((id) => where.set(id, [...(where.get(id) ?? []), i])));
  const scored = truth.pedidos.filter((p) => p.joins === null && p.core.size > 0);
  const rows = scored.map((p) => {
    const per = new Map();
    for (const id of p.core) for (const mi of where.get(id) ?? []) per.set(mi, (per.get(mi) ?? 0) + 1);
    const main = [...per.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? null;
    return { n: p.n, core: p.core.size, main: main ? main[0] : null, weight: main ? main[1] : 0, messages: [...per.keys()].sort((a, b) => a - b) };
  });
  const owned = new Map();
  for (const r of rows) if (r.main !== null) owned.set(r.main, [...(owned.get(r.main) ?? []), r]);
  for (const r of rows) {
    if (r.main === null) { r.status = 'lost'; continue; }
    const mates = owned.get(r.main);
    if (mates.length === 1) { r.status = 'solo'; continue; }
    const heaviest = Math.max(...mates.map((x) => x.weight));
    r.status = r.weight * 2 < heaviest ? 'buried' : 'mixed';
  }
  const surplus = messages.map((m, i) => (m.unit_ids.some((id) => truth.pedidoUnits.has(id)) ? -1 : i)).filter((i) => i >= 0);
  const split = rows.filter((r) => r.messages.length > 1).map((r) => r.n);
  const twins = [];
  for (let i = 0; i < messages.length; i += 1) {
    for (let j = i + 1; j < messages.length; j += 1) {
      if (words(messages[i].title).size >= 3 && titleOverlap(messages[i].title, messages[j].title) >= 0.75) twins.push([i, j]);
    }
  }
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    messages: messages.length,
    requests: rows.length,
    joined: truth.pedidos.filter((p) => p.joins !== null).length,
    solo: count('solo'),
    mixed: count('mixed'),
    buried: count('buried'),
    lost: count('lost'),
    surplus: surplus.length,
    surplus_messages: surplus,
    split: split.length,
    twins: twins.length,
    mixed_messages: [...owned.values()].filter((v) => v.length > 1).length,
    rows,
  };
}

/** Sums the counts of several element scores. */
export function totalOf(scores) {
  const keys = ['messages', 'requests', 'solo', 'mixed', 'buried', 'lost', 'surplus', 'split', 'twins', 'mixed_messages'];
  return Object.fromEntries(keys.map((k) => [k, scores.reduce((a, s) => a + s[k], 0)]));
}
