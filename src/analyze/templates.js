// Plantillas de análisis: markdown con frontmatter (MASTER-SPEC §7.9).
//
//   ---
//   name: Reporte de error            (hasta 64 caracteres)
//   description: …                    (hasta 1.024 caracteres)
//   fields:
//     - { name: steps, label: Pasos para reproducir, required: true }
//   ---
//   ## Método … ## Formato de salida …
//
// `name` y `description` respetan los límites de la especificación Agent Skills (informe 02 §6.1 [F32]):
// la primera llamada sólo ve esos dos campos de cada plantilla y el cuerpo se revela en la segunda.
// `fields` es un campo propio del frontmatter: Agent Skills no lo define y su `metadata` sólo admite cadenas.
import { readFile } from 'node:fs/promises';
import { load as loadYaml } from 'js-yaml';
import { TemplateError } from './errors.js';

export const TEMPLATE_NAME_MAX = 64;
export const TEMPLATE_DESCRIPTION_MAX = 1024;
export const FIELD_NAME_MAX = 64;
export const FIELD_LABEL_MAX = 120;

// Identificador de un campo: letra minúscula inicial y luego minúsculas, dígitos o guion bajo.
// Es la forma de una clave de esquema, no una lectura de texto humano.
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
 * Lee y valida una plantilla.
 * @param {string} markdown
 * @param {{source?: string}} [opts] nombre del archivo, sólo para los mensajes de error
 * @returns {{name: string, description: string, fields: {name: string, label: string, required: boolean}[], body: string, warnings: string[]}}
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
  const unknown = Object.keys(meta).filter((k) => !['name', 'description', 'fields'].includes(k));
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

  // El cuerpo se carga entero en la segunda llamada; las dos secciones son convención de §7.9, no condición.
  const warnings = [];
  for (const heading of ['## Método', '## Formato de salida']) {
    if (!body.split('\n').some((line) => line.trim() === heading)) warnings.push(`Falta la sección «${heading}»`);
  }
  return { name: name.trim(), description: description.trim(), fields, body, warnings };
}

export async function loadTemplateFile(path) {
  return parseTemplate(await readFile(path, 'utf8'), { source: path });
}

// Tope de propiedades opcionales por esquema en la gramática de Anthropic (informe 02 §1.1 [F1]: 24 en total).
export const ANTHROPIC_MAX_OPTIONAL_PROPERTIES = 24;

/**
 * Compila los `fields` de una plantilla a un esquema JSON del objeto `fields` de cada mensaje.
 *
 * Dos usos:
 *  - Gramática del proveedor (`validation: false`): sin `minLength` (no admitido), y según el perfil:
 *      `anthropic`     lo opcional es una propiedad opcional (cuenta contra el tope de 24);
 *      `all-required`  el servidor exige todo requerido: lo opcional se emula con `null`.
 *  - Validación con Ajv (`validation: true`): esquema completo; lo obligatorio no puede ir vacío y
 *    lo opcional admite ausencia o `null`. Ajv valida después con el esquema completo porque el de
 *    la gramática es un subconjunto (informe 02 §1.4).
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
