// Property tests (fast-check, MIT) of the MECE score of the benchmark (bench/score.js, MASTER-SPEC section 7.11,
// docs/TEST.md layer 3): the arithmetic of sets has to hold for any partition of the units, not just for the
// hand-made cases of bench/score.test.js.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import fc from 'fast-check'
import { mergeAssignment, score } from '../bench/score.js'

/** A reference over units 1..n: each unit goes to one of `groups` messages or is discarded (-1). */
const referenceArb = fc.integer({ min: 1, max: 30 }).chain((n) => fc.tuple(
  fc.constant(n),
  fc.array(fc.integer({ min: -1, max: 5 }), { minLength: n, maxLength: n })
)).map(([n, assignment]) => {
  const units = Array.from({ length: n }, (_, i) => i + 1)
  const byGroup = new Map()
  const discarded = []
  assignment.forEach((group, i) => {
    if (group === -1) discarded.push(units[i])
    else byGroup.set(group, [...(byGroup.get(group) ?? []), units[i]])
  })
  const messages = [...byGroup.values()].map((unitIds, index) => ({ id: `g${index}`, unit_ids: unitIds, area_id: index + 1, template_id: index + 1 }))
  return { units, messages, discarded }
})

test('score: when the obtained result equals the expected one every rate is 0 or 100 %', () => {
  fc.assert(fc.property(referenceArb.filter((r) => r.messages.length > 0), ({ units, messages, discarded }) => {
    const actual = {
      messages: messages.map((m) => ({ unit_ids: [...m.unit_ids], area_id: m.area_id, template_id: m.template_id })),
      discarded: discarded.length > 0 ? [{ unit_ids: discarded, reason: 'not actionable' }] : []
    }
    const result = score({ units, expected: { messages }, actual })
    assert.equal(result.rates.coverage, 1)
    for (const rate of ['repetition', 'extra', 'split', 'fused']) assert.equal(result.rates[rate], 0, rate)
    for (const rate of ['area_accuracy', 'template_accuracy', 'classification_accuracy']) assert.equal(result.rates[rate], 1, rate)
    assert.equal(result.counts.overlap_units, 0)
    assert.equal(result.counts.hole_units, 0)
    assert.equal(result.counts.invalid_unit_ids, 0)
    assert.equal(result.mece, true)
  }), { numRuns: 300 })
})

test('score: units covered by a message or discarded plus holes are exactly all the units, whatever the result', () => {
  const idArb = fc.integer({ min: 0, max: 40 }) // ids beyond the input exist on purpose: the score must ignore them
  const actualArb = fc.record({
    messages: fc.array(fc.record({ unit_ids: fc.array(idArb, { maxLength: 12 }), area_id: fc.integer({ min: 1, max: 6 }), template_id: fc.integer({ min: 1, max: 6 }) }), { maxLength: 8 }),
    discarded: fc.array(fc.oneof(idArb, fc.record({ unit_ids: fc.array(idArb, { maxLength: 6 }), reason: fc.constant('x') })), { maxLength: 6 })
  })
  fc.assert(fc.property(referenceArb, actualArb, ({ units, messages }, actual) => {
    const result = score({ units, expected: { messages }, actual })
    const known = new Set(units)
    const accounted = new Set()
    for (const m of actual.messages) for (const id of m.unit_ids) if (known.has(id)) accounted.add(id)
    for (const d of actual.discarded) for (const id of (typeof d === 'object' ? d.unit_ids : [d])) if (known.has(id)) accounted.add(id)
    assert.equal(accounted.size + result.counts.hole_units, units.length)
    // A unit cannot be both a hole and an overlap, and neither can be an id that does not exist.
    const holes = new Set(result.details.hole_units)
    assert.ok(result.details.overlap_units.every((id) => known.has(id) && !holes.has(id)))
    assert.ok([...holes].every((id) => known.has(id)))
    for (const [name, rate] of Object.entries(result.rates)) assert.ok(rate === null || (rate >= 0 && rate <= 1), `${name} out of range: ${rate}`)
  }), { numRuns: 500 })
})

// ---- assignment (H-77) ----

