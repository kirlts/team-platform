// H-3737: the split check. The classification of a long input names a section as one request; each group is read alone once more
// and split when it holds several. The model is a fake: what is tested is the placement of the answer, the shape validation and the
// fallbacks, never a reading of the text.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProviderRefusalError } from '../providers/errors.js';
import { createFakeProviders } from '../providers/index.js';
import { analyze, resolveConfig } from './index.js';
import * as en from './prompts-en.js';
import * as es from './prompts-es.js';
import { splitSystem, splitUser } from './prompts.js';
import { buildSplitSchema } from './schema.js';
import { bugMessage, lastUserText, makeBundle, unitIdsIn } from './testing/fixtures.js';
import { repairSplit, settleSplit, validateSplit } from './validate.js';

// u1 greeting, u2 to u5 one section of a document, u6 a single unit
const TEXT = [
  'Hola equipo.',
  'Los controles quedaron arriba del selector.',
  'La barra de búsqueda de las prestaciones no existe.',
  'Falta un botón para borrar los filtros.',
  'Los encabezados de las tablas no ordenan.',
  'El logo del profesional no se puede cargar.',
].join('\n\n');
const isClassify = (req) => Boolean(req.schema.properties.groups);
const isSplit = (req) => Boolean(req.schema.properties.requests);
const group = (ids, extra = {}) => ({ unit_ids: ids, area_id: 2, template_id: 2, requests: ['Corregir la sección'], recap_unit_ids: [], ...extra });
const classification = { split_at: [], groups: [group([2, 3, 4, 5]), group([6])], discarded: [{ unit_ids: [1], reason: 'saludo' }] };
const decompose = (req) => ({ messages: [bugMessage(unitIdsIn(req), `Corregir ${unitIdsIn(req).join('-')}`)] });

