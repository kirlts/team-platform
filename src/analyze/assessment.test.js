// UD-292: what the analyzer returns beyond the text of a message: what is expected of Claude in natural words, the Guards of the area it touches (the only boolean), and continuous
// estimates with their reason. The grammar requires them so the model always decides them; the validation bounds the numbers and accepts a proposal without them (a draft from before).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { areaBlock, decomposeSystem, harnessPrompt } from './prompts.js'
import { buildDecompositionSchema, buildProposalSchema } from './schema.js'
import { normalizeDecomposition } from './validate.js'
import { readEstimates } from '../domain/assessment.js'

const FIELDS = ['expectation', 'guards_touched', 'understand_vs_create', 'irreversibility', 'value_holder', 'certainty', 'estimate_reason']

describe('assessment of a message', () => {
  const grammar = buildDecompositionSchema([], { withDiscarded: false }).properties.messages.items
  const validation = buildDecompositionSchema([], { validation: true }).properties.messages.items

  it('the grammar requires every field, before the assignees, and no field is a closed list of levels or kinds', () => {
    for (const f of FIELDS) assert.ok(grammar.required.includes(f), f)
    const order = Object.keys(grammar.properties)
    assert.ok(order.indexOf('estimate_reason') < order.indexOf('assignee_ids'))
    assert.deepEqual(grammar.properties.value_holder.enum, ['person', 'model'])
    assert.equal(grammar.properties.expectation.enum, undefined)
    assert.equal(grammar.properties.understand_vs_create.enum, undefined)
  })

  it('the validation bounds the estimates to 0..1 and does not require the fields; the harness proposal carries them', () => {
    assert.deepEqual([validation.properties.certainty.minimum, validation.properties.certainty.maximum], [0, 1])
    for (const f of FIELDS) assert.ok(!validation.required.includes(f), f)
    const proposal = buildProposalSchema().properties.messages.items
    for (const f of FIELDS) assert.ok(proposal.required.includes(f), f)
    assert.ok(!buildProposalSchema({ validation: true }).properties.messages.items.required.includes('expectation'))
  })

  it('the instructions define every field in both languages and in the harness prompt, and the area block gives the space and the Guards by id', () => {
    const template = { name: 'T', description: 'd', fields: [], body: 'x' }
    for (const language of ['es-419', 'en']) {
      const text = decomposeSystem(template, { name: 'P', description: 'd' }, language, undefined, { title: 'Errores', description: 'Lo que falla.', guards: [{ id: 3, text: 'Nada toca pagos', person: true }] }).join('\n')
      for (const f of FIELDS) assert.ok(text.includes(f), `${language}: ${f}`)
      assert.match(text, /G3/)
      assert.match(text, /Lo que falla\./)
    }
    assert.match(harnessPrompt({ unitCount: 3 }), /guards_touched/)
    assert.equal(areaBlock({ title: 'A', description: '', guards: [] }, 'en'), '')
  })

  it('the normalization keeps valid estimates and a list of guards, and drops estimates out of range', () => {
    const base = { unit_ids: [1], title: 't', body: 'b', fields: {}, assignee_ids: [], attachment_ids: [] }
    const good = { ...base, expectation: ' investigar ', guards_touched: [2, 1, 2], understand_vs_create: 0.3, irreversibility: 0.1, value_holder: 'model', certainty: 0.9, estimate_reason: ' ok ' }
    const out = normalizeDecomposition({ messages: [good, { ...base, unit_ids: [2], certainty: 3, understand_vs_create: 0.2, irreversibility: 0.2, value_holder: 'model' }], discarded: [] })
    assert.deepEqual([out.messages[0].expectation, out.messages[0].guards_touched, out.messages[0].estimate_reason], ['investigar', [1, 2], 'ok'])
    assert.equal(out.messages[1].certainty, undefined)
    assert.equal(readEstimates({ ...good, value_holder: 'x' }), null)
  })
})
