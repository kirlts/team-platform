import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTemplate } from './templates.js';
import {
  closeStretches, coverage, foldEmptyGroups, normalizeDecomposition, repairClassification, repairCoverage, validateClassification, validateDecomposition, validateProposal,
} from './validate.js';
import { bugMessage, CLASSIFY_ERRORS, CLASSIFY_MULTI, goodDecomposition, makeBundle } from './testing/fixtures.js';

async function setup() {
  const bundle = await makeBundle();
  const template = parseTemplate(bundle.templates[1].body_markdown);
  const ctx = { fields: template.fields, scope: new Set([2, 3, 4, 5]), memberIds: new Set([1, 2, 3]), attachmentIds: new Set([10]), withDiscarded: false };
  return { bundle, ctx };
}

describe('coverage', () => {
  it('detects overlaps and gaps by sets', () => {
    const r = coverage([{ unit_ids: [1, 2] }, { unit_ids: [2, 3] }], [{ unit_ids: [3] }], [1, 2, 3, 4]);
    assert.deepEqual(r.overlaps, [{ unit_id: 2, owners: ['message 1', 'message 2'] }, { unit_id: 3, owners: ['message 2', 'discarded'] }]);
    assert.deepEqual(r.gaps, [4]);
  });
});

describe('validateDecomposition', () => {
  it('accepts the correct decomposition, with no errors or conflicts', async () => {
    const { ctx } = await setup();
    const v = validateDecomposition(goodDecomposition(), ctx);
    assert.deepEqual(v.errors, []);
    assert.deepEqual(v.conflicts, { overlaps: [], gaps: [] });
  });

  it('separates shape and reference errors from MECE conflicts', async () => {
    const { ctx } = await setup();
    const out = goodDecomposition();
    out.messages[0].unit_ids = [2, 3]; // overlap with message 2 and gap at u4
    const v = validateDecomposition(out, ctx);
    assert.deepEqual(v.errors, []);
    assert.deepEqual(v.conflicts.overlaps.map((o) => o.unit_id), [3]);
    assert.deepEqual(v.conflicts.gaps, [4]);
  });

  it('flags missing or empty required fields, empty messages and extra properties', async () => {
    const { ctx } = await setup();
    const out = goodDecomposition();
    delete out.messages[0].fields.actual;
    out.messages[1].title = '';
    out.messages[2].extra = 1;
    const errors = validateDecomposition(out, ctx).errors.join('\n');
    assert.match(errors, /missing «actual»/);
    assert.match(errors, /cannot be empty/);
    assert.match(errors, /unexpected «extra»/);
  });

  it('a required field of only spaces or a blank body count as empty', async () => {
    const { ctx } = await setup();
    const out = goodDecomposition();
    out.messages[0].fields.steps = '   ';
    out.messages[1].body = '  ';
    const errors = validateDecomposition(out, ctx).errors.join('\n');
    assert.match(errors, /the required field «steps» is empty/);
    assert.match(errors, /the body is empty/);
  });

  it('flags units, members and attachments that do not exist', async () => {
    const { ctx } = await setup();
    const out = goodDecomposition();
    out.messages[0].unit_ids = [2, 4, 99];
    out.messages[1].assignee_ids = [42];
    out.messages[2].attachment_ids = [77];
    const errors = validateDecomposition(out, ctx).errors.join('\n');
    assert.match(errors, /unit 99 does not exist/);
    assert.match(errors, /member 42 does not exist/);
    assert.match(errors, /attachment 77 does not belong to the input/);
  });

  it('does not coerce types or trim properties', async () => {
    const { ctx } = await setup();
    const out = goodDecomposition();
    out.messages[0].unit_ids = ['2', 4];
    assert.ok(validateDecomposition(out, ctx).errors.length > 0);
    assert.equal(out.messages[0].unit_ids[0], '2');
  });

  it('accepts optional fields with null and the empty message list with everything discarded', async () => {
    const { ctx } = await setup();
    const out = { messages: [bugMessage([2, 3, 4, 5], 'Un solo error', { fields: { steps: 'a', expected: 'b', actual: 'c', where: null } })] };
    assert.deepEqual(validateDecomposition(out, ctx).errors, []);
    const vacio = { messages: [], discarded: [{ unit_ids: [2, 3, 4, 5], reason: 'charla' }] };
    assert.deepEqual(validateDecomposition(vacio, { ...ctx, withDiscarded: true }), { errors: [], conflicts: { overlaps: [], gaps: [] } });
    assert.match(validateDecomposition({ messages: [] }, { ...ctx, requireMessage: true }).errors[0], /the group produced no message/);
    assert.match(validateDecomposition(vacio, ctx).errors[0], /unexpected «discarded»/);
  });
});