describe('the split check reads each group alone and splits the ones with several requests (H-3737)', () => {
  it('a group answered with two requests becomes two groups with the same area and template; each one is decomposed apart', async () => {
    const asked = [];
    const fake = createFakeProviders({
      text: (req) => {
        if (isClassify(req)) return classification;
        if (isSplit(req)) {
          asked.push(unitIdsIn(req));
          return { requests: [{ request: 'Mover los controles', unit_ids: [2] }, { request: 'Agregar la barra de búsqueda', unit_ids: [3, 4] }, { request: 'Ordenar las tablas', unit_ids: [5] }] };
        }
        return decompose(req);
      },
    });
    const result = await analyze(await makeBundle({ text: TEXT, attachments: [] }), { providers: fake, config: { coveragePasses: 0 } });
    assert.equal(result.status, 'ok');
    assert.deepEqual(asked, [[2, 3, 4, 5]], 'only the group with two or more units is checked; the single unit is not');
    assert.deepEqual(result.proposal.messages.map((m) => m.unit_ids), [[2], [3, 4], [5], [6]]);
    assert.deepEqual(result.proposal.messages.map((m) => m.area_id), [2, 2, 2, 2]);
    assert.deepEqual(result.stats.split_pass, { checked: 1, split: 1, added: 2 });
    const notes = fake.calls.text.filter((r) => !isClassify(r) && !isSplit(r)).map((r) => lastUserText(r).match(/(?:pedido de este grupo|request of this group as): «([^»]+)»/)?.[1]);
    assert.deepEqual(notes.sort(), ['Agregar la barra de búsqueda', 'Mover los controles', 'Ordenar las tablas', 'Corregir la sección'].sort());
  });

  it('a group answered with one request stays as it is', async () => {
    const fake = createFakeProviders({ text: (req) => (isClassify(req) ? classification : isSplit(req) ? { requests: [{ request: 'Una sola cosa', unit_ids: [2, 3, 4, 5] }] } : decompose(req)) });
    const result = await analyze(await makeBundle({ text: TEXT, attachments: [] }), { providers: fake, config: { coveragePasses: 0 } });
    assert.deepEqual(result.proposal.messages.map((m) => m.unit_ids), [[2, 3, 4, 5], [6]]);
    assert.deepEqual(result.stats.split_pass, { checked: 1, split: 0, added: 0 });
  });

  it('a call that is refused leaves its group as it was and the input does not fail', async () => {
    const fake = createFakeProviders({ text: (req) => (isClassify(req) ? classification : isSplit(req) ? new ProviderRefusalError('no') : decompose(req)) });
    const result = await analyze(await makeBundle({ text: TEXT, attachments: [] }), { providers: fake, config: { coveragePasses: 0 } });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.proposal.messages.map((m) => m.unit_ids), [[2, 3, 4, 5], [6]]);
  });

  it('an answer that leaves a unit out is retried with the conflict, and what the retry does not fix is closed by sets', async () => {
    let splitCalls = 0;
    const fake = createFakeProviders({
      text: (req) => {
        if (isClassify(req)) return classification;
        if (isSplit(req)) {
          splitCalls += 1;
          return { requests: [{ request: 'Primero', unit_ids: [2, 3] }, { request: 'Segundo', unit_ids: [5] }] };
        }
        return decompose(req);
      },
    });
    const result = await analyze(await makeBundle({ text: TEXT, attachments: [] }), { providers: fake, config: { coveragePasses: 0 } });
    assert.equal(splitCalls, 2, 'one retry with the error as context');
    assert.deepEqual(result.proposal.messages.map((m) => m.unit_ids), [[2, 3, 4], [5], [6]], 'u4, in no request, goes with the one before it');
  });

  it('a group with a voice unit is not checked: the transcription cuts by time and the group is read alone', async () => {
    const voice = ['[00:00-00:10] Voz: lo primero es el historial', '[00:05] Fotograma 1: Barra.', '[00:10-00:20] Voz: y lo segundo la agenda', '[00:20-00:30] Voz: que no abre'].join('\n');
    const fake = createFakeProviders({ text: (req) => (isClassify(req) ? { split_at: [], groups: [group([1, 2, 3, 4])], discarded: [] } : isSplit(req) ? { requests: [] } : decompose(req)) });
    const result = await analyze(await makeBundle({ text: '', attachments: [{ id: 1, kind: 'video', extracted: voice }] }), { providers: fake, config: { coveragePasses: 0 } });
    assert.equal(result.status, 'ok');
    assert.equal(fake.calls.text.filter(isSplit).length, 0);
    assert.deepEqual(result.stats.split_pass, { checked: 0, split: 0, added: 0 });
  });

  it('the check can be turned off', async () => {
    const fake = createFakeProviders({ text: (req) => (isClassify(req) ? classification : decompose(req)) });
    const result = await analyze(await makeBundle({ text: TEXT, attachments: [] }), { providers: fake, config: { coveragePasses: 0, splitPass: false } });
    assert.equal(fake.calls.text.filter(isSplit).length, 0);
    assert.equal(result.stats.split_pass, undefined);
  });
});

describe('the shape of a split is checked by sets (H-3737)', () => {
  const scope = new Set([2, 3, 4]);
  it('units outside the group, repeated or missing are errors; a valid cover is accepted', () => {
    assert.deepEqual(validateSplit({ requests: [{ request: 'a', unit_ids: [2, 3] }, { request: 'b', unit_ids: [4] }] }, { scope }), { errors: [] });
    assert.match(validateSplit({ requests: [{ request: 'a', unit_ids: [2, 9] }] }, { scope }).errors[0], /unit 9 is not in this group/);
    assert.match(validateSplit({ requests: [{ request: 'a', unit_ids: [2, 3] }, { request: 'b', unit_ids: [3, 4] }] }, { scope }).errors[0], /unit 3 is in more than one place/);
    assert.match(validateSplit({ requests: [{ request: 'a', unit_ids: [2, 3] }] }, { scope }).errors[0], /units 4 are in no place/);
    assert.ok(validateSplit({ requests: [{ request: 'a', unit_ids: [2, 3] }] }, { scope }).repairable);
  });

  it('a repeated unit stays in the first request; a missing one goes where the unit before it went', () => {
    const fixed = repairSplit({ requests: [{ request: 'a', unit_ids: [2, 3] }, { request: 'b', unit_ids: [3, 5] }] }, new Set([2, 3, 4, 5]));
    assert.deepEqual(fixed.requests.map((r) => r.unit_ids), [[2, 3, 4], [5]]);
  });

  it('a part made only of frames or of units with no content joins the part before it', () => {
    const parts = settleSplit([{ request: 'a', unit_ids: [1, 2] }, { request: 'frames', unit_ids: [3] }, { request: 'b', unit_ids: [4] }], { frameIds: new Set([3]) });
    assert.deepEqual(parts.parts.map((p) => p.unit_ids), [[1, 2, 3], [4]]);
    assert.equal(parts.joined, 1);
    const first = settleSplit([{ request: 'mark', unit_ids: [1] }, { request: 'b', unit_ids: [2, 3] }], { emptyIds: new Set([1]) });
    assert.deepEqual(first.parts.map((p) => p.unit_ids), [[1, 2, 3]], 'a hollow first part goes with the next one');
  });

  it('the schema asks for the request and its units, nothing else', () => {
    const schema = buildSplitSchema();
    assert.deepEqual(schema.required, ['requests']);
    assert.deepEqual(schema.properties.requests.items.required, ['unit_ids', 'request']);
  });
});

