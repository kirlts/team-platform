import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isEmptyUnit, numberUnits, partitionUnits, renderUnits } from './units.js';

describe('numberUnits', () => {
  it('splits paragraphs, bullets and timestamps, and numbers the input and the attachments continuously', () => {
    const units = numberUnits({
      text: 'Hola equipo\n\nEl ingreso falla.\n\n- Agregar filtro\n- Cambiar color',
      attachments: [
        { id: 7, kind: 'audio', extracted: '[00:01] hola\n[00:05] el menú no abre' },
        { id: 8, kind: 'image', extracted: null },
        { id: 9, kind: 'document', extracted: '1. Primer punto\n2. Segundo punto' },
      ],
    });
    assert.deepEqual(units.map((u) => u.id), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(units.slice(4, 6).map((u) => u.text), ['[00:01] hola', '[00:05] el menú no abre']);
    assert.deepEqual(units.map((u) => u.source.type === 'input' ? 'input' : u.source.attachment_id), ['input', 'input', 'input', 'input', 7, 7, 9, 9]);
    assert.ok(units[4].atomic && !units[0].atomic);
    assert.deepEqual(units.map((u) => u.label), ['p1', 'p2', 'p3', 'p4', 'a7.p1', 'a7.p2', 'a9.p1', 'a9.p2']);
  });

  it('a paragraph with several sentences drops to sentence level, and the label keeps the paragraph', () => {
    const units = numberUnits({ text: 'El ingreso falla. No entra a la agenda. ¿Alguien lo vio?\n\nOtro párrafo de una oración.' });
    assert.deepEqual(units.map((u) => [u.label, u.text]), [
      ['p1.s1', 'El ingreso falla.'],
      ['p1.s2', 'No entra a la agenda.'],
      ['p1.s3', '¿Alguien lo vio?'],
      ['p2', 'Otro párrafo de una oración.'],
    ]);
  });

  it('in a chat each line is a paragraph', () => {
    assert.deepEqual(numberUnits({ text: 'Ana: hola\nBruno: ok' }).map((u) => [u.label, u.text]), [['p1', 'Ana: hola'], ['p2', 'Bruno: ok']]);
  });

  it('an inline enumeration cuts one unit per element: «1) … 2) …» and «a) … b) …»', () => {
    const chat = '1) popup vacío en agenda 2) idea de recordatorio por WhatsApp 3) pregunta a Pablo sobre la reunión 4) exportar a Excel tarda un minuto';
    assert.deepEqual(numberUnits({ text: chat }).map((u) => u.text), [
      '1) popup vacío en agenda',
      '2) idea de recordatorio por WhatsApp',
      '3) pregunta a Pablo sobre la reunión',
      '4) exportar a Excel tarda un minuto',
    ]);
    assert.deepEqual(numberUnits({ text: 'Pablo pidió que a) abra el menú b) cierre sesión' }).map((u) => u.text), ['Pablo pidió que', 'a) abra el menú', 'b) cierre sesión']);
    assert.deepEqual(numberUnits({ text: 'Hola. Te cuento: 1) falla el login 2) falta un filtro' }).map((u) => u.text), ['Hola.', 'Te cuento:', '1) falla el login', '2) falta un filtro']);
  });

  it('a numbering that does not start at 1 or does not go up by one does not cut', () => {
    assert.equal(numberUnits({ text: 'Falló el paso 3) y el paso 5) también' }).length, 1);
    assert.equal(numberUnits({ text: 'Es el punto 1) de la lista' }).length, 1);
  });

  it('a semicolon separates requests', () => {
    assert.deepEqual(numberUnits({ text: 'Arreglar el login; agregar un filtro por fecha; exportar a CSV' }).map((u) => u.text), [
      'Arreglar el login;', 'agregar un filtro por fecha;', 'exportar a CSV',
    ]);
  });

  it('a dash list on a single line cuts one unit per dash', () => {
    assert.deepEqual(numberUnits({ text: '- popup vacío - idea de recordatorio - pregunta a Pablo' }).map((u) => u.text), [
      '- popup vacío', '- idea de recordatorio', '- pregunta a Pablo',
    ]);
    assert.equal(numberUnits({ text: 'El login - que ya falló - no entra' }).length, 1, 'a parenthetical dash in prose does not cut');
  });

  it('abbreviations do not cut the sentence and a list marker does not count as a sentence', () => {
    assert.deepEqual(numberUnits({ text: 'El Sr. García lo vio ayer. Dra. Pérez también.' }).map((u) => u.text), ['El Sr. García lo vio ayer.', 'Dra. Pérez también.']);
    assert.deepEqual(numberUnits({ text: '1. Primer punto' }).map((u) => u.text), ['1. Primer punto']);
  });

  it('a transcribed monologue does not drop to sentence level: each segment with its timestamp is one unit', () => {
    const units = numberUnits({ attachments: [{ id: 1, kind: 'audio', extracted: '[00:01] Hola. Esto es largo; sigue.\n[00:05] el menú no abre' }] });
    assert.deepEqual(units.map((u) => u.text), ['[00:01] Hola. Esto es largo; sigue.', '[00:05] el menú no abre']);
  });

  it('a joined transcript line with several sentences, semicolons and numbering stays one unit', () => {
    const extracted = [
      '[00:00] pues cachai que el menú no abre. Eso. Dos cositas; una sí y la otra no',
      '[00:21] 1) el popup 2) el filtro',
      '[00:30-00:41] Voz: el Sr. García dice que sigue igual.',
    ].join('\n');
    for (const kind of ['audio', 'video']) {
      const units = numberUnits({ attachments: [{ id: 3, kind, extracted }] });
      assert.deepEqual(units.map((u) => u.text), extracted.split('\n'));
      assert.deepEqual(units.map((u) => u.label), ['a3.p1', 'a3.p2', 'a3.p3'], 'one paragraph per line, no sentence suffix');
      assert.ok(units.every((u) => u.atomic));
    }
  });

  it('a heading sticks to the unit that follows and opens a section', () => {
    const units = numberUnits({ text: '# Errores\nLa pantalla falla.\n\n# Ideas\nUn filtro.' });
    assert.deepEqual(units.map((u) => u.text), ['# Errores\nLa pantalla falla.', '# Ideas\nUn filtro.']);
    assert.deepEqual(units.map((u) => u.section), [1, 2]);
  });

  it('a final heading with no content still stays as a unit', () => {
    assert.deepEqual(numberUnits({ text: 'Algo.\n\n# Fin' }).map((u) => u.text), ['Algo.', '# Fin']);
  });

  it('a bullet with indented lines is a single bullet', () => {
    assert.deepEqual(numberUnits({ text: '- Agregar filtro\n  por fecha\n- Cambiar color' }).map((u) => u.text), ['- Agregar filtro por fecha', '- Cambiar color']);
  });

  it('empty text or no extraction produces no units', () => {
    assert.deepEqual(numberUnits({ text: '  \n', attachments: [{ id: 1, kind: 'image', extracted: null }] }), []);
  });

  it('renderUnits groups by source and marks each unit with its number and its label', () => {
    const out = renderUnits(numberUnits({ text: 'Uno. Dos.\n\nTres', attachments: [{ id: 4, kind: 'image', extracted: 'Captura de chat' }] }), 'en');
    assert.match(out, /### Input text\n\[u1\] \(p1\.s1\) Uno\.\n\[u2\] \(p1\.s2\) Dos\.\n\[u3\] \(p2\) Tres\n\n### Attachment 4 \(image\)\n\[u4\] \(a4\.p1\) Captura de chat/);
  });
});

describe('partitionUnits', () => {
  const chars = 3;
  it('if everything fits, a single chunk', () => {
    const units = numberUnits({ text: 'A\n\nB\n\nC' });
    assert.equal(partitionUnits(units, { budgetTokens: 1000, charsPerToken: chars }).length, 1);
  });

  it('splits by section and the chunks are disjoint and cover all units', () => {
    const text = Array.from({ length: 6 }, (_, i) => `# Sección ${i}\nPárrafo de la sección ${i} con algo de texto.`).join('\n\n');
    const units = numberUnits({ text });
    const chunks = partitionUnits(units, { budgetTokens: 40, charsPerToken: chars });
    assert.ok(chunks.length > 1);
    assert.deepEqual(chunks.flat().map((u) => u.id), units.map((u) => u.id));
    for (const c of chunks) assert.deepEqual(new Set(c.map((u) => u.section)).size <= c.length, true);
  });

  it('a docx of bullets without headings is split by items', () => {
    const text = Array.from({ length: 12 }, (_, i) => `- Punto número ${i} con su explicación`).join('\n');
    const units = numberUnits({ text });
    const chunks = partitionUnits(units, { budgetTokens: 60, charsPerToken: chars });
    assert.ok(chunks.length > 1);
    assert.deepEqual(chunks.flat().map((u) => u.id), units.map((u) => u.id));
  });

  it('a transcribed monologue is not split even if it exceeds the budget', () => {
    const extracted = Array.from({ length: 50 }, (_, i) => `[${String(i).padStart(2, '0')}:00] frase número ${i} del monólogo`).join('\n');
    const units = numberUnits({ attachments: [{ id: 1, kind: 'audio', extracted }] });
    assert.equal(units.length, 50);
    assert.equal(partitionUnits(units, { budgetTokens: 20, charsPerToken: chars }).length, 1);
  });

  it('an audio attachment is not mixed into a chunk with the text if the budget is not enough', () => {
    const audio = Array.from({ length: 30 }, (_, i) => `[00:${String(i).padStart(2, '0')}] frase del audio número ${i}`).join('\n');
    const units = numberUnits({ text: '- uno\n- dos', attachments: [{ id: 1, kind: 'audio', extracted: audio }] });
    const chunks = partitionUnits(units, { budgetTokens: 40, charsPerToken: chars });
    assert.equal(chunks.at(-1).length, 30);
    assert.ok(chunks.slice(0, -1).every((c) => c.every((u) => u.source.type === 'input')));
  });
});

describe('isEmptyUnit (H-1902)', () => {
  it('a speaker mark with its time, a speaker label, a bare list number and a line of symbols say nothing by themselves', () => {
    for (const text of ['00:12:41 Martín', '[00:12] Ana Gil', '1:02:05 Ana María Gil', 'Martín:', '27.', '3)', '\\', '- ']) {
      assert.equal(isEmptyUnit(text), true, text);
    }
  });

  it('a line of the video extractor with its label and nothing after it is empty: it never becomes a message (2026-10-21)', () => {
    for (const text of ['[01:20] Fotograma 26:', '[00:00-00:16] Voz:', '[1:02:05] Fotograma 3:']) assert.equal(isEmptyUnit(text), true, text);
    for (const text of ['[01:20] Fotograma 26: lista de conversaciones', '[00:00-00:16] Voz: hola']) assert.equal(isEmptyUnit(text), false, text);
  });

  it('a sentence, a timed line with punctuation and a line with a sender and a body carry content', () => {
    for (const text of ['Exacto.', '00:12:41 Sí.', '[00:03 - 00:14] Speaker 1: hola', 'Revisar el login', '00:00:09 Ana María Gil Pérez']) {
      assert.equal(isEmptyUnit(text), false, text);
    }
  });
});
