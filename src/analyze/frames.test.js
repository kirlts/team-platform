// H-3728: a request is born from what the author says or writes; a frame is evidence. The model is a fake: what is tested is the
// structural kind of the units, the validation of the shape and the deterministic placement of frames, never a reading of the text.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFakeProviders } from '../providers/index.js';
import { analyze } from './index.js';
import { classifySystem, decomposeSystem } from './prompts.js';
import { buildDecompositionSchema } from './schema.js';
import { parseTemplate } from './templates.js';
import { bugMessage, lastUserText, makeBundle, unitIdsIn } from './testing/fixtures.js';
import { numberUnits } from './units.js';
import { anchorFrames, foldFrameMessages, normalizeDecomposition, repairClassification, validateClassification } from './validate.js';

// u1 frame, u2 voice 00:00-00:10, u3 frame 00:05, u4 voice 00:10-00:20, u5 frame 00:12, u6 frame 00:25 (silence)
const VIDEO = [
  '[00:00] Fotograma 1: Pantalla de pagos con filtro Todos.',
  '[00:00-00:10] Voz: en pagos sale comprobante rechazado cuando nunca mandaron comprobante.',
  '[00:05] Fotograma 2: Fila con estado Comprobante rechazado.',
  '[00:10-00:20] Voz: y lo segundo, el historial no se abre al pinchar Abrir.',
  '[00:12] Fotograma 3: Barra de historial con el botón Abrir.',
  '[00:25] Fotograma 4: Dos líneas de sistema repetidas.',
].join('\n');
const videoBundle = (extra = {}) => makeBundle({ text: '', attachments: [{ id: 1, kind: 'video', extracted: VIDEO }], ...extra });
const isClassify = (req) => Boolean(req.schema.properties.groups);
const isCoverage = (req) => /Revisión de lo apartado|Review of what was set aside/.test(lastUserText(req));
const group = (ids) => ({ unit_ids: ids, area_id: 2, template_id: 2 });
const decompose = (req) => ({ messages: [bugMessage(unitIdsIn(req), `Corregir ${unitIdsIn(req).join('-')}`)] });

describe('units carry a structural kind (H-3728)', () => {
  it('voice and frame come from the extractor label of a video; author text and images are text and frame', () => {
    const units = numberUnits({ text: 'Mira el video', attachments: [{ id: 1, kind: 'video', extracted: VIDEO }, { id: 2, kind: 'image', extracted: 'Una captura.' }, { id: 3, kind: 'audio', extracted: '[00:00-00:04] Voz: hola' }] });
    assert.deepEqual(units.map((u) => u.kind), ['text', 'frame', 'voice', 'frame', 'voice', 'frame', 'frame', 'frame', 'voice']);
  });
});

describe('a frame alone does not become a request (H-3728)', () => {
  const units = numberUnits({ attachments: [{ id: 1, kind: 'video', extracted: VIDEO }] });
  const frameIds = new Set(units.filter((u) => u.kind === 'frame').map((u) => u.id));
  const ctx = { areas: [{ id: 2 }], templates: [{ id: 2, area_id: 2 }], scope: new Set(units.map((u) => u.id)), frameIds };

  it('a group of frames only is a validation error with the output kept for the repair', () => {
    const out = validateClassification({ groups: [group([1, 2, 3, 4, 5]), group([6])], discarded: [] }, ctx);
    assert.equal(out.errors.length, 1);
    assert.match(out.errors[0], /group 2: cites only frame descriptions \(u6\)/);
    assert.ok(out.repairable);
  });

  it('the repair discards a group of frames the retry did not fix', () => {
    const fixed = repairClassification({ groups: [group([1, 2, 3, 4, 5]), group([6])], discarded: [] }, ctx.scope, { frameIds, frameReason: 'Observado, no dicho' });
    assert.deepEqual(fixed.groups.map((g) => g.unit_ids), [[1, 2, 3, 4, 5]]);
    assert.deepEqual(fixed.discarded, [{ unit_ids: [6], reason: 'Observado, no dicho' }]);
  });

  it('with no frame set (an input made only of images, UD-021) a group of frames is valid', () => {
    assert.deepEqual(validateClassification({ groups: [group([6])], discarded: [{ unit_ids: [1, 2, 3, 4, 5], reason: 'x' }] }, { ...ctx, frameIds: null }).errors, []);
  });

  it('the whole analysis turns a frame-only group into a discard and never into a message', async () => {
    const fake = createFakeProviders({ text: (req) => (isClassify(req) ? { groups: [group([1, 2, 3, 4, 5]), group([6])], discarded: [] } : decompose(req)) });
    const result = await analyze(await videoBundle(), { providers: fake, config: { coveragePasses: 1 } });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.proposal.messages.map((m) => m.unit_ids), [[1, 2, 3, 4, 5]]);
    assert.deepEqual(result.proposal.discarded.map((d) => d.unit_ids), [[6]]);
    assert.ok(!result.proposal.messages.some((m) => m.source === 'frame'));
    assert.ok(!fake.calls.text.some((r) => isClassify(r) && isCoverage(r)), 'a discarded frame is not reread by the coverage pass');
  });
});

