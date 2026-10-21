import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { numberUnits, partitionUnits, renderUnits } from './units.js';

describe('numberUnits', () => {
  it('separa párrafos, viñetas y marcas de tiempo, y numera de corrido el input y los adjuntos', () => {
    const units = numberUnits({
      text: 'Hola equipo\n\nEl ingreso falla.\nNo entra.\n\n- Agregar filtro\n- Cambiar color',
      attachments: [
        { id: 7, kind: 'audio', extracted: '[00:01] hola\n[00:05] el menú no abre' },
        { id: 8, kind: 'image', extracted: null },
        { id: 9, kind: 'document', extracted: '1. Primer punto\n2. Segundo punto' },
      ],
    });
    assert.deepEqual(units.map((u) => u.id), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(units[1].text, 'El ingreso falla.\nNo entra.');
    assert.deepEqual(units.slice(4, 6).map((u) => u.text), ['[00:01] hola', '[00:05] el menú no abre']);
    assert.deepEqual(units.map((u) => u.source.type === 'input' ? 'input' : u.source.attachment_id), ['input', 'input', 'input', 'input', 7, 7, 9, 9]);
    assert.ok(units[4].atomic && !units[0].atomic);
  });

  it('un encabezado se pega a la unidad que sigue y abre una sección', () => {
    const units = numberUnits({ text: '# Errores\nLa pantalla falla.\n\n# Ideas\nUn filtro.' });
    assert.deepEqual(units.map((u) => u.text), ['# Errores\nLa pantalla falla.', '# Ideas\nUn filtro.']);
    assert.deepEqual(units.map((u) => u.section), [1, 2]);
  });

  it('un encabezado final sin contenido igual queda como unidad', () => {
    assert.deepEqual(numberUnits({ text: 'Algo.\n\n# Fin' }).map((u) => u.text), ['Algo.', '# Fin']);
  });

  it('texto vacío o sin extracción no produce unidades', () => {
    assert.deepEqual(numberUnits({ text: '  \n', attachments: [{ id: 1, kind: 'image', extracted: null }] }), []);
  });

  it('renderUnits agrupa por origen y marca cada unidad', () => {
    const out = renderUnits(numberUnits({ text: 'Uno\n\nDos', attachments: [{ id: 4, kind: 'image', extracted: 'Captura de chat' }] }));
    assert.match(out, /### Texto del input\n\[u1\] Uno\n\[u2\] Dos\n\n### Adjunto 4 \(image\)\n\[u3\] Captura de chat/);
  });
});

describe('partitionUnits', () => {
  const chars = 3;
  it('si todo cabe, un solo trozo', () => {
    const units = numberUnits({ text: 'A\n\nB\n\nC' });
    assert.equal(partitionUnits(units, { budgetTokens: 1000, charsPerToken: chars }).length, 1);
  });

  it('parte por sección y los trozos son disjuntos y cubren todas las unidades', () => {
    const text = Array.from({ length: 6 }, (_, i) => `# Sección ${i}\nPárrafo de la sección ${i} con algo de texto.`).join('\n\n');
    const units = numberUnits({ text });
    const chunks = partitionUnits(units, { budgetTokens: 40, charsPerToken: chars });
    assert.ok(chunks.length > 1);
    assert.deepEqual(chunks.flat().map((u) => u.id), units.map((u) => u.id));
    for (const c of chunks) assert.deepEqual(new Set(c.map((u) => u.section)).size <= c.length, true);
  });

  it('un docx de viñetas sin encabezados se parte por ítems', () => {
    const text = Array.from({ length: 12 }, (_, i) => `- Punto número ${i} con su explicación`).join('\n');
    const units = numberUnits({ text });
    const chunks = partitionUnits(units, { budgetTokens: 60, charsPerToken: chars });
    assert.ok(chunks.length > 1);
    assert.deepEqual(chunks.flat().map((u) => u.id), units.map((u) => u.id));
  });

  it('un monólogo transcrito no se parte aunque supere el presupuesto', () => {
    const extracted = Array.from({ length: 50 }, (_, i) => `[${String(i).padStart(2, '0')}:00] frase número ${i} del monólogo`).join('\n');
    const units = numberUnits({ attachments: [{ id: 1, kind: 'audio', extracted }] });
    assert.equal(units.length, 50);
    assert.equal(partitionUnits(units, { budgetTokens: 20, charsPerToken: chars }).length, 1);
  });

  it('un adjunto de audio no se mezcla en un trozo con el texto si el presupuesto no alcanza', () => {
    const audio = Array.from({ length: 30 }, (_, i) => `[00:${String(i).padStart(2, '0')}] frase del audio número ${i}`).join('\n');
    const units = numberUnits({ text: '- uno\n- dos', attachments: [{ id: 1, kind: 'audio', extracted: audio }] });
    const chunks = partitionUnits(units, { budgetTokens: 40, charsPerToken: chars });
    assert.equal(chunks.at(-1).length, 30);
    assert.ok(chunks.slice(0, -1).every((c) => c.every((u) => u.source.type === 'input')));
  });
});
