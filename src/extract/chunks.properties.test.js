// Property tests (fast-check, MIT) of the audio chunk plan and the merge of their segments (MASTER-SPEC section 7.4,
// report 06 section 3.3, docs/TEST.md layer 3): whatever the duration and the segments, merging the chunks neither
// duplicates nor loses a segment.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import fc from 'fast-check'
import { DEFAULTS } from './config.js'
import { mergeSegments, planChunks } from './lib/chunks.js'

const small = { chunkSeconds: 30, overlapSeconds: 5, minChunkSeconds: 10 }
const configArb = fc.oneof(
  fc.constant(small),
  fc.constant(DEFAULTS.audio),
  fc.integer({ min: 20, max: 120 }).chain((chunkSeconds) => fc.record({
    chunkSeconds: fc.constant(chunkSeconds),
    overlapSeconds: fc.integer({ min: 2, max: Math.floor(chunkSeconds / 4) }),
    minChunkSeconds: fc.integer({ min: 1, max: 15 })
  }))
)
const durationArb = fc.integer({ min: 1, max: 6000 })

test('planChunks: the chunks cover the audio, overlap their neighbours and their cut windows partition the timeline', () => {
  fc.assert(fc.property(durationArb, configArb, (duration, cfg) => {
    const plan = planChunks(duration, cfg)
    assert.equal(plan[0].start, 0)
    assert.equal(plan.at(-1).start + plan.at(-1).length, duration, 'the last chunk ends where the audio ends')
    plan.forEach((chunk, i) => {
      assert.equal(chunk.index, i)
      assert.ok(chunk.length > 0 && chunk.length <= duration)
      if (i > 0) {
        const previous = plan[i - 1]
        assert.ok(chunk.start < previous.start + previous.length, 'consecutive chunks overlap')
        assert.ok(chunk.start > previous.start)
        // The cut lies inside the overlap, and the end of one window is the start of the next.
        assert.ok(chunk.cutStart >= chunk.start && chunk.cutStart <= previous.start + previous.length)
        assert.equal(previous.cutEnd, chunk.cutStart)
      }
    })
    assert.equal(plan[0].cutStart, 0)
    assert.equal(plan.at(-1).cutEnd, Number.POSITIVE_INFINITY)
  }), { numRuns: 500 })
})

test('mergeSegments: merging the chunks returns every segment once, in order, with its original time', () => {
  // Segments of 1 to 2 s (integer seconds) never straddle a cut: with a 5 s overlap the cut sits 2.5 s from the
  // start of the overlap, so a segment that starts before it still ends inside the first chunk.
  const segmentsArb = fc.array(fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 1, max: 2 })), { maxLength: 60 })
  fc.assert(fc.property(durationArb, segmentsArb, (duration, shape) => {
    let cursor = 0
    const truth = []
    for (const [gap, length] of shape) {
      const start = cursor + gap
      if (start + length > duration) break
      truth.push({ start, end: start + length, text: `segment ${truth.length}` })
      cursor = start + length
    }
    const plan = planChunks(duration, small)
    // Each chunk "transcribes" the segments that lie completely inside it, with times relative to the chunk.
    const perChunk = plan.map((chunk) => truth
      .filter((s) => s.start >= chunk.start && s.end <= chunk.start + chunk.length)
      .map((s) => ({ start: s.start - chunk.start, end: s.end - chunk.start, text: s.text })))
    const merged = mergeSegments(plan, perChunk)
    // Each merged segment also carries the index of the chunk it came from (sentence joining never crosses it):
    // the one whose cut window holds its start.
    for (const segment of merged) {
      const owner = plan.find((chunk) => segment.start >= chunk.cutStart && segment.start < chunk.cutEnd)
      assert.equal(segment.chunk, owner.index)
    }
    assert.deepEqual(merged.map(({ chunk, ...rest }) => rest), truth)
  }), { numRuns: 500 })
})

test('mergeSegments: the same segment heard by two chunks is kept only from one of them', () => {
  fc.assert(fc.property(durationArb, fc.integer({ min: 0, max: 5999 }), (duration, at) => {
    const plan = planChunks(duration, small)
    const start = Math.min(at, duration - 1)
    // Every chunk that contains the instant reports a one-second segment starting there.
    const perChunk = plan.map((chunk) => (start >= chunk.start && start + 1 <= chunk.start + chunk.length
      ? [{ start: start - chunk.start, end: start + 1 - chunk.start, text: 'heard twice' }]
      : []))
    const merged = mergeSegments(plan, perChunk)
    const heard = perChunk.filter((segments) => segments.length > 0).length
    assert.equal(merged.length, heard > 0 ? 1 : 0, 'the segment must be kept exactly once')
    assert.ok(merged.every((s) => s.start === start))
  }), { numRuns: 500 })
})
