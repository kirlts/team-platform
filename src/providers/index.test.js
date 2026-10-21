// Tests of building slots from environment variables.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProviders, ProviderConfigError } from './index.js';

describe('createProviders', () => {
  it('the defaults are those of MASTER-SPEC §3', () => {
    const p = createProviders({ ANTHROPIC_API_KEY: 'k', GROQ_API_KEY: 'g' });
    assert.equal(p.text.name, 'anthropic');
    assert.equal(p.text.model, 'claude-haiku-5-5');
    assert.equal(p.text.schemaProfile, 'anthropic');
    assert.equal(p.vision.name, 'anthropic');
    assert.equal(p.vision.model, 'claude-haiku-5-5');
    assert.equal(p.speech.name, 'groq-speech');
    assert.equal(p.speech.model, 'whisper-large-v3-turbo');
    assert.equal(p.textFallback, null);
  });

  it('DeepSeek as text and fallback: model, tool mode and schema profile', () => {
    const p = createProviders({ ANTHROPIC_API_KEY: 'k', TEXT_FALLBACK_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'd' });
    assert.equal(p.textFallback.name, 'deepseek');
    assert.equal(p.textFallback.model, 'deepseek-flash');
    assert.equal(p.textFallback.schemaProfile, 'all-required');
  });

  it('vision inherits from text only if it declares no provider of its own', () => {
    const heredada = createProviders({ TEXT_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'd', TEXT_MODEL: 'deepseek-otro' });
    assert.equal(heredada.vision.name, 'deepseek');
    assert.equal(heredada.vision.model, 'deepseek-otro');
    const propia = createProviders({ TEXT_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'd', TEXT_MODEL: 'deepseek-otro', VISION_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' });
    assert.equal(propia.vision.name, 'anthropic');
    assert.equal(propia.vision.model, 'claude-haiku-5-5');
  });

  it('without a key the slot exists but fails on use with a configuration error', async () => {
    const p = createProviders({});
    assert.match(p.text.unavailable, /ANTHROPIC_API_KEY/);
    await assert.rejects(async () => p.text.complete({ messages: [{ role: 'user', content: 'x' }] }), ProviderConfigError);
    await assert.rejects(async () => p.speech.transcribe({ audioPath: 'x' }), ProviderConfigError);
  });

  it('a compatible provider without a declared model is unavailable, with the reason', () => {
    const p = createProviders({ TEXT_PROVIDER: 'groq', GROQ_API_KEY: 'g' });
    assert.match(p.text.unavailable, /TEXT_MODEL/);
  });

  it('an unknown provider is a configuration error', () => {
    assert.throws(() => createProviders({ TEXT_PROVIDER: 'inventado' }), ProviderConfigError);
    assert.throws(() => createProviders({ SPEECH_PROVIDER: 'inventado' }), ProviderConfigError);
  });

  it('describe() lists providers and models without exposing keys', () => {
    const p = createProviders({ ANTHROPIC_API_KEY: 'secreto-que-no-debe-salir', GROQ_API_KEY: 'otro-secreto' });
    const text = JSON.stringify(p.describe());
    assert.ok(!text.includes('secreto'));
    assert.deepEqual(p.describe().map((s) => s.slot), ['text', 'vision', 'speech']);
  });
});
