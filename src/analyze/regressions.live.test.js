// REG-004 with the real provider: runs only if ANTHROPIC_API_KEY exists in the environment (§4.6: no key in the repository).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProviders } from '../providers/index.js';
import { analyze } from './index.js';
import { makeBundle } from './testing/fixtures.js';

// A chat that explains what a widget that does not exist yet looks like, without asking for anything in those words. Before the fix
// the analyzer classified it as `Pregunta` or `Retroalimentación`, or discarded it as «sin pedido ni falla».
const WIDGET = [
  'Ana: Mira, el widget funciona así.',
  'Ana: Arriba a la derecha hay un contador con las entregas pendientes.',
  'Ana: Al apretar el contador se despliega la lista, ordenada por hora.',
  'Ana: Martín, el cliente lo ve el lunes 26.',
].join('\n');

describe('REG-004 (proveedor real)', { skip: process.env.ANTHROPIC_API_KEY ? false : 'missing ANTHROPIC_API_KEY' }, () => {
  it('a chat that explains a widget produces new-feature messages, with the deadline included and without discarding the commission', async () => {
    const bundle = await makeBundle({ text: WIDGET, attachments: [] });
    const result = await analyze(bundle, { providers: createProviders(process.env) });
    assert.equal(result.status, 'ok', JSON.stringify(result.errors));
    const { messages, discarded } = result.proposal;
    assert.ok(messages.length >= 1, 'the analyzer lost the commission');
    assert.ok(messages.every((m) => m.area_id === 3), 'describing what has to be built is a new feature (area 3)');
    const descartadas = new Set(discarded.flatMap((d) => d.unit_ids));
    const plazo = result.units.find((u) => /lunes 26/.test(u.text));
    assert.ok(!descartadas.has(plazo.id), 'the committed deadline is never discarded');
    assert.ok(messages.some((m) => m.unit_ids.includes(plazo.id)));
  });
});
