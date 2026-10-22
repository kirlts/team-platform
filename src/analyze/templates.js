// Analysis templates: markdown with frontmatter (MASTER-SPEC §7.9).
//
//   ---
//   name: Reporte de error            (up to 64 characters)
//   description: …                    (up to 1,024 characters)
//   fields:
//     - { name: steps, label: «Pasos para reproducir», required: true }
//   output:                           (optional: what the harness delivers when it works the message)
//     - { name: cause, label: Causa, type: text, required: true }
//     - { name: effort, label: Esfuerzo, type: text, required: false, enum: [bajo, medio, alto] }
//   ---
//   «## Método» … «## Formato de salida» …
//
// `name` and `description` respect the limits of the Agent Skills specification (report 02 §6.1 [F32]):
// the first call sees only those two fields of each template and the body is revealed in the second.
// `fields` is a frontmatter field of our own: Agent Skills does not define it and its `metadata` only admits strings.
// `output` is too (UD-254 (5), UD-255 (5)): the template declares the output format and `compileOutputSchema` turns it into the
// JSON schema demanded from the harness. Only the frontmatter declares it; a «## Salida» section of the body is prose for the
// prompt and is never read here.
import { readFile } from 'node:fs/promises';
import { load as loadYaml } from 'js-yaml';
import { TemplateError } from './errors.js';

export const TEMPLATE_NAME_MAX = 64;
export const TEMPLATE_DESCRIPTION_MAX = 1024;
export const FIELD_NAME_MAX = 64;
export const FIELD_LABEL_MAX = 120;

// Identifier of a field: initial lowercase letter and then lowercase letters, digits or underscore.
// It is the shape of a schema key, not a reading of human text.
const FIELD_NAME_FORMAT = /^[a-z][a-z0-9_]*$/;

function splitFrontmatter(markdown, source) {
  const text = String(markdown).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') {
    throw new TemplateError('La plantilla debe empezar con un frontmatter delimitado por «---»', { source });
  }
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end === -1) throw new TemplateError('El frontmatter de la plantilla no se cierra con «---»', { source });
  return { front: lines.slice(1, end).join('\n'), body: lines.slice(end + 1).join('\n').trim() };
}

// Types an output entry may take: `text` a string, `list` a list of strings, `number`, `boolean`.
export const OUTPUT_TYPES = ['text', 'list', 'number', 'boolean'];
// Two properties every output carries even when the template does not declare them (UD-255 (5)): `summary` is the couple of
// paragraphs for the person who sent the message, `outcome` how the work ended.
export const OUTPUT_OUTCOMES = ['done', 'investigated', 'blocked', 'needs_decision'];
export const OUTPUT_FIXED = ['summary', 'outcome'];
export const OUTPUT_ENUM_MAX = 32;

