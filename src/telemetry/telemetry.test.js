// Pruebas de la telemetría (MASTER-SPEC §7.10 bis, UD-014, TEST.md HP-001 y HP-002).
// Cada prueba usa una base SQLite en archivo efímero y arranca y cierra su propio SDK.
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

/** Arranca la telemetría sobre una base nueva; `end()` vacía, cierra el SDK y borra la base. */
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

test('una llamada al proveedor falso deja un span con gen_ai.usage.* y el contenido completo de entrada y salida', async () => {
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
    // La convención cuenta la caché dentro de input_tokens: 120 sin caché + 50 leídos.
    assert.equal(call.attributes['gen_ai.usage.input_tokens'], 170);
    assert.equal(call.attributes['gen_ai.usage.output_tokens'], 30);
    assert.equal(call.attributes['gen_ai.usage.cache_read.input_tokens'], 50);
    assert.deepEqual(call.attributes['gen_ai.response.finish_reasons'], ['end_turn']);
    assert.equal(call.attributes['team.job_id'], '9', 'el span hijo hereda el trabajo de su padre');

    const [content] = eventsOf(call, CONTENT_EVENT);
    assert.ok(content, 'el evento de contenido existe');
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

test('HP-002: la vista llm_calls devuelve las columnas de MASTER-SPEC §7.2', async () => {
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
      assert.ok(columns.includes(column), `falta la columna ${column}`);
    }
    const rows = t.db.prepare('SELECT * FROM llm_calls ORDER BY at, id').all();
    assert.equal(rows.length, 2, 'el span del trabajo no es una llamada');
    const text = rows.find((r) => r.modality === 'text');
    assert.equal(text.job_id, '3');
    assert.equal(text.provider, 'anthropic');
    assert.equal(text.model, 'claude-haiku-5-5');
    assert.equal(text.input_tokens, 5000);
    assert.equal(text.cached_tokens, 4000);
    assert.equal(text.output_tokens, 200);
    // (1000 × 0,10 + 4000 × 0,01 + 200 × 0,50) / 1.000.000 USD, precios de MASTER-SPEC §3.
    assert.ok(Math.abs(text.cost_usd - 0.00024) < 1e-12, `costo ${text.cost_usd}`);
    assert.ok(text.duration_ms >= 0 && Number.isInteger(text.duration_ms));
    assert.ok(Math.abs(text.at - Date.now()) < 60_000);
    assert.equal(rows.find((r) => r.modality === 'vision').output_tokens, 40);
  } finally {
    await t.end();
  }
});

test('un error tipado del proveedor queda como estado del span, con los tokens que ya había gastado', async () => {
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
    assert.ok(eventsOf(call, 'exception').length === 1, 'el error queda como evento exception');
    assert.equal(t.db.prepare("SELECT status FROM llm_calls").get().status, 'error');
  } finally {
    await t.end();
  }
});

test('la transcripción deja un span con la transcripción completa y los segundos de audio', async () => {
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
    // 7,5 s a 0,04 USD por hora (MASTER-SPEC §3).
    assert.ok(Math.abs(call.attributes['team.cost_usd'] - (7.5 / 3600) * 0.04) < 1e-12);
    const [content] = eventsOf(call, CONTENT_EVENT);
    assert.equal(JSON.parse(content.attributes['gen_ai.output.messages'])[0].parts[0].content, 'hola equipo');
    assert.equal(JSON.parse(content.attributes['team.response.segments'])[0].text, 'hola equipo');
    assert.match(JSON.parse(content.attributes['gen_ai.input.messages'])[0].parts[0].uri, /voz\.flac$/);
  } finally {
    await t.end();
  }
});

test('un extractor deja su árbol: adjunto, paso de sharp, paso de visión y la llamada al proveedor', async () => {
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
    // La imagen viaja en el evento de contenido, en base64 (TELEMETRY_INLINE_BLOBS por omisión).
    const input = JSON.parse(vision.children[0].events[0].attributes['gen_ai.input.messages']);
    assert.equal(input[0].parts[0].type, 'blob');
    assert.ok(input[0].parts[0].content.length > 0);
    assert.equal(trace.totals.llm_calls, 1);
    assert.equal(trace.totals.input_tokens, 10);
  } finally {
    await t.end();
  }
});

