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
