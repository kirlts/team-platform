// Tests of the Anthropic provider against a local HTTP server: the request that goes out
// over the network is checked, not a simulation of the client.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createAnthropicClient } from './anthropic.js';
import {
  ProviderConfigError, ProviderHttpError, ProviderMaxTokensError, ProviderOutputError, ProviderRefusalError,
} from './errors.js';
import { startLocalServer } from './local-server.js';

const SCHEMA = {
  type: 'object',
  properties: { area_id: { type: 'integer' } },
  required: ['area_id'],
  additionalProperties: false,
};

function okMessage(extra = {}) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '{"area_id": 3}' }],
    usage: { input_tokens: 120, output_tokens: 9, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 },
    ...extra,
  };
}

describe('anthropic', () => {
  let server;
  let reply;
  before(async () => {
    server = await startLocalServer(() => reply());
  });
  after(() => server.close());

  const client = (extra = {}) => createAnthropicClient({ apiKey: 'clave-de-prueba', baseUrl: server.url, ...extra });
  const last = () => server.requests.at(-1);

  it('sends a request without sampling parameters, with schema, effort and cache on the system prompt', async () => {
    reply = () => ({ body: okMessage() });
    const out = await client().complete({
      system: ['Instrucciones estables', 'Catálogo de áreas'],
      messages: [{ role: 'user', content: 'hola' }],
      schema: SCHEMA,
      effort: 'low',
    });
    const req = last();
    assert.equal(req.url, '/v1/messages');
    assert.equal(req.headers['x-api-key'], 'clave-de-prueba');
    assert.equal(req.headers['anthropic-version'], '2023-06-01');
    const b = req.json;
    assert.equal(b.model, 'claude-haiku-5-5');
    assert.equal(b.max_tokens, 16_000);
    for (const k of ['temperature', 'top_p', 'top_k']) assert.ok(!(k in b), `${k} must not be sent`);
    assert.deepEqual(b.output_config, { format: { type: 'json_schema', schema: SCHEMA }, effort: 'low' });
    assert.equal(b.system.length, 2);
    assert.ok(!('cache_control' in b.system[0]));
    assert.deepEqual(b.system[1].cache_control, { type: 'ephemeral' });
    assert.deepEqual(b.messages, [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }]);
    assert.ok(!('thinking' in b));

    assert.deepEqual(out.json, { area_id: 3 });
    assert.deepEqual(out.usage, { input_tokens: 120, output_tokens: 9, cached_tokens: 400, cache_creation_tokens: 0 });
    assert.equal(out.provider, 'anthropic');
    assert.equal(out.model, 'claude-haiku-5-5');
    assert.equal(typeof out.duration_ms, 'number');
  });

  it('without a schema it returns text and does not send output_config', async () => {
    reply = () => ({ body: okMessage({ content: [{ type: 'text', text: 'listo' }] }) });
    const out = await client().complete({ messages: [{ role: 'user', content: 'x' }] });
    assert.equal(out.text, 'listo');
    assert.ok(!('json' in out));
    assert.ok(!('output_config' in last().json));
    assert.ok(!('system' in last().json));
  });

  it('with the one-hour cache the cache point carries ttl', async () => {
    reply = () => ({ body: okMessage() });
    await client({ cacheTtl: '1h' }).complete({ system: 'A', messages: [{ role: 'user', content: 'x' }], schema: SCHEMA });
    assert.deepEqual(last().json.system[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  });

  it('the cache TTL can be given on each call', async () => {
    reply = () => ({ body: okMessage() });
    await client().complete({ system: 'A', messages: [{ role: 'user', content: 'x' }], schema: SCHEMA, cacheTtl: '1h' });
    assert.deepEqual(last().json.system[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  });

  it('with thinking off it adds the JSON output line', async () => {
    reply = () => ({ body: okMessage() });
    await client({ thinking: 'disabled' }).complete({ system: 'A', messages: [{ role: 'user', content: 'x' }], schema: SCHEMA, effort: 'low' });
    const b = last().json;
    assert.deepEqual(b.thinking, { type: 'disabled' });
    assert.match(b.system.at(-1).text, /applies to your final answer only/);
  });

  it('thinking off can be requested in a single call', async () => {
    reply = () => ({ body: okMessage() });
    await client().complete({ system: 'A', messages: [{ role: 'user', content: 'x' }], schema: SCHEMA, thinking: 'disabled' });
    assert.deepEqual(last().json.thinking, { type: 'disabled' });
    await client().complete({ system: 'A', messages: [{ role: 'user', content: 'x' }], schema: SCHEMA });
    assert.ok(!('thinking' in last().json));
  });

  it('sends images and PDF as image and document blocks in base64', async () => {
    reply = () => ({ body: okMessage({ content: [{ type: 'text', text: '{"area_id":1}' }] }) });
    await client().describe({
      images: [
        { mime: 'image/png', data: Buffer.from('PNG'), label: 'fotograma 3' },
        { mime: 'application/pdf', data: Buffer.from('%PDF').toString('base64') },
      ],
      prompt: 'describe',
      schema: SCHEMA,
    });
    const content = last().json.messages[0].content;
    assert.deepEqual(content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from('PNG').toString('base64') } });
    assert.deepEqual(content[1], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF').toString('base64') } });
    assert.deepEqual(content[2], { type: 'text', text: 'describe' });
  });

  it('a refusal is a typed error with its category and its tokens', async () => {
    reply = () => ({ body: okMessage({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' }, content: [] }) });
    await assert.rejects(
      client().complete({ messages: [{ role: 'user', content: 'x' }], schema: SCHEMA }),
      (err) => err instanceof ProviderRefusalError && err.code === 'refusal' && err.category === 'cyber' && err.usage.input_tokens === 120,
    );
  });

  it('a max_tokens cut-off is a typed error', async () => {
    reply = () => ({ body: okMessage({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"area' }] }) });
    await assert.rejects(
      client().complete({ messages: [{ role: 'user', content: 'x' }], schema: SCHEMA, maxTokens: 32_000 }),
      (err) => err instanceof ProviderMaxTokensError && err.maxTokens === 32_000,
    );
    assert.equal(last().json.max_tokens, 32_000);
  });

  it('an output that is not JSON is ProviderOutputError', async () => {
    reply = () => ({ body: okMessage({ content: [{ type: 'text', text: 'no soy json' }] }) });
    await assert.rejects(
      client().complete({ messages: [{ role: 'user', content: 'x' }], schema: SCHEMA }),
      (err) => err instanceof ProviderOutputError && err.raw === 'no soy json',
    );
  });

  it('a 429 is a retryable ProviderHttpError with Retry-After', async () => {
    reply = () => ({ status: 429, headers: { 'retry-after': '7' }, body: { type: 'error', error: { type: 'rate_limit_error', message: 'demasiadas' } } });
    await assert.rejects(
      client().complete({ messages: [{ role: 'user', content: 'x' }] }),
      (err) => err instanceof ProviderHttpError && err.status === 429 && err.retryable && err.retryAfterMs === 7000 && /demasiadas/.test(err.message),
    );
  });

  it('a 400 is not retryable', async () => {
    reply = () => ({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Schema is too complex for compilation' } } });
    await assert.rejects(
      client().complete({ messages: [{ role: 'user', content: 'x' }], schema: SCHEMA }),
      (err) => err instanceof ProviderHttpError && err.status === 400 && !err.retryable,
    );
  });

  it('rejects a malformed call before going out to the network', async () => {
    const before = server.requests.length;
    await assert.rejects(client().complete({ messages: [] }), ProviderConfigError);
    await assert.rejects(client().complete({ messages: [{ role: 'user', content: 'x' }], effort: 'enorme' }), ProviderConfigError);
    assert.equal(server.requests.length, before);
  });

  it('it cannot be created without a key', () => {
    assert.throws(() => createAnthropicClient({}), ProviderConfigError);
  });
});
