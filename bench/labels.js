// Second labeler (H-90). A reference message has the first reader's `area_id`, `template_id` and `assignee_ids`. A second,
// independent reader labels the same messages in `expected-b.json` (same shape, matched by message id). Where both
// agree the label is firm; where they differ both are accepted:
//   area_id and template_id become the union of the two readers' choices (a list means «any of these is right»);
//   the second reader's assignees travel as `assignee_ids_alt` and score.js treats a member both chose as firm and a
//   member only one chose as accepted.

const list = (v) => (v === undefined || v === null ? null : [].concat(v));
const union = (a, b) => {
  const x = list(a);
  const y = list(b);
  if (!x && !y) return undefined;
  const all = [...new Set([...(x ?? []), ...(y ?? [])])].sort((m, n) => m - n);
  return all.length === 1 ? all[0] : all;
};

/**
 * @param {{ messages: object[] }} expected  the first reader's reference
 * @param {{ messages: object[] }} second    the second reader's labels
 */
export function mergeSecondLabeler(expected, second) {
  const byId = new Map((second.messages ?? []).map((m) => [m.id, m]));
  return {
    ...expected,
    messages: expected.messages.map((m) => {
      const b = byId.get(m.id);
      if (!b) return m;
      return {
        ...m,
        area_id: union(m.area_id, b.area_id),
        template_id: union(m.template_id, b.template_id),
        ...(Array.isArray(b.assignee_ids) ? { assignee_ids_alt: b.assignee_ids } : {}),
      };
    }),
  };
}

/** Agreement between the two readers over the messages both labeled: same area, same template, same assignee set. */
export function labelerAgreement(first, second) {
  const byId = new Map((second.messages ?? []).map((m) => [m.id, m]));
  const same = (x, y) => JSON.stringify([...new Set(list(x) ?? [])].sort()) === JSON.stringify([...new Set(list(y) ?? [])].sort());
  const both = first.messages.filter((m) => byId.has(m.id));
  return {
    messages: both.length,
    area: both.filter((m) => same(m.area_id, byId.get(m.id).area_id)).length,
    template: both.filter((m) => same(m.template_id, byId.get(m.id).template_id)).length,
    assignees: both.filter((m) => same(m.assignee_ids, byId.get(m.id).assignee_ids)).length,
  };
}

/**
 * The second reader's labels alone, on the first reader's messages and units (used to score against reader B only).
 */
export function onlySecondLabeler(expected, second) {
  const byId = new Map((second.messages ?? []).map((m) => [m.id, m]));
  return {
    ...expected,
    messages: expected.messages.map((m) => {
      const b = byId.get(m.id);
      return b ? { ...m, area_id: b.area_id, template_id: b.template_id, assignee_ids: b.assignee_ids } : m;
    }),
  };
}

/**
 * A reader's labels as if they were an analyzer run: one message per reference message with the reader's area, template
 * and assignees (the first area and template when several are accepted). Scoring reader B against reference A (and the
 * other way round) gives the ceiling that the disagreement between readers puts on any variant.
 * @param {{ messages: object[] }} units  the reference that fixes the messages and their units
 * @param {{ messages: object[] }} reader  the labels to play as the analyzer
 */
export function readerAsProposal(units, reader) {
  const byId = new Map((reader.messages ?? []).map((m) => [m.id, m]));
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  return {
    messages: units.messages.map((m) => {
      const r = byId.get(m.id) ?? m;
      return { unit_ids: m.unit_ids, area_id: first(r.area_id), template_id: first(r.template_id), assignee_ids: r.assignee_ids ?? [], title: m.title, body: '', fields: {} };
    }),
    discarded: units.discarded ?? [],
  };
}
