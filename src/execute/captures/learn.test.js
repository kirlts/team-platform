import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { learn, newLearned, personRules } from './learn.js'

const run = (payload, rules = personRules(), inContext = false) => { const learned = newLearned(); learn(learned, payload, rules, inContext); return learned }

describe('learn', () => {
  it('learns the values under keys that name a person, at any depth and inside lists', () => {
    const l = run({ data: [{ id: 1, full_name: 'Maria Soto', contact: { email: 'maria@example.org', phone: '+56 9 8765 4321' } }] })
    assert.deepEqual([...l.values].sort(), ['+56 9 8765 4321', 'Maria Soto', 'maria@example.org'])
    assert.equal(l.count, 3)
  })

  it('learns a generic key (name, title) only inside something about people', () => {
    assert.equal(run({ services: [{ name: 'Consultation' }] }).values.size, 0)
    assert.deepEqual([...run({ patients: [{ name: 'Maria Soto' }] }).values], ['Maria Soto'])
    assert.deepEqual([...run({ list: [{ name: 'Maria Soto' }] }, personRules(), true).values], ['Maria Soto'], 'the path of the request can say it')
  })

  it('does not learn dates, numbers, values that are too short or too long, or lists of strings under other keys', () => {
    const l = run({ email: ['2026-10-26T10:00:00Z', 'ab', 'x'.repeat(81), 42], notes: 'Maria Soto' })
    assert.equal(l.values.size, 0)
  })

  it('the host widens the rules with its own keys and context', () => {
    const rules = personRules({ personKey: /^(rut|nombre_completo)$/i, personContext: /pacient/i, genericKey: /^nombre$/i })
    assert.deepEqual([...run({ pacientes: [{ nombre: 'Ana Perez', rut: '1-9' }] }, rules).values].sort(), ['1-9', 'Ana Perez'].filter((v) => v.length >= 3).sort())
  })

  it('stops at the depth it declares', () => {
    let deep = { email: 'deep@example.org' }
    for (let i = 0; i < 12; i++) deep = { next: deep }
    assert.equal(run(deep).values.size, 0)
  })
})
