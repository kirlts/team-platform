// Test against the real Anthropic API. Runs only if ANTHROPIC_API_KEY exists in the environment;
// without a key it is skipped (there is no key on the development machine or in the repository, §4.6).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAnthropicClient } from './anthropic.js';

const apiKey = process.env.ANTHROPIC_API_KEY;

describe('anthropic (API real)', { skip: apiKey ? false : 'ANTHROPIC_API_KEY is missing' }, () => {
  const schema = {
    type: 'object',
    properties: { area: { type: 'string', enum: ['error', 'idea', 'pregunta'] } },
    required: ['area'],
    additionalProperties: false,
  };

  it('classifies a sentence with structured output, low effort and a cacheable system prompt', async () => {
    const client = createAnthropicClient({ apiKey });
    const out = await client.complete({
      system: 'You classify messages from a software team. Answer with the area.',
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
