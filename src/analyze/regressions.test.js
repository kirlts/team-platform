// Regression tests (docs/TEST.md, REG-001 to REG-009): each one reproduces a defect found in real use or in the
// bench and fails if it comes back. The real-provider ones are in regressions.live.test.js.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stat } from 'node:fs/promises';
import { extract } from '../extract/index.js';
import { makeAudio, makeTmp } from '../extract/test/helpers.js';
import { createFakeProviders } from '../providers/index.js';
import { analyze } from './index.js';
import { classifySystem, decomposeSystem } from './prompts.js';
import { parseTemplate } from './templates.js';
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
  it('the definition that makes it a new feature lives in the area description of the catalog, which the Editor can edit, and the prompt only keeps the deadline rule', async () => {
    const { areas, templates } = await makeBundle();
    const nueva = areas.find((a) => a.title === 'Nueva funcionalidad');
    assert.match(nueva.description, /explicar cómo debe ser algo que todavía no existe/);
    for (const language of ['en', 'es-419']) {
      const prompt = classifySystem({ areas, templates, language }).join('\n');
      assert.ok(prompt.includes(nueva.description), `${language}: the catalog carries the description`);
      assert.match(prompt, language === 'en' ? /Never discard a unit that sets a deadline, a date or a delivery commitment/ : /Nunca descartes una unidad que fija un plazo, una fecha o un compromiso de entrega/);
      assert.doesNotMatch(prompt, language === 'en' ? /it is a new feature/ : /es una nueva funcionalidad,/, `${language}: no product definition hidden in the instructions`);
    }
  });

  it('each initial area description is long and detailed: what it is, typical cases, edge cases with the tie-break toward its neighbors, and what it is not (UD-028)', async () => {
    const { areas } = await makeBundle();
    assert.equal(areas.length, 5);
    for (const a of areas) {
      const paragraphs = a.description.split('\n\n');
      assert.ok(paragraphs.length >= 2 && paragraphs.length <= 4, `${a.title}: ${paragraphs.length} paragraphs`);
      assert.ok(a.description.split(/\s+/).length >= 150, `${a.title}: long enough to be exhaustive`);
      assert.match(a.description, /Casos típicos/, `${a.title}: typical cases`);
      assert.match(a.description, /Casos borde/, `${a.title}: edge cases`);
      assert.match(a.description, /\bNo es\b|\bno es\b/, `${a.title}: what it is not`);
    }
  });

  it('the set is mutually exclusive in its edge cases: every area is named as the destination of a tie-break in some neighbor', async () => {
    const { areas } = await makeBundle();
    for (const a of areas) {
      const named = areas.filter((o) => o.title !== a.title).some((o) => o.description.includes(a.title));
      assert.ok(named, `${a.title} is not the destination of any tie-break rule`);
    }
  });
});

describe('REG-005: a voice note transcribed in short phrases becomes sentence-sized units', () => {
  // Phrase-level segments as Groq returns them: contiguous, one to five seconds, punctuation only now and then.
  const PHRASES = [
    [0, 2, 'pues cachai'], [2, 4, 'que el menú de la agenda'], [4, 6, 'no abre en el celular.'], [6, 7, 'Eso.'],
    [7, 9, 'dos cositas,'], [9, 11, 'una sí y la otra no'], [11, 13, 'la del filtro de fechas'], [13, 16, 'sí funciona bien.'],
    [19, 21, 'ahora lo del correo'], [21, 23, 'llega duplicado'], [23, 26, 'cada vez que se guarda un cambio.'],
  ];

  it('eleven phrase segments give four units, each one a whole sentence', async () => {
    const tmp = await makeTmp('reg005');
    try {
      const path = await makeAudio(tmp.join('nota.m4a'), 28);
      const segments = PHRASES.map(([start, end, text]) => ({ start, end, text: ` ${text}` }));
      const speech = { async transcribe() { return { text: '', segments }; } };
      const attachment = { id: 1, kind: 'audio', path, mime: 'audio/mp4', size: (await stat(path)).size };
      const { text } = await extract(attachment, { providers: { speech } });

      const units = numberUnits({ attachments: [{ id: 1, kind: 'audio', extracted: text }] });
      assert.equal(segments.length, 11);
      assert.deepEqual(units.map((u) => u.text), [
        '[00:00] pues cachai que el menú de la agenda no abre en el celular.',
        '[00:06] Eso.',
        '[00:07] dos cositas, una sí y la otra no la del filtro de fechas sí funciona bien.',
        '[00:19] ahora lo del correo llega duplicado cada vez que se guarda un cambio.',
      ]);
      // Every unit but the one-word "Eso." is a whole sentence.
      assert.ok(units.filter((u) => u.text.split(' ').length > 3).every((u) => /[.?!…]$/.test(u.text)));
    } finally {
      await tmp.cleanup();
    }
  });
});

