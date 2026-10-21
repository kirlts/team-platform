import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProviderHttpError } from './errors.js';
import { createAnthropicClient } from './anthropic.js';
import { createFakeProviders } from './fake.js';
import { createLimiter, isConcurrencyCapError, limiterFor, maxFor, PROVIDER_LIMIT_DEFAULTS, runInJobScope } from './limiter.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const cap429 = () => new ProviderHttpError('anthropic: concurrent requests', { status: 429, retryable: true, retryAfterMs: null });

describe('limiter: cap', () => {
  it('never lets more than max requests run at once and grants waiters in FIFO order inside a job', async () => {
    const limiter = createLimiter({ name: 't', max: 2 });
    const order = [];
    let running = 0;
    let peak = 0;
    const work = (id) => limiter.run(async () => {
      order.push(id);
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
    }, { jobId: 'a' });
    await Promise.all([1, 2, 3, 4, 5].map(work));
    assert.equal(peak, 2);
    assert.deepEqual(order, [1, 2, 3, 4, 5]);
    assert.equal(limiter.stats().inflight, 0);
  });

  it('max 0 means no limit and no AIMD', async () => {
    const limiter = createLimiter({ name: 't', max: 0 });
    const slots = await Promise.all(Array.from({ length: 50 }, () => limiter.acquire()));
    assert.equal(limiter.stats().inflight, 50);
    assert.equal(limiter.congested(cap429()), false);
    slots.forEach((s) => s.release());
  });
});

describe('limiter: fairness across jobs', () => {
  it('a job with many waiters cannot starve a job that arrives later (round-robin by job)', async () => {
    const limiter = createLimiter({ name: 't', max: 1 });
    const holder = await limiter.acquire({ jobId: 'x' });
    const granted = [];
    const wait = (jobId, n) => limiter.acquire({ jobId }).then((slot) => { granted.push(`${jobId}${n}`); return slot; });
    const pending = [wait('big', 1), wait('big', 2), wait('big', 3), wait('big', 4), wait('small', 1), wait('small', 2)];
    holder.release();
    // Each grant is released as soon as it is taken, so the next one in the rotation gets the slot.
    for (const p of pending) p.then((slot) => slot.release());
    await Promise.all(pending);
    assert.deepEqual(granted, ['big1', 'small1', 'big2', 'small2', 'big3', 'big4']);
  });

  it('takes the job from the worker scope when the caller does not name it', async () => {
    const limiter = createLimiter({ name: 't', max: 1 });
    const holder = await limiter.acquire();
    const granted = [];
    const wait = (jobId, n) => runInJobScope({ jobId, signal: null }, () => limiter.acquire().then((slot) => { granted.push(`${jobId}${n}`); slot.release(); }));
    const all = [wait(1, 'a'), wait(1, 'b'), wait(2, 'a')];
    holder.release();
    await Promise.all(all);
    assert.deepEqual(granted, ['1a', '2a', '1b']);
  });
});

describe('limiter: cancellation and release', () => {
  it('a waiter leaves the queue when the signal of its job fires, and does not take a slot', async () => {
    const limiter = createLimiter({ name: 't', max: 1 });
    const holder = await limiter.acquire();
    const controller = new AbortController();
    const waiter = limiter.acquire({ jobId: 'j', signal: controller.signal });
    const other = limiter.acquire({ jobId: 'k' });
    assert.equal(limiter.stats().waiting, 2);
    controller.abort('lost');
    await assert.rejects(waiter, (error) => error.name === 'AbortError' && error.code === 'aborted');
    assert.equal(limiter.stats().waiting, 1);
    holder.release();
    (await other).release();
    assert.deepEqual([limiter.stats().inflight, limiter.stats().waiting], [0, 0]);
  });

  it('an already aborted signal is refused without queueing, and the scope signal is honored', async () => {
    const limiter = createLimiter({ name: 't', max: 1 });
    const controller = new AbortController();
    controller.abort(new Error('shutdown'));
    await assert.rejects(limiter.acquire({ signal: controller.signal }), /shutdown/);
    const holder = await limiter.acquire();
    const scoped = new AbortController();
    const waiter = runInJobScope({ jobId: 'j', signal: scoped.signal }, () => limiter.acquire());
    scoped.abort('timeout');
    await assert.rejects(waiter, /aborted \(timeout\)/);
    holder.release();
  });

  it('releases the slot when the work throws, and release is idempotent', async () => {
    const limiter = createLimiter({ name: 't', max: 1 });
    await assert.rejects(limiter.run(async () => { throw new Error('boom'); }), /boom/);
    assert.equal(limiter.stats().inflight, 0);
    const slot = await limiter.acquire();
    slot.release();
    slot.release();
    assert.equal(limiter.stats().inflight, 0);
    (await limiter.acquire()).release();
  });
});

