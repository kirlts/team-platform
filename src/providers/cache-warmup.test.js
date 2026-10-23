import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createCacheWarmup, prefixKey } from './cache-warmup.js';
import { createAnthropicClient } from './anthropic.js';
import { createLimiter } from './limiter.js';

const tick = (ms = 5) => new Promise((resolve) => { setTimeout(resolve, ms); });

describe('prefixKey', () => {
  it('ignores the messages and max_tokens, not the schema', () => {
    const base = { model: 'm', system: [{ type: 'text', text: 'a' }], output_config: { format: { schema: { a: 1 } } } };
    assert.equal(prefixKey({ ...base, messages: [1], max_tokens: 5 }), prefixKey({ ...base, messages: [2], max_tokens: 9 }));
    assert.notEqual(prefixKey(base), prefixKey({ ...base, output_config: { format: { schema: { a: 2 } } } }));
  });
});

describe('cache warm-up', () => {
  it('the first call leads, the others wait for it to start and then go', async () => {
    let clock = 0;
    const w = createCacheWarmup({ now: () => clock });
    const lead = await w.enter('k');
    assert.equal(lead.role, 'leader');
    const order = [];
    const follower = w.enter('k').then((t) => { order.push(t.role); return t; });
    await tick();
    assert.deepEqual(order, []);
    lead.started(60_000);
    assert.equal((await follower).role, 'follower');
    lead.finish();
    assert.equal((await w.enter('k')).role, 'warm');
    clock = 60_001;
    assert.equal((await w.enter('k')).role, 'leader');
  });

  it('a leader that fails releases the followers and nothing stays warm', async () => {
    const w = createCacheWarmup();
    const lead = await w.enter('k');
    const follower = w.enter('k');
    lead.finish();
    assert.equal((await follower).role, 'follower');
    assert.equal((await w.enter('k')).role, 'leader');
  });

  it('a follower stops waiting after maxWaitMs or when the job aborts', async () => {
    const w = createCacheWarmup({ maxWaitMs: 20 });
    await w.enter('k');
    const t0 = Date.now();
    assert.equal((await w.enter('k')).role, 'follower');
    assert.ok(Date.now() - t0 < 500);
    const ac = new AbortController();
    const waiting = w.enter('k', { signal: ac.signal, maxWaitMs: 60_000 });
    ac.abort();
    assert.equal((await waiting).role, 'follower');
  });
});

describe('anthropic client with the warm-up', () => {
  it('four parallel calls: one streams, three leave after its message_start and are not stream requests', async () => {
    const seen = [];
    let startedAt = null;
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const body = JSON.parse(raw);
        seen.push({ stream: body.stream === true, at: Date.now() });
        const usage = { input_tokens: 5, output_tokens: 1, cache_creation_input_tokens: body.stream ? 800 : 0, cache_read_input_tokens: body.stream ? 0 : 800 };
        if (body.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'm', model: 'claude-sonnet-5-5', role: 'assistant', content: [], usage } })}\n\n`);
          startedAt = Date.now();
          setTimeout(() => {
            res.write(`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`);
            res.write(`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\\"ok\\":"}}\n\n`);
            res.write(`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"true}"}}\n\n`);
            res.write(`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n`);
            res.end(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
          }, 150);
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'm', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn', usage }));
        }
      });
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    try {
      const client = createAnthropicClient({
        apiKey: 'sk-test-0123456789', model: 'claude-sonnet-5-5', baseUrl: `http://127.0.0.1:${server.address().port}`,
        limiter: createLimiter({ name: 'anthropic', max: 0 }), warmup: createCacheWarmup(),
      });
      const req = { system: ['x'.repeat(2000)], messages: [{ role: 'user', content: 'hola' }], schema: { type: 'object' } };
      const results = await Promise.all([1, 2, 3, 4].map(() => client.complete(req)));
      assert.deepEqual(results.map((r) => r.json), Array(4).fill({ ok: true }));
      assert.equal(seen.filter((s) => s.stream).length, 1);
      const leaderResult = results.find((r) => r.usage.cache_creation_tokens > 0);
      assert.equal(leaderResult.usage.output_tokens, 7);
      assert.equal(leaderResult.stop_reason, 'end_turn');
      assert.equal(results.filter((r) => r.usage.cached_tokens === 800).length, 3);
      for (const s of seen.filter((x) => !x.stream)) assert.ok(s.at >= startedAt, 'a follower leaves after the leader started');
    } finally {
      server.close();
    }
  });

  it('a system prompt below the cacheable minimum is not held back', async () => {
    const seen = [];
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        seen.push(JSON.parse(raw).stream === true);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} }));
      });
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    try {
      const client = createAnthropicClient({ apiKey: 'sk-test-0123456789', baseUrl: `http://127.0.0.1:${server.address().port}`, limiter: createLimiter({ name: 'anthropic', max: 0 }), warmup: createCacheWarmup() });
      await Promise.all([1, 2].map(() => client.complete({ system: ['corto'], messages: [{ role: 'user', content: 'hola' }] })));
      assert.deepEqual(seen, [false, false]);
    } finally {
      server.close();
    }
  });
});