describe('validateClassification', () => {
  const scope = new Set([1, 2, 3, 4, 5, 6]);
  it('accepts groups that with the discards cover each unit once', async () => {
    const { areas, templates } = await makeBundle();
    assert.deepEqual(validateClassification(CLASSIFY_ERRORS, { areas, templates, scope }), { errors: [] });
    const multi = { ...CLASSIFY_MULTI, discarded: [{ unit_ids: [1, 5, 6], reason: 'charla' }] };
    assert.deepEqual(validateClassification(multi, { areas, templates, scope: new Set([1, 2, 3, 4, 5, 6]) }).errors, []);
  });

  it('requires the area and the template to exist and to match', async () => {
    const { areas, templates } = await makeBundle();
    const group = (area_id, template_id) => ({ groups: [{ unit_ids: [2, 3, 4, 5], area_id, template_id }], discarded: CLASSIFY_ERRORS.discarded });
    assert.match(validateClassification(group(2, 3), { areas, templates, scope }).errors[0], /group 1: template 3 does not belong to area 2/);
    assert.match(validateClassification(group(99, 2), { areas, templates, scope }).errors[0], /allowed list/);
  });

  it('flags nonexistent units, overlaps between groups and gaps', async () => {
    const { areas, templates } = await makeBundle();
    const inexistente = { groups: [{ unit_ids: [2, 3, 4, 5, 77], area_id: 2, template_id: 2 }], discarded: CLASSIFY_ERRORS.discarded };
    assert.match(validateClassification(inexistente, { areas, templates, scope }).errors[0], /unit 77 does not exist/);
    const solape = { groups: [{ unit_ids: [2, 3], area_id: 2, template_id: 2 }, { unit_ids: [3, 4, 5], area_id: 1, template_id: 1 }], discarded: CLASSIFY_ERRORS.discarded };
    assert.match(validateClassification(solape, { areas, templates, scope }).errors[0], /unit 3 is in more than one place \(group 1 and group 2\)/);
    const hueco = { groups: [{ unit_ids: [2, 3], area_id: 2, template_id: 2 }], discarded: CLASSIFY_ERRORS.discarded };
    assert.match(validateClassification(hueco, { areas, templates, scope }).errors[0], /units 4, 5 are in no place/);
    const descartadaYAgrupada = { groups: CLASSIFY_ERRORS.groups, discarded: [...CLASSIFY_ERRORS.discarded, { unit_ids: [2], reason: 'x' }] };
    assert.match(validateClassification(descartadaYAgrupada, { areas, templates, scope }).errors[0], /unit 2 is in more than one place \(group 1 and discarded\)/);
  });

  it('rejects empty groups and extra properties', async () => {
    const { areas, templates } = await makeBundle();
    const out = { groups: [{ unit_ids: [], area_id: 2, template_id: 2, extra: 1 }], discarded: [] };
    const errors = validateClassification(out, { areas, templates, scope }).errors.join('\n');
    assert.match(errors, /at least 1 item/);
    assert.match(errors, /unexpected «extra»/);
  });
});

