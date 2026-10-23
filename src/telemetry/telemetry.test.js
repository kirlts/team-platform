// Telemetry tests (MASTER-SPEC §7.10 bis, UD-014, TEST.md HP-001 and HP-002).
// Each test uses a SQLite database in an ephemeral file and starts and closes its own SDK.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { writeFile } from 'node:fs/promises';
import { metrics } from '@opentelemetry/api';
import { createFakeProviders, ProviderRefusalError } from '../providers/index.js';
import { createGroqSpeechClient } from '../providers/groq-speech.js';
import { extract } from '../extract/index.js';
import { makeImage, makeTmp } from '../extract/test/helpers.js';
import { initTelemetry, traceOfJob, withSpan, withToolSpan, pruneSpans } from './index.js';
import { CONTENT_EVENT } from './api.js';
import { makeDb, readSpans } from './test/helpers.js';

const tmp = await makeTmp('telemetria');
after(() => tmp.cleanup());

/** Starts telemetry on a fresh database; `end()` flushes, closes the SDK and deletes the database. */
function start(env = {}) {
  const store = makeDb();
  const telemetry = initTelemetry({ db: store.db, env });
  return {
    ...store,
    telemetry,
    async end() {
      await telemetry.shutdown();
      store.cleanup();
    },
  };
}

const eventsOf = (span, name) => span.events.filter((e) => e.name === name);

test('a call to the fake provider leaves a span with gen_ai.usage.* and the full input and output content', async () => {
  const t = start();
  try {
    const providers = createFakeProviders({
      text: [{ json: { ok: true }, usage: { input_tokens: 120, output_tokens: 30, cached_tokens: 50 }, stop_reason: 'end_turn' }],
    });
    await withSpan('analyze', { 'team.job_id': '9', 'team.step': 'analyze' }, () =>
      providers.text.complete({
        system: ['Eres un clasificador.'],
        messages: [{ role: 'user', content: 'Se cae el login en Safari' }],
        schema: { type: 'object' },
        effort: 'low',
      }),
    );
    await t.telemetry.flush();

    const [call] = readSpans(t.db, "name LIKE 'chat %'");
    assert.equal(call.kind, 'CLIENT');
    assert.equal(call.attributes['gen_ai.operation.name'], 'chat');
    assert.equal(call.attributes['gen_ai.provider.name'], 'fake');
    assert.equal(call.attributes['gen_ai.request.model'], 'fake-model');
    // The convention counts the cache within input_tokens: 120 uncached + 50 read.
    assert.equal(call.attributes['gen_ai.usage.input_tokens'], 170);
    assert.equal(call.attributes['gen_ai.usage.output_tokens'], 30);
    assert.equal(call.attributes['gen_ai.usage.cache_read.input_tokens'], 50);
    assert.deepEqual(call.attributes['gen_ai.response.finish_reasons'], ['end_turn']);
    assert.equal(call.attributes['team.job_id'], '9', 'the child span inherits the job of its parent');

    const [content] = eventsOf(call, CONTENT_EVENT);
    assert.ok(content, 'the content event exists');
    const input = JSON.parse(content.attributes['gen_ai.input.messages']);
    assert.deepEqual(input, [{ role: 'user', parts: [{ type: 'text', content: 'Se cae el login en Safari' }] }]);
    assert.deepEqual(JSON.parse(content.attributes['gen_ai.system_instructions']), [{ type: 'text', content: 'Eres un clasificador.' }]);
    const output = JSON.parse(content.attributes['gen_ai.output.messages']);
    assert.equal(output[0].role, 'assistant');
    assert.deepEqual(JSON.parse(output[0].parts[0].content), { ok: true });
    assert.equal(content.attributes['team.request.schema'], JSON.stringify({ type: 'object' }));
  } finally {
    await t.end();
  }
});

