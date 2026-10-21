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

describe('REG-004 (real provider)', { skip: process.env.ANTHROPIC_API_KEY ? false : 'missing ANTHROPIC_API_KEY' }, () => {
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

describe('UD-018 (real provider): the output follows bundle.language, not the language of the input', { skip: process.env.ANTHROPIC_API_KEY ? false : 'missing ANTHROPIC_API_KEY' }, () => {
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

// UD-025 with the real provider: a second input that repeats a point of the first is not dropped; its message says which recent input it continues.
describe('UD-025 (real provider): a point that repeats a recent input is kept and says which one it continues', { skip: process.env.ANTHROPIC_API_KEY ? false : 'missing ANTHROPIC_API_KEY' }, () => {
  it('the second input keeps the repeated point and names the recent input by its time', async () => {
    const providers = createProviders(process.env);
    const first = await analyze(await makeBundle({ text: 'El botón Exportar del tablero no hace nada cuando lo aprieto en Safari.', attachments: [], language: 'es-419' }), { providers });
    assert.equal(first.status, 'ok', JSON.stringify(first.errors));
    const recent = [{ id: 1, created_at: Date.UTC(2026, 9, 21, 9, 30), text_excerpt: 'El botón Exportar del tablero no hace nada cuando lo aprieto en Safari.', proposed_titles: first.proposal.messages.map((m) => m.title) }];
    const second = await analyze(await makeBundle({
      text: 'Otra vez lo del botón Exportar: sigue sin hacer nada en Safari.\nAdemás, el filtro de fechas deja elegir días pasados.',
      attachments: [],
      language: 'es-419',
      recent_inputs: recent,
    }), { providers });
    assert.equal(second.status, 'ok', JSON.stringify(second.errors));
    const messages = second.proposal.messages;
    const exportMessage = messages.find((m) => /export/i.test(`${m.title} ${m.body}`));
    assert.ok(exportMessage, 'the repeated point is still produced');
    assert.match(exportMessage.body, /09:30/, 'its body names the recent input by its time');
    assert.ok(messages.some((m) => /fecha/i.test(`${m.title} ${m.body}`)), 'the new point is produced too');
  });
});

// H-133 and H-135 with the real provider (UD-032).
const ARTICLE = [
  'Las colas de trabajo con arriendo y latido se recuperan solas cuando un proceso muere a mitad de una tarea.',
  'El arriendo vence si el proceso deja de renovarlo, y otro proceso toma el trabajo.',
  'Muchos sistemas usan un reintento con retroceso exponencial para no saturar al proveedor.',
  'Un tope de reintentos evita que un trabajo defectuoso se repita para siempre.',
  'La idempotencia de cada paso es lo que permite repetirlo sin duplicar efectos.',
].join('\n');
const VIDEO = [
  '[00:00] Fotograma 1: Pantalla de la agenda con el menú de acciones abierto.',
  '[00:04] Fotograma 2: El popup del menú aparece vacío.',
  '[00:04-00:09] Voz: miren, cuando abro el menú de acciones el popup sale vacío, solo en Safari.',
  '[00:09] Fotograma 3: El popup sigue vacío.',
].join('\n');

describe('UD-032 and H-135 (real provider)', { skip: process.env.ANTHROPIC_API_KEY ? false : 'missing ANTHROPIC_API_KEY' }, () => {
  it('a link shared with no request is never a proposal with zero messages (H-133)', async () => {
    const bundle = await makeBundle({ text: 'Mira este artículo, me parece relevante para nosotros', attachments: [{ id: 1, kind: 'link', extracted: ARTICLE }], language: 'es-419' });
    const result = await analyze(bundle, { providers: createProviders(process.env) });
    assert.equal(result.status, 'ok', JSON.stringify(result.errors));
    assert.ok(result.proposal.messages.length >= 1, 'what was shared becomes a message the team can see');
  });

  it('a sentence that only points at the video does not become a message of its own (H-135)', async () => {
    const bundle = await makeBundle({ text: 'Revisa este video, algo anda mal', attachments: [{ id: 1, kind: 'video', extracted: VIDEO }], language: 'es-419' });
    const result = await analyze(bundle, { providers: createProviders(process.env) });
    assert.equal(result.status, 'ok', JSON.stringify(result.errors));
    const textUnit = result.units.find((u) => u.source.type === 'input').id;
    assert.ok(result.proposal.messages.length >= 1);
    assert.ok(result.proposal.messages.every((m) => m.unit_ids.some((id) => id !== textUnit)), 'no message holds only the sentence that points at the video');
  });
});
