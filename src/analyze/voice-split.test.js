// H-3731: the transcription cuts voice by time, so a voice unit can start with the end of the previous sentence, and a closing
// that only sums up requests already said came out as a message. The model declares both; the system checks the shape.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFakeProviders } from '../providers/index.js';
import { analyze } from './index.js';
import { bugMessage, makeBundle, unitIdsIn } from './testing/fixtures.js';
import { numberUnits } from './units.js';
import { applySplits, foldRecapGroups, splitProblem, validateClassification } from './validate.js';

// u1 voice, u2 frame, u3 voice (starts with the end of u1's sentence), u4 voice (a closing)
const VIDEO = [
  '[00:00-00:10] Voz: el historial no abre y quiero ver cómo se',
  '[00:05] Fotograma 1: Barra de historial.',
  '[00:10-00:20] Voz: desenvolvió esa conversación, la persona aparece dos veces',
  '[00:20-00:25] Voz: necesitamos que el equipo use todo según su rol',
].join('\n');
const units = numberUnits({ attachments: [{ id: 1, kind: 'video', extracted: VIDEO }] });
const scope = new Set(units.map((u) => u.id));
const group = (ids, extra = {}) => ({ unit_ids: ids, area_id: 2, template_id: 2, ...extra });
const ctx = { areas: [{ id: 2 }], templates: [{ id: 2, area_id: 2 }], scope, frameIds: new Set([2]), units };
const isClassify = (req) => Boolean(req.schema.properties.groups);

describe('split_at moves the first words of a voice unit to the voice unit before it (H-3731)', () => {
  it('the words before «at» finish the previous voice unit; ids and labels stay', () => {
    const { units: out, applied } = applySplits(units, [{ unit_id: 3, at: 'la persona aparece dos veces' }]);
    assert.equal(applied, 1);
    assert.equal(out[0].text, '[00:00-00:10] Voz: el historial no abre y quiero ver cómo se desenvolvió esa conversación,');
    assert.equal(out[2].text, '[00:10-00:20] Voz: la persona aparece dos veces');
    assert.deepEqual(out.map((u) => u.id), units.map((u) => u.id));
    assert.equal(units[2].text.includes('desenvolvió'), true, 'the input units are not mutated');
  });

  it('a split whose words are not in the unit, are at its start, or fall on a frame is a shape error and is skipped', () => {
    assert.match(splitProblem({ unit_id: 3, at: 'otra cosa' }, units, scope), /is not inside the text of u3/);
    assert.match(splitProblem({ unit_id: 3, at: 'desenvolvió' }, units, scope), /after its first word/);
    assert.match(splitProblem({ unit_id: 2, at: 'historial' }, units, scope), /not a voice unit/);
    assert.match(splitProblem({ unit_id: 1, at: 'no abre' }, units, scope), /no voice unit before it/);
    assert.equal(applySplits(units, [{ unit_id: 3, at: 'otra cosa' }]).applied, 0);
    const v = validateClassification({ split_at: [{ unit_id: 3, at: 'otra cosa' }], groups: [group([1, 2, 3, 4])], discarded: [] }, ctx);
    assert.match(v.errors[0], /split_at 1:/);
    assert.ok(v.repairable, 'a bad split never fails the input');
  });

  it('the analysis applies the split before the decomposition reads the units', async () => {
    const fake = createFakeProviders({
      text: (req) => (isClassify(req)
        ? { split_at: [{ unit_id: 3, at: 'la persona aparece dos veces' }], groups: [group([1, 2]), group([3, 4], { recap_unit_ids: [4] })], discarded: [] }
        : { messages: [bugMessage(unitIdsIn(req), `Corregir ${unitIdsIn(req).join('-')}`)] }),
    });
    const result = await analyze(await makeBundle({ text: '', attachments: [{ id: 1, kind: 'video', extracted: VIDEO }] }), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.equal(result.stats.voice_splits, 1);
    assert.match(result.units[0].text, /desenvolvió esa conversación,$/);
    const decompositions = fake.calls.text.filter((r) => !isClassify(r)).map((r) => JSON.stringify(r.messages));
    assert.ok(decompositions.some((d) => d.includes('[u3] (a1.p3) [00:10-00:20] Voz: la persona aparece dos veces')));
  });
});

describe('a unit that only closes requests already said is not a request (H-3731)', () => {
  it('recap units outside the group, and a group made only of recap units, are shape errors', () => {
    const v = validateClassification({ split_at: [], groups: [group([1, 2, 3]), group([4], { recap_unit_ids: [4] }), group([1], { recap_unit_ids: [9] })], discarded: [] }, { ...ctx, units: null });
    assert.ok(v.errors.some((e) => /group 2: only closes requests already said/.test(e)));
    assert.ok(v.errors.some((e) => /group 3: recap_unit_ids u9 are not in its unit_ids/.test(e)));
  });

  it('a recap-only group joins the group of the closest request before it, as recap there', () => {
    const out = foldRecapGroups({ groups: [group([1, 2]), group([3]), group([4], { recap_unit_ids: [4] })], discarded: [] }, new Set([2]));
    assert.deepEqual(out.groups.map((g) => [g.unit_ids, g.recap_unit_ids]), [[[1, 2], []], [[3, 4], [4]]]);
  });

  it('with no recap-only group the classification passes untouched', () => {
    const input = { groups: [group([1, 2]), group([3, 4], { recap_unit_ids: [4] })], discarded: [] };
    assert.equal(foldRecapGroups(input, new Set([2])), input);
  });
});