test('HP-002: the llm_calls view returns the MASTER-SPEC §7.2 columns', async () => {
  const t = start();
  try {
    const providers = createFakeProviders({
      name: 'anthropic',
      model: 'claude-haiku-5-5',
      text: [{ json: { a: 1 }, usage: { input_tokens: 1000, output_tokens: 200, cached_tokens: 4000 } }],
      vision: [{ json: { description: 'una captura' }, usage: { input_tokens: 300, output_tokens: 40, cached_tokens: 0 } }],
    });
    await withSpan('job', { 'team.job_id': '3' }, async () => {
      await providers.text.complete({ messages: [{ role: 'user', content: 'hola' }] });
      await providers.vision.describe({ images: [{ data: Buffer.from('png'), mime: 'image/png' }], prompt: 'describe' });
    });
    await t.telemetry.flush();

    const columns = Object.keys(t.db.prepare('SELECT * FROM llm_calls').get());
    for (const column of ['id', 'job_id', 'provider', 'model', 'modality', 'input_tokens', 'output_tokens', 'cached_tokens', 'cost_usd', 'duration_ms', 'at']) {
      assert.ok(columns.includes(column), `missing column ${column}`);
    }
    const rows = t.db.prepare('SELECT * FROM llm_calls ORDER BY at, id').all();
    assert.equal(rows.length, 2, 'the job span is not a call');
    const text = rows.find((r) => r.modality === 'text');
    assert.equal(text.job_id, '3');
    assert.equal(text.provider, 'anthropic');
    assert.equal(text.model, 'claude-haiku-5-5');
    assert.equal(text.input_tokens, 5000);
    assert.equal(text.cached_tokens, 4000);
    assert.equal(text.output_tokens, 200);
    // (1000 × 0.10 + 4000 × 0.01 + 200 × 0.50) / 1,000,000 USD, prices from MASTER-SPEC §3.
    assert.ok(Math.abs(text.cost_usd - 0.00024) < 1e-12, `cost ${text.cost_usd}`);
    assert.ok(text.duration_ms >= 0 && Number.isInteger(text.duration_ms));
    assert.ok(Math.abs(text.at - Date.now()) < 60_000);
    assert.equal(rows.find((r) => r.modality === 'vision').output_tokens, 40);
  } finally {
    await t.end();
  }
});

test('a typed provider error is left as the span status, with the tokens it had already spent', async () => {
  const t = start();
  try {
    const refusal = new ProviderRefusalError('rechazado', {
      provider: 'fake',
      model: 'fake-model',
      usage: { input_tokens: 80, output_tokens: 0, cached_tokens: 0 },
      category: 'policy',
      explanation: 'no corresponde',
    });
    const providers = createFakeProviders({ text: [refusal] });
    await assert.rejects(providers.text.complete({ messages: [{ role: 'user', content: 'x' }] }), (e) => e === refusal);
    await t.telemetry.flush();

    const [call] = readSpans(t.db, "name LIKE 'chat %'");
    assert.equal(call.status, 'error');
    assert.equal(call.attributes['error.type'], 'refusal');
    assert.equal(call.attributes['gen_ai.usage.input_tokens'], 80);
    const [content] = eventsOf(call, CONTENT_EVENT);
    assert.equal(content.attributes['team.error.category'], 'policy');
    assert.equal(content.attributes['team.error.explanation'], 'no corresponde');
    assert.ok(eventsOf(call, 'exception').length === 1, 'the error is left as an exception event');
    assert.equal(t.db.prepare("SELECT status FROM llm_calls").get().status, 'error');
  } finally {
    await t.end();
  }
});

