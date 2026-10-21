import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTemplate } from './templates.js';
import {
  coverage, normalizeDecomposition, validateClassification, validateDecomposition, validateProposal,
} from './validate.js';
import { bugMessage, CLASSIFY_ERRORS, CLASSIFY_MULTI, goodDecomposition, makeBundle } from './testing/fixtures.js';

async function setup() {
  const bundle = await makeBundle();
  const template = parseTemplate(bundle.templates[1].body_markdown);
  const ctx = { fields: template.fields, scope: new Set([2, 3, 4, 5]), memberIds: new Set([1, 2, 3]), attachmentIds: new Set([10]) };
  return { bundle, ctx };
}

describe('coverage', () => {
  it('detecta solapes y huecos por conjuntos', () => {
    const r = coverage([{ unit_ids: [1, 2] }, { unit_ids: [2, 3] }], [{ unit_ids: [3] }], [1, 2, 3, 4]);
    assert.deepEqual(r.overlaps, [{ unit_id: 2, owners: ['mensaje 1', 'mensaje 2'] }, { unit_id: 3, owners: ['mensaje 2', 'descartada'] }]);
    assert.deepEqual(r.gaps, [4]);
  });
});

describe('validateDecomposition', () => {
  it('acepta la descomposición correcta, sin errores ni conflictos', async () => {
    const { ctx } = await setup();
    const v = validateDecomposition(goodDecomposition(), ctx);
    assert.deepEqual(v.errors, []);
    assert.deepEqual(v.conflicts, { overlaps: [], gaps: [] });
  });

  it('separa errores de forma y referencias de los conflictos MECE', async () => {
    const { ctx } = await setup();
    const out = goodDecomposition();
    out.messages[0].unit_ids = [2, 3]; // solape con el mensaje 2 y hueco en la u4
    const v = validateDecomposition(out, ctx);
    assert.deepEqual(v.errors, []);
    assert.deepEqual(v.conflicts.overlaps.map((o) => o.unit_id), [3]);
    assert.deepEqual(v.conflicts.gaps, [4]);
  });

  it('señala campos obligatorios ausentes o vacíos, mensajes vacíos y propiedades de más', async () => {
    const { ctx } = await setup();
    const out = goodDecomposition();
    delete out.messages[0].fields.actual;
    out.messages[1].title = '';
    out.messages[2].extra = 1;
    const errors = validateDecomposition(out, ctx).errors.join('\n');
    assert.match(errors, /falta «actual»/);
    assert.match(errors, /no puede estar vacío/);
    assert.match(errors, /sobra «extra»/);
  });

  it('un campo obligatorio de sólo espacios o un cuerpo en blanco cuentan como vacíos', async () => {
    const { ctx } = await setup();
    const out = goodDecomposition();
    out.messages[0].fields.steps = '   ';
    out.messages[1].body = '  ';
    const errors = validateDecomposition(out, ctx).errors.join('\n');
    assert.match(errors, /«steps» está vacío/);
    assert.match(errors, /el cuerpo está vacío/);
  });

  it('señala unidades, miembros y adjuntos que no existen', async () => {
    const { ctx } = await setup();
    const out = goodDecomposition();
    out.messages[0].unit_ids = [2, 4, 99];
    out.messages[1].assignee_ids = [42];
    out.messages[2].attachment_ids = [77];
    const errors = validateDecomposition(out, ctx).errors.join('\n');
    assert.match(errors, /la unidad 99 no existe/);
    assert.match(errors, /el miembro 42 no existe/);
    assert.match(errors, /el adjunto 77 no pertenece al input/);
  });

  it('no coacciona tipos ni recorta propiedades', async () => {
    const { ctx } = await setup();
    const out = goodDecomposition();
    out.messages[0].unit_ids = ['2', 4];
    assert.ok(validateDecomposition(out, ctx).errors.length > 0);
    assert.equal(out.messages[0].unit_ids[0], '2');
  });

  it('acepta campos opcionales con null y la lista vacía de mensajes con todo descartado', async () => {
    const { ctx } = await setup();
    const out = { messages: [bugMessage([2, 3, 4, 5], 'Un solo error', { fields: { steps: 'a', expected: 'b', actual: 'c', where: null } })], discarded: [] };
    assert.deepEqual(validateDecomposition(out, ctx).errors, []);
    const vacio = { messages: [], discarded: [{ unit_ids: [2, 3, 4, 5], reason: 'charla' }] };
    assert.deepEqual(validateDecomposition(vacio, ctx), { errors: [], conflicts: { overlaps: [], gaps: [] } });
  });
});