describe('validateProposal', () => {
  async function ctx() {
    const bundle = await makeBundle();
    const fieldsByTemplate = new Map([2, 1, 5].map((id) => [id, parseTemplate(bundle.templates[id - 1].body_markdown).fields]));
    return { templates: bundle.templates, fieldsByTemplate, scope: new Set([1, 2, 3, 4, 5]), memberIds: new Set([1, 2, 3]), attachmentIds: new Set([10]) };
  }
  const idea = { unit_ids: [3], area_id: 1, template_id: 1, title: 'Agrupar por día', fields: { idea: 'x', motivation: 'y' }, body: 'z', assignee_ids: [], attachment_ids: [] };
  const pregunta = { unit_ids: [4], area_id: 5, template_id: 5, title: 'Q', fields: { question: '¿?' }, body: 'Q', assignee_ids: [], attachment_ids: [] };
  const error = { ...bugMessage([2], 'E'), area_id: 2, template_id: 2 };

  it('validates each message against its own template and the conflicts over the union of the groups', async () => {
    const c = await ctx();
    const ok = validateProposal({ messages: [error, idea, pregunta], discarded: [{ unit_ids: [1, 5], reason: 'charla' }] }, c);
    assert.deepEqual(ok, { errors: [], conflicts: { overlaps: [], gaps: [] } });
    const cruzado = validateProposal({ messages: [error, { ...idea, fields: { question: 'x' } }, pregunta], discarded: [{ unit_ids: [1, 5], reason: 'c' }] }, c);
    assert.match(cruzado.errors.join('\n'), /message 2, fields: missing «idea»/);
    const hueco = validateProposal({ messages: [error, idea], discarded: [{ unit_ids: [1, 5], reason: 'c' }] }, c);
    assert.deepEqual(hueco.conflicts.gaps, [4]);
    const solape = validateProposal({ messages: [error, { ...idea, unit_ids: [2, 3] }, pregunta], discarded: [{ unit_ids: [1, 5], reason: 'c' }] }, c);
    assert.deepEqual(solape.conflicts.overlaps.map((o) => o.unit_id), [2]);
  });

  it('rejects a nonexistent template or one from another area', async () => {
    const c = await ctx();
    assert.match(validateProposal({ messages: [{ ...idea, template_id: 99 }], discarded: [] }, c).errors[0], /template 99 does not exist/);
    assert.match(validateProposal({ messages: [{ ...idea, area_id: 2 }], discarded: [] }, c).errors[0], /does not belong to area 2/);
  });
});

describe('normalizeDecomposition', () => {
  it('sorts, removes nulls and trims', () => {
    const out = normalizeDecomposition({
      messages: [bugMessage([5, 3], ' B ', { fields: { steps: ' a ', where: null }, assignee_ids: [2, 1, 2] }), bugMessage([1], 'A')],
      discarded: [{ unit_ids: [9], reason: ' x ' }],
    });
    assert.deepEqual(out.messages.map((m) => m.title), ['A', 'B']);
    assert.deepEqual(out.messages[1].unit_ids, [3, 5]);
    assert.deepEqual(out.messages[1].fields, { steps: 'a' });
    assert.deepEqual(out.messages[1].assignee_ids, [1, 2]);
    assert.equal(out.discarded[0].reason, 'x');
  });
});

