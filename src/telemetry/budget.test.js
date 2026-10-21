// Byte budget of the span queues (HALLAZGOS H-40).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import { createFakeProviders } from '../providers/index.js';
import { initTelemetry } from './index.js';
import { recordGenAiCall, TRACER_NAME, withSpan } from './api.js';
import { spanBytes } from './budget.js';
import { DEFAULTS, queueBudgetFromEnv } from './config.js';
import { makeDb, readSpans } from './test/helpers.js';

const MiB = 1024 * 1024;

/** Telemetry on a fresh database; `end()` flushes, closes the SDK and deletes the database. */
function start(env = {}) {
  const store = makeDb('presupuesto');
  const telemetry = initTelemetry({ db: store.db, env: { TELEMETRY_FLUSH_MS: '600000', ...env } }); // the batch timer never fires in a test
  return { ...store, telemetry, async end() { await telemetry.shutdown(); store.cleanup(); } };
}

// Spans that end in the same tick: the early flush is scheduled with setImmediate and cannot run between them.
const endBigSpansNow = (count, bytes) => {
  const tracer = trace.getTracer(TRACER_NAME);
  for (let i = 0; i < count; i++) tracer.startSpan(`grande-${i}`, { attributes: { 'team.blob': 'x'.repeat(bytes) } }).end();
};

