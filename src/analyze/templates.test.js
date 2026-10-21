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

// Palabras clave que la gramática de Anthropic no admite (informe 02 §1.1 [F1]).
const FORBIDDEN_IN_GRAMMAR = ['minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems', 'uniqueItems', 'pattern'];

function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (node && typeof node === 'object') {
    visit(node);
    Object.values(node).forEach((n) => walk(n, visit));
  }
}

describe('parseTemplate', () => {
  it('lee nombre, descripción, campos y cuerpo', () => {
    const t = parseTemplate(VALID);
    assert.equal(t.name, 'Reporte de error');
    assert.deepEqual(t.fields, [
      { name: 'steps', label: 'Pasos para reproducir', required: true },
      { name: 'where', label: 'Dónde (pantalla, URL)', required: false },
    ]);
    assert.match(t.body, /^## Método/);
    assert.deepEqual(t.warnings, []);
  });

  it('avisa si faltan las secciones Método o Formato de salida', () => {
    const t = parseTemplate(VALID.replace('## Formato de salida', '## Otra cosa'));
    assert.deepEqual(t.warnings, ['Falta la sección «## Formato de salida»']);
  });

  it('rechaza lo que no cumple los límites y la forma', () => {
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

  it('el YAML no ejecuta etiquetas de código', () => {
    assert.throws(() => parseTemplate('---\nname: !!js/function "function(){}"\ndescription: y\n---\ncuerpo'), TemplateError);
  });
});

describe('compileFieldsSchema', () => {
  const fields = parseTemplate(VALID).fields;

  it('perfil anthropic: lo opcional es una propiedad opcional', () => {
    const s = compileFieldsSchema(fields, { profile: 'anthropic' });
    assert.deepEqual(s.required, ['steps']);
    assert.deepEqual(s.properties.where, { type: 'string' });
    assert.equal(s.additionalProperties, false);
  });

  it('perfil all-required: todo requerido y lo opcional admite null', () => {
    const s = compileFieldsSchema(fields, { profile: 'all-required' });
    assert.deepEqual(s.required, ['steps', 'where']);
    assert.deepEqual(s.properties.where, { type: ['string', 'null'] });
  });

  it('la validación exige texto no vacío en lo obligatorio y acepta ausencia o null en lo opcional', () => {
    const validate = new Ajv({ strict: true, allowUnionTypes: true }).compile(compileFieldsSchema(fields, { validation: true }));
    assert.ok(validate({ steps: 'a' }));
    assert.ok(validate({ steps: 'a', where: null }));
    assert.ok(!validate({ steps: '' }));
    assert.ok(!validate({}));
    assert.ok(!validate({ steps: 'a', extra: 'x' }));
  });

  it('más de 24 opcionales exceden la gramática de Anthropic pero no la de los compatibles', () => {
    const many = Array.from({ length: ANTHROPIC_MAX_OPTIONAL_PROPERTIES + 1 }, (_, i) => ({ name: `f${i}`, label: `Campo ${i}`, required: false }));
    assert.throws(() => compileFieldsSchema(many, { profile: 'anthropic' }), TemplateError);
    assert.doesNotThrow(() => compileFieldsSchema(many, { profile: 'all-required' }));
    assert.doesNotThrow(() => compileFieldsSchema(many, { validation: true }));
  });
});

describe('juego inicial de plantillas', () => {
  it('trae las cinco plantillas de MASTER-SPEC §7.9 y no sobran archivos sueltos', async () => {
    const { areas, templates } = await loadSeed();
    assert.deepEqual(areas.map((a) => a.title), ['Idea', 'Error', 'Nueva funcionalidad', 'Retroalimentación', 'Pregunta']);
    assert.equal(templates.length, 5);
    const files = (await readdir(DEFAULT_TEMPLATES_DIR)).filter((f) => f.endsWith('.md')).sort();
    assert.deepEqual(files, ['bug.md', 'feature.md', 'feedback.md', 'idea.md', 'question.md']);
  });

  it('cada plantilla es válida, trae Método y Formato de salida y define al menos un campo obligatorio', async () => {
    const { templates } = await loadSeed();
    for (const row of templates) {
      const t = parseTemplate(row.body_markdown, { source: row.name });
      assert.deepEqual(t.warnings, [], row.name);
      assert.ok(t.name.length <= TEMPLATE_NAME_MAX);
      assert.ok(t.description.length <= TEMPLATE_DESCRIPTION_MAX);
      assert.ok(t.fields.some((f) => f.required), `${row.name} sin campos obligatorios`);
      assert.match(t.body, /Un mensaje por /, `${row.name}: el Formato de salida fija la unidad de un mensaje`);
    }
  });

  it('los esquemas de gramática de cada plantilla cumplen los límites de Anthropic', async () => {
    const { templates } = await loadSeed();
    for (const row of templates) {
      const t = parseTemplate(row.body_markdown);
      const schema = buildDecompositionSchema(t.fields, { profile: 'anthropic' });
      walk(schema, (node) => {
        for (const k of FORBIDDEN_IN_GRAMMAR) assert.ok(!(k in node), `${row.name}: «${k}» no se admite en la gramática`);
        if ('minItems' in node) assert.ok(node.minItems === 0 || node.minItems === 1);
        if (node.type === 'object' && node.properties && !node.additionalProperties?.type) assert.equal(node.additionalProperties, false);
      });
      // El orden de la salida es el del esquema: unit_ids primero (informe 02 §6.2).
      assert.deepEqual(Object.keys(schema.properties.messages.items.properties).slice(0, 2), ['unit_ids', 'title']);
    }
  });

  it('el esquema del Proposal del harness compila', () => {
    const ajv = new Ajv({ strict: true, allowUnionTypes: true });
    assert.doesNotThrow(() => ajv.compile(buildProposalSchema()));
  });
});
