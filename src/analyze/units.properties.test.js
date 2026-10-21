// Property tests (fast-check, MIT) of the unit numbering (MASTER-SPEC section 7.5, docs/TEST.md layer 3): what an
// example cannot cover is that, whatever text arrives, the units are never empty, their ids are unique and ordered,
// and nothing is lost or invented: the units put back together are the input text, whitespace aside.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import fc from 'fast-check'
import { numberUnits, partitionUnits } from './units.js'

const compact = (text) => text.replace(/\s+/g, '')

// Fragments the segmentation looks at: words, sentence ends, list markers, bullets, headings, timestamps, an
// abbreviation, semicolons, dashes, indentation and blank lines, plus arbitrary unicode text.
const fragment = fc.oneof(
  fc.constantFrom('hello', 'the button', 'saves', 'Sr.', 'Dra.', 'etc.', '1)', '2)', '3)', 'a)', 'b)', '- ', '* ', '• ', '# Title', '## Section', '[00:12]', '12:34', '3.', ';', '.', '?', '!', '–', '  indented', '\t'),
  fc.string({ unit: 'grapheme', maxLength: 12 })
)
const separator = fc.constantFrom(' ', ' ', '\n', '\n\n', '\r\n', '\n  ')
const textArb = fc.array(fc.tuple(fragment, separator), { maxLength: 40 }).map((parts) => parts.map(([f, s]) => f + s).join(''))
const attachmentArb = fc.record({ kind: fc.constantFrom('image', 'document', 'audio', 'video', 'link'), extracted: fc.option(textArb, { nil: null }) })
const bundleArb = fc.record({ text: textArb, attachments: fc.array(attachmentArb, { maxLength: 4 }) })
  .map((b) => ({ ...b, attachments: b.attachments.map((a, i) => ({ ...a, id: i + 1 })) }))

/** The text sources of a bundle, in the order the numbering visits them. */
const sourcesOf = (bundle) => [bundle.text, ...bundle.attachments.map((a) => a.extracted)].filter((t) => typeof t === 'string' && t.trim() !== '')

test('numberUnits: no unit is empty and the ids are unique, consecutive and ordered', () => {
  fc.assert(fc.property(bundleArb, (bundle) => {
    const units = numberUnits(bundle)
    units.forEach((u, i) => {
      assert.notEqual(u.text.trim(), '', `unit ${u.id} is empty`)
      assert.equal(u.id, i + 1)
    })
    assert.equal(new Set(units.map((u) => u.id)).size, units.length)
  }), { numRuns: 300 })
})

test('numberUnits: the units put back together recover the text, whitespace aside', () => {
  fc.assert(fc.property(bundleArb, (bundle) => {
    const units = numberUnits(bundle)
    assert.equal(compact(units.map((u) => u.text).join('')), compact(sourcesOf(bundle).join('')))
  }), { numRuns: 300 })
})

test('numberUnits: a text without content yields no units and the numbering is deterministic', () => {
  assert.deepEqual(numberUnits({ text: '  \n\t ', attachments: [{ id: 1, kind: 'image', extracted: '' }, { id: 2, kind: 'audio', extracted: null }] }), [])
  fc.assert(fc.property(bundleArb, (bundle) => {
    assert.deepEqual(numberUnits(structuredClone(bundle)), numberUnits(bundle))
  }), { numRuns: 100 })
})

test('partitionUnits: the chunks are disjoint, keep the order and together hold every unit exactly once', () => {
  fc.assert(fc.property(bundleArb, fc.integer({ min: 5, max: 400 }), (bundle, budgetTokens) => {
    const units = numberUnits(bundle)
    const chunks = partitionUnits(units, { budgetTokens, charsPerToken: 3 })
    assert.deepEqual(chunks.flat().map((u) => u.id), units.map((u) => u.id))
    assert.ok(chunks.every((chunk) => chunk.length > 0) || units.length === 0)
  }), { numRuns: 200 })
})
