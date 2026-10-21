// Property tests (fast-check, MIT) of the MECE score of the benchmark (bench/score.js, MASTER-SPEC section 7.11,
// docs/TEST.md layer 3): the arithmetic of sets has to hold for any partition of the units, not just for the
// hand-made cases of bench/score.test.js.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import fc from 'fast-check'
import { score } from '../bench/score.js'

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
