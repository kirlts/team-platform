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

// UD-018 with the real provider: the output language is the one of the account, whatever the language of the input.
const ENGLISH_INPUT = [
  'Hi team, quick report from my test.',
  'The export button on the delivery board does nothing when I click it in Safari.',
  'It worked last week, so something in the latest release broke it.',
].join('\n');
const SPANISH_INPUT = [
  'Hola equipo, un reporte rápido de mi prueba.',
  'El botón de exportar del tablero de entregas no hace nada cuando lo aprieto en Safari.',
  'La semana pasada funcionaba, así que algo de la última versión lo rompió.',
].join('\n');

// Function words that only one of the two languages uses; enough to tell the language of a whole message.
const SPANISH = new Set('el la los las de del que y en un una por para con no se es al lo como más pero sus ya este esta son está cuando también sin sobre'.split(' '));
const ENGLISH = new Set('the of and to in is are was for that this with it on as be at by from or an not but have has can will when also into than'.split(' '));
const languageOf = (text) => {
  const words = text.toLowerCase().match(/[a-záéíóúñü]+/g) ?? [];
  const es = words.filter((w) => SPANISH.has(w)).length;
  const en = words.filter((w) => ENGLISH.has(w)).length;
  return es >= en ? 'es' : 'en';
};
const proseOf = (m) => [m.title, m.body, ...Object.values(m.fields ?? {}).filter((v) => typeof v === 'string' && v !== 'No indicado')].join(' ');

describe('UD-018 (proveedor real): the output follows bundle.language, not the language of the input', { skip: process.env.ANTHROPIC_API_KEY ? false : 'missing ANTHROPIC_API_KEY' }, () => {
  for (const [name, text, language, expected] of [
    ['an English input with language es-419 yields Spanish messages', ENGLISH_INPUT, 'es-419', 'es'],
    ['a Spanish input with language en yields English messages', SPANISH_INPUT, 'en', 'en'],
  ]) {
    it(name, async () => {
      const bundle = await makeBundle({ text, attachments: [], language });
      const result = await analyze(bundle, { providers: createProviders(process.env) });
      assert.equal(result.status, 'ok', JSON.stringify(result.errors));
      assert.ok(result.proposal.messages.length >= 1, 'the report was not lost');
      for (const m of result.proposal.messages) assert.equal(languageOf(proseOf(m)), expected, `message «${m.title}» is not in ${expected}`);
    });
  }
});