describe('repairCoverage', () => {
  const m = (...unit_ids) => ({ unit_ids, title: 't' });

  it('a unit cited twice stays in the first message and a unit cited by none joins the closest one before it', () => {
    const out = repairCoverage([m(1, 2, 4), m(4, 6)], [], [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(out.messages.map((x) => x.unit_ids), [[1, 2, 3, 4, 5], [6]]);
  });

  it('a gap before the first cited unit joins the first message; discarded units stay discarded', () => {
    const out = repairCoverage([m(3, 4)], [{ unit_ids: [2], reason: 'x' }], [1, 2, 3, 4]);
    assert.deepEqual(out.messages.map((x) => x.unit_ids), [[1, 3, 4]]);
    assert.deepEqual(out.discarded, [{ unit_ids: [2], reason: 'x' }]);
  });

  it('a unit both cited and discarded is kept in its message, and a message left empty disappears', () => {
    const out = repairCoverage([m(1, 2), m(2)], [{ unit_ids: [2], reason: 'x' }], [1, 2]);
    assert.deepEqual(out.messages.map((x) => x.unit_ids), [[1, 2]]);
    assert.deepEqual(out.discarded, []);
  });

  it('with no message there is nothing to repair into', () => {
    assert.equal(repairCoverage([], [], [1, 2]), null);
  });
});

describe('closeStretches', () => {
  const g = (...unit_ids) => ({ unit_ids, area_id: 2, template_id: 2 });
  const d = (reason, ...unit_ids) => ({ unit_ids, reason });

  it('what is discarded inside the stretch of a group joins it; what lies outside every stretch stays discarded', () => {
    const out = closeStretches([g(3, 6), g(9, 10)], [d('hola', 1, 2), d('charla', 4, 5, 7), d('cierre', 11)]);
    assert.deepEqual(out.groups.map((x) => x.unit_ids), [[3, 4, 5, 6], [9, 10]]);
    assert.deepEqual(out.discarded.map((x) => x.unit_ids), [[1, 2], [7], [11]]);
  });

  it('when the stretches of two groups overlap, the unit goes to the group with the closest member', () => {
    const out = closeStretches([g(1, 10), g(4, 6)], [d('x', 5, 9)]);
    assert.deepEqual(out.groups.map((x) => x.unit_ids), [[1, 9, 10], [4, 5, 6]]);
  });

  it('nothing is discarded, nothing changes', () => {
    const groups = [g(1, 2), g(3)];
    assert.deepEqual(closeStretches(groups, []).groups, groups);
  });
});

describe('foldEmptyGroups (H-1902)', () => {
  const g = (area, ...unit_ids) => ({ unit_ids, area_id: area, template_id: area });
  const empty = new Set([1, 4, 5]);

  it('a group of marks alone joins the group of the unit right after it', () => {
    const out = foldEmptyGroups([g(2, 1), g(3, 2, 3)], [], empty, 'r');
    assert.deepEqual(out.groups.map((x) => [x.area_id, x.unit_ids]), [[3, [1, 2, 3]]]);
    assert.equal(out.folded, 1);
  });

  it('a mark whose next unit was discarded is discarded with it', () => {
    const out = foldEmptyGroups([g(2, 1, 2, 3), g(3, 4)], [{ unit_ids: [5, 6], reason: 'charla' }], empty, 'sin contenido');
    assert.deepEqual(out.groups.map((x) => x.unit_ids), [[1, 2, 3]]);
    assert.deepEqual(out.discarded, [{ unit_ids: [5, 6], reason: 'charla' }, { unit_ids: [4], reason: 'sin contenido' }]);
  });

  it('consecutive marks chain into the group that finally has content', () => {
    const out = foldEmptyGroups([g(2, 4), g(3, 5), g(1, 6, 7)], [], empty, 'r');
    assert.deepEqual(out.groups.map((x) => x.unit_ids), [[4, 5, 6, 7]]);
  });

  it('a group with content, even one unit, stays as it is', () => {
    const groups = [g(2, 1, 2), g(3, 3)];
    const out = foldEmptyGroups(groups, [], empty, 'r');
    assert.equal(out.groups, groups);
    assert.equal(out.folded, 0);
  });
});

describe('repairClassification', () => {
  it('a unit cited twice stays in the first place; a unit cited nowhere goes where the closest unit before it went', () => {
    const out = repairClassification({
      groups: [{ unit_ids: [1, 2, 4], area_id: 2, template_id: 2 }, { unit_ids: [4, 7], area_id: 1, template_id: 1 }],
      discarded: [{ unit_ids: [5], reason: 'charla' }],
    }, [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(out.groups.map((g) => g.unit_ids), [[1, 2, 3, 4], [7]]);
    assert.deepEqual(out.discarded.map((d) => d.unit_ids), [[5, 6]]);
  });

  it('a first unit cited nowhere follows the closest unit after it', () => {
    const out = repairClassification({ groups: [{ unit_ids: [2, 3], area_id: 2, template_id: 2 }], discarded: [] }, [1, 2, 3]);
    assert.deepEqual(out.groups.map((g) => g.unit_ids), [[1, 2, 3]]);
  });
});

describe('a message that only says there is no data', () => {
  it('a title or a body that is exactly the empty-field value is an error', async () => {
    const { ctx } = await setup();
    const out = { messages: [{ ...bugMessage([2, 3, 4, 5], 'No indicado'), body: 'No indicado' }] };
    const result = validateDecomposition(out, ctx);
    assert.match(result.errors.join('\n'), /only says that there is no data/);
  });
});
