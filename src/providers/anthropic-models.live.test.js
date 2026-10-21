// H-1100 against the real API: the analyzer's default knobs (effort low, thinking off) must be accepted by every
// model of the table that the project can select. Runs only with TEAM_LIVE_PROVIDERS=1 and a key.
// Cost: one tiny classification per model (a few hundred tokens), far under the hard cap of 0.10 USD.
// The key is read from ANTHROPIC_API_KEY or from ~/.config/team-platform/env and is never printed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { DEFAULT_CONFIG } from '../analyze/config.js';
import { createAnthropicClient } from './anthropic.js';

function readKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const line = readFileSync(join(homedir(), '.config/team-platform/env'), 'utf8').split('\n').find((l) => /^\s*(export\s+)?ANTHROPIC_API_KEY=/.test(l));
    return line?.replace(/^[^=]*=/, '').trim().replace(/^["']|["']$/g, '') || undefined;
  } catch {
    return undefined;
  }
}

const apiKey = process.env.TEAM_LIVE_PROVIDERS === '1' ? readKey() : undefined;
const MAX_TOKENS = 400;
// List prices per million tokens (input, output) at the most expensive end of the two models; used only for the spend cap.
const WORST_USD_PER_MTOK = { input: 5, output: 25 };
const SPEND_CAP_USD = 0.1;

const SCHEMA = {
  type: 'object',
  properties: { area: { type: 'string', enum: ['error', 'idea', 'pregunta'] } },
  required: ['area'],
  additionalProperties: false,
};

describe('anthropic (real API, thinking and effort by model)', { skip: apiKey ? false : 'TEAM_LIVE_PROVIDERS=1 and a key are required' }, () => {
  let spent = 0;
  for (const model of ['claude-haiku-5-5', 'claude-sonnet-5-5']) {
    it(`${model} accepts the default classification knobs`, async () => {
      const client = createAnthropicClient({ apiKey, model, thinking: DEFAULT_CONFIG.classifyThinking ?? undefined });
      const out = await client.complete({
        system: 'You classify messages from a software team. Answer with the area.',
        messages: [{ role: 'user', content: 'La pantalla de ingreso se queda en blanco al apretar Entrar.' }],
        schema: SCHEMA,
        effort: DEFAULT_CONFIG.classifyEffort,
        maxTokens: MAX_TOKENS,
      });
      spent += (out.usage.input_tokens + out.usage.cache_creation_tokens) * WORST_USD_PER_MTOK.input / 1e6 + out.usage.output_tokens * WORST_USD_PER_MTOK.output / 1e6;
      assert.ok(['error', 'idea', 'pregunta'].includes(out.json.area), JSON.stringify(out.json));
      assert.ok(out.model.includes(model.replace('claude-', '').split('-')[0]));
      assert.ok(spent < SPEND_CAP_USD, `spend ${spent.toFixed(4)} USD`);
    });
  }
});