describe('each frame goes with the voice segment on air (H-3728)', () => {
  const units = numberUnits({ attachments: [{ id: 1, kind: 'video', extracted: VIDEO }] });

  it('a frame inside a segment joins the group of that segment; one in a silence stays', () => {
    const out = anchorFrames([group([1, 2, 5]), group([3, 4])], [{ unit_ids: [6], reason: 'x' }], units);
    assert.deepEqual(out.groups.map((g) => g.unit_ids), [[1, 2, 3], [4, 5]]);
    assert.deepEqual(out.discarded.map((d) => d.unit_ids), [[6]]);
    assert.equal(out.anchored, 2);
  });

  it('a frame whose segment was discarded stays where the model put it', () => {
    const out = anchorFrames([group([3, 4, 5])], [{ unit_ids: [1, 2, 6], reason: 'x' }], units);
    assert.deepEqual(out.groups.map((g) => g.unit_ids), [[3, 4, 5]]);
    assert.equal(out.anchored, 0);
  });
});

describe('the decomposition keeps one request per message and frames out of the body (H-3728)', () => {
  it('a message written from frames alone folds into the next message and its title goes to observed', () => {
    const frames = new Set([1, 3, 6]);
    const out = foldFrameMessages([{ unit_ids: [1, 2], title: 'A', observed: [] }, { unit_ids: [3], title: 'Fila con otro estado' }, { unit_ids: [4, 5, 6], title: 'B' }], frames);
    assert.equal(out.folded, 1);
    assert.deepEqual(out.messages.map((m) => [m.unit_ids, m.observed]), [[[1, 2], []], [[3, 4, 5, 6], ['Fila con otro estado']]]);
  });

  it('observed is in the grammar, optional in the validation, and survives the normalization trimmed', () => {
    const grammar = buildDecompositionSchema([]).properties.messages.items;
    assert.ok(grammar.required.includes('observed'));
    assert.ok(!('source' in grammar.properties), 'source is decided by the kind of the units, not by the model');
    assert.ok(!buildDecompositionSchema([], { validation: true }).properties.messages.items.required.includes('observed'));
    const { messages } = normalizeDecomposition({ messages: [{ ...bugMessage([1], 'T'), observed: [' Dos líneas repetidas ', ''] }], discarded: [] });
    assert.deepEqual(messages[0].observed, ['Dos líneas repetidas']);
  });

  it('a group with two requests can come back as two messages, each with its own units', async () => {
    const fake = createFakeProviders({
      text: (req) => (isClassify(req) ? { groups: [group([1, 2, 3, 4, 5])], discarded: [{ unit_ids: [6], reason: 'x' }] } : { messages: [bugMessage([1, 2, 3], 'Quitar el rechazo sin comprobante'), bugMessage([4, 5], 'Abrir el historial anterior')] }),
    });
    const result = await analyze(await videoBundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.proposal.messages.map((m) => m.unit_ids), [[1, 2, 3], [4, 5]]);
  });

  it('source «frame» is set from the kind of the units in an input made only of images', async () => {
    const fake = createFakeProviders({ text: (req) => (isClassify(req) ? { groups: [group([1])], discarded: [] } : decompose(req)) });
    const result = await analyze(await makeBundle({ text: '', attachments: [{ id: 7, kind: 'image', extracted: 'Un panel vacío.' }] }), { providers: fake });
    assert.equal(result.proposal.messages[0].source, 'frame');
  });
});

describe('the prompts carry the rules of the review of a client video (H-3728)', async () => {
  const bundle = await makeBundle();
  const template = parseTemplate(bundle.templates.find((t) => t.id === 2).body_markdown);
  for (const language of ['es-419', 'en']) {
    const classify = classifySystem({ areas: bundle.areas, templates: bundle.templates, language }).join('\n');
    const decompose = decomposeSystem(template, null, language).join('\n');
    it(`${language}: one request per group and per message`, () => {
      assert.match(classify, language === 'en' ? /A group carries a single request/ : /Un grupo lleva un solo pedido/);
      assert.match(decompose, language === 'en' ? /A message is a single request of the person/ : /Un mensaje es un solo pedido de la persona/);
    });
    it(`${language}: a point is born from voice or text; frames are evidence and what is only seen goes to observed`, () => {
      assert.match(classify, language === 'en' ? /never forms a group of its own/ : /nunca forma un grupo propio/);
      assert.match(decompose, language === 'en' ? /it goes in observed/ : /va en observed/);
    });
    it(`${language}: the title names the action, a capability that never existed is a new feature, one screen in Where, quotes from the screen`, () => {
      assert.match(decompose, language === 'en' ? /The title names the action the person asks for/ : /El título nombra la acción que la persona pide/);
      assert.match(classify, language === 'en' ? /never did nor was agreed is New feature/ : /nunca hizo ni se acordó es Nueva funcionalidad/);
      assert.match(decompose, language === 'en' ? /names a single screen: the one that changes/ : /nombra una sola pantalla: la que cambia/);
      assert.match(decompose, language === 'en' ? /copy it as it reads on screen/ : /cópialo como se lee en la pantalla/);
    });
  }
});
