// Hunt for the failures of the providers (2026-10-24): a response that is cut, empty or slow, reproduced against a raw HTTP server that
// breaks the connection where a real network does. The rule they share: every way a call ends is a typed provider error, retryable or not,
// never a bare network exception that the retries and the person's message do not know.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createAnthropicClient } from './anthropic.js';
import { ProviderHttpError, ProviderTimeoutError } from './errors.js';
import { postRequest } from './http.js';
import { runInJobScope } from './limiter.js';

const SCHEMA = { type: 'object', properties: { area_id: { type: 'integer' } }, required: ['area_id'], additionalProperties: false };

describe('providers: a response that does not arrive whole', () => {
  let server;
  let url;
  let behave;
  before(async () => {
    server = createServer((req, res) => { req.resume(); behave(req, res); });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { server.closeAllConnections(); server.close(); });

  const post = (extra = {}) => postRequest(`${url}/v1/messages`, { headers: { 'content-type': 'application/json' }, body: '{}', provider: 'anthropic', model: 'm', ...extra });

  it('a connection that breaks while the body arrives is a retryable provider error, not a bare «terminated»', async () => {
    behave = (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '1000' });
      res.write('{"content":[');
      setTimeout(() => res.destroy(), 20);
    };
    const error = await post().catch((e) => e);
    assert.ok(error instanceof ProviderHttpError, `${error?.constructor?.name}: ${error?.message}`);
    assert.equal(error.retryable, true, 'a cut response clears up on the next try');
    assert.match(error.message, /anthropic: fallo de red/);
  });

  it('a body that stalls past the deadline is a provider timeout, not a bare TimeoutError', async () => {
    behave = (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"content":[');
    };
    const error = await post({ timeoutMs: 150 }).catch((e) => e);
    assert.ok(error instanceof ProviderTimeoutError, `${error?.constructor?.name}: ${error?.message}`);
    assert.match(error.message, /anthropic: la llamada superó 150 ms/);
  });

  it('a 200 with an empty body or a page that is not JSON is a retryable failure of the transport, not an invalid answer of the model', async () => {
    for (const body of ['', '<html><body>502 Bad Gateway</body></html>']) {
      behave = (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(body); };
      const error = await post().catch((e) => e);
      assert.ok(error instanceof ProviderHttpError, `«${body}» gave ${error?.constructor?.name}`);
      assert.equal(error.retryable, true);
      assert.equal(error.status, 200);
    }
    // and through the client: it is the HTTP retries of the analyzer that clear it, not the single retry of an invalid output
    behave = (req, res) => { res.writeHead(200); res.end(''); };
    const client = createAnthropicClient({ apiKey: 'clave-de-prueba', baseUrl: url, cacheWarmup: false });
    const error = await client.complete({ messages: [{ role: 'user', content: 'hola' }], schema: SCHEMA }).catch((e) => e);
    assert.equal(error.code, 'http');
  });
});

describe('providers: an error status whose body does not arrive', () => {
  let server;
  let url;
  before(async () => {
    server = createServer((req, res) => {
      req.resume();
      res.writeHead(429, { 'content-length': '500', 'retry-after': '7' });
      res.write('{"error":');
      setTimeout(() => res.destroy(), 20);
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { server.closeAllConnections(); server.close(); });

  it('keeps its status and its Retry-After: the wait the provider asked for is not lost with the body', async () => {
    const error = await postRequest(`${url}/v1/messages`, { headers: {}, body: '{}', provider: 'anthropic', model: 'm' }).catch((e) => e);
    assert.ok(error instanceof ProviderHttpError, `${error?.constructor?.name}: ${error?.message}`);
    assert.deepEqual([error.status, error.retryable, error.retryAfterMs], [429, true, 7000]);
  });
});

describe('providers: a call in flight when its job ends', () => {
  let server;
  let url;
  const closed = [];
  before(async () => {
    server = createServer((req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' }); // answers its headers and never its body
      res.write('{"content":[');
      res.on('close', () => closed.push(Date.now()));
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { server.closeAllConnections(); server.close(); });

  it('a shutdown or a cancellation takes the request with it: it ends at once, as an abort and not as a provider failure to retry', { timeout: 5000 }, async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort('shutdown'), 40);
    const started = Date.now();
    const error = await runInJobScope({ jobId: 7, signal: controller.signal }, () => postRequest(`${url}/v1/messages`, { headers: {}, body: '{}', provider: 'anthropic', model: 'm' })).catch((e) => e);
    assert.equal(error.code, 'aborted', `${error?.constructor?.name}: ${error?.message}`);
    assert.ok(!(error instanceof ProviderHttpError) && !(error instanceof ProviderTimeoutError));
    assert.ok(Date.now() - started < 1000, `${Date.now() - started} ms`);
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    assert.equal(closed.length, 1, 'the connection was closed, so the provider stops generating');
  });
});

describe('providers: an account with nothing left', () => {
  let server;
  let url;
  let answer;
  before(async () => {
    server = createServer((req, res) => { req.resume(); res.writeHead(answer.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(answer.body)); });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { server.closeAllConnections(); server.close(); });
  const call = () => postRequest(`${url}/chat/completions`, { headers: {}, body: '{}', provider: 'deepseek', model: 'm' }).catch((e) => e);

  it('a 429 that says the quota is spent does not clear by waiting: it is not retried, and says so; a rate limit still is', async () => {
    answer = { status: 429, body: { error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'You exceeded your current quota' } } };
    const spent = await call();
    assert.deepEqual([spent.status, spent.retryable, spent.quota], [429, false, true]);
    answer = { status: 429, body: { error: { type: 'rate_limit_error', message: 'rate' } } };
    const limited = await call();
    assert.deepEqual([limited.status, limited.retryable, limited.quota], [429, true, false]);
    answer = { status: 402, body: { error: { message: 'Insufficient Balance' } } };
    assert.deepEqual([(await call()).retryable, (await call()).quota], [false, true]);
  });
});