const waitFor = async (condition, what, timeoutMs = 10_000) => {
  const cap = Date.now() + timeoutMs;
  while (!condition()) {
    assert.ok(Date.now() < cap, `timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test('the defaults come from the measured span of a 48-frame call, and the hard cap leaves room for the largest request', () => {
  assert.equal(DEFAULTS.queueMaxBytes, 4 * MiB);
  assert.deepEqual(queueBudgetFromEnv({}), { softBytes: 4 * MiB, hardBytes: 4 * MiB + 32 * MiB });
  // 3,653,672 B measured in span-size.bench.mjs: it fits under the soft threshold, a second one does not.
  assert.ok(3_653_672 < DEFAULTS.queueMaxBytes && 2 * 3_653_672 > DEFAULTS.queueMaxBytes);
  assert.deepEqual(queueBudgetFromEnv({ TELEMETRY_QUEUE_MAX_BYTES: '1000' }), { softBytes: 1000, hardBytes: 1000 + 32 * MiB });
  assert.deepEqual(queueBudgetFromEnv({ TELEMETRY_QUEUE_MAX_BYTES: '1000', TELEMETRY_QUEUE_HARD_BYTES: '5000' }), { softBytes: 1000, hardBytes: 5000 });
  // A hard cap under the soft one makes no sense; nonsense values fall back to the defaults.
  assert.equal(queueBudgetFromEnv({ TELEMETRY_QUEUE_MAX_BYTES: '9000', TELEMETRY_QUEUE_HARD_BYTES: '10' }).hardBytes, 9000);
  assert.deepEqual(queueBudgetFromEnv({ TELEMETRY_QUEUE_MAX_BYTES: 'abc', TELEMETRY_QUEUE_HARD_BYTES: '-4' }), queueBudgetFromEnv({}));
});

test('the estimate of a span is within 1 % of what is stored for a call with video frames', async () => {
  const t = start();
  try {
    const frames = Array.from({ length: 48 }, (_, i) => ({ data: randomBytes(57_500), mime: 'image/jpeg', label: `Frame ${i + 1}` }));
    const providers = createFakeProviders({ vision: [{ json: { frames: [] }, usage: { input_tokens: 70_000, output_tokens: 100 } }] });
    await providers.vision.describe({ images: frames, prompt: 'describe' });
    await t.telemetry.flush();
    const row = t.db.prepare("SELECT length(attributes_json) AS a, length(events_json) AS e FROM spans WHERE name LIKE 'chat %'").get();
    const [span] = readSpans(t.db, "name LIKE 'chat %'");
    const estimated = spanBytes({ name: span.name, attributes: span.attributes, status: {}, events: span.events });
    const stored = row.a + row.e;
    assert.ok(stored > 3.5 * MiB, `a 48-frame span is large: ${stored}`);
    assert.ok(Math.abs(estimated - stored) / stored < 0.01, `estimated ${estimated}, stored ${stored}`);
  } finally {
    await t.end();
  }
});

test('over the soft threshold the queue is flushed at once, without waiting for the batch timer', async () => {
  const t = start({ TELEMETRY_QUEUE_MAX_BYTES: String(MiB) });
  try {
    const count = () => t.db.prepare("SELECT count(*) AS n FROM spans WHERE name LIKE 'grande-%'").get().n;
    endBigSpansNow(1, 600_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(count(), 0, 'under the threshold the span waits for the timer (10 minutes in this test)');
    assert.equal(t.telemetry.budget().forcedFlushes, 0);
    endBigSpansNow(1, 600_000); // 1.2 MB queued, over the 1 MiB threshold
    await waitFor(() => count() === 2, 'the early flush');
    assert.equal(t.telemetry.budget().forcedFlushes, 1);
    await waitFor(() => t.telemetry.budget().queuedBytes === 0, 'the queue to empty');
    assert.ok(t.telemetry.budget().peakBytes >= 1_200_000);
  } finally {
    await t.end();
  }
});

test('over the hard cap a call keeps the size of its blobs and loses their content, and says so', async () => {
  const t = start({ TELEMETRY_QUEUE_MAX_BYTES: String(MiB), TELEMETRY_QUEUE_HARD_BYTES: String(2 * MiB) });
  try {
    const call = (label) => withSpan(label, {}, async (span) => {
      recordGenAiCall(span, {
        provider: 'fake', model: 'm', modality: 'vision',
        request: { images: [{ data: Buffer.alloc(100_000, 1), mime: 'image/png' }, { data: Buffer.alloc(50_000, 2), mime: 'image/png' }], prompt: 'describe' },
        response: { text: 'ok' }, usage: { input_tokens: 1, output_tokens: 1 },
      });
    });
    // Three big spans end in one tick: 3 x 0.9 MB queued, over the 2 MiB hard cap, flush not yet run.
    endBigSpansNow(3, 900_000);
    await call('bajo-presion');
    // The same call once the queue is empty keeps its blobs.
    await t.telemetry.flush();
    await waitFor(() => t.telemetry.budget().queuedBytes === 0, 'the queue to empty');
    await call('sin-presion');
    await t.telemetry.flush();

    const parts = (name) => {
      const [span] = readSpans(t.db, `name = '${name}'`);
      const event = span.events.find((e) => e.name === 'gen_ai.client.inference.operation.details');
      return { span, parts: JSON.parse(event.attributes['gen_ai.input.messages'])[0].parts.filter((p) => p.type === 'blob') };
    };
    const pressed = parts('bajo-presion');
    assert.deepEqual(pressed.parts.map((p) => [p.size_bytes, p.content]), [[100_000, null], [50_000, null]]);
    assert.equal(pressed.span.attributes['team.telemetry.blobs_dropped'], 2);
    const free = parts('sin-presion');
    assert.ok(free.parts.every((p) => typeof p.content === 'string' && p.content.length > 0), 'without backlog the blobs are kept');
    assert.equal(free.span.attributes['team.telemetry.blobs_dropped'], undefined);
    assert.equal(t.telemetry.budget().blobsDropped, 2);
  } finally {
    await t.end();
  }
});

test('TELEMETRY_INLINE_BLOBS=0 is a choice, not a loss: it does not count as dropped blobs', async () => {
  const t = start({ TELEMETRY_INLINE_BLOBS: '0' });
  try {
    await withSpan('sin-blobs', {}, async (span) => {
      recordGenAiCall(span, { provider: 'fake', model: 'm', request: { images: [{ data: Buffer.alloc(10), mime: 'image/png' }], prompt: 'p' }, response: { text: 'ok' } });
    });
    await t.telemetry.flush();
    assert.equal(t.telemetry.budget().blobsDropped, 0);
    assert.equal(readSpans(t.db, "name = 'sin-blobs'")[0].attributes['team.telemetry.blobs_dropped'], undefined);
  } finally {
    await t.end();
  }
});