test('con TELEMETRY_INLINE_BLOBS=0 la imagen queda con su tamaño y sin los bytes', async () => {
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

test('un documento de texto deja el paso con su herramienta y los tamaños de entrada y salida', async () => {
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

test('un extractor que falla deja el error tipado en el span del adjunto', async () => {
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

test('traceOfJob arma el árbol por padre, ordena por inicio y devuelve null si el trabajo no existe', async () => {
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
    assert.match(trace.roots[0].start_ns, /^\d{19}$/, 'los nanosegundos viajan como texto exacto');
    assert.equal(traceOfJob(t.db, 999), null);
  } finally {
    await t.end();
  }
});

test('withSpan admite funciones síncronas y asíncronas y propaga el error con su tipo', async () => {
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
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM llm_calls').get().n, 0, 'una herramienta no es una llamada a un modelo');
  } finally {
    await t.end();
  }
});

test('los nanosegundos se guardan sin perder precisión', async () => {
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

test('pruneSpans borra lo anterior a la retención y conserva lo reciente', async () => {
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
// HP-001: ninguna conexión sale sin colector configurado

/** Registra cada `Socket.connect` mientras corre `fn`. */
async function recordingConnections(fn) {
  const attempts = [];
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function patched(...args) {
    // Node llama a `connect` con las opciones sueltas o con la lista normalizada `[opciones, callback]`.
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

test('HP-001: sin OTEL_EXPORTER_OTLP_ENDPOINT ninguna conexión sale, ni al iniciar, ni al medir, ni al cerrar', async () => {
  const saved = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('OTEL_')) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  }
  // Intervalo corto para que un lector de métricas por omisión, de existir, abra su conexión dentro de la prueba.
  process.env.OTEL_METRIC_EXPORT_INTERVAL = '20';
  const attempts = await recordingConnections(async () => {
    const t = start(); // env vacío
    try {
      assert.equal(t.telemetry.otlp, false);
      metrics.getMeter('prueba').createCounter('llamadas').add(1);
      const providers = createFakeProviders({ text: [{ json: {} }] });
      await withSpan('job', { 'team.job_id': '1' }, () => providers.text.complete({ messages: [{ role: 'user', content: 'x' }] }));
      await t.telemetry.flush();
      // Un lector de métricas periódico o un exportador de registros por omisión abrirían su
      // conexión en el primer ciclo; se deja pasar un ciclo del bucle para atraparlos.
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      await t.end();
    }
  });
  delete process.env.OTEL_METRIC_EXPORT_INTERVAL;
  Object.assign(process.env, saved);
  assert.deepEqual(attempts, []);
});

test('con OTEL_EXPORTER_OTLP_ENDPOINT los spans salen por OTLP/HTTP además de guardarse en SQLite', async () => {
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
        assert.equal(readSpans(t.db, "name = 'hacia-el-colector'").length, 1, 'también quedó en SQLite');
      } finally {
        await t.end();
      }
    });
    assert.ok(attempts.some((a) => a.includes(`${port}`)), `conexiones: ${attempts.join(' | ')}`);
    assert.equal(received.length, 1);
    assert.equal(received[0].url, '/v1/traces');
    assert.equal(received[0].headers['x-prueba'], '1');
    assert.match(received[0].body, /hacia-el-colector/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------------------------
// El exportador no bloquea el bucle de eventos

test('el exportador a SQLite escribe por tajadas y cede el bucle entre una y otra', async () => {
  const t = start();
  try {
    const exporter = t.telemetry.sqlite;
    const slicesBefore = exporter.slices;
    const spans = [];
    // 200 spans con 20 KB de contenido cada uno, como una llamada a un modelo con un documento.
    for (let i = 0; i < 200; i++) {
      await withSpan(`carga-${i}`, { 'team.job_id': '77', 'team.blob': 'x'.repeat(20_000) }, () => 1);
    }
    await t.telemetry.flush();
    spans.push(...readSpans(t.db, "name LIKE 'carga-%'"));
    assert.equal(spans.length, 200);

    // Un lote de 160 spans con tajadas de 16: diez tajadas y nueve cesiones del bucle.
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
    assert.ok(ticks >= 9, `el bucle corrió ${ticks} veces durante la escritura`);
    assert.ok(slicesBefore >= 0);
  } finally {
    await t.end();
  }
});

test('el exportador restaura synchronous=FULL de la conexión y se suma a una transacción abierta del núcleo', async () => {
  const t = start();
  try {
    const synchronous = () => t.db.prepare('PRAGMA synchronous').get().synchronous;
    const FULL = 2; // sqlite.org/pragma.html
    assert.equal(synchronous(), FULL);
    await withSpan('uno', {}, () => 1);
    await t.telemetry.flush();
    assert.equal(synchronous(), FULL, 'el ajuste de la conexión del núcleo queda como estaba');

    // Con una transacción del núcleo abierta, las filas entran en ella y se deshacen con ella.
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

/** Un span terminado con la forma que el SDK entrega al exportador, con otro identificador. */
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

test('un fallo de escritura no llega a la aplicación: el lote se pierde y el exportador sigue', async () => {
  const t = start();
  try {
    t.db.exec('DROP VIEW llm_calls');
    t.db.exec('DROP TABLE spans');
    await withSpan('sin-tabla', {}, () => 1); // no lanza
    await t.telemetry.flush();
    t.db.exec(
      'CREATE TABLE spans (trace_id TEXT, span_id TEXT, parent_id TEXT, name TEXT, kind TEXT, start_ns INTEGER, end_ns INTEGER, status TEXT, status_message TEXT, attributes_json TEXT, events_json TEXT)',
    );
    await withSpan('con-tabla', {}, () => 1);
    await t.telemetry.flush();
    assert.deepEqual(t.db.prepare('SELECT name FROM spans').all().map((r) => r.name), ['con-tabla']);
  } finally {
    await t.end();
  }
});
