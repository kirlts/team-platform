// MECE score by set arithmetic over unit_ids (report 02, §5.2 and §10) and per-unit classification
// accuracy (MASTER-SPEC §7.11). Pure module: no network, no disk, no prose reading (§1.2).
//
// Vocabulary:
//   G = expected messages of the reference, each an atomic point with its unit_ids.
//   P = messages obtained from the analyzer.
//   unit = numbered fragment of the input (paragraph, bullet, timestamped segment).

/**
 * @typedef {number | string} UnitId
 * @typedef {{ id: string, unit_ids: UnitId[], area_id?: number | number[], template_id?: number | number[] }} ExpectedMessage
 * @typedef {{ unit_ids: UnitId[], area_id?: number, template_id?: number }} ActualMessage
 * @typedef {{
 *   units: Array<UnitId | { id: UnitId }>,
 *   expected: { messages: ExpectedMessage[] },
 *   actual: { messages?: ActualMessage[], discarded?: Array<UnitId | { unit_id?: UnitId, unit_ids?: UnitId[] }> }
 * }} ScoreInput
 */

const idOf = (unit) => (typeof unit === 'object' && unit !== null ? unit.id : unit);
const isSubset = (small, big) => [...small].every((x) => big.has(x));
const intersects = (a, b) => [...a].some((x) => b.has(x));
const ratio = (n, d) => (d === 0 ? 0 : n / d);
const asList = (v) => (v === undefined || v === null ? null : [].concat(v));

/** Discarded items arrive as bare ids, `{ unit_id }` or `{ unit_ids, reason }`. */
function discardedIds(discarded) {
  return (discarded ?? []).flatMap((d) => {
    if (typeof d !== 'object' || d === null) return [d];
    return [...(d.unit_ids ?? []), ...(d.unit_id === undefined ? [] : [d.unit_id])];
  });
}

/**
 * Assignment scoring (H-77). An expected message may carry `assignee_ids`. It is paired with the obtained message that
 * holds all of its units (the tightest one when several do); an expected point that no message covers has no pair, so
 * assignment is judged only where decomposition succeeded. Per pair the two sets are compared as sets (order and
 * repeated ids do not matter); an empty set on both sides is an exact match.
 *
 * Returns `null` rates when there is nothing to divide by, and the raw counts so that several cases can be summed
 * before dividing (`mergeAssignment`).
 * @param {Array<{ assignee_ids?: number[], units: Set<UnitId> }>} G expected messages
 * @param {Array<{ assignee_ids?: number[], units: Set<UnitId> }>} P obtained messages
 */
const sortedUnique = (ids) => [...new Set(ids)].sort((a, b) => a - b);

/**
 * Pairs each expected message with the obtained message that holds all of its units (the tightest one). A second
 * labeler's assignees travel as `assignee_ids_alt`; area and template lists already hold both labelers' choices.
 */
function matchPairs(G, P) {
  const pairs = [];
  for (const g of G) {
    if (g.units.size === 0) continue;
    const complete = P.filter((p) => isSubset(g.units, p.units));
    if (complete.length === 0) continue;
    const match = complete.reduce((best, p) => (p.units.size < best.units.size ? p : best));
    const areas = asList(g.area_id);
    const templates = asList(g.template_id);
    pairs.push({
      expected_id: g.id,
      actual_index: match.index,
      expected: Array.isArray(g.assignee_ids) ? sortedUnique(g.assignee_ids) : null,
      alt: Array.isArray(g.assignee_ids_alt) ? sortedUnique(g.assignee_ids_alt) : null,
      actual: sortedUnique(match.assignee_ids ?? []),
      area_ok: areas ? areas.includes(match.area_id) : null,
      template_ok: templates ? templates.includes(match.template_id) : null,
    });
  }
  return pairs;
}

/** Counts of area and template correctness over the expected messages that have a covering message. */
function classificationByMessage(pairs, G) {
  const withRef = G.filter((g) => asList(g.area_id) || asList(g.template_id)).length;
  const judged = pairs.filter((p) => p.area_ok !== null || p.template_ok !== null);
  return {
    expected: withRef,
    with_message: judged.length,
    area_correct: judged.filter((p) => p.area_ok !== false).length,
    template_correct: judged.filter((p) => p.template_ok !== false).length,
    both_correct: judged.filter((p) => p.area_ok !== false && p.template_ok !== false).length,
  };
}

/**
 * Assignment counts and rates from a list of pairs `{ expected, alt?, actual }`. Exported so that a comparison can
 * score only the pairs that every variant produced.
 *
 * With one labeler, `expected` is the truth. With a second one (`alt`), a member both labelers chose is firm and a
 * member only one chose is accepted: recall counts firm members, precision counts accepted ones, and a set is exact when
 * it equals either labeler's set.
 * @param {Array<{ expected: number[], alt?: number[]|null, actual: number[] }>} pairList
 */
