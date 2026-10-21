import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTemplate } from './templates.js';
import { coverage, normalizeDecomposition, validateClassification, validateDecomposition } from './validate.js';
import { bugMessage, goodDecomposition, makeBundle } from './testing/fixtures.js';

async function setup() {
  const bundle = await makeBundle();
  const template = parseTemplate(bundle.templates[1].body_markdown);
  const ctx = { fields: template.fields, scope: new Set([1, 2, 3, 4, 5, 6]), memberIds: new Set([1, 2, 3]), attachmentIds: new Set([10]) };
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
    const out = { messages: [bugMessage([1, 2, 3, 4, 5, 6], 'Un solo error', { fields: { steps: 'a', expected: 'b', actual: 'c', where: null } })], discarded: [] };
    assert.deepEqual(validateDecomposition(out, ctx).errors, []);
    const vacio = { messages: [], discarded: [{ unit_ids: [1, 2, 3, 4, 5, 6], reason: 'charla' }] };
    assert.deepEqual(validateDecomposition(vacio, ctx), { errors: [], conflicts: { overlaps: [], gaps: [] } });
  });
});

describe('validateClassification', () => {
  it('exige que el área y la plantilla existan y se correspondan', async () => {
    const { areas, templates } = await makeBundle();
    assert.deepEqual(validateClassification({ area_id: 2, template_id: 2 }, { areas, templates }), []);
    assert.match(validateClassification({ area_id: 2, template_id: 3 }, { areas, templates })[0], /no pertenece al área/);
    assert.match(validateClassification({ area_id: 99, template_id: 2 }, { areas, templates })[0], /lista permitida/);
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
