// REG-004 con el proveedor real: corre sólo si existe ANTHROPIC_API_KEY en el entorno (§4.6: ninguna llave en el repositorio).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProviders } from '../providers/index.js';
import { analyze } from './index.js';
import { makeBundle } from './testing/fixtures.js';

const WIDGET = [
  '[15:55, 7/10/2026] Ana Pérez: Hola Martín, te explico el widget del tablero de entregas.',
  '[15:56, 7/10/2026] Ana Pérez: Es una tarjeta que muestra las entregas pendientes del día, con un contador y la lista de las tres más atrasadas.',
  '[15:57, 7/10/2026] Ana Pérez: Se tiene que actualizar sola cada vez que se completa una entrega, sin recargar la página.',
  '[15:58, 7/10/2026] Ana Pérez: Lo necesitamos listo para el lunes 26 de octubre, porque ese día lo presentamos al cliente.',
].join('\n');

describe('REG-004 (proveedor real)', { skip: process.env.ANTHROPIC_API_KEY ? false : 'falta ANTHROPIC_API_KEY' }, () => {
  it('un chat que explica un widget produce un mensaje de nueva funcionalidad con el plazo, y nada del encargo queda descartado', async () => {
    const bundle = await makeBundle({ text: WIDGET, attachments: [] });
    const result = await analyze(bundle, { providers: createProviders(process.env) });
    assert.equal(result.status, 'ok', JSON.stringify(result.errors));
    const { messages, discarded } = result.proposal;
    assert.ok(messages.length >= 1, 'el analizador perdió el encargo');
    assert.ok(messages.some((m) => m.area_id === 3), 'el encargo es una nueva funcionalidad (área 3)');
    const descartadas = new Set(discarded.flatMap((d) => d.unit_ids));
    const plazo = result.units.find((u) => /26 de octubre/.test(u.text));
    assert.ok(!descartadas.has(plazo.id), 'el plazo comprometido nunca se descarta');
    assert.ok(messages.some((m) => m.unit_ids.includes(plazo.id)));
  });
});
