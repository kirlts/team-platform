// Estimated cost per call: each price comes from the pricing.js table (MASTER-SPEC §3, reports 02 and 06).
import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { costOfModelUsage, costOfResult, estimateCostUsd, unpricedSlots } from './pricing.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} ≠ ${expected}`);

test('Haiku 5.5: input, output and cache read at the MASTER-SPEC §3 prices', () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cached_tokens: 1_000_000 };
  // One million of each exceeds the 100,000-token tier and carries cache: the price of that tier is not known.
  assert.equal(estimateCostUsd({ provider: 'anthropic', model: 'claude-haiku-5-5', usage }), null);
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-haiku-5-5', usage: { input_tokens: 10_000, output_tokens: 2_000, cached_tokens: 50_000 } }), 0.0001 * 10 + 0.0005 * 2 + 0.00001 * 50);
});

test('cache write costs 1.25 times the input at 5 minutes and 2 times at 1 hour', () => {
  const usage = { input_tokens: 0, output_tokens: 0, cached_tokens: 0, cache_creation_tokens: 10_000 };
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-haiku-5-5', usage }), 0.1 * 1.25 * 0.01);
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-haiku-5-5', usage, cacheTtl: '1h' }), 0.1 * 2 * 0.01);
});

test('above 100,000 uncached input tokens the upper tier price applies', () => {
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-haiku-5-5', usage: { input_tokens: 200_000, output_tokens: 0 } }), 0.5 * 0.2);
});

test('a model with a date suffix uses the price of its base', () => {
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-haiku-5-5-20261001', usage: { input_tokens: 50_000, output_tokens: 0 } }), 0.1 * 0.05);
});

test('transcription: 0.04 USD per hour of audio', () => {
  close(estimateCostUsd({ provider: 'groq-speech', model: 'whisper-large-v3-turbo', usage: { audio_seconds: 1800 } }), 0.02);
});

test('a model without a declared price is an unknown cost (null), never zero nor that of another model', () => {
  assert.equal(estimateCostUsd({ provider: 'deepseek', model: 'deepseek-flash', usage: { input_tokens: 1000, output_tokens: 1000 } }), null);
  assert.equal(estimateCostUsd({ provider: 'fake', model: 'fake-model', usage: { input_tokens: 1000, output_tokens: 1000 } }), null);
  assert.equal(estimateCostUsd({ provider: 'anthropic', model: 'claude-haiku-5-5', usage: undefined }), null);
});

test('Sonnet 5.5: 2 USD input, 10 output, 0.10 cache read, cache write 1.25 and 2 times the input, no long-prompt tier', () => {
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-sonnet-5-5', usage: { input_tokens: 1000, output_tokens: 200, cached_tokens: 5000 } }), (1000 * 2 + 200 * 10 + 5000 * 0.1) / 1e6);
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-sonnet-5-5', usage: { input_tokens: 0, cache_creation_tokens: 10_000 } }), (10_000 * 2 * 1.25) / 1e6);
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-sonnet-5-5', cacheTtl: '1h', usage: { input_tokens: 0, cache_creation_tokens: 10_000 } }), (10_000 * 2 * 2) / 1e6);
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-sonnet-5-5', usage: { input_tokens: 500_000, output_tokens: 0, cached_tokens: 100_000 } }), (500_000 * 2 + 100_000 * 0.1) / 1e6);
});

test('Opus 5.5 (4 and 20 USD, cache read 0.20) and Fable 5.1 (10 and 50, cache read 0.25): the models an area can run with (UD-295)', () => {
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 200, cached_tokens: 5000 } }), (1000 * 4 + 200 * 20 + 5000 * 0.2) / 1e6);
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-fable-5-1', usage: { input_tokens: 1000, output_tokens: 200, cached_tokens: 5000 } }), (1000 * 10 + 200 * 50 + 5000 * 0.25) / 1e6);
  close(estimateCostUsd({ provider: 'anthropic', model: 'claude-fable-5-1', usage: { input_tokens: 0, cache_creation_tokens: 10_000 } }), (10_000 * 12.5) / 1e6);
});

test('the startup notice lists the available functions whose model has no price', () => {
  const slots = [
    { slot: 'text', provider: 'anthropic', model: 'claude-sonnet-5-5', available: true },
    { slot: 'vision', provider: 'deepseek', model: 'deepseek-flash', available: true },
    { slot: 'speech', provider: 'groq-speech', model: 'whisper-large-v3-turbo', available: true },
    { slot: 'text_fallback', provider: 'anthropic', model: 'claude-opus-4-8', available: false },
  ];
  assert.deepEqual(unpricedSlots(slots).map((s) => s.slot), ['vision']);
});

// Measured 2026-10-25: the session of message 119 (job 165) ran with `claude-haiku-5-5`, its three subagents with the same model. The transcript
// adds 6.30M cache reads, 144k 5-minute and 52k 1-hour cache writes and 85k output; the CLI reported 4.0957 USD (costBasis «unknown», its fallback rate) and
// the columns showed only the session's own turns. Local, CLI 2.1.284: `claude -p --model claude-haiku-5-5` prints «costBasis: "unknown"» for that model.
describe('costOfModelUsage: the cost of a run with subagents', () => {
  const usage = { 'claude-haiku-5-5': { inputTokens: 334, outputTokens: 84734, cacheReadInputTokens: 6302596, cacheCreationInputTokens: 196404, costUSD: 4.0957, costBasis: 'unknown' } };

  it('adds every model\'s tokens and prices an unknown basis with the table, not with the CLI fallback', () => {
    const c = costOfModelUsage(usage);
    assert.equal(c.tokens.cache_read, 6302596);
    assert.equal(c.tokens.input, 334 + 6302596 + 196404);
    assert.ok(c.cost_usd < 1, `Haiku 5.5 at its table price is cents, got ${c.cost_usd}`);
    assert.ok(c.cost_min_usd < c.cost_usd, 'the tier bounds are kept apart');
    assert.equal(c.models[0].cli_cost_usd, 4.0957);
    assert.equal(c.models[0].source, 'table_bounds');
    assert.equal(costOfResult({ modelUsage: usage, total_cost_usd: 4.0957 }), c.cost_usd);
  });

  it('keeps the CLI figure when it priced the model from the list, or the model has no price here', () => {
    const listed = { 'claude-haiku-5-5': { ...usage['claude-haiku-5-5'], costBasis: 'list' } };
    assert.equal(costOfModelUsage(listed).cost_usd, 4.0957);
    const other = { 'claude-x-9': { ...usage['claude-haiku-5-5'], costBasis: 'unknown' } };
    assert.equal(costOfModelUsage(other).cost_usd, 4.0957);
  });

  it('without token counts it has nothing to say and the CLI total stands', () => {
    assert.equal(costOfModelUsage({ 'claude-sonnet-5-5': {} }), null);
    assert.equal(costOfResult({ modelUsage: { 'claude-sonnet-5-5': {} }, total_cost_usd: 1.2345 }), 1.2345);
  });
});
