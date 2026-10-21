import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countTells, tellsOfProposal, PATTERNS, SECTIONS } from './ai-tells.js';

const ids = (text, opts) => countTells(text, opts).map((t) => t.id);

describe('ai-tells', () => {
  it('every pattern cites a section of the guide', () => {
    for (const p of PATTERNS) assert.ok(SECTIONS[p.section], `${p.id} cites an unknown section`);
  });

  it('plain statements of fact carry no mark', () => {
    assert.deepEqual(ids('Corregir el popup vacío de la agenda. El popup aparece vacío al abrir el menú y tarda 3 segundos.'), []);
    assert.deepEqual(ids('Fix the empty popup in the agenda. The popup is empty when the menu opens.'), []);
    assert.deepEqual(ids('Guardar la clave de acceso en el panel y la clave API en el servidor.'), []);
  });

  it('flags the vocabulary, the contrasts and the markup of generated text in both languages', () => {
    assert.ok(ids('This is a crucial and seamless change').includes('vocab-en'));
    assert.ok(ids('Es un cambio fundamental y robusto').includes('vocab-es'));
    assert.ok(ids('Un elemento clave del flujo').includes('vocab-es'));
    assert.ok(ids('It is not just a bug, but also a design problem').includes('not-just-en'));
    assert.ok(ids('No solo falla el filtro, sino también el orden').includes('not-just-es'));
    assert.ok(ids('El botón falla — y nadie lo notó').includes('em-dash'));
    assert.ok(ids('Texto con **negrita**').includes('bold'));
    assert.ok(ids('Hola 🙂').includes('emoji'));
    assert.ok(ids('El filtro sirve como puente entre las vistas').includes('copula-es'));
    assert.ok(ids('The menu serves as the entry point').includes('copula-en'));
    assert.ok(ids('Se corrige el popup, destacando la importancia del menú').includes('gerund-tail-es'));
    assert.ok(ids('Espero que esto sirva. Avísame si falta algo').includes('collaborative-es'));
    assert.ok(ids('En resumen, el popup falla').includes('closing-summary'));
    assert.ok(ids('No se indica impacto.').includes('missing-info'));
    assert.ok(ids('The deadline was not specified.').includes('missing-info-en'));
    assert.ok(ids('Se pierde el contenido, lo que sugiere un fallo de estado.').includes('speculation'));
    assert.deepEqual(ids('impacto: No indicado'), [], 'the literal value of an empty field is not a mark');
  });

  it('does not count what the input contains verbatim', () => {
    assert.deepEqual(ids('El cliente dijo: «es crucial»', { input: 'Para el cliente es crucial que cargue rápido' }), []);
    assert.deepEqual(ids('Es crucial', { input: 'otra cosa' }), ['vocab-en']);
  });

  it('adds up a proposal per message', () => {
    const proposal = { messages: [{ title: 'Corregir popup', body: 'El popup falla.', fields: { a: 'x' } }, { title: 'Es fundamental', body: 'Algo robusto.', fields: {} }] };
    const result = tellsOfProposal(proposal);
    assert.equal(result.messages, 2);
    assert.equal(result.total, 2);
    assert.equal(result.perMessage, 1);
    assert.equal(result.byPattern['vocab-es'], 2);
  });
});
