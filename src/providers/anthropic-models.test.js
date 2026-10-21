// H-1100: for every model in the table, the request the provider builds is valid according to the table
// (the documented 400s are checked on the request that really goes over the network to a local server).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createAnthropicClient } from './anthropic.js';
import { MODEL_CAPABILITIES, MODEL_SOURCE, capabilitiesFor, resolveThinkingAndEffort } from './anthropic-models.js';
import { ProviderHttpError } from './errors.js';
import { startLocalServer } from './local-server.js';

const SCHEMA = { type: 'object', properties: { a: { type: 'integer' } }, required: ['a'], additionalProperties: false };
const ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];
const OK_BODY = { id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":1}' }], usage: { input_tokens: 1, output_tokens: 1 } };

/** Problems of a request body for a model, per the documented rejections. Empty = valid. */
function problems(modelId, body) {
  const caps = MODEL_CAPABILITIES[modelId];
  const out = [];
  const type = body.thinking?.type;
  const effort = body.output_config?.effort;
  if (type === 'enabled') out.push('«enabled» is rejected by the Claude 5 models and by Claude 4.7 and later');
  if (type === 'disabled' && caps.offForm !== 'disabled') out.push('«disabled» is rejected');
  if (type === 'between_tools' && caps.offForm !== 'between_tools') out.push('«between_tools» is rejected');
  if ((type === 'disabled' || type === 'between_tools') && caps.offMaxEffort && effort && ORDER.indexOf(effort) > ORDER.indexOf(caps.offMaxEffort)) {
    out.push(`«${type}» with effort ${effort} is rejected`);
  }
  if (effort !== undefined && !caps.efforts.includes(effort)) out.push(`effort ${effort} is not supported`);
  return out;
}

describe('anthropic model table', () => {
  let server;
  before(async () => {
    server = await startLocalServer(() => ({ body: OK_BODY }));
  });
  after(() => server.close());

  it('declares its source with a date and the documentation address', () => {
    assert.match(MODEL_SOURCE.consulted, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(MODEL_SOURCE.urls.every((u) => u.startsWith('https://platform.claude.com/docs/')));
  });

  it('lists the models whose thinking and effort the provider has to shape', () => {
    for (const id of ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5']) {
      assert.ok(MODEL_CAPABILITIES[id], id);
    }
  });

  for (const modelId of Object.keys(MODEL_CAPABILITIES)) {
    it(`${modelId}: every combination of thinking intent and effort goes out valid`, async () => {
      for (const thinking of [undefined, 'disabled']) {
        for (const effort of [undefined, ...ORDER]) {
          const client = createAnthropicClient({ apiKey: 'k', baseUrl: server.url, model: modelId, thinking });
          await client.complete({ system: 'S', messages: [{ role: 'user', content: 'x' }], schema: SCHEMA, effort });
          const body = server.requests.at(-1).json;
          assert.deepEqual(problems(modelId, body), [], `${modelId} thinking=${thinking} effort=${effort}: ${JSON.stringify({ thinking: body.thinking, output_config: body.output_config })}`);
        }
      }
    });
  }

  it('Sonnet 5.5 turns thinking off with between_tools, never with disabled', async () => {
    const client = createAnthropicClient({ apiKey: 'k', baseUrl: server.url, model: 'claude-sonnet-5-5', thinking: 'disabled' });
    await client.complete({ system: 'S', messages: [{ role: 'user', content: 'x' }], effort: 'low' });
    assert.deepEqual(server.requests.at(-1).json.thinking, { type: 'between_tools' });
  });

  it('Haiku 5.5 keeps disabled at low effort and goes adaptive at xhigh (disabled is a 400 there)', () => {
    assert.deepEqual(resolveThinkingAndEffort('claude-haiku-5-5', { wantOff: true, effort: 'low' }).thinking, { type: 'disabled' });
    const r = resolveThinkingAndEffort('claude-haiku-5-5', { wantOff: true, effort: 'xhigh' });
    assert.equal(r.thinking, undefined);
    assert.equal(r.effort, 'xhigh');
  });

  it('a model that cannot turn thinking off receives no thinking field', () => {
    assert.equal(resolveThinkingAndEffort('claude-opus-5-5', { wantOff: true, effort: 'low' }).thinking, undefined);
  });

  it('a model with thinking off by default receives no thinking field and still gets the JSON line', async () => {
    const client = createAnthropicClient({ apiKey: 'k', baseUrl: server.url, model: 'claude-opus-4-8', thinking: 'disabled' });
    await client.complete({ system: 'A', messages: [{ role: 'user', content: 'x' }], schema: SCHEMA });
    const b = server.requests.at(-1).json;
    assert.ok(!('thinking' in b));
    assert.match(b.system.at(-1).text, /final answer only/);
  });

  it('a model outside the table gets the most compatible shape: no thinking and no effort', async () => {
    const client = createAnthropicClient({ apiKey: 'k', baseUrl: server.url, model: 'claude-future-9', thinking: 'disabled' });
    await client.complete({ system: 'A', messages: [{ role: 'user', content: 'x' }], schema: SCHEMA, effort: 'low' });
    const b = server.requests.at(-1).json;
    assert.ok(!('thinking' in b));
    assert.deepEqual(Object.keys(b.output_config), ['format']);
  });

  it('a dated id resolves to its undated entry', () => {
    assert.equal(capabilitiesFor('claude-opus-4-5-20251101'), MODEL_CAPABILITIES['claude-opus-4-5']);
    assert.equal(capabilitiesFor('claude-unknown'), null);
  });

  it('a 400 is not retried blindly: one request, one error', async () => {
    const bad = await startLocalServer(() => ({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } } }));
    try {
      const client = createAnthropicClient({ apiKey: 'k', baseUrl: bad.url, model: 'claude-sonnet-5-5', thinking: 'disabled' });
      await assert.rejects(() => client.complete({ system: 'S', messages: [{ role: 'user', content: 'x' }] }), (e) => e instanceof ProviderHttpError && e.status === 400);
      assert.equal(bad.requests.length, 1);
    } finally {
      await bad.close();
    }
  });
});
