import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProviderRefusalError } from './errors.js';
import { createFakeProviders } from './fake.js';

describe('fake', () => {
  it('entrega las respuestas en orden, completa usage y registra las llamadas', async () => {
    const fake = createFakeProviders({ text: [{ json: { a: 1 } }, { b: 2 }, { text: 'hola' }] });
    const a = await fake.text.complete({ messages: [{ role: 'user', content: 'x' }] });
    assert.deepEqual(a.json, { a: 1 });
    assert.deepEqual(Object.keys(a.usage), ['input_tokens', 'output_tokens', 'cached_tokens']);
    assert.deepEqual((await fake.text.complete({ messages: [] })).json, { b: 2 });
    assert.equal((await fake.text.complete({ messages: [] })).text, 'hola');
    assert.equal(fake.calls.text.length, 3);
    await assert.rejects(fake.text.complete({ messages: [] }), /se agotaron/);
  });

  it('lanza los errores del guion y admite funciones', async () => {
    const fake = createFakeProviders({ text: [new ProviderRefusalError('no'), (req, n) => ({ json: { n, eco: req.system } })] });
    await assert.rejects(fake.text.complete({ messages: [] }), ProviderRefusalError);
    assert.deepEqual((await fake.text.complete({ messages: [], system: 'S' })).json, { n: 1, eco: 'S' });
  });

  it('visión y transcripción con la forma del contrato', async () => {
    const fake = createFakeProviders({ vision: [{ text: 'captura' }], speech: [{ text: 'hola', segments: [{ start: 0, end: 1, text: 'hola' }] }] });
    assert.equal((await fake.vision.describe({ images: [], prompt: 'x' })).text, 'captura');
    const s = await fake.speech.transcribe({ audioPath: '/tmp/a.flac', language: 'es' });
    assert.equal(s.segments.length, 1);
    assert.equal(s.provider, 'fake');
  });
});
