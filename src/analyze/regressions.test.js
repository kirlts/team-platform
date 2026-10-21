// Regression tests (docs/TEST.md, REG-001 to REG-004): each one reproduces a defect found in real use or in the
// bench and fails if it comes back. The real-provider ones are in regressions.live.test.js.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFakeProviders } from '../providers/index.js';
import { analyze } from './index.js';
import { classifySystem } from './prompts.js';
import { bugMessage, makeBundle, scriptByRequest, unitIdsIn } from './testing/fixtures.js';
import { numberUnits, partitionUnits, renderUnits } from './units.js';

const CHAT_4 = '1) popup vacío en agenda 2) idea de recordatorio por WhatsApp 3) pregunta a Pablo sobre la reunión 4) exportar a Excel tarda un minuto';

describe('REG-001: a one-paragraph chat message with four points', () => {
  it('there are four units and four messages come out in three areas', async () => {
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

describe('REG-002: a markdown table is segmented by rows', () => {
  const tabla = (nombre, filas) => [`## ${nombre}`, '', '| Tema | Observación | Prioridad |', '|---|---|---|', ...Array.from({ length: filas }, (_, i) => `| Tema ${i + 1} | Observación número ${i + 1} del grupo de entrevistas | Media |`)].join('\n');

  it('four tables of 20 to 40 rows give one unit per row, with the header as context and not as a unit', () => {
    const filas = [20, 30, 35, 40];
    const text = ['Matriz de retroalimentación de la prueba piloto.', ...filas.map((n, i) => tabla(`Tabla ${i + 1}`, n))].join('\n\n');
    const units = numberUnits({ text });
    const rows = units.filter((u) => /\.r\d+$/.test(u.label));
    assert.equal(rows.length, 125);
    assert.equal(units.length, 126, 'the title and the 125 rows; neither header nor separator are units');
    assert.ok(!units.some((u) => /Tema \| Observación \| Prioridad/.test(u.text)));
    assert.ok(!units.some((u) => /^\|-+/.test(u.text)));
    assert.equal(rows[11].label, 'p2.r12', 'p is the table and r the row');
    assert.equal(rows[11].text, '| Tema 12 | Observación número 12 del grupo de entrevistas | Media |');
    assert.equal(rows.at(-1).label, 'p5.r40');
  });

  it('the header is shown once per table in the prompt', () => {
    const out = renderUnits(numberUnits({ text: tabla('Tabla 1', 3) }), 'en');
    assert.equal((out.match(/Header of table p1: \| Tema \| Observación \| Prioridad \|/g) ?? []).length, 1);
    assert.match(out, /\[u1\] \(p1\.r1\) ## Tabla 1\n\s+\| Tema 1 \|/, 'the section heading sticks to the first row');
  });

  it('a large table is split into chunks by rows and each chunk carries its header', () => {
    const units = numberUnits({ text: tabla('Tabla 1', 40) });
    const chunks = partitionUnits(units, { budgetTokens: 300, charsPerToken: 3 });
    assert.ok(chunks.length > 1);
    assert.deepEqual(chunks.flat().map((u) => u.id), units.map((u) => u.id));
    for (const c of chunks) assert.match(renderUnits(c, 'en'), /Header of table p1/);
  });

  it('a table without a separator line treats all rows as units', () => {
    const units = numberUnits({ text: '| a | b |\n| c | d |' });
    assert.deepEqual(units.map((u) => u.label), ['p1.r1', 'p1.r2']);
  });
});

describe('REG-003: the WhatsApp chat «[15:55, 7/10/2026] Name: …»', () => {
  const chat = [
    '[15:55, 7/10/2026] Ana Pérez: Hola equipo. Necesito el widget del tablero para el lunes.',
    'Tiene que mostrar las entregas atrasadas.',
    '[15:56, 7/10/2026] Bruno: dale',
    '7/10/2026 16:01 - Carla: lo reviso mañana',
  ].join('\n');

  it('each chat line is a separate unit and the sender stays as an attribute', () => {
    const units = numberUnits({ text: chat });
    assert.deepEqual(units.map((u) => [u.label, u.sender]), [
      ['p1.s1', 'Ana Pérez'], ['p1.s2', 'Ana Pérez'], ['p1.s3', 'Ana Pérez'], ['p2', 'Bruno'], ['p3', 'Carla'],
    ]);
    assert.equal(units[0].text, '[15:55, 7/10/2026] Ana Pérez: Hola equipo.');
    assert.equal(units[1].text, 'Ana Pérez: Necesito el widget del tablero para el lunes.');
    assert.equal(units[2].text, 'Ana Pérez: Tiene que mostrar las entregas atrasadas.', 'a line without a prefix follows the message of its sender');
  });

  it('the comma after the time counts as a timestamp in a transcript', () => {
    const units = numberUnits({ attachments: [{ id: 1, kind: 'audio', extracted: '[15:55, 7/10/2026] primera frase\n[15:56, 7/10/2026] segunda frase' }] });
    assert.equal(units.length, 2);
  });

  it('the capture format «[09:12] Name: …» also keeps the sender', () => {
    assert.equal(numberUnits({ text: '[09:12] Isidora: el mapa no carga' })[0].sender, 'Isidora');
  });
});

describe('REG-004: a commission explained in a chat is not discarded', () => {
  it('the classification receives the rule: what describes something to be built is a new feature and a deadline is never discarded', async () => {
    const { areas, templates } = await makeBundle();
    const prompt = classifySystem({ areas, templates, language: 'en' }).join('\n');
    assert.match(prompt, /explains how something that does not exist yet should be.*it is a new feature/);
    assert.match(prompt, /Never discard a unit that describes something to be built or changed, nor one that sets a deadline, a date or a delivery commitment/);
    const nueva = areas.find((a) => a.title === 'Nueva funcionalidad');
    assert.match(nueva.description, /descripción de lo que hay que construir/);
  });
});
