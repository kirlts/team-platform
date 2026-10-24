// UD-283: with EXECUTE_MAX_TURNS=0 there is no cap on turns. The invocation carries no `--max-turns`, only `--max-budget-usd`, and the progress is the share
// of that budget spent, computed from the usage of each message of the stream (a message repeated by partial events counts once).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { claudeArgs } from './handler.js'
import { createStreamReader } from './stream.js'
import { loadConfig } from '../config.js'

test('EXECUTE_MAX_TURNS=0 is accepted and the invocation carries no --max-turns; a positive value still carries it', () => {
  assert.equal(loadConfig({ ...process.env, EXECUTE_MAX_TURNS: '0' }).execute.maxTurns, 0)
  const base = { model: 'claude-sonnet-5-5', effort: 'medium', maxBudgetUsd: 10 }
  assert.ok(!claudeArgs({ ...base, maxTurns: 0 }, {}).includes('--max-turns'))
  const withCap = claudeArgs({ ...base, maxTurns: 60 }, {})
  assert.equal(withCap[withCap.indexOf('--max-turns') + 1], '60')
})

test('without a cap on turns the progress is the share of the budget spent, each message counted once', () => {
  const seen = []
  const r = createStreamReader({ maxTurns: 0, budgetUsd: 1, onProgress: (p) => seen.push(p) })
  // 100 000 output tokens of Sonnet 5.5 cost 1 USD at 10 USD per million; a message of 25 000 output tokens is a quarter of a 1 USD budget.
  const msg = (id) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-sonnet-5-5', usage: { input_tokens: 0, output_tokens: 25000 }, content: [{ type: 'text', text: 'x' }] } }) + '\n'
  r.push(msg('a')); r.push(msg('a')); r.push(msg('b'))
  assert.equal(seen.at(-1), 50, `progress ${JSON.stringify(seen)}`)
})
