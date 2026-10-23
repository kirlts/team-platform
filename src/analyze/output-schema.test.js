// UD-254 (5), H-3723: the template declares the output the harness delivers; `compileOutputSchema` compiles it and
// `validateOutput` checks an output against it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Ajv from 'ajv';
import { TemplateError } from './errors.js';
import { loadSeed } from './seed.js';
import { ANTHROPIC_MAX_OPTIONAL_PROPERTIES, compileOutputSchema, OUTPUT_OUTCOMES, parseTemplate } from './templates.js';
import { validateOutput } from './validate.js';

const WITH_OUTPUT = `---
name: Reporte de error
description: Algo que no funciona.
fields:
  - { name: steps, label: Pasos para reproducir, required: true }
output:
  - { name: cause, label: Causa, type: text, required: true }
  - { name: files, label: Archivos tocados, type: list, required: false }
  - { name: effort, label: Esfuerzo, type: text, required: false, enum: [bajo, medio, alto] }
  - { name: verified, label: Verificado, type: boolean, required: true }
---
## Método
Cómo leer el input.

## Formato de salida
Un mensaje por error.

## Salida
Instrucciones en prosa al harness: \`compileOutputSchema\` no las lee.
`;

const WITHOUT_OUTPUT = WITH_OUTPUT.replace(/output:\n(?: {2}- .*\n)+/, '');

const valid = () => ({ cause: 'Falta un índice', verified: true, outcome: 'done', summary: 'Ana, el error quedó corregido.' });

