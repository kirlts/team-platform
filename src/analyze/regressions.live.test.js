// REG-004 con el proveedor real: corre sólo si existe ANTHROPIC_API_KEY en el entorno (§4.6: ninguna llave en el repositorio).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProviders } from '../providers/index.js';
import { analyze } from './index.js';
import { makeBundle } from './testing/fixtures.js';

// Un chat que explica cómo es un widget que todavía no existe, sin pedir nada con esas palabras. Antes de la corrección
// el analizador lo clasificaba como Pregunta o Retroalimentación, o lo descartaba como «sin pedido ni falla».
const WIDGET = [
  'Ana: Mira, el widget funciona así.',
  'Ana: Arriba a la derecha hay un contador con las entregas pendientes.',
  'Ana: Al apretar el contador se despliega la lista, ordenada por hora.',
  'Ana: Martín, el cliente lo ve el lunes 26.',
].join('\n');

describe('REG-004 (proveedor real)', { skip: process.env.ANTHROPIC_API_KEY ? false : 'falta ANTHROPIC_API_KEY' }, () => {
  it('un chat que explica un widget produce mensajes de nueva funcionalidad, con el plazo incluido y sin descartar el encargo', async () => {
    const bundle = await makeBundle({ text: WIDGET, attachments: [] });
    const result = await analyze(bundle, { providers: createProviders(process.env) });
    assert.equal(result.status, 'ok', JSON.stringify(result.errors));
    const { messages, discarded } = result.proposal;
    assert.ok(messages.length >= 1, 'el analizador perdió el encargo');
    assert.ok(messages.every((m) => m.area_id === 3), 'describir lo que hay que construir es una nueva funcionalidad (área 3)');
    const descartadas = new Set(discarded.flatMap((d) => d.unit_ids));
    const plazo = result.units.find((u) => /lunes 26/.test(u.text));
    assert.ok(!descartadas.has(plazo.id), 'el plazo comprometido nunca se descarta');
    assert.ok(messages.some((m) => m.unit_ids.includes(plazo.id)));
  });
});
