// Pruebas de la construcción de ranuras desde variables de entorno.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProviders, ProviderConfigError } from './index.js';

describe('createProviders', () => {
  it('los valores por omisión son los de MASTER-SPEC §3', () => {
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

  it('DeepSeek como texto y respaldo: modelo, modo de herramienta y perfil de esquema', () => {
    const p = createProviders({ ANTHROPIC_API_KEY: 'k', TEXT_FALLBACK_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'd' });
    assert.equal(p.textFallback.name, 'deepseek');
    assert.equal(p.textFallback.model, 'deepseek-flash');
    assert.equal(p.textFallback.schemaProfile, 'all-required');
  });

  it('la visión hereda de texto sólo si no declara proveedor propio', () => {
    const heredada = createProviders({ TEXT_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'd', TEXT_MODEL: 'deepseek-otro' });
    assert.equal(heredada.vision.name, 'deepseek');
    assert.equal(heredada.vision.model, 'deepseek-otro');
    const propia = createProviders({ TEXT_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'd', TEXT_MODEL: 'deepseek-otro', VISION_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' });
    assert.equal(propia.vision.name, 'anthropic');
    assert.equal(propia.vision.model, 'claude-haiku-5-5');
  });

  it('sin llave la ranura existe pero falla al usarse con un error de configuración', async () => {
    const p = createProviders({});
    assert.match(p.text.unavailable, /ANTHROPIC_API_KEY/);
    await assert.rejects(async () => p.text.complete({ messages: [{ role: 'user', content: 'x' }] }), ProviderConfigError);
    await assert.rejects(async () => p.speech.transcribe({ audioPath: 'x' }), ProviderConfigError);
  });

  it('un compatible sin modelo declarado queda no disponible con el motivo', () => {
    const p = createProviders({ TEXT_PROVIDER: 'groq', GROQ_API_KEY: 'g' });
    assert.match(p.text.unavailable, /TEXT_MODEL/);
  });

  it('un proveedor desconocido es error de configuración', () => {
    assert.throws(() => createProviders({ TEXT_PROVIDER: 'inventado' }), ProviderConfigError);
    assert.throws(() => createProviders({ SPEECH_PROVIDER: 'inventado' }), ProviderConfigError);
  });

  it('describe() lista proveedores y modelos sin exponer llaves', () => {
    const p = createProviders({ ANTHROPIC_API_KEY: 'secreto-que-no-debe-salir', GROQ_API_KEY: 'otro-secreto' });
    const text = JSON.stringify(p.describe());
    assert.ok(!text.includes('secreto'));
    assert.deepEqual(p.describe().map((s) => s.slot), ['text', 'vision', 'speech']);
  });
});
