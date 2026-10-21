// Pruebas de regresión (docs/TEST.md, REG-001 a REG-004): cada una reproduce un defecto encontrado en uso real o en el
// banco y falla si vuelve. Las de proveedor real están en regressions.live.test.js.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFakeProviders } from '../providers/index.js';
import { analyze } from './index.js';
import { classifySystem } from './prompts.js';
import { bugMessage, makeBundle, scriptByRequest, unitIdsIn } from './testing/fixtures.js';
import { numberUnits, partitionUnits, renderUnits } from './units.js';

const CHAT_4 = '1) popup vacío en agenda 2) idea de recordatorio por WhatsApp 3) pregunta a Pablo sobre la reunión 4) exportar a Excel tarda un minuto';

describe('REG-001: un mensaje de chat de un párrafo con cuatro puntos', () => {
  it('son cuatro unidades y salen cuatro mensajes en tres áreas', async () => {
    const bundle = await makeBundle({ text: CHAT_4, attachments: [] });
    assert.equal(numberUnits(bundle).length, 4);
    const pregunta = (u) => ({ unit_ids: [u], title: 'Pregunta a Pablo', fields: { question: '¿La reunión?' }, body: 'Pregunta sobre la reunión.', assignee_ids: [2], attachment_ids: [] });
    const idea = (u) => ({ unit_ids: [u], title: 'Recordatorio por WhatsApp', fields: { idea: 'Recordatorio', motivation: 'No indicado' }, body: 'Idea de recordatorio.', assignee_ids: [], attachment_ids: [] });
    const fake = createFakeProviders({
      text: scriptByRequest({
        classification: {
          groups: [
            { unit_ids: [1], area_id: 2, template_id: 2 }, { unit_ids: [2], area_id: 1, template_id: 1 },
            { unit_ids: [3], area_id: 5, template_id: 5 }, { unit_ids: [4], area_id: 2, template_id: 2 },
          ],
          discarded: [],
        },
        decompositions: {
          'Reporte de error': (req) => ({ messages: unitIdsIn(req).map((u) => bugMessage([u], `Corregir punto ${u}`)) }),
          Idea: { messages: [idea(2)] },
          Pregunta: { messages: [pregunta(3)] },
        },
      }),
    });
    const result = await analyze(bundle, { providers: fake });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.proposal.messages.map((m) => [m.unit_ids, m.area_id]), [[[1], 2], [[2], 1], [[3], 5], [[4], 2]]);
  });
});

describe('REG-002: una tabla markdown se segmenta por filas', () => {
  const tabla = (nombre, filas) => [`## ${nombre}`, '', '| Tema | Observación | Prioridad |', '|---|---|---|', ...Array.from({ length: filas }, (_, i) => `| Tema ${i + 1} | Observación número ${i + 1} del grupo de entrevistas | Media |`)].join('\n');

  it('cuatro tablas de 20 a 40 filas dan una unidad por fila, con la cabecera como contexto y no como unidad', () => {
    const filas = [20, 30, 35, 40];
    const text = ['Matriz de retroalimentación de la prueba piloto.', ...filas.map((n, i) => tabla(`Tabla ${i + 1}`, n))].join('\n\n');
    const units = numberUnits({ text });
    const rows = units.filter((u) => /\.r\d+$/.test(u.label));
    assert.equal(rows.length, 125);
    assert.equal(units.length, 126, 'el título y las 125 filas; ni cabecera ni separador son unidades');
    assert.ok(!units.some((u) => /Tema \| Observación \| Prioridad/.test(u.text)));
    assert.ok(!units.some((u) => /^\|-+/.test(u.text)));
    assert.equal(rows[11].label, 'p2.r12', 'p es la tabla y r la fila');
    assert.equal(rows[11].text, '| Tema 12 | Observación número 12 del grupo de entrevistas | Media |');
    assert.equal(rows.at(-1).label, 'p5.r40');
  });

  it('la cabecera se muestra una vez por tabla en el prompt', () => {
    const out = renderUnits(numberUnits({ text: tabla('Tabla 1', 3) }));
    assert.equal((out.match(/Cabecera de la tabla p1: \| Tema \| Observación \| Prioridad \|/g) ?? []).length, 1);
    assert.match(out, /\[u1\] \(p1\.r1\) \| Tema 1 \|/);
  });

  it('una tabla grande se parte en trozos por filas y cada trozo lleva su cabecera', () => {
    const units = numberUnits({ text: tabla('Tabla 1', 40) });
    const chunks = partitionUnits(units, { budgetTokens: 300, charsPerToken: 3 });
    assert.ok(chunks.length > 1);
    assert.deepEqual(chunks.flat().map((u) => u.id), units.map((u) => u.id));
    for (const c of chunks) assert.match(renderUnits(c), /Cabecera de la tabla p1/);
  });

  it('una tabla sin línea separadora trata todas las filas como unidades', () => {
    const units = numberUnits({ text: '| a | b |\n| c | d |' });
    assert.deepEqual(units.map((u) => u.label), ['p1.r1', 'p1.r2']);
  });
});

describe('REG-003: el chat de WhatsApp «[15:55, 7/10/2026] Nombre: …»', () => {
  const chat = [
    '[15:55, 7/10/2026] Ana Pérez: Hola equipo. Necesito el widget del tablero para el lunes.',
    'Tiene que mostrar las entregas atrasadas.',
    '[15:56, 7/10/2026] Bruno: dale',
    '7/10/2026 16:01 - Carla: lo reviso mañana',
  ].join('\n');

  it('cada línea de chat es una unidad aparte y el emisor queda como atributo', () => {
    const units = numberUnits({ text: chat });
    assert.deepEqual(units.map((u) => [u.label, u.sender]), [
      ['p1.s1', 'Ana Pérez'], ['p1.s2', 'Ana Pérez'], ['p1.s3', 'Ana Pérez'], ['p2', 'Bruno'], ['p3', 'Carla'],
    ]);
    assert.equal(units[0].text, '[15:55, 7/10/2026] Ana Pérez: Hola equipo.');
    assert.equal(units[1].text, 'Ana Pérez: Necesito el widget del tablero para el lunes.');
    assert.equal(units[2].text, 'Ana Pérez: Tiene que mostrar las entregas atrasadas.', 'una línea sin prefijo sigue al mensaje de su emisor');
  });

  it('la coma después de la hora cuenta como marca de tiempo en una transcripción', () => {
    const units = numberUnits({ attachments: [{ id: 1, kind: 'audio', extracted: '[15:55, 7/10/2026] primera frase\n[15:56, 7/10/2026] segunda frase' }] });
    assert.equal(units.length, 2);
  });

  it('el formato de la captura «[09:12] Nombre: …» también guarda el emisor', () => {
    assert.equal(numberUnits({ text: '[09:12] Isidora: el mapa no carga' })[0].sender, 'Isidora');
  });
});

describe('REG-004: un encargo explicado en un chat no se descarta', () => {
  it('la clasificación recibe la regla: lo que describe algo por construir es nueva funcionalidad y un plazo nunca se descarta', async () => {
    const { areas, templates } = await makeBundle();
    const prompt = classifySystem({ areas, templates }).join('\n');
    assert.match(prompt, /explica cómo debe ser algo que todavía no existe.*es una nueva funcionalidad/);
    assert.match(prompt, /Nunca descartes una unidad que describe algo que hay que construir o cambiar, ni una que fija un plazo, una fecha o un compromiso de entrega/);
    const nueva = areas.find((a) => a.title === 'Nueva funcionalidad');
    assert.match(nueva.description, /descripción de lo que hay que construir/);
  });
});
