// Prueba contra la API real de Anthropic. Corre sólo si existe ANTHROPIC_API_KEY en el entorno;
// sin llave se omite (no hay llave en la máquina de desarrollo ni en el repositorio, §4.6).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAnthropicClient } from './anthropic.js';

const apiKey = process.env.ANTHROPIC_API_KEY;

describe('anthropic (API real)', { skip: apiKey ? false : 'falta ANTHROPIC_API_KEY' }, () => {
  const schema = {
    type: 'object',
    properties: { area: { type: 'string', enum: ['error', 'idea', 'pregunta'] } },
    required: ['area'],
    additionalProperties: false,
  };

  it('clasifica una frase con salida estructurada, esfuerzo low y sistema cacheable', async () => {
    const client = createAnthropicClient({ apiKey });
    const out = await client.complete({
      system: 'Clasificás mensajes de un equipo de software. Respondé con el área.',
      messages: [{ role: 'user', content: 'La pantalla de ingreso se queda en blanco al apretar Entrar.' }],
      schema,
      effort: 'low',
      maxTokens: 2000,
    });
    assert.ok(['error', 'idea', 'pregunta'].includes(out.json.area));
    assert.ok(out.usage.input_tokens + out.usage.cached_tokens > 0);
    assert.ok(out.usage.output_tokens > 0);
    assert.equal(out.provider, 'anthropic');
    assert.match(out.model, /haiku/);
  });
});
