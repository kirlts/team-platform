// UD-292: the analyzer returns `bloom_level` as an enum of the revised Bloom taxonomy. The grammar requires it so the model always decides it;
// the validation accepts a proposal without it (a draft saved before it existed); the system keeps only a value of the enum.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BLOOM_LEVELS } from '../domain/bloom.js'
import { decomposeSystem, harnessPrompt } from './prompts.js'
import { buildDecompositionSchema, buildProposalSchema } from './schema.js'
import { normalizeDecomposition } from './validate.js'

describe('bloom_level of a message', () => {
  const grammar = buildDecompositionSchema([], { withDiscarded: false }).properties.messages.items
  const validation = buildDecompositionSchema([], { validation: true }).properties.messages.items

  it('is an enum of the six levels, required by the grammar and before the assignees', () => {
    assert.deepEqual(grammar.properties.bloom_level.enum, BLOOM_LEVELS)
    assert.ok(grammar.required.includes('bloom_level'))
    const order = Object.keys(grammar.properties)
    assert.ok(order.indexOf('bloom_level') < order.indexOf('assignee_ids'), `order ${order}`)
  })

  it('the validation does not require it, and the harness proposal carries it the same way', () => {
    assert.ok(!validation.required.includes('bloom_level'))
    assert.deepEqual(buildProposalSchema().properties.messages.items.properties.bloom_level.enum, BLOOM_LEVELS)
    assert.ok(buildProposalSchema().properties.messages.items.required.includes('bloom_level'))
    assert.ok(!buildProposalSchema({ validation: true }).properties.messages.items.required.includes('bloom_level'))
  })

  it('the instructions define every level, in both languages and in the harness prompt', () => {
    const template = { name: 'T', description: 'd', fields: [], body: 'x' }
    for (const language of ['es-419', 'en']) {
      const text = decomposeSystem(template, { name: 'P', description: 'd' }, language).join('\n')
      for (const level of BLOOM_LEVELS) assert.ok(text.includes(`${level}:`) || text.includes(`${level}.`), `${language}: ${level}`)
    }
    assert.match(harnessPrompt({ unitCount: 3 }), /bloom_level/)
  })

  it('the normalization keeps a level of the enum and drops anything else', () => {
    const base = { unit_ids: [1], title: 't', body: 'b', fields: {}, assignee_ids: [], attachment_ids: [] }
    const out = normalizeDecomposition({ messages: [{ ...base, bloom_level: 'apply' }, { ...base, unit_ids: [2], bloom_level: 'Aplicar' }, { ...base, unit_ids: [3] }], discarded: [] })
    assert.deepEqual(out.messages.map((m) => m.bloom_level), ['apply', undefined, undefined])
  })
})