function validateOutput(raw, source) {
  if (raw === undefined) return null;
  if (raw === null) return [];
  if (!Array.isArray(raw)) throw new TemplateError('«output» debe ser una lista', { source });
  const seen = new Set();
  return raw.map((entry, i) => {
    const where = `output[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TemplateError(`${where} debe ser un objeto con name, label, type y required`, { source });
    const unknown = Object.keys(entry).filter((k) => !['name', 'label', 'type', 'required', 'enum'].includes(k));
    if (unknown.length > 0) throw new TemplateError(`${where} tiene claves desconocidas: ${unknown.join(', ')}`, { source });
    const { name, label, required } = entry;
    const type = entry.type ?? 'text';
    if (typeof name !== 'string' || !FIELD_NAME_FORMAT.test(name) || name.length > FIELD_NAME_MAX) {
      throw new TemplateError(`${where}.name debe ser un identificador en minúsculas de hasta ${FIELD_NAME_MAX} caracteres (letras, dígitos y «_»)`, { source });
    }
    if (OUTPUT_FIXED.includes(name)) throw new TemplateError(`${where}.name «${name}» es un campo fijo de toda salida y no se declara`, { source });
    if (seen.has(name)) throw new TemplateError(`El campo de salida «${name}» está repetido`, { source });
    seen.add(name);
    if (typeof label !== 'string' || label.trim() === '' || label.length > FIELD_LABEL_MAX) {
      throw new TemplateError(`${where}.label debe ser un texto de 1 a ${FIELD_LABEL_MAX} caracteres`, { source });
    }
    if (!OUTPUT_TYPES.includes(type)) throw new TemplateError(`${where}.type debe ser uno de: ${OUTPUT_TYPES.join(', ')}`, { source });
    if (typeof required !== 'boolean') throw new TemplateError(`${where}.required debe ser verdadero o falso`, { source });
    const out = { name, label: label.trim(), type, required };
    if (entry.enum !== undefined) {
      if (type !== 'text') throw new TemplateError(`${where}.enum sólo se admite con type: text`, { source });
      const values = entry.enum;
      if (!Array.isArray(values) || values.length === 0 || values.length > OUTPUT_ENUM_MAX
        || values.some((v) => typeof v !== 'string' || v.trim() === '' || v.length > FIELD_LABEL_MAX)) {
        throw new TemplateError(`${where}.enum debe ser una lista de 1 a ${OUTPUT_ENUM_MAX} textos`, { source });
      }
      if (new Set(values).size !== values.length) throw new TemplateError(`${where}.enum tiene valores repetidos`, { source });
      out.enum = [...values];
    }
    return out;
  });
}

function validateFields(raw, source) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new TemplateError('«fields» debe ser una lista', { source });
  const seen = new Set();
  return raw.map((entry, i) => {
    const where = `fields[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TemplateError(`${where} debe ser un objeto con name, label y required`, { source });
    const unknown = Object.keys(entry).filter((k) => !['name', 'label', 'required'].includes(k));
    if (unknown.length > 0) throw new TemplateError(`${where} tiene claves desconocidas: ${unknown.join(', ')}`, { source });
    const { name, label, required } = entry;
    if (typeof name !== 'string' || !FIELD_NAME_FORMAT.test(name) || name.length > FIELD_NAME_MAX) {
      throw new TemplateError(`${where}.name debe ser un identificador en minúsculas de hasta ${FIELD_NAME_MAX} caracteres (letras, dígitos y «_»)`, { source });
    }
    if (seen.has(name)) throw new TemplateError(`El campo «${name}» está repetido`, { source });
    seen.add(name);
    if (typeof label !== 'string' || label.trim() === '' || label.length > FIELD_LABEL_MAX) {
      throw new TemplateError(`${where}.label debe ser un texto de 1 a ${FIELD_LABEL_MAX} caracteres`, { source });
    }
    if (typeof required !== 'boolean') throw new TemplateError(`${where}.required debe ser verdadero o falso`, { source });
    return { name, label: label.trim(), required };
  });
}

/**
 * Reads and validates a template.
 * @param {string} markdown
 * @param {{source?: string}} [opts] file name, only for the error messages
 * @returns {{name: string, description: string, fields: {name: string, label: string, required: boolean}[], output: OutputField[]|null, body: string, warnings: string[]}}
 * `output` is null when the frontmatter declares no `output` block.
 */
export function parseTemplate(markdown, { source } = {}) {
  const { front, body } = splitFrontmatter(markdown, source);
  let meta;
  try {
    meta = loadYaml(front);
  } catch (cause) {
    throw new TemplateError(`El frontmatter no es YAML válido: ${cause.reason ?? cause.message}`, { source, cause });
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new TemplateError('El frontmatter debe ser un mapa con name, description y fields', { source });
  const unknown = Object.keys(meta).filter((k) => !['name', 'description', 'fields', 'output'].includes(k));
  if (unknown.length > 0) throw new TemplateError(`Claves desconocidas en el frontmatter: ${unknown.join(', ')}`, { source });

  const { name, description } = meta;
  if (typeof name !== 'string' || name.trim() === '' || name.length > TEMPLATE_NAME_MAX) {
    throw new TemplateError(`«name» debe ser un texto de 1 a ${TEMPLATE_NAME_MAX} caracteres`, { source });
  }
  if (typeof description !== 'string' || description.trim() === '' || description.length > TEMPLATE_DESCRIPTION_MAX) {
    throw new TemplateError(`«description» debe ser un texto de 1 a ${TEMPLATE_DESCRIPTION_MAX} caracteres`, { source });
  }
  if (body === '') throw new TemplateError('La plantilla no tiene cuerpo (Método y Formato de salida)', { source });
  const fields = validateFields(meta.fields, source);
  const output = validateOutput(meta.output, source);
  if (output) compileOutputSchema(output); // the grammar caps are checked when saving, not when the harness runs

  // The body is loaded whole in the second call; the two sections are a convention of §7.9, not a condition.
  const warnings = [];
  for (const heading of ['## Método', '## Formato de salida']) {
    if (!body.split('\n').some((line) => line.trim() === heading)) warnings.push(`Falta la sección «${heading}»`);
  }
  return { name: name.trim(), description: description.trim(), fields, output, body, warnings };
}

export async function loadTemplateFile(path) {
  return parseTemplate(await readFile(path, 'utf8'), { source: path });
}

// Cap on optional properties per schema in Anthropic's grammar (report 02 §1.1 [F1]: 24 in total).
export const ANTHROPIC_MAX_OPTIONAL_PROPERTIES = 24;

/**
 * Compiles the `fields` of a template into a JSON schema for the `fields` object of each message.
 *
 * Two uses:
 *  - Provider grammar (`validation: false`): no `minLength` (not supported), and depending on the profile:
 *      `anthropic`     optional means an optional property (counts against the cap of 24);
 *      `all-required`  the server requires everything: optional is emulated with `null`.
 *  - Validation with Ajv (`validation: true`): full schema; a required field cannot be empty and
 *    an optional one admits absence or `null`. Ajv then validates with the full schema because the
 *    grammar one is a subset (report 02 §1.4).
 *
 * @param {{name: string, label: string, required: boolean}[]} fields
 * @param {{profile?: 'anthropic'|'all-required', validation?: boolean}} [opts]
 */
export function compileFieldsSchema(fields, { profile = 'anthropic', validation = false } = {}) {
  const properties = {};
  const required = [];
  let optionalCount = 0;
  for (const f of fields) {
    if (f.required) {
      properties[f.name] = validation ? { type: 'string', minLength: 1 } : { type: 'string' };
      required.push(f.name);
    } else {
      optionalCount += 1;
      const nullable = validation || profile === 'all-required';
      properties[f.name] = nullable ? { type: ['string', 'null'] } : { type: 'string' };
      if (!validation && profile === 'all-required') required.push(f.name);
    }
  }
  if (!validation && profile === 'anthropic' && optionalCount > ANTHROPIC_MAX_OPTIONAL_PROPERTIES) {
    throw new TemplateError(`La plantilla tiene ${optionalCount} campos opcionales y la gramática de Anthropic admite ${ANTHROPIC_MAX_OPTIONAL_PROPERTIES} en total`);
  }
  const schema = { type: 'object', properties, additionalProperties: false };
  if (required.length > 0) schema.required = required;
  return schema;
}

/** @typedef {{name: string, label: string, type: 'text'|'list'|'number'|'boolean', required: boolean, enum?: string[]}} OutputField */

const OUTPUT_JSON_TYPE = { text: 'string', number: 'number', boolean: 'boolean' };

function outputProperty(entry, validation) {
  if (entry.type === 'list') return validation ? { type: 'array', items: { type: 'string', minLength: 1 } } : { type: 'array', items: { type: 'string' } };
  const p = { type: OUTPUT_JSON_TYPE[entry.type] };
  if (entry.enum) p.enum = [...entry.enum];
  else if (validation && entry.type === 'text' && entry.required) p.minLength = 1;
  return p;
}

/**
 * Compiles the `output` block of a template into the JSON schema of the output the harness must deliver (UD-254 (5)).
 * Accepts the template markdown, an already parsed template (`{ output }`) or the `output` list itself.
 * Returns null when the template declares no `output` block. Every output carries `summary` (non-empty text for the
 * person who sent the message) and `outcome` (one of `OUTPUT_OUTCOMES`) besides the declared entries, and admits no
 * other property (`additionalProperties: false`).
 *
 * `validation: false` (default) is the grammar handed to `claude -p --json-schema`: no `minLength`, optional means an
 * optional property. `validation: true` is the schema `validateOutput` checks with: required texts cannot be empty and
 * an optional entry admits absence or null.
 * @param {string | {output?: OutputField[]|null} | OutputField[]} markdownOrTemplate
 * @param {{validation?: boolean}} [opts]
 * @returns {object|null}
 */
export function compileOutputSchema(markdownOrTemplate, { validation = false } = {}) {
  let output;
  if (typeof markdownOrTemplate === 'string') output = parseTemplate(markdownOrTemplate).output;
  else if (Array.isArray(markdownOrTemplate)) output = markdownOrTemplate;
  else output = markdownOrTemplate?.output ?? null;
  if (output === null || output === undefined) return null;
  const properties = {};
  const required = [];
  let optionalCount = 0;
  for (const entry of output) {
    const p = outputProperty(entry, validation);
    if (entry.required) required.push(entry.name);
    else {
      optionalCount += 1;
      if (validation) p.type = [].concat(p.type, 'null');
      if (validation && p.enum) p.enum = [...p.enum, null];
    }
    properties[entry.name] = p;
  }
  if (!validation && optionalCount > ANTHROPIC_MAX_OPTIONAL_PROPERTIES) {
    throw new TemplateError(`La salida tiene ${optionalCount} campos opcionales y la gramática de Anthropic admite ${ANTHROPIC_MAX_OPTIONAL_PROPERTIES} en total`);
  }
  properties.outcome = { type: 'string', enum: [...OUTPUT_OUTCOMES] };
  properties.summary = validation ? { type: 'string', minLength: 1 } : { type: 'string' };
  return { type: 'object', properties, required: [...required, 'outcome', 'summary'], additionalProperties: false };
}
