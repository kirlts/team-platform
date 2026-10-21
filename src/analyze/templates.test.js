import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { describe, it } from 'node:test';
import Ajv from 'ajv';
import { TemplateError } from './errors.js';
import { DEFAULT_TEMPLATES_DIR, loadSeed } from './seed.js';
import {
  ANTHROPIC_MAX_OPTIONAL_PROPERTIES, compileFieldsSchema, parseTemplate, TEMPLATE_DESCRIPTION_MAX, TEMPLATE_NAME_MAX,
} from './templates.js';
import { buildDecompositionSchema, buildProposalSchema } from './schema.js';

const VALID = `---
name: Reporte de error
description: Algo que no funciona.
fields:
  - { name: steps, label: Pasos para reproducir, required: true }
  - { name: where, label: "Dónde (pantalla, URL)", required: false }
---
## Método
Cómo leer el input.

## Formato de salida
Un mensaje por error.
`;

// Keywords that Anthropic's grammar does not support (report 02 §1.1 [F1]).
const FORBIDDEN_IN_GRAMMAR = ['minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems', 'uniqueItems', 'pattern'];

function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (node && typeof node === 'object') {
    visit(node);
    Object.values(node).forEach((n) => walk(n, visit));
  }
}

describe('parseTemplate', () => {
  it('reads name, description, fields and body', () => {
    const t = parseTemplate(VALID);
    assert.equal(t.name, 'Reporte de error');
    assert.deepEqual(t.fields, [
      { name: 'steps', label: 'Pasos para reproducir', required: true },
      { name: 'where', label: 'Dónde (pantalla, URL)', required: false },
    ]);
    assert.match(t.body, /^## Método/);
    assert.deepEqual(t.warnings, []);
  });

  it('warns if the `Método` or `Formato de salida` sections are missing', () => {
    const t = parseTemplate(VALID.replace('## Formato de salida', '## Otra cosa'));
    assert.deepEqual(t.warnings, ['Falta la sección «## Formato de salida»']);
  });

  it('rejects what does not meet the limits and the shape', () => {
    const rechaza = (markdown, fragmento) =>
      assert.throws(() => parseTemplate(markdown), (e) => e instanceof TemplateError && e.message.includes(fragmento), fragmento);
    rechaza('sin frontmatter', 'frontmatter');
    rechaza('---\nname: x\n', 'no se cierra');
    rechaza(VALID.replace('name: Reporte de error', `name: ${'n'.repeat(TEMPLATE_NAME_MAX + 1)}`), '«name»');
    rechaza(VALID.replace('description: Algo que no funciona.', `description: ${'d'.repeat(TEMPLATE_DESCRIPTION_MAX + 1)}`), '«description»');
    rechaza(VALID.replace('name: steps', 'name: Pasos'), 'identificador');
    rechaza(VALID.replace('name: where', 'name: steps'), 'repetido');
    rechaza(VALID.replace('required: false', 'required: quizás'), 'required');
    rechaza(VALID.replace('fields:', 'extra: 1\nfields:'), 'Claves desconocidas');
    rechaza(VALID.replace('fields:\n  - { name: steps, label: Pasos para reproducir, required: true }', 'fields:\n  - { name: steps, label: Pasos, required: true, tipo: texto }'), 'claves desconocidas');
    rechaza('---\nname: x\ndescription: y\nfields: [\n---\ncuerpo', 'YAML');
    rechaza('---\nname: x\ndescription: y\n---\n', 'no tiene cuerpo');
  });

  it('the YAML does not execute code tags', () => {
    assert.throws(() => parseTemplate('---\nname: !!js/function "function(){}"\ndescription: y\n---\ncuerpo'), TemplateError);
  });
});

describe('compileFieldsSchema', () => {
  const fields = parseTemplate(VALID).fields;

  it('anthropic profile: optional means an optional property', () => {
    const s = compileFieldsSchema(fields, { profile: 'anthropic' });
    assert.deepEqual(s.required, ['steps']);
    assert.deepEqual(s.properties.where, { type: 'string' });
    assert.equal(s.additionalProperties, false);
  });

  it('all-required profile: everything required and optional admits null', () => {
    const s = compileFieldsSchema(fields, { profile: 'all-required' });
    assert.deepEqual(s.required, ['steps', 'where']);
    assert.deepEqual(s.properties.where, { type: ['string', 'null'] });
  });

  it('validation requires non-empty text in required fields and accepts absence or null in optional ones', () => {
    const validate = new Ajv({ strict: true, allowUnionTypes: true }).compile(compileFieldsSchema(fields, { validation: true }));
    assert.ok(validate({ steps: 'a' }));
    assert.ok(validate({ steps: 'a', where: null }));
    assert.ok(!validate({ steps: '' }));
    assert.ok(!validate({}));
    assert.ok(!validate({ steps: 'a', extra: 'x' }));
  });

  it('more than 24 optionals exceed Anthropic\'s grammar but not that of the compatible ones', () => {
    const many = Array.from({ length: ANTHROPIC_MAX_OPTIONAL_PROPERTIES + 1 }, (_, i) => ({ name: `f${i}`, label: `Campo ${i}`, required: false }));
    assert.throws(() => compileFieldsSchema(many, { profile: 'anthropic' }), TemplateError);
    assert.doesNotThrow(() => compileFieldsSchema(many, { profile: 'all-required' }));
    assert.doesNotThrow(() => compileFieldsSchema(many, { validation: true }));
  });
});

describe('initial set of templates', () => {
  it('brings the five templates of MASTER-SPEC §7.9 and no stray files', async () => {
    const { areas, templates } = await loadSeed();
    assert.deepEqual(areas.map((a) => a.title), ['Idea', 'Error', 'Nueva funcionalidad', 'Retroalimentación', 'Pregunta']);
    assert.equal(templates.length, 5);
    const files = (await readdir(DEFAULT_TEMPLATES_DIR)).filter((f) => f.endsWith('.md')).sort();
    assert.deepEqual(files, ['bug.md', 'feature.md', 'feedback.md', 'idea.md', 'question.md']);
  });

  it('each template is valid, has `Método` and `Formato de salida` and defines at least one required field', async () => {
    const { templates } = await loadSeed();
    for (const row of templates) {
      const t = parseTemplate(row.body_markdown, { source: row.name });
      assert.deepEqual(t.warnings, [], row.name);
      assert.ok(t.name.length <= TEMPLATE_NAME_MAX);
      assert.ok(t.description.length <= TEMPLATE_DESCRIPTION_MAX);
      assert.ok(t.fields.some((f) => f.required), `${row.name} has no required fields`);
      assert.match(t.body, /Un mensaje por /, `${row.name}: the Formato de salida fixes the unit of a message`);
    }
  });

  it('the grammar schemas of each template meet Anthropic\'s limits', async () => {
    const { templates } = await loadSeed();
    for (const row of templates) {
      const t = parseTemplate(row.body_markdown);
      const schema = buildDecompositionSchema(t.fields, { profile: 'anthropic' });
      walk(schema, (node) => {
        for (const k of FORBIDDEN_IN_GRAMMAR) assert.ok(!(k in node), `${row.name}: «${k}» is not supported in the grammar`);
        if ('minItems' in node) assert.ok(node.minItems === 0 || node.minItems === 1);
        if (node.type === 'object' && node.properties && !node.additionalProperties?.type) assert.equal(node.additionalProperties, false);
      });
      // The output order is that of the schema: unit_ids first (report 02 §6.2).
      assert.deepEqual(Object.keys(schema.properties.messages.items.properties).slice(0, 2), ['unit_ids', 'title']);
    }
  });

  it('the harness Proposal schema compiles', () => {
    const ajv = new Ajv({ strict: true, allowUnionTypes: true });
    assert.doesNotThrow(() => ajv.compile(buildProposalSchema()));
  });
});