describe('the rules of documents and of context in the classification (H-3737)', () => {
  for (const [name, set, expect] of [
    ['es-419', es, { doc: /2g\. Documentos y listas/, ctx: /2h\. Contexto no es tarea/, promise: /el propio autor promete hacer él mismo/, rule7: /Nunca descartes una unidad que fija un plazo, una fecha o un compromiso de entrega que otra persona o el equipo debe cumplir/ }],
    ['en', en, { doc: /2g\. Documents and lists/, ctx: /2h\. Context is not a task/, promise: /the author promises to do himself/, rule7: /Never discard a unit that sets a deadline, a date or a delivery commitment that another person or the team must meet/ }],
  ]) {
    it(`${name}: a document is a list of requests, context is not a task, and a delivery of someone else is still never discarded`, () => {
      const text = set.classifyInstructions();
      assert.match(text, expect.doc);
      assert.match(text, expect.ctx);
      assert.match(text, expect.promise);
      assert.match(text, expect.rule7);
    });

    it(`${name}: the split prompt asks for the requests of one group and carries only that group`, () => {
      const system = splitSystem({ language: set.LANGUAGE }).join('\n');
      assert.match(system, /request/);
      const user = splitUser({ units: [{ id: 3, label: 'p3', text: 'Una frase.', source: { type: 'input' }, table: null }], language: set.LANGUAGE });
      assert.match(user, /\[u3\] \(p3\) Una frase\./);
    });
  }
});

describe('the knobs of the split check are validated (H-3737)', () => {
  it('on by default, low effort, no thinking; a wrong value is an error', () => {
    const config = resolveConfig({});
    assert.equal(config.splitPass, true);
    assert.equal(config.splitPassEffort, 'low');
    assert.equal(config.splitPassThinking, 'disabled');
    assert.throws(() => resolveConfig({ splitPass: 'yes' }), /splitPass/);
    assert.throws(() => resolveConfig({ splitPassEffort: 'huge' }), /splitPassEffort/);
    assert.throws(() => resolveConfig({ splitPassThinking: 'on' }), /splitPassThinking/);
  });
});

describe('the steps of one feature are one request, not one per step (UD-273)', () => {
  for (const [name, set, expect] of [
    ['es-419', es, { group: /2i\. Una funcionalidad o un defecto es un solo grupo/, fewer: /En la duda, menos grupos/, split: /En la duda, menos pedidos/, message: /conservando la lista numerada/ }],
    ['en', en, { group: /2i\. A feature or a defect is a single group/, fewer: /When in doubt, fewer groups/, split: /When in doubt, fewer requests/, message: /keeping the numbered list/ }],
  ]) {
    it(`${name}: classification, split check and decomposition say that steps, requirements and criteria of one feature stay together`, () => {
      const classify = set.classifyInstructions();
      assert.match(classify, expect.group);
      assert.match(classify, expect.fewer);
      assert.match(splitSystem({ language: set.LANGUAGE }).join('\n'), expect.split);
      assert.match(set.decomposeInstructions(), expect.message);
    });
  }
});