test('transcription leaves a span with the full transcription and the seconds of audio', async () => {
  const t = start();
  try {
    const audio = tmp.join('voz.flac');
    await writeFile(audio, Buffer.alloc(2048));
    const fetchImpl = async () =>
      new Response(JSON.stringify({ text: 'hola equipo', language: 'es', duration: 7.5, segments: [{ start: 0, end: 7.5, text: ' hola equipo ' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const speech = createGroqSpeechClient({ apiKey: 'no-es-una-llave', fetchImpl });
    await withSpan('job', { 'team.job_id': '5' }, () => speech.transcribe({ audioPath: audio }));
    await t.telemetry.flush();

    const [call] = readSpans(t.db, "name LIKE 'transcription %'");
    assert.equal(call.attributes['gen_ai.operation.name'], 'transcription');
    assert.equal(call.attributes['team.modality'], 'speech');
    assert.equal(call.attributes['team.audio_seconds'], 7.5);
    assert.equal(call.attributes['team.input_bytes'], 2048);
    // 7.5 s at 0.04 USD per hour (MASTER-SPEC §3).
    assert.ok(Math.abs(call.attributes['team.cost_usd'] - (7.5 / 3600) * 0.04) < 1e-12);
    const [content] = eventsOf(call, CONTENT_EVENT);
    assert.equal(JSON.parse(content.attributes['gen_ai.output.messages'])[0].parts[0].content, 'hola equipo');
    assert.equal(JSON.parse(content.attributes['team.response.segments'])[0].text, 'hola equipo');
    assert.match(JSON.parse(content.attributes['gen_ai.input.messages'])[0].parts[0].uri, /voz\.flac$/);
  } finally {
    await t.end();
  }
});

test('an extractor leaves its tree: attachment, sharp step, vision step and the provider call', async () => {
  const t = start();
  try {
    const path = await makeImage(tmp.join('captura.png'));
    const providers = createFakeProviders({ vision: [{ json: { description: 'pantalla de error' }, usage: { input_tokens: 10, output_tokens: 3, cached_tokens: 0 } }] });
    await withSpan('job', { 'team.job_id': '11', 'team.step': 'job' }, () =>
      extract({ id: 4, input_id: 2, kind: 'image', path, mime: 'image/png', size: 1234 }, { providers }),
    );
    await t.telemetry.flush();

    const trace = traceOfJob(t.db, 11);
    assert.equal(trace.roots.length, 1);
    const [job] = trace.roots;
    const [attachment] = job.children;
    assert.equal(attachment.name, 'extract.attachment');
    assert.equal(attachment.attributes['team.attachment_kind'], 'image');
    assert.equal(attachment.attributes['team.input_id'], 2);
    assert.equal(attachment.attributes['team.input_bytes'], 1234);
    assert.equal(attachment.attributes['team.output_chars'], 'pantalla de error'.length);
    assert.deepEqual(attachment.children.map((c) => c.name), ['extract.sharp', 'extract.vision']);
    const [sharp, vision] = attachment.children;
    assert.ok(sharp.attributes['team.output_bytes'] > 0);
    assert.equal(sharp.attributes['team.width'], 320);
    assert.equal(vision.attributes['team.images'], 1);
    assert.equal(vision.children[0].attributes['gen_ai.operation.name'], 'chat');
    assert.equal(vision.children[0].attributes['team.modality'], 'vision');
    // The image travels in the content event, in base64 (TELEMETRY_INLINE_BLOBS by default).
    const input = JSON.parse(vision.children[0].events[0].attributes['gen_ai.input.messages']);
    assert.equal(input[0].parts[0].type, 'blob');
    assert.ok(input[0].parts[0].content.length > 0);
    assert.equal(trace.totals.llm_calls, 1);
    assert.equal(trace.totals.input_tokens, 10);
  } finally {
    await t.end();
  }
});

test('with TELEMETRY_INLINE_BLOBS=0 the image keeps its size and loses its bytes', async () => {
  const t = start({ TELEMETRY_INLINE_BLOBS: '0' });
  try {
    const providers = createFakeProviders({ vision: [{ json: {} }] });
    await providers.vision.describe({ images: [{ data: Buffer.from('0123456789'), mime: 'image/png' }], prompt: 'describe' });
    await t.telemetry.flush();
    const [call] = readSpans(t.db, "name LIKE 'chat %'");
    const part = JSON.parse(eventsOf(call, CONTENT_EVENT)[0].attributes['gen_ai.input.messages'])[0].parts[0];
    assert.deepEqual({ type: part.type, size: part.size_bytes, content: part.content }, { type: 'blob', size: 10, content: null });
  } finally {
    await t.end();
  }
});

test('a text document leaves the step with its tool and the input and output sizes', async () => {
  const t = start();
  try {
    const path = tmp.join('notas.txt');
    await writeFile(path, 'uno\ndos\ntres');
    await withSpan('job', { 'team.job_id': '12' }, () => extract({ id: 1, kind: 'document', path, mime: 'text/plain', size: 12 }, {}));
    await t.telemetry.flush();
    const [attachment] = traceOfJob(t.db, 12).roots[0].children;
    const [step] = attachment.children;
    assert.equal(step.name, 'extract.text');
    assert.equal(step.attributes['team.tool'], 'text');
    assert.equal(step.attributes['team.input_bytes'], 12);
    assert.equal(step.attributes['team.output_chars'], 'uno\ndos\ntres'.length);
  } finally {
    await t.end();
  }
});

test('an extractor that fails leaves the typed error on the attachment span', async () => {
  const t = start();
  try {
    const path = tmp.join('roto.png');
    await writeFile(path, 'no es una imagen');
    await withSpan('job', { 'team.job_id': '13' }, () =>
      extract({ id: 1, kind: 'image', path, mime: 'image/png', size: 16 }, { providers: { vision: { describe: async () => ({}) } } }).catch(() => {}),
    );
    await t.telemetry.flush();
    const [attachment] = traceOfJob(t.db, 13).roots[0].children;
    assert.equal(attachment.status, 'error');
    assert.equal(attachment.attributes['error.type'], 'image_unreadable');
    assert.equal(attachment.children[0].status, 'error');
  } finally {
    await t.end();
  }
});

test('traceOfJob builds the tree by parent, sorts by start and returns null if the job does not exist', async () => {
  const t = start();
  try {
    await withSpan('job', { 'team.job_id': '21' }, async () => {
      await withSpan('a', { 'team.step': 'a' }, () => withSpan('a1', {}, () => 1));
      await withSpan('b', { 'team.step': 'b' }, () => 2);
    });
    await withSpan('otro', { 'team.job_id': '22' }, () => 3);
    await t.telemetry.flush();
    const trace = traceOfJob(t.db, 21);
    assert.equal(trace.span_count, 4);
    assert.equal(trace.roots.length, 1);
    assert.deepEqual(trace.roots[0].children.map((c) => c.name), ['a', 'b']);
    assert.equal(trace.roots[0].children[0].children[0].name, 'a1');
    assert.equal(trace.roots[0].children[0].children[0].attributes['team.job_id'], '21');
    assert.match(trace.roots[0].start_ns, /^\d{19}$/, 'nanoseconds travel as exact text');
    assert.equal(traceOfJob(t.db, 999), null);
  } finally {
    await t.end();
  }
});

test('withSpan supports synchronous and asynchronous functions and propagates the error with its type', async () => {
  const t = start();
  try {
    assert.equal(withSpan('sync', {}, () => 7), 7);
    assert.equal(await withSpan('async', {}, async () => 8), 8);
    assert.throws(() => withSpan('falla', {}, () => { throw Object.assign(new Error('mal'), { code: 'mi_codigo' }); }), /mal/);
    await assert.rejects(withSpan('rechaza', {}, async () => { throw new TypeError('x'); }), TypeError);
    await withToolSpan('claude', { 'team.job_id': '1' }, () => 1);
    await t.telemetry.flush();
    const byName = Object.fromEntries(readSpans(t.db).map((s) => [s.name, s]));
    assert.equal(byName.sync.status, 'unset');
    assert.equal(byName.falla.status, 'error');
    assert.equal(byName.falla.attributes['error.type'], 'mi_codigo');
    assert.equal(byName.rechaza.attributes['error.type'], 'TypeError');
    assert.equal(byName['execute_tool claude'].attributes['gen_ai.tool.name'], 'claude');
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM llm_calls').get().n, 0, 'a tool is not a model call');
  } finally {
    await t.end();
  }
});

test('nanoseconds are stored without losing precision', async () => {
  const t = start();
  try {
    await withSpan('p', {}, () => 1);
    await t.telemetry.flush();
    const row = t.db.prepare('SELECT CAST(start_ns AS TEXT) AS s, CAST(end_ns AS TEXT) AS e, end_ns - start_ns AS d FROM spans').get();
    assert.ok(BigInt(row.e) - BigInt(row.s) === BigInt(row.d));
    assert.ok(BigInt(row.s) > 1_700_000_000_000_000_000n);
  } finally {
    await t.end();
  }
});

test('pruneSpans deletes what is older than the retention and keeps what is recent', async () => {
  const t = start();
  try {
    await withSpan('reciente', {}, () => 1);
    await t.telemetry.flush();
    const day = 86_400_000;
    assert.equal(pruneSpans(t.db, { now: Date.now() }), 0);
    assert.equal(pruneSpans(t.db, { now: Date.now() + 8 * day }), 1);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM spans').get().n, 0);
  } finally {
    await t.end();
  }
});

// ---------------------------------------------------------------------------------------------
// HP-001: no connection goes out without a configured collector

/** Records each `Socket.connect` while `fn` runs. */
async function recordingConnections(fn) {
  const attempts = [];
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function patched(...args) {
    // Node calls `connect` with loose options or with the normalized list `[options, callback]`.
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    attempts.push(typeof options === 'object' && options !== null ? `${options.host ?? ''}:${options.port ?? options.path ?? ''}` : String(options));
    return original.apply(this, args);
  };
  try {
    await fn();
  } finally {
    net.Socket.prototype.connect = original;
  }
  return attempts;
}

test('HP-001: without OTEL_EXPORTER_OTLP_ENDPOINT no connection goes out, neither on start, nor on measuring, nor on close', async () => {
  const saved = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('OTEL_')) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  }
  // Short interval so that a default metrics reader, if there were one, opens its connection within the test.
  process.env.OTEL_METRIC_EXPORT_INTERVAL = '20';
  const attempts = await recordingConnections(async () => {
    const t = start(); // empty env
    try {
      assert.equal(t.telemetry.otlp, false);
      metrics.getMeter('prueba').createCounter('llamadas').add(1);
      const providers = createFakeProviders({ text: [{ json: {} }] });
      await withSpan('job', { 'team.job_id': '1' }, () => providers.text.complete({ messages: [{ role: 'user', content: 'x' }] }));
      await t.telemetry.flush();
      // A periodic metrics reader or a default log exporter would open their
      // connection in the first cycle; one loop cycle is allowed to pass to catch them.
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      await t.end();
    }
  });
  delete process.env.OTEL_METRIC_EXPORT_INTERVAL;
  Object.assign(process.env, saved);
  assert.deepEqual(attempts, []);
});

test('with OTEL_EXPORTER_OTLP_ENDPOINT the spans go out over OTLP/HTTP in addition to being stored in SQLite', async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const attempts = await recordingConnections(async () => {
      const t = start({ OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`, OTEL_EXPORTER_OTLP_HEADERS: 'x-prueba=1' });
      try {
        assert.equal(t.telemetry.otlp, true);
        await withSpan('hacia-el-colector', { 'team.job_id': '2' }, () => 1);
        await t.telemetry.flush();
        assert.equal(readSpans(t.db, "name = 'hacia-el-colector'").length, 1, 'it also ended up in SQLite');
      } finally {
        await t.end();
      }
    });
    assert.ok(attempts.some((a) => a.includes(`${port}`)), `connections: ${attempts.join(' | ')}`);
    assert.equal(received.length, 1);
    assert.equal(received[0].url, '/v1/traces');
    assert.equal(received[0].headers['x-prueba'], '1');
    assert.match(received[0].body, /hacia-el-colector/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------------------------
// The exporter does not block the event loop

test('the SQLite exporter writes in slices and yields the loop between them', async () => {
  const t = start();
  try {
    const exporter = t.telemetry.sqlite;
    const slicesBefore = exporter.slices;
    const spans = [];
    // 200 spans with 20 KB of content each, like a model call with a document.
    for (let i = 0; i < 200; i++) {
      await withSpan(`carga-${i}`, { 'team.job_id': '77', 'team.blob': 'x'.repeat(20_000) }, () => 1);
    }
    await t.telemetry.flush();
    spans.push(...readSpans(t.db, "name LIKE 'carga-%'"));
    assert.equal(spans.length, 200);

    // A batch of 160 spans with slices of 16: ten slices and nine loop yields.
    let ticks = 0;
    let running = true;
    const ticker = (async () => {
      while (running) {
        await new Promise((resolve) => setImmediate(resolve));
        ticks += 1;
      }
    })();
    const batch = spans.slice(0, 160).map((s) => ({
      ...fakeReadable(s, 'otra'),
    }));
    const slicesStart = exporter.slices;
    await new Promise((resolve) => exporter.export(batch, resolve));
    running = false;
    await ticker;
    assert.equal(exporter.slices - slicesStart, 10);
    assert.ok(ticks >= 9, `the loop ran ${ticks} times during the write`);
    assert.ok(slicesBefore >= 0);
  } finally {
    await t.end();
  }
});

test('the exporter restores synchronous=FULL on the connection and joins an open core transaction', async () => {
  const t = start();
  try {
    const synchronous = () => t.db.prepare('PRAGMA synchronous').get().synchronous;
    const FULL = 2; // sqlite.org/pragma.html
    assert.equal(synchronous(), FULL);
    await withSpan('uno', {}, () => 1);
    await t.telemetry.flush();
    assert.equal(synchronous(), FULL, 'the setting of the core connection is left as it was');

    // With a core transaction open, the rows go into it and are undone with it.
    t.db.exec('BEGIN IMMEDIATE');
    await withSpan('dentro', {}, () => 1);
    await t.telemetry.flush();
    assert.ok(t.db.isTransaction);
    t.db.exec('ROLLBACK');
    assert.deepEqual(t.db.prepare('SELECT name FROM spans').all().map((r) => r.name), ['uno']);
  } finally {
    await t.end();
  }
});

/** A finished span in the shape the SDK hands to the exporter, with a different identifier. */
function fakeReadable(row, suffix) {
  const hr = (ns) => [Number(BigInt(ns) / 1_000_000_000n), Number(BigInt(ns) % 1_000_000_000n)];
  return {
    name: `${row.name}-${suffix}`,
    kind: 0,
    spanContext: () => ({ traceId: row.trace_id, spanId: `${row.span_id.slice(0, 12)}${String(Math.random()).slice(2, 6)}` }),
    parentSpanContext: undefined,
    startTime: hr(row.start_ns),
    endTime: hr(row.end_ns),
    status: { code: 0 },
    attributes: row.attributes,
    events: [],
  };
}

test('a write failure does not reach the application: the batch is lost and the exporter carries on', async () => {
  const t = start();
  try {
    t.db.exec('DROP VIEW llm_calls');
    t.db.exec('DROP TABLE spans');
    await withSpan('sin-tabla', {}, () => 1); // does not throw
    await t.telemetry.flush();
    t.db.exec(
      'CREATE TABLE spans (trace_id TEXT, span_id TEXT, parent_id TEXT, name TEXT, kind TEXT, start_ns INTEGER, end_ns INTEGER, status TEXT, status_message TEXT, attributes_json TEXT, events_json TEXT, links_json TEXT)',
    );
    await withSpan('con-tabla', {}, () => 1);
    await t.telemetry.flush();
    assert.deepEqual(t.db.prepare('SELECT name FROM spans').all().map((r) => r.name), ['con-tabla']);
  } finally {
    await t.end();
  }
});