describe('compileOutputSchema', () => {
  it('compiles the declared entries plus `summary` and `outcome`, with no other property', () => {
    const s = compileOutputSchema(WITH_OUTPUT);
    assert.equal(s.type, 'object');
    assert.equal(s.additionalProperties, false);
    assert.deepEqual(Object.keys(s.properties), ['cause', 'files', 'effort', 'verified', 'outcome', 'summary']);
    assert.deepEqual(s.required, ['cause', 'verified', 'outcome', 'summary']);
    assert.deepEqual(s.properties.outcome, { type: 'string', enum: OUTPUT_OUTCOMES });
    assert.deepEqual(OUTPUT_OUTCOMES, ['done', 'investigated', 'blocked', 'needs_decision', 'not_mine']);
    assert.deepEqual(s.properties.files, { type: 'array', items: { type: 'string' } });
    assert.deepEqual(s.properties.effort, { type: 'string', enum: ['bajo', 'medio', 'alto'] });
    assert.doesNotThrow(() => new Ajv({ strict: true, allowUnionTypes: true }).compile(s));
    assert.doesNotThrow(() => new Ajv({ strict: true, allowUnionTypes: true }).compile(compileOutputSchema(WITH_OUTPUT, { validation: true })));
  });

  it('takes the markdown, the parsed template or the list and gives the same schema', () => {
    const parsed = parseTemplate(WITH_OUTPUT);
    assert.deepEqual(compileOutputSchema(parsed), compileOutputSchema(WITH_OUTPUT));
    assert.deepEqual(compileOutputSchema(parsed.output), compileOutputSchema(WITH_OUTPUT));
  });

  it('returns null when the template declares no output, and only the two fixed fields for an empty block', () => {
    assert.equal(compileOutputSchema(WITHOUT_OUTPUT), null);
    assert.equal(parseTemplate(WITHOUT_OUTPUT).output, null);
    assert.equal(compileOutputSchema({ name: 'x' }), null);
    const empty = compileOutputSchema(WITHOUT_OUTPUT.replace('---\n## Método', 'output: []\n---\n## Método'));
    assert.deepEqual(Object.keys(empty.properties), ['outcome', 'summary']);
  });

  it('reads only the frontmatter: a «## Salida» section in the body changes nothing', () => {
    const noSection = WITH_OUTPUT.replace(/## Salida[\s\S]*$/, '');
    assert.deepEqual(compileOutputSchema(noSection), compileOutputSchema(WITH_OUTPUT));
    assert.match(parseTemplate(WITH_OUTPUT).body, /## Salida/);
  });

  it('rejects an output block that does not compile', () => {
    const rejects = (markdown, fragment) =>
      assert.throws(() => parseTemplate(markdown), (e) => e instanceof TemplateError && e.message.includes(fragment), fragment);
    rejects(WITH_OUTPUT.replace('type: list', 'type: tabla'), 'type');
    rejects(WITH_OUTPUT.replace('name: cause', 'name: summary'), 'campo fijo');
    rejects(WITH_OUTPUT.replace('name: cause', 'name: outcome'), 'campo fijo');
    rejects(WITH_OUTPUT.replace('name: files', 'name: cause'), 'repetido');
    rejects(WITH_OUTPUT.replace('type: boolean, required: true', 'type: boolean, required: sí'), 'required');
    rejects(WITH_OUTPUT.replace('enum: [bajo, medio, alto]', 'enum: []'), 'enum');
    rejects(WITH_OUTPUT.replace('enum: [bajo, medio, alto]', 'enum: [bajo, bajo]'), 'repetidos');
    rejects(WITH_OUTPUT.replace('type: boolean, required: true', 'type: boolean, required: true, enum: [x]'), 'type: text');
    rejects(WITH_OUTPUT.replace('label: Causa, ', 'label: Causa, extra: 1, '), 'claves desconocidas');
    rejects(WITH_OUTPUT.replace(/output:\n(?: {2}- .*\n)+/, 'output: texto\n'), 'lista');
  });

  it('more than 24 optional entries exceed the grammar and the template is refused when saved', () => {
    const many = Array.from({ length: ANTHROPIC_MAX_OPTIONAL_PROPERTIES + 1 }, (_, i) => `  - { name: f${i}, label: F${i}, type: text, required: false }`).join('\n');
    assert.throws(() => parseTemplate(WITHOUT_OUTPUT.replace('---\n## Método', `output:\n${many}\n---\n## Método`)), TemplateError);
  });
});

describe('validateOutput', () => {
  it('accepts a valid output, with optional entries absent or null', () => {
    assert.deepEqual(validateOutput(valid(), WITH_OUTPUT), { errors: [] });
    assert.deepEqual(validateOutput({ ...valid(), files: ['a.js'], effort: 'bajo' }, WITH_OUTPUT), { errors: [] });
    assert.deepEqual(validateOutput({ ...valid(), files: null, effort: null }, WITH_OUTPUT), { errors: [] });
  });

  it('requires `summary` and `outcome`', () => {
    const { summary, ...noSummary } = valid();
    const { outcome, ...noOutcome } = valid();
    assert.ok(summary && outcome);
    assert.match(validateOutput(noSummary, WITH_OUTPUT).errors.join(), /missing «summary»/);
    assert.match(validateOutput(noOutcome, WITH_OUTPUT).errors.join(), /missing «outcome»/);
    assert.match(validateOutput({ ...valid(), summary: '' }, WITH_OUTPUT).errors.join(), /summary/);
    assert.match(validateOutput({ ...valid(), summary: '   ' }, WITH_OUTPUT).errors.join(), /summary/);
    assert.match(validateOutput({ ...valid(), outcome: 'finished' }, WITH_OUTPUT).errors.join(), /outcome/);
  });

  it('rejects an output with a property the template does not declare', () => {
    assert.match(validateOutput({ ...valid(), extra: 'x' }, WITH_OUTPUT).errors.join(), /unexpected «extra»/);
  });

  it('rejects a wrong type, an empty required text and a value outside the enum', () => {
    assert.ok(validateOutput({ ...valid(), verified: 'sí' }, WITH_OUTPUT).errors.length > 0);
    assert.ok(validateOutput({ ...valid(), cause: '' }, WITH_OUTPUT).errors.length > 0);
    assert.ok(validateOutput({ ...valid(), effort: 'enorme' }, WITH_OUTPUT).errors.length > 0);
    assert.ok(validateOutput({ ...valid(), files: 'a.js' }, WITH_OUTPUT).errors.length > 0);
  });

  it('says so when the template declares no output', () => {
    assert.deepEqual(validateOutput(valid(), WITHOUT_OUTPUT), { errors: ['the template declares no output'] });
  });
});

describe('seeded templates', () => {
  it('each of the five declares an output block that compiles', async () => {
    const { templates } = await loadSeed();
    assert.equal(templates.length, 5);
    for (const row of templates) {
      const schema = compileOutputSchema(row.body_markdown);
      assert.ok(schema, `${row.name} declares no output`);
      assert.ok(Object.keys(schema.properties).length > 2, `${row.name} declares only the fixed fields`);
      assert.doesNotThrow(() => new Ajv({ strict: true, allowUnionTypes: true }).compile(compileOutputSchema(row.body_markdown, { validation: true })), row.name);
    }
  });
});
