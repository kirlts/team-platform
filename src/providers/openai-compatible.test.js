// Pruebas del proveedor compatible con OpenAI contra un servidor HTTP local.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  ProviderMaxTokensError, ProviderOutputError, ProviderRefusalError, ProviderUnsupportedError,
} from './errors.js';
import { startLocalServer } from './local-server.js';
import { createOpenAICompatibleClient } from './openai-compatible.js';

const SCHEMA = {
  type: 'object',
  properties: { area_id: { type: 'integer' }, note: { type: ['string', 'null'] } },
  required: ['area_id', 'note'],
  additionalProperties: false,
};

const completion = (message, extra = {}) => ({
  model: 'deepseek-flash',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', ...message } }],
  usage: { prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 600 } },
  ...extra,
});

describe('openai-compatible', () => {
  let server;
  let reply;
  before(async () => {
    server = await startLocalServer(() => reply());
  });
  after(() => server.close());

  const client = (extra = {}) => createOpenAICompatibleClient({ name: 'deepseek', apiKey: 'clave-de-prueba', model: 'deepseek-flash', baseUrl: server.url, ...extra });
  const last = () => server.requests.at(-1);

  it('modo json_schema: response_format estricto, sistema como primer mensaje, uso normalizado', async () => {
    reply = () => ({ body: completion({ content: '{"area_id": 2, "note": null}' }) });
    const out = await client({ structured: 'json_schema' }).complete({
      system: ['A', 'B'],
      messages: [{ role: 'user', content: 'hola' }],
      schema: SCHEMA,
    });
    const b = last().json;
    assert.equal(last().url, '/chat/completions');
    assert.equal(last().headers.authorization, 'Bearer clave-de-prueba');
    assert.deepEqual(b.messages[0], { role: 'system', content: 'A\n\nB' });
    assert.deepEqual(b.messages[1], { role: 'user', content: 'hola' });
    assert.deepEqual(b.response_format, { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: SCHEMA } });
    assert.deepEqual(out.json, { area_id: 2, note: null });
    // 1000 de prompt con 600 en caché: la entrada sin caché son 400.
    assert.deepEqual(out.usage, { input_tokens: 400, output_tokens: 20, cached_tokens: 600 });
  });

  it('modo tool: herramienta estricta forzada y argumentos como salida', async () => {
    reply = () => ({ body: completion({ content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'respond', arguments: '{"area_id": 5, "note": "x"}' } }] }) });
    const out = await client({ structured: 'tool' }).complete({ messages: [{ role: 'user', content: 'x' }], schema: SCHEMA });
    const b = last().json;
    assert.equal(b.tools[0].function.strict, true);
    assert.deepEqual(b.tools[0].function.parameters, SCHEMA);
    assert.deepEqual(b.tool_choice, { type: 'function', function: { name: 'respond' } });
    assert.deepEqual(out.json, { area_id: 5, note: 'x' });
  });

  it('modo json_object: el esquema va en el prompt y la salida se valida con Ajv', async () => {
    reply = () => ({ body: completion({ content: '{"area_id": 1, "note": "ok"}' }) });
    const out = await client({ structured: 'json_object' }).complete({ system: 'Base', messages: [{ role: 'user', content: 'x' }], schema: SCHEMA });
    const b = last().json;
    assert.deepEqual(b.response_format, { type: 'json_object' });
    assert.match(b.messages[0].content, /JSON/);
    assert.match(b.messages[0].content, /area_id/);
    assert.deepEqual(out.json, { area_id: 1, note: 'ok' });

    reply = () => ({ body: completion({ content: '{"area_id": "uno", "note": "ok"}' }) });
    await assert.rejects(
      client({ structured: 'json_object' }).complete({ messages: [{ role: 'user', content: 'x' }], schema: SCHEMA }),
      (err) => err instanceof ProviderOutputError && err.errors.length > 0,
    );
  });

  it('contenido vacío en modo JSON es ProviderOutputError', async () => {
    reply = () => ({ body: completion({ content: '' }) });
    await assert.rejects(
      client({ structured: 'json_object' }).complete({ messages: [{ role: 'user', content: 'x' }], schema: SCHEMA }),
      ProviderOutputError,
    );
  });

  it('finish_reason length es corte por max_tokens', async () => {
    reply = () => ({ body: { choices: [{ finish_reason: 'length', message: { content: '{"a' } }], usage: { prompt_tokens: 5, completion_tokens: 5 } } });
    await assert.rejects(
      client().complete({ messages: [{ role: 'user', content: 'x' }], schema: SCHEMA }),
      (err) => err instanceof ProviderMaxTokensError,
    );
  });

  it('content_filter y refusal son rechazos tipados', async () => {
    reply = () => ({ body: { choices: [{ finish_reason: 'content_filter', message: { content: null } }], usage: {} } });
    await assert.rejects(
      client().complete({ messages: [{ role: 'user', content: 'x' }], schema: SCHEMA }),
      (err) => err instanceof ProviderRefusalError && err.category === 'content_filter',
    );
    reply = () => ({ body: completion({ content: null, refusal: 'no puedo' }) });
    await assert.rejects(client().complete({ messages: [{ role: 'user', content: 'x' }], schema: SCHEMA }), ProviderRefusalError);
  });

  it('visión: imagen como image_url con data URL; PDF nativo no se admite', async () => {
    reply = () => ({ body: completion({ content: 'una captura de chat' }) });
    const out = await client().describe({ images: [{ mime: 'image/jpeg', data: Buffer.from('JPG'), label: 'captura-1' }], prompt: 'describí' });
    const content = last().json.messages[0].content;
    assert.equal(content[0].type, 'image_url');
    assert.equal(content[0].image_url.url, `data:image/jpeg;base64,${Buffer.from('JPG').toString('base64')}`);
    assert.deepEqual(content[1], { type: 'text', text: 'describí' });
    assert.equal(out.text, 'una captura de chat');
    await assert.rejects(client().describe({ images: [{ mime: 'application/pdf', data: Buffer.from('%PDF') }], prompt: 'x' }), ProviderUnsupportedError);
  });

  it('el esfuerzo sólo se envía si el proveedor declara su parámetro', async () => {
    reply = () => ({ body: completion({ content: 'ok' }) });
    await client().complete({ messages: [{ role: 'user', content: 'x' }], effort: 'low' });
    assert.ok(!('reasoning_effort' in last().json));
    await client({ effortParam: 'reasoning_effort' }).complete({ messages: [{ role: 'user', content: 'x' }], effort: 'low' });
    assert.equal(last().json.reasoning_effort, 'low');
  });
});
