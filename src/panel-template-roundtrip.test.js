// J1-A-32: the panel edits a template as a form (fields and instructions) and stores it with `buildTemplate`.
// What it builds has to be a file the server accepts, and what the server reads has to be what the form
// showed. The panel's module is TypeScript without imports of its own, which Node reads directly.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTemplate } from './analyze/templates.js';
import { buildTemplate, fieldKey, parseTemplateFields, templateInstructions } from '../panel/src/lib/template.ts';

const INSTRUCTIONS = '## Método\nUna idea por mensaje.\n\n## Formato de salida\nUn mensaje por idea.';

describe('template built by the panel', () => {
  it('is read back by the server with the same fields, name and instructions', () => {
    const fields = [
      { name: 'idea', label: 'La idea', required: true },
      { name: 'where', label: 'Dónde (pantalla, URL, "versión" o dispositivo)', required: false },
    ];
    const file = buildTemplate({ name: 'Idea: «ahora»', description: 'Una propuesta, sin compromiso.', fields, instructions: INSTRUCTIONS });
    const read = parseTemplate(file);
    assert.equal(read.name, 'Idea: «ahora»');
    assert.equal(read.description, 'Una propuesta, sin compromiso.');
    assert.deepEqual(read.fields, fields);
    assert.equal(read.body, INSTRUCTIONS);
    assert.deepEqual(read.warnings, []);
    assert.deepEqual(parseTemplateFields(file), fields);
    assert.equal(templateInstructions(file), INSTRUCTIONS);
  });

  it('accepts a template without fields', () => {
    const file = buildTemplate({ name: 'Pregunta', description: 'Una duda.', fields: [], instructions: INSTRUCTIONS });
    assert.deepEqual(parseTemplate(file).fields, []);
  });

  it('keys of new fields are valid schema names and never repeat', () => {
    const taken = ['idea'];
    const keys = ['La idea', 'Idea', 'Idea', '¿Qué problema hay?', '2.º paso', '***'].map((label) => {
      const key = fieldKey(label, taken);
      taken.push(key);
      return key;
    });
    assert.equal(new Set(keys).size, keys.length);
    for (const key of keys) assert.match(key, /^[a-z][a-z0-9_]*$/);
  });
});