const memberIdsArb = fc.uniqueArray(fc.integer({ min: 1, max: 4 }), { maxLength: 4 })
/** Expected messages carrying assignees, and an obtained result that either copies them or draws its own. */
const assignmentArb = referenceArb.filter((r) => r.messages.length > 0).chain((reference) =>
  fc.tuple(
    fc.constant(reference),
    fc.array(memberIdsArb, { minLength: reference.messages.length, maxLength: reference.messages.length }),
    fc.array(memberIdsArb, { minLength: reference.messages.length, maxLength: reference.messages.length })
  )
).map(([reference, expectedAssignees, actualAssignees]) => ({
  units: reference.units,
  expected: { messages: reference.messages.map((m, i) => ({ ...m, assignee_ids: expectedAssignees[i] })) },
  actualMessages: reference.messages.map((m, i) => ({ unit_ids: [...m.unit_ids], area_id: m.area_id, template_id: m.template_id, assignee_ids: actualAssignees[i] })),
  expectedAssignees,
  actualAssignees
}))

test('assignment: copying the expected assignees gives accuracy 1 and precision and recall 1 (or null when nobody is assigned)', () => {
  fc.assert(fc.property(assignmentArb, ({ units, expected, actualMessages, expectedAssignees }) => {
    const copy = actualMessages.map((m, i) => ({ ...m, assignee_ids: expectedAssignees[i] }))
    const a = score({ units, expected, actual: { messages: copy } }).assignment
    assert.equal(a.pairs, expected.messages.length)
    assert.equal(a.accuracy, 1)
    const assigned = expectedAssignees.flat().length
    assert.equal(a.precision, assigned === 0 ? null : 1)
    assert.equal(a.recall, assigned === 0 ? null : 1)
  }), { numRuns: 300 })
})

test('assignment: counts are consistent and every rate stays in range, whatever the assignees', () => {
  fc.assert(fc.property(assignmentArb, ({ units, expected, actualMessages, expectedAssignees, actualAssignees }) => {
    const a = score({ units, expected, actual: { messages: actualMessages } }).assignment
    assert.ok(a.exact <= a.pairs)
    // Exact matches are exactly the pairs whose sets are equal as sets.
    const sameSet = (x, y) => x.length === y.length && x.every((id) => y.includes(id))
    assert.equal(a.exact, expectedAssignees.filter((e, i) => sameSet(e, actualAssignees[i])).length)
    // Totals equal the sums over members, and tp + fn is the number of expected assignments.
    const sum = (key) => Object.values(a.per_member).reduce((acc, m) => acc + m[key], 0)
    assert.equal(sum('tp'), a.tp)
    assert.equal(sum('fp'), a.fp)
    assert.equal(sum('fn'), a.fn)
    assert.equal(a.tp + a.fn, expectedAssignees.flat().length)
    assert.equal(a.tp + a.fp, actualAssignees.flat().length)
    for (const m of Object.values(a.per_member)) {
      assert.equal(m.tp + m.fp + m.fn + m.tn, a.pairs)
      for (const rate of [m.precision, m.recall, m.accuracy, m.exact_when_expected_rate]) assert.ok(rate === null || (rate >= 0 && rate <= 1))
    }
    for (const rate of [a.accuracy, a.precision, a.recall]) assert.ok(rate === null || (rate >= 0 && rate <= 1))
  }), { numRuns: 500 })
})

test('assignment: the order and repetition of ids inside a message do not change the result', () => {
  fc.assert(fc.property(assignmentArb, ({ units, expected, actualMessages }) => {
    const scramble = actualMessages.map((m) => ({ ...m, assignee_ids: [...m.assignee_ids].reverse().concat(m.assignee_ids) }))
    const base = score({ units, expected, actual: { messages: actualMessages } }).assignment
    const noisy = score({ units, expected, actual: { messages: scramble } }).assignment
    assert.deepEqual(noisy, base)
  }), { numRuns: 200 })
})

test('assignment: merging the two halves of a list of cases equals scoring them together', () => {
  fc.assert(fc.property(assignmentArb, assignmentArb, (x, y) => {
    const one = score({ units: x.units, expected: x.expected, actual: { messages: x.actualMessages } }).assignment
    const two = score({ units: y.units, expected: y.expected, actual: { messages: y.actualMessages } }).assignment
    const merged = mergeAssignment([one, two])
    assert.equal(merged.pairs, one.pairs + two.pairs)
    assert.equal(merged.exact, one.exact + two.exact)
    assert.equal(merged.tp, one.tp + two.tp)
    for (const m of Object.values(merged.per_member)) assert.equal(m.tp + m.fp + m.fn + m.tn, merged.pairs)
  }), { numRuns: 200 })
})