describe('limiter: AIMD', () => {
  const clock = () => {
    const state = { t: 0 };
    return { now: () => state.t, advance: (ms) => { state.t += ms; } };
  };

  it('a 429 without Retry-After lowers the cap by one, once per cooldown window, and gives it back one request per step', () => {
    const c = clock();
    const events = [];
    const limiter = createLimiter({ name: 't', max: 4, cooldownMs: 1000, restoreStepMs: 500, now: c.now, logger: { warn: (detail, message) => events.push({ detail, message }) } });
    assert.equal(limiter.stats().effective, 4);
    assert.equal(limiter.congested(cap429()), true);
    assert.equal(limiter.stats().effective, 3);
    // The requests in flight fail together: the second 429 of the same window does not cut again.
    assert.equal(limiter.congested(cap429()), false);
    assert.equal(limiter.stats().effective, 3);
    c.advance(999);
    assert.equal(limiter.stats().effective, 3);
    c.advance(1 + 500); // cooldown over, one step
    assert.equal(limiter.stats().effective, 4);
    // A new 429 after the recovery cuts again.
    c.advance(10_000);
    limiter.congested(cap429());
    limiter.congested(cap429());
    assert.equal(limiter.stats().effective, 3);
    c.advance(1000);
    limiter.congested(cap429());
    assert.equal(limiter.stats().effective, 2);
    assert.equal(events.length, 3);
    assert.match(events[0].message, /effective cap 4 -> 3/);
    assert.equal(events[0].detail.provider, 't');
  });

  it('never goes below one and the cut-back queues new requests behind the lower cap', async () => {
    const c = clock();
    const limiter = createLimiter({ name: 't', max: 2, cooldownMs: 100, restoreStepMs: 100, now: c.now });
    limiter.congested(cap429());
    c.advance(100);
    limiter.congested(cap429());
    c.advance(100);
    limiter.congested(cap429());
    assert.equal(limiter.stats().effective, 1);
    const a = await limiter.acquire();
    let second = false;
    const pending = limiter.acquire().then((slot) => { second = true; return slot; });
    await tick();
    assert.equal(second, false);
    a.release();
    (await pending).release();
  });

  it('only a 429 without Retry-After counts', () => {
    assert.equal(isConcurrencyCapError(cap429()), true);
    assert.equal(isConcurrencyCapError(new ProviderHttpError('x', { status: 429, retryAfterMs: 2000 })), false);
    assert.equal(isConcurrencyCapError(new ProviderHttpError('x', { status: 500 })), false);
    assert.equal(isConcurrencyCapError(new Error('x')), false);
  });

  it('the fake provider returning 429 lowers the cap of its limiter and the other calls still finish', async () => {
    const c = clock();
    const limiter = createLimiter({ name: 'fake', max: 3, cooldownMs: 1000, restoreStepMs: 1000, now: c.now });
    const fake = createFakeProviders({ limiter, text: (req, n) => (n === 0 ? cap429() : { json: { n } }) });
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => fake.text.complete({ messages: [{ role: 'user', content: 'x' }] })));
    assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
    assert.equal(limiter.stats().effective, 2);
    assert.equal(limiter.stats().inflight, 0);
    c.advance(1000 + 1000);
    assert.equal(limiter.stats().effective, 3);
  });
});

describe('limiter: registry and defaults', () => {
  it('one limiter per provider, Groq text and speech share the Groq one, and a new cap reaches the shared limiter', () => {
    const a = limiterFor('anthropic', { ...PROVIDER_LIMIT_DEFAULTS });
    assert.equal(limiterFor('anthropic'), a);
    assert.equal(limiterFor('groq-speech'), limiterFor('groq'));
    assert.notEqual(limiterFor('deepseek'), a);
    limiterFor('anthropic', { ...PROVIDER_LIMIT_DEFAULTS, anthropic: 3 });
    assert.equal(a.stats().max, 3);
    limiterFor('anthropic', { ...PROVIDER_LIMIT_DEFAULTS });
    assert.equal(a.stats().max, PROVIDER_LIMIT_DEFAULTS.anthropic);
    assert.equal(maxFor('deepseek'), PROVIDER_LIMIT_DEFAULTS.openaiCompatible);
  });
});

describe('limiter: real clients', () => {
  const okResponse = () => new Response(JSON.stringify({ model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });

  it('the Anthropic client takes a slot before fetch and never has more requests out than the cap', async () => {
    const limiter = createLimiter({ name: 'anthropic', max: 2 });
    let out = 0;
    let peak = 0;
    const fetchImpl = async () => {
      out += 1;
      peak = Math.max(peak, out);
      await tick();
      out -= 1;
      return okResponse();
    };
    const client = createAnthropicClient({ apiKey: 'k', fetchImpl, limiter });
    await Promise.all(Array.from({ length: 6 }, () => client.complete({ messages: [{ role: 'user', content: 'x' }] })));
    assert.equal(peak, 2);
    assert.deepEqual([limiter.stats().granted, limiter.stats().inflight], [6, 0]);
  });

  it('an HTTP 429 without Retry-After lowers the cap and releases the slot; one with Retry-After does not lower it', async () => {
    const limiter = createLimiter({ name: 'anthropic', max: 3 });
    const responses = [
      new Response('{"error":{"message":"Number of concurrent requests"}}', { status: 429 }),
      new Response('{"error":{"message":"slow down"}}', { status: 429, headers: { 'retry-after': '2' } }),
    ];
    const client = createAnthropicClient({ apiKey: 'k', fetchImpl: async () => responses.shift(), limiter });
    const req = { messages: [{ role: 'user', content: 'x' }] };
    await assert.rejects(client.complete(req), (error) => error.status === 429 && error.retryAfterMs === null);
    assert.equal(limiter.stats().effective, 2);
    assert.equal(limiter.stats().inflight, 0);
    await assert.rejects(client.complete(req), (error) => error.retryAfterMs === 2000);
    assert.equal(limiter.stats().effective, 2);
    assert.equal(limiter.stats().cut_backs, 1);
  });
});