export function assignmentFromPairs(pairList) {
  const members = new Map();
  const member = (id) => {
    if (!members.has(id)) members.set(id, { tp: 0, tp_p: 0, fp: 0, fn: 0, tn: 0, expected: 0, exact_when_expected: 0 });
    return members.get(id);
  };
  let exact = 0;
  let tp = 0;
  let tpP = 0;
  let fp = 0;
  let fn = 0;
  const sameSet = (x, y) => x.size === y.size && [...x].every((id) => y.has(id));
  for (const pair of pairList) {
    const a = new Set(pair.expected);
    const b = pair.alt ? new Set(pair.alt) : null;
    const got = new Set(pair.actual);
    const firm = b ? new Set([...a].filter((id) => b.has(id))) : a;
    const accepted = b ? new Set([...a, ...b]) : a;
    const same = sameSet(a, got) || (b !== null && sameSet(b, got));
    if (same) exact += 1;
    for (const id of new Set([...accepted, ...got])) {
      const m = member(id);
      if (got.has(id)) {
        if (accepted.has(id)) { m.tp_p += 1; tpP += 1; } else { m.fp += 1; fp += 1; }
        if (firm.has(id)) { m.tp += 1; tp += 1; }
      } else if (firm.has(id)) {
        m.fn += 1;
        fn += 1;
      }
    }
    for (const id of firm) {
      member(id).expected += 1;
      if (same) member(id).exact_when_expected += 1;
    }
  }
  for (const m of members.values()) m.tn = pairList.length - m.tp - m.fp - m.fn;
  return finishAssignment({
    pairs: pairList.length,
    exact,
    tp,
    tp_p: tpP,
    fp,
    fn,
    per_member: Object.fromEntries([...members].map(([id, m]) => [String(id), m])),
    pair_list: pairList,
  });
}

/** Adds the derived rates to raw assignment counts. */
function finishAssignment({ pairs, exact, tp, tp_p: tpP = tp, fp, fn, per_member, pair_list }) {
  const perMember = {};
  for (const [id, m] of Object.entries(per_member)) {
    perMember[id] = {
      ...m,
      precision: (m.tp_p ?? m.tp) + m.fp === 0 ? null : (m.tp_p ?? m.tp) / ((m.tp_p ?? m.tp) + m.fp),
      recall: m.tp + m.fn === 0 ? null : m.tp / (m.tp + m.fn),
      accuracy: pairs === 0 ? null : (m.tp + m.tn) / pairs,
      exact_when_expected_rate: m.expected === 0 ? null : m.exact_when_expected / m.expected,
    };
  }
  return {
    pairs,
    exact,
    tp,
    tp_p: tpP,
    fp,
    fn,
    accuracy: pairs === 0 ? null : exact / pairs,
    precision: tpP + fp === 0 ? null : tpP / (tpP + fp),
    recall: tp + fn === 0 ? null : tp / (tp + fn),
    per_member: perMember,
    ...(pair_list ? { pair_list } : {}),
  };
}

/**
 * Sums the assignment counts of several cases and recomputes the rates (micro average over pairs).
 * @param {Array<ReturnType<typeof scoreAssignment>>} list
 */
export function mergeAssignment(list) {
  const total = { pairs: 0, exact: 0, tp: 0, tp_p: 0, fp: 0, fn: 0, per_member: {} };
  for (const a of list) {
    if (!a) continue;
    for (const k of ['pairs', 'exact', 'tp', 'fp', 'fn']) total[k] += a[k];
    total.tp_p += a.tp_p ?? a.tp;
    for (const [id, m] of Object.entries(a.per_member)) {
      const t = (total.per_member[id] ??= { tp: 0, tp_p: 0, fp: 0, fn: 0, tn: 0, expected: 0, exact_when_expected: 0 });
      for (const k of Object.keys(t)) t[k] += m[k] ?? (k === 'tp_p' ? m.tp : 0);
    }
  }
  // A member absent from a case's pairs is a true negative in all of them, so tn is recomputed from the merged counts.
  for (const m of Object.values(total.per_member)) m.tn = total.pairs - m.tp - m.fp - m.fn;
  return finishAssignment(total);
}

/**
 * Computes the report 02 §5.2 measures, the per-unit overlaps and holes (§3.3) and the per-unit
 * area and template accuracy. Units the analyzer cites that do not exist in the input are
 * ignored and reported.
 * @param {ScoreInput} input
 */
