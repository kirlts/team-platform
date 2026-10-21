import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { numberUnits, partitionUnits, renderUnits } from './units.js';

describe('numberUnits', () => {
  it('separa párrafos, viñetas y marcas de tiempo, y numera de corrido el input y los adjuntos', () => {
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

  it('un párrafo con varias oraciones baja a oración, y el rótulo conserva el párrafo', () => {
    const units = numberUnits({ text: 'El ingreso falla. No entra a la agenda. ¿Alguien lo vio?\n\nOtro párrafo de una oración.' });
    assert.deepEqual(units.map((u) => [u.label, u.text]), [
      ['p1.s1', 'El ingreso falla.'],
      ['p1.s2', 'No entra a la agenda.'],
      ['p1.s3', '¿Alguien lo vio?'],
      ['p2', 'Otro párrafo de una oración.'],
    ]);
  });

  it('en un chat cada línea es un párrafo', () => {
    assert.deepEqual(numberUnits({ text: 'Ana: hola\nBruno: ok' }).map((u) => [u.label, u.text]), [['p1', 'Ana: hola'], ['p2', 'Bruno: ok']]);
  });

  it('una enumeración en línea corta una unidad por elemento: «1) … 2) …» y «a) … b) …»', () => {
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

  it('una numeración que no empieza en 1 o no sube de a uno no corta', () => {
    assert.equal(numberUnits({ text: 'Falló el paso 3) y el paso 5) también' }).length, 1);
    assert.equal(numberUnits({ text: 'Es el punto 1) de la lista' }).length, 1);
  });

  it('un punto y coma separa pedidos', () => {
    assert.deepEqual(numberUnits({ text: 'Arreglar el login; agregar un filtro por fecha; exportar a CSV' }).map((u) => u.text), [
      'Arreglar el login;', 'agregar un filtro por fecha;', 'exportar a CSV',
    ]);
  });

  it('una lista de guiones en una sola línea corta una unidad por guion', () => {
    assert.deepEqual(numberUnits({ text: '- popup vacío - idea de recordatorio - pregunta a Pablo' }).map((u) => u.text), [
      '- popup vacío', '- idea de recordatorio', '- pregunta a Pablo',
    ]);
    assert.equal(numberUnits({ text: 'El login - que ya falló - no entra' }).length, 1, 'un guion de paréntesis en prosa no corta');
  });

  it('las abreviaturas no cortan la oración y un marcador de lista no cuenta como oración', () => {
    assert.deepEqual(numberUnits({ text: 'El Sr. García lo vio ayer. Dra. Pérez también.' }).map((u) => u.text), ['El Sr. García lo vio ayer.', 'Dra. Pérez también.']);
    assert.deepEqual(numberUnits({ text: '1. Primer punto' }).map((u) => u.text), ['1. Primer punto']);
  });

  it('un monólogo transcrito no baja a oración: cada segmento con su marca de tiempo es una unidad', () => {
    const units = numberUnits({ attachments: [{ id: 1, kind: 'audio', extracted: '[00:01] Hola. Esto es largo; sigue.\n[00:05] el menú no abre' }] });
    assert.deepEqual(units.map((u) => u.text), ['[00:01] Hola. Esto es largo; sigue.', '[00:05] el menú no abre']);
  });

  it('un encabezado se pega a la unidad que sigue y abre una sección', () => {
    const units = numberUnits({ text: '# Errores\nLa pantalla falla.\n\n# Ideas\nUn filtro.' });
    assert.deepEqual(units.map((u) => u.text), ['# Errores\nLa pantalla falla.', '# Ideas\nUn filtro.']);
    assert.deepEqual(units.map((u) => u.section), [1, 2]);
  });

  it('un encabezado final sin contenido igual queda como unidad', () => {
    assert.deepEqual(numberUnits({ text: 'Algo.\n\n# Fin' }).map((u) => u.text), ['Algo.', '# Fin']);
  });

  it('una viñeta con líneas con sangría es una sola viñeta', () => {
    assert.deepEqual(numberUnits({ text: '- Agregar filtro\n  por fecha\n- Cambiar color' }).map((u) => u.text), ['- Agregar filtro por fecha', '- Cambiar color']);
  });

  it('texto vacío o sin extracción no produce unidades', () => {
    assert.deepEqual(numberUnits({ text: '  \n', attachments: [{ id: 1, kind: 'image', extracted: null }] }), []);
  });

  it('renderUnits agrupa por origen y marca cada unidad con su número y su rótulo', () => {
    const out = renderUnits(numberUnits({ text: 'Uno. Dos.\n\nTres', attachments: [{ id: 4, kind: 'image', extracted: 'Captura de chat' }] }));
    assert.match(out, /### Texto del input\n\[u1\] \(p1\.s1\) Uno\.\n\[u2\] \(p1\.s2\) Dos\.\n\[u3\] \(p2\) Tres\n\n### Adjunto 4 \(image\)\n\[u4\] \(a4\.p1\) Captura de chat/);
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
