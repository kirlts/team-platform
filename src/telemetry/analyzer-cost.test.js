// The cost of every model call reaches the `llm_calls` view: the real Anthropic client against a local server with
// known usage, so the path measured is client → withGenAiCall → span attribute → view (prices: pricing.js).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { all } from '../db/index.js';
import { createAnthropicClient } from '../providers/anthropic.js';
import { createLimiter } from '../providers/limiter.js';
import { makeEnv } from '../testing/helpers.js';
import { withGenAiCall, withSpan } from './api.js';
import { traceOfJob } from './trace.js';

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 2000 };

describe('cost of the analyzer calls in llm_calls', () => {
  let env;
  let server;
  let baseUrl;
  before(async () => {
    env = await makeEnv({ telemetry: true });
    server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'm', content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn', usage: USAGE }));
      });
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { server.close(); env.close?.(); });

  const client = (model) => createAnthropicClient({ apiKey: 'sk-test-0123456789', model, baseUrl, limiter: createLimiter({ name: 'anthropic', max: 0 }), warmup: false, cacheTtl: '5m' });
  const rows = async (jobId) => {
    await env.telemetry.flush();
    return all(env.db, 'SELECT model, modality, input_tokens, output_tokens, cached_tokens, cost_usd FROM llm_calls WHERE job_id = ? ORDER BY at', jobId);
  };

  it('text and vision with Sonnet 5.5 record the estimated cost of the known tokens; a model without a price stays null', async () => {
    await withSpan('analyze', { 'team.job_id': '9001' }, async () => {
      await client('claude-sonnet-5-5').complete({ system: ['s'], messages: [{ role: 'user', content: 'hola' }] });
      await client('claude-sonnet-5-5').describe({ images: [{ mediaType: 'image/png', data: 'AAAA' }], prompt: 'describe' });
      await client('claude-opus-4-8').complete({ system: ['s'], messages: [{ role: 'user', content: 'hola' }] });
    });
    const calls = await rows('9001');
    assert.deepEqual(calls.map((c) => [c.model, c.modality]), [['claude-sonnet-5-5', 'text'], ['claude-sonnet-5-5', 'vision'], ['claude-opus-4-8', 'text']]);
    // Sonnet 5.5 (2 USD in, 10 out, 0.10 cache read, 2.50 cache write at 5 minutes, per million): pricing page read on 2026-10-24.
    const expected = (1000 * 2 + 5000 * 0.1 + 2000 * 2.5 + 200 * 10) / 1e6;
    assert.ok(Math.abs(calls[0].cost_usd - expected) < 1e-12, `${calls[0].cost_usd} ≠ ${expected}`);
    assert.ok(Math.abs(calls[1].cost_usd - expected) < 1e-12);
    assert.equal(calls[0].input_tokens, 8000);
    assert.equal(calls[2].cost_usd, null);
    const totals = traceOfJob(env.db, 9001).totals;
    assert.ok(Math.abs(totals.cost_usd - 2 * expected) < 1e-12);
    assert.equal(totals.unpriced_calls, 1);
  });

  it('transcription records the cost by audio hour; a job with no priced call has an unknown total, not zero', async () => {
    await withSpan('extract', { 'team.job_id': '9002' }, async () => {
      await withGenAiCall({ provider: 'groq-speech', model: 'whisper-large-v3-turbo', modality: 'speech', operation: 'transcription', request: { audioPath: '/x.ogg' } }, async () => ({ text: 'x', usage: { audio_seconds: 3600 } }));
    });
    const [call] = await rows('9002');
    assert.ok(Math.abs(call.cost_usd - 0.04) < 1e-12);

    await withSpan('analyze', { 'team.job_id': '9003' }, async () => {
      await client('claude-opus-4-8').complete({ system: ['s'], messages: [{ role: 'user', content: 'hola' }] });
    });
    await env.telemetry.flush();
    const totals = traceOfJob(env.db, 9003).totals;
    assert.equal(totals.cost_usd, null);
    assert.equal(totals.unpriced_calls, 1);
  });
});