export function score({ units, expected, actual }) {
  const known = new Set(units.map(idOf));

  // Units cited by the analyzer that do not exist in the input.
  const invalid = new Set();
  const clean = (ids, track) => {
    const out = new Set();
    for (const id of ids ?? []) {
      if (known.has(id)) out.add(id);
      else if (track) invalid.add(id);
    }
    return out;
  };

  const G = expected.messages.map((m) => ({ ...m, units: clean(m.unit_ids, false) }));
  const P = (actual.messages ?? []).map((m, index) => ({ ...m, index, units: clean(m.unit_ids, true) }));
  const discarded = new Set(discardedIds(actual.discarded).filter((id) => known.has(id)));

  const union = new Set(P.flatMap((p) => [...p.units]));

  // State of each reference point.
  const perPoint = G.map((g) => {
    const touching = P.filter((p) => intersects(g.units, p.units));
    const complete = P.filter((p) => isSubset(g.units, p.units));
    let state;
    if (complete.length > 0) state = 'covered';
    else if (touching.length === 0) state = 'missing';
    else if (touching.length === 1) state = 'partial';
    else state = 'split';
    return {
      id: g.id,
      state,
      touching: touching.map((p) => p.index),
      complete: complete.map((p) => p.index),
      repeated: complete.length > 0 && touching.length >= 2,
    };
  });

  const nG = G.length;
  const nP = P.length;
  const covered = perPoint.filter((x) => x.state === 'covered').length;
  const repeated = perPoint.filter((x) => x.repeated).length;
  const split = perPoint.filter((x) => x.state === 'split').length;
  const partial = perPoint.filter((x) => x.state === 'partial').length;
  const missing = perPoint.filter((x) => x.state === 'missing').length;

  // Extra message: touches no reference point (includes messages without units).
  const extraMessages = P.filter((p) => !G.some((g) => intersects(g.units, p.units))).map((p) => p.index);
  // Fused message: touches two or more distinct reference points.
  const fusedMessages = P.filter((p) => G.filter((g) => intersects(g.units, p.units)).length >= 2).map((p) => p.index);

  // Per unit, without knowing the reference: what the system computes on its own in production.
  const messageCount = new Map();
  for (const p of P) for (const id of p.units) messageCount.set(id, (messageCount.get(id) ?? 0) + 1);
  const overlapUnits = [...messageCount].filter(([, n]) => n > 1).map(([id]) => id);
  const holeUnits = [...known].filter((id) => !union.has(id) && !discarded.has(id));

  // Per-unit classification: each unit of an expected point must be only in messages
  // whose area (and template) are among those accepted for that point.
  const classification = { units: 0, area_correct: 0, template_correct: 0, both_correct: 0 };
  // The same count over the units that received a message: an unit nobody covered says nothing about the area.
  const givenMessage = { units: 0, area_correct: 0, template_correct: 0, both_correct: 0 };
  const pairs = matchPairs(G, P);
  let classified = false;
  for (const g of G) {
    const areas = asList(g.area_id);
    const templates = asList(g.template_id);
    if (!areas && !templates) continue;
    classified = true;
    for (const unit of g.units) {
      const holders = P.filter((p) => p.units.has(unit));
      const areaOk = holders.length > 0 && (!areas || holders.every((p) => areas.includes(p.area_id)));
      const templateOk = holders.length > 0 && (!templates || holders.every((p) => templates.includes(p.template_id)));
      classification.units += 1;
      if (holders.length > 0) {
        givenMessage.units += 1;
        if (areaOk) givenMessage.area_correct += 1;
        if (templateOk) givenMessage.template_correct += 1;
        if (areaOk && templateOk) givenMessage.both_correct += 1;
      }
      if (areaOk) classification.area_correct += 1;
      if (templateOk) classification.template_correct += 1;
      if (areaOk && templateOk) classification.both_correct += 1;
    }
  }

  const counts = {
    expected_messages: nG,
    actual_messages: nP,
    covered,
    repeated,
    split,
    partial,
    missing,
    extra: extraMessages.length,
    fused: fusedMessages.length,
    overlap_units: overlapUnits.length,
    hole_units: holeUnits.length,
    invalid_unit_ids: invalid.size,
    ...classification,
  };
  const rates = {
    coverage: ratio(covered, nG),
    repetition: ratio(repeated, nG),
    extra: ratio(extraMessages.length, nP),
    split: ratio(split, nG),
    fused: ratio(fusedMessages.length, nP),
    area_accuracy: classified ? ratio(classification.area_correct, classification.units) : null,
    template_accuracy: classified ? ratio(classification.template_correct, classification.units) : null,
    classification_accuracy: classified ? ratio(classification.both_correct, classification.units) : null,
  };

  // MECE by definition: nothing missing, nothing repeated, no broken or fused point, no message without a point.
  // The classification is graded separately (MASTER-SPEC §7.11).
  const mece =
    rates.coverage === 1 &&
    counts.repeated === 0 &&
    counts.split === 0 &&
    counts.fused === 0 &&
    counts.extra === 0 &&
    counts.overlap_units === 0 &&
    counts.hole_units === 0 &&
    counts.invalid_unit_ids === 0;

  return {
    counts,
    rates,
    mece,
    assignment: assignmentFromPairs(pairs.filter((p) => p.expected !== null)),
    classification_by_message: classificationByMessage(pairs, G),
    classification_given_message: givenMessage,
    details: {
      points: perPoint,
      extra_messages: extraMessages,
      fused_messages: fusedMessages,
      overlap_units: overlapUnits,
      hole_units: holeUnits,
      invalid_unit_ids: [...invalid],
    },
  };
}