describe('validateClassification', () => {
  const scope = new Set([1, 2, 3, 4, 5, 6]);
  it('acepta grupos que con los descartes cubren cada unidad una vez', async () => {
    const { areas, templates } = await makeBundle();
    assert.deepEqual(validateClassification(CLASSIFY_ERRORS, { areas, templates, scope }), { errors: [] });
    const multi = { ...CLASSIFY_MULTI, discarded: [{ unit_ids: [1, 5, 6], reason: 'charla' }] };
    assert.deepEqual(validateClassification(multi, { areas, templates, scope: new Set([1, 2, 3, 4, 5, 6]) }).errors, []);
  });

  it('exige que el área y la plantilla existan y se correspondan', async () => {
    const { areas, templates } = await makeBundle();
    const group = (area_id, template_id) => ({ groups: [{ unit_ids: [2, 3, 4, 5], area_id, template_id }], discarded: CLASSIFY_ERRORS.discarded });
    assert.match(validateClassification(group(2, 3), { areas, templates, scope }).errors[0], /grupo 1: la plantilla 3 no pertenece al área 2/);
    assert.match(validateClassification(group(99, 2), { areas, templates, scope }).errors[0], /lista permitida/);
  });

  it('señala unidades inexistentes, solapes entre grupos y huecos', async () => {
    const { areas, templates } = await makeBundle();
    const inexistente = { groups: [{ unit_ids: [2, 3, 4, 5, 77], area_id: 2, template_id: 2 }], discarded: CLASSIFY_ERRORS.discarded };
    assert.match(validateClassification(inexistente, { areas, templates, scope }).errors[0], /la unidad 77 no existe/);
    const solape = { groups: [{ unit_ids: [2, 3], area_id: 2, template_id: 2 }, { unit_ids: [3, 4, 5], area_id: 1, template_id: 1 }], discarded: CLASSIFY_ERRORS.discarded };
    assert.match(validateClassification(solape, { areas, templates, scope }).errors[0], /unidad 3 está en más de un lugar \(grupo 1 y grupo 2\)/);
    const hueco = { groups: [{ unit_ids: [2, 3], area_id: 2, template_id: 2 }], discarded: CLASSIFY_ERRORS.discarded };
    assert.match(validateClassification(hueco, { areas, templates, scope }).errors[0], /las unidades 4, 5 no están en ningún lugar/);
    const descartadaYAgrupada = { groups: CLASSIFY_ERRORS.groups, discarded: [...CLASSIFY_ERRORS.discarded, { unit_ids: [2], reason: 'x' }] };
    assert.match(validateClassification(descartadaYAgrupada, { areas, templates, scope }).errors[0], /unidad 2 está en más de un lugar \(grupo 1 y descartada\)/);
  });

  it('rechaza grupos vacíos y propiedades de más', async () => {
    const { areas, templates } = await makeBundle();
    const out = { groups: [{ unit_ids: [], area_id: 2, template_id: 2, extra: 1 }], discarded: [] };
    const errors = validateClassification(out, { areas, templates, scope }).errors.join('\n');
    assert.match(errors, /al menos 1 elemento/);
    assert.match(errors, /sobra «extra»/);
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

  it('valida cada mensaje contra su propia plantilla y los conflictos sobre la unión de los grupos', async () => {
    const c = await ctx();
    const ok = validateProposal({ messages: [error, idea, pregunta], discarded: [{ unit_ids: [1, 5], reason: 'charla' }] }, c);
    assert.deepEqual(ok, { errors: [], conflicts: { overlaps: [], gaps: [] } });
    const cruzado = validateProposal({ messages: [error, { ...idea, fields: { question: 'x' } }, pregunta], discarded: [{ unit_ids: [1, 5], reason: 'c' }] }, c);
    assert.match(cruzado.errors.join('\n'), /mensaje 2, campos: falta «idea»/);
    const hueco = validateProposal({ messages: [error, idea], discarded: [{ unit_ids: [1, 5], reason: 'c' }] }, c);
    assert.deepEqual(hueco.conflicts.gaps, [4]);
    const solape = validateProposal({ messages: [error, { ...idea, unit_ids: [2, 3] }, pregunta], discarded: [{ unit_ids: [1, 5], reason: 'c' }] }, c);
    assert.deepEqual(solape.conflicts.overlaps.map((o) => o.unit_id), [2]);
  });

  it('rechaza una plantilla inexistente o de otra área', async () => {
    const c = await ctx();
    assert.match(validateProposal({ messages: [{ ...idea, template_id: 99 }], discarded: [] }, c).errors[0], /la plantilla 99 no existe/);
    assert.match(validateProposal({ messages: [{ ...idea, area_id: 2 }], discarded: [] }, c).errors[0], /no pertenece al área 2/);
  });
});

describe('normalizeDecomposition', () => {
  it('ordena, quita nulos y recorta', () => {
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