describe('REG-006: a time range is a unit boundary and the voice does not glue to the previous frame', () => {
  // The video extractor writes «[mm:ss] Fotograma N: …» and «[mm:ss-mm:ss] Voz: …»; a transcript line may also carry just the range.
  const VIDEO = [
    '[00:00] Fotograma 1: Pantalla de agenda con el menú abierto. Se ve el botón azul.',
    '[00:05] Fotograma 2: El popup aparece vacío.',
    '[00:05-00:10] Voz: miren, aquí sale vacío. ¿Qué pasa ahí?',
    '[1:02:05-1:02:09] otra cosa dicha mucho después',
    '[1:02:10] Fotograma 3: Se cierra.',
  ].join('\n');

  it('each frame and each voice line is one unit and keeps its time, whatever the kind of the source', () => {
    for (const bundle of [{ text: VIDEO }, { attachments: [{ id: 1, kind: 'video', extracted: VIDEO }] }]) {
      const units = numberUnits(bundle);
      assert.deepEqual(units.map((u) => u.time), ['00:00', '00:05', '00:05-00:10', '1:02:05-1:02:09', '1:02:10']);
      assert.deepEqual(units.map((u) => u.text), VIDEO.split('\n'), 'no line is glued to the previous one nor split by sentence');
    }
  });

  it('a range alone is not taken for a continuation of the previous line', () => {
    const units = numberUnits({ text: '[00:05] Fotograma 2: El popup aparece vacío.\n[00:05-00:10] miren, aquí sale vacío' });
    assert.equal(units.length, 2);
    assert.equal(units[1].time, '00:05-00:10');
  });
});

describe('REG-007: one point said once is one message, whatever the units in between', () => {
  for (const [language, split, contiguous] of [
    ['es-419', /nunca lo partas por oración/, /aunque entre ellas haya descripciones de fotogramas/],
    ['en', /never split it by sentence/, /even when descriptions of frames come between them/],
  ]) {
    it(`the prompts of ${language} tell the model not to split a point and to keep consecutive units together`, async () => {
      const { areas, templates } = await makeBundle();
      const classify = classifySystem({ areas, templates, language }).join('\n');
      assert.match(classify, split);
      const decompose = decomposeSystem(parseTemplate(templates[1].body_markdown), undefined, language).join('\n');
      assert.match(decompose, contiguous);
    });
  }
});

describe('REG-008: praise with nothing to decide is not a message', () => {
  for (const [language, praise] of [
    ['es-419', /elogios o aprobaciones sin nada que decidir ni responder/],
    ['en', /praise or approval with nothing to decide or answer/],
  ]) {
    it(`the classification of ${language} discards it`, async () => {
      const { areas, templates } = await makeBundle();
      assert.match(classifySystem({ areas, templates, language }).join('\n'), praise);
    });
  }
});

describe('REG-009: a rhetorical question or a closing filler is not a Question message', () => {
  for (const [language, rhetorical, decomposition] of [
    ['es-419', /preguntas retóricas y muletillas de cierre/, /Una pregunta retórica o una muletilla de cierre no es un mensaje de pregunta/],
    ['en', /rhetorical questions and closing fillers/, /A rhetorical question or a closing filler is not a question message/],
  ]) {
    it(`the classification and the decomposition of ${language} leave it out`, async () => {
      const { areas, templates } = await makeBundle();
      assert.match(classifySystem({ areas, templates, language }).join('\n'), rhetorical);
      assert.match(decomposeSystem(parseTemplate(templates[1].body_markdown), undefined, language).join('\n'), decomposition);
    });
  }
});

describe('H-11: a point seen only in a frame carries source «frame» into the proposal', () => {
  const script = (source) => scriptByRequest({
    classification: { groups: [{ unit_ids: [1, 2], area_id: 2, template_id: 2 }], discarded: [] },
    decompositions: { 'Reporte de error': { messages: [{ ...bugMessage([1, 2], 'Corregir el icono desalineado'), ...(source ? { source } : {}) }] } },
  });
  const run = async (source) => analyze(await makeBundle({ text: '[00:03] Fotograma 1: El icono sale desalineado.\n[00:04] Fotograma 2: El icono sigue desalineado.', attachments: [] }), { providers: createFakeProviders({ text: script(source) }) });

  it('the field survives the validation and the normalization', async () => {
    const result = await run('frame');
    assert.equal(result.status, 'ok');
    assert.equal(result.proposal.messages[0].source, 'frame');
  });

  it('a message without the field stays without it, and any other value is invalid', async () => {
    const without = await run(undefined);
    assert.equal(without.status, 'ok');
    assert.ok(!('source' in without.proposal.messages[0]));
    const other = await run('audio');
    assert.equal(other.status, 'invalid');
  });
});
