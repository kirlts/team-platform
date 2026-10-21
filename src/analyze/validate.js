// Validación de la salida del modelo (MASTER-SPEC §7.5): la hace el sistema, no el modelo.
//
// Una instancia propia de Ajv: los esquemas de respuesta de Fastify convierten tipos y descartan
// propiedades (informe 03), lo contrario de lo que se quiere acá. Nada se coacciona ni se recorta.
//
// El sistema valida forma y conjuntos: que el área exista, que cada miembro y cada adjunto existan, que cada
// unidad esté en un mensaje o en `discarded`. Nunca interpreta el texto que escribió una persona (§4.2).
import Ajv from 'ajv';
import { buildClassificationSchema, buildDecompositionSchema, buildProposalSchema } from './schema.js';
import { compileFieldsSchema } from './templates.js';

export const ajv = new Ajv({
  allErrors: true,
  strict: true,
  allowUnionTypes: true, // `type: ['string', 'null']` en los campos opcionales
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});

const compiled = new Map();
function compile(schema) {
  const key = JSON.stringify(schema);
  let validate = compiled.get(key);
  if (!validate) {
    validate = ajv.compile(schema);
    compiled.set(key, validate);
  }
  return validate;
}

/** `/messages/0/fields` → `mensaje 1, fields`: la ruta del error como la leería una persona. */
function readablePath(instancePath) {
  if (!instancePath) return 'la salida';
  const parts = instancePath.split('/').slice(1);
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const next = parts[i + 1];
    const isIndex = next !== undefined && /^\d+$/.test(next);
    if (parts[i] === 'messages' && isIndex) { out.push(`mensaje ${Number(next) + 1}`); i += 1; }
    else if (parts[i] === 'discarded' && isIndex) { out.push(`descarte ${Number(next) + 1}`); i += 1; }
    else if (/^\d+$/.test(parts[i])) out[out.length - 1] = `${out.at(-1)}[${Number(parts[i]) + 1}]`;
    else out.push(parts[i]);
  }
  return out.join(', ');
}

/** Errores de Ajv a frases que el modelo y la persona entienden. */
export function formatAjvErrors(errors = []) {
  return errors.map((e) => {
    const path = readablePath(e.instancePath);
    switch (e.keyword) {
      case 'required': return `${path}: falta «${e.params.missingProperty}»`;
      case 'additionalProperties': return `${path}: sobra «${e.params.additionalProperty}»`;
      case 'type': return `${path}: debe ser de tipo ${[].concat(e.params.type).join(' o ')}`;
      case 'minLength': return `${path}: no puede estar vacío`;
      case 'minItems': return `${path}: debe tener al menos ${e.params.limit} elemento`;
      case 'uniqueItems': return `${path}: tiene elementos repetidos`;
      case 'enum': return `${path}: valor fuera de la lista permitida`;
      default: return `${path}: ${e.message}`;
    }
  });
}

/** Ids de una lista de objetos como conjunto. */
const idSet = (list) => new Set((list ?? []).map((x) => x.id));

/** Frases de los conflictos MECE (solapes y huecos) para el modelo y para el motivo visible del trabajo. */
export function describeConflicts({ overlaps, gaps }) {
  const out = overlaps.map((o) => `la unidad ${o.unit_id} está en más de un lugar (${o.owners.join(' y ')})`);
  if (gaps.length > 0) out.push(`las unidades ${gaps.join(', ')} no están en ningún lugar`);
  return out;
}

/**
 * Validación de la primera llamada: cada grupo tiene un área y una plantilla que existen y se corresponden,
 * cita unidades del input y, junto con `discarded`, los grupos cubren cada unidad exactamente una vez.
 * Solapes y huecos entre grupos son errores reintentables acá (el rescate es de la descomposición).
 * @param {any} output  `{groups, discarded}`
 * @param {{areas: object[], templates: object[], scope: Set<number>}} ctx
 * @returns {{errors: string[]}}
 */
export function validateClassification(output, { areas, templates, scope }) {
  const validate = compile(buildClassificationSchema({ areas, templates }, { validation: true }));
  if (!validate(output)) return { errors: formatAjvErrors(validate.errors) };
  const errors = [];
  output.groups.forEach((g, i) => {
    const template = templates.find((t) => t.id === g.template_id);
    if (template.area_id !== g.area_id) errors.push(`grupo ${i + 1}: la plantilla ${g.template_id} no pertenece al área ${g.area_id}`);
    for (const id of g.unit_ids) if (!scope.has(id)) errors.push(`grupo ${i + 1}: la unidad ${id} no existe en este input`);
  });
  output.discarded.forEach((d, i) => {
    for (const id of d.unit_ids) if (!scope.has(id)) errors.push(`descarte ${i + 1}: la unidad ${id} no existe en este input`);
  });
  if (errors.length > 0) return { errors };
  const conflicts = coverage(output.groups.map((g) => ({ unit_ids: g.unit_ids })), output.discarded, scope, 'grupo');
  return { errors: describeConflicts(conflicts) };
}

/**
 * Aritmética de conjuntos sobre las unidades: solapes (en más de un lugar) y huecos (en ninguno).
 * @param {{unit_ids: number[]}[]} messages  (o grupos, con `noun: 'grupo'`)
 * @param {{unit_ids: number[]}[]} discarded
 * @param {Iterable<number>} scope unidades que deben quedar cubiertas
 */
export function coverage(messages, discarded, scope, noun = 'mensaje') {
  const owners = new Map();
  const add = (unitId, label) => {
    if (!owners.has(unitId)) owners.set(unitId, []);
    owners.get(unitId).push(label);
  };
  messages.forEach((m, i) => m.unit_ids.forEach((id) => add(id, `${noun} ${i + 1}`)));
  discarded.forEach((d) => d.unit_ids.forEach((id) => add(id, 'descartada')));
  const overlaps = [];
  for (const [unit_id, list] of owners) if (list.length > 1) overlaps.push({ unit_id, owners: list });
  overlaps.sort((a, b) => a.unit_id - b.unit_id);
  const gaps = [...scope].filter((id) => !owners.has(id)).sort((a, b) => a - b);
  return { overlaps, gaps };
}

/** Referencias, textos vacíos y campos obligatorios en blanco de un mensaje ya validado en su forma. */
function checkMessage(m, label, { fields, scope, memberIds, attachmentIds, errors }) {
  for (const id of m.unit_ids) if (!scope.has(id)) errors.push(`${label}: la unidad ${id} no existe en este input`);
  for (const id of m.assignee_ids) if (!memberIds.has(id)) errors.push(`${label}: el miembro ${id} no existe`);
  for (const id of m.attachment_ids) if (!attachmentIds.has(id)) errors.push(`${label}: el adjunto ${id} no pertenece al input`);
  // «Ningún mensaje vacío»: el esquema exige longitud mínima; acá se descartan los textos de sólo espacios.
  if (m.title.trim() === '') errors.push(`${label}: el título está vacío`);
  if (m.body.trim() === '') errors.push(`${label}: el cuerpo está vacío`);
  for (const f of fields) {
    if (f.required && typeof m.fields[f.name] === 'string' && m.fields[f.name].trim() === '') {
      errors.push(`${label}: el campo obligatorio «${f.name}» está vacío`);
    }
  }
}

/**
 * Valida una descomposición.
 *
 * `errors`  forma y referencias: reintentables una vez con el error como contexto.
 * `conflicts` solapes y huecos: van al pase de rescate, no al reintento.
 *
 * @param {any} output  `{messages, discarded}`
 * @param {object} ctx
 * @param {{name: string, label: string, required: boolean}[]} ctx.fields  campos de la plantilla elegida
 * @param {Set<number>} ctx.scope  unidades de este análisis (o de este trozo)
 * @param {Set<number>} ctx.memberIds
 * @param {Set<number>} ctx.attachmentIds  adjuntos del input
 * @param {boolean} [ctx.requireMessage]  el grupo no puede quedar sin mensajes
 * @param {boolean} [ctx.withDiscarded]  falso: la salida no lleva `discarded`
 */
export function validateDecomposition(output, { fields, scope, memberIds, attachmentIds, requireMessage = false, withDiscarded = true }) {
  const validate = compile(buildDecompositionSchema(fields, { validation: true, withDiscarded }));
  if (!validate(output)) {
    return { errors: formatAjvErrors(validate.errors), conflicts: { overlaps: [], gaps: [] } };
  }
  const errors = [];
  // Un grupo lo eligió la clasificación como un punto de esta plantilla: no puede terminar sin mensaje.
  if (requireMessage && output.messages.length === 0) errors.push('el grupo no produjo ningún mensaje: la clasificación lo eligió como un punto de esta plantilla, así que sus unidades tienen que ir en mensajes');
  output.messages.forEach((m, i) => checkMessage(m, `mensaje ${i + 1}`, { fields, scope, memberIds, attachmentIds, errors }));
  const discarded = output.discarded ?? [];
  discarded.forEach((d, i) => {
    for (const id of d.unit_ids) if (!scope.has(id)) errors.push(`descarte ${i + 1}: la unidad ${id} no existe en este input`);
  });
  if (errors.length > 0) return { errors, conflicts: { overlaps: [], gaps: [] } };
  return { errors: [], conflicts: coverage(output.messages, discarded, scope) };
}

/**
 * Valida la propuesta entera: mensajes de grupos distintos, cada uno contra los campos de su propia plantilla,
 * y solapes y huecos sobre la unión de todos los grupos (MASTER-SPEC §7.5).
 * @param {any} output  `{messages:[{area_id, template_id, …}], discarded}`
 * @param {object} ctx
 * @param {object[]} ctx.areas
 * @param {object[]} ctx.templates  filas del bundle (id, area_id)
 * @param {Map<number, {name: string, label: string, required: boolean}[]>} ctx.fieldsByTemplate  campos de cada plantilla usada
 * @param {Set<number>} ctx.scope
 * @param {Set<number>} ctx.memberIds
 * @param {Set<number>} ctx.attachmentIds
 */
export function validateProposal(output, { templates, fieldsByTemplate, scope, memberIds, attachmentIds }) {
  const validate = compile(buildProposalSchema({ validation: true }));
  if (!validate(output)) return { errors: formatAjvErrors(validate.errors), conflicts: { overlaps: [], gaps: [] } };
  const errors = [];
  output.messages.forEach((m, i) => {
    const label = `mensaje ${i + 1}`;
    const template = templates.find((t) => t.id === m.template_id);
    if (!template) {
      errors.push(`${label}: la plantilla ${m.template_id} no existe`);
      return;
    }
    if (template.area_id !== m.area_id) errors.push(`${label}: la plantilla ${m.template_id} no pertenece al área ${m.area_id}`);
    const fields = fieldsByTemplate.get(m.template_id);
    if (!fields) {
      errors.push(`${label}: la plantilla ${m.template_id} no se cargó`);
      return;
    }
    const fieldsValidate = compile(compileFieldsSchema(fields, { validation: true }));
    if (!fieldsValidate(m.fields)) {
      errors.push(...formatAjvErrors(fieldsValidate.errors).map((e) => `${label}, campos: ${e.replace(/^la salida: /, '')}`));
      return;
    }
    checkMessage(m, label, { fields, scope, memberIds, attachmentIds, errors });
  });
  output.discarded.forEach((d, i) => {
    for (const id of d.unit_ids) if (!scope.has(id)) errors.push(`descarte ${i + 1}: la unidad ${id} no existe en este input`);
  });
  if (errors.length > 0) return { errors, conflicts: { overlaps: [], gaps: [] } };
  return { errors: [], conflicts: coverage(output.messages, output.discarded, scope) };
}

/** Contexto de validación a partir del bundle. */
export function contextFromBundle(bundle, { fields, scope }) {
  return {
    fields,
    scope: scope instanceof Set ? scope : new Set(scope),
    memberIds: idSet(bundle.members),
    attachmentIds: idSet(bundle.attachments),
  };
}

/** Limpia una descomposición válida: sin nulos, ids únicos y ordenados, textos recortados. */
export function normalizeDecomposition(output) {
  const sortedUnique = (ids) => [...new Set(ids)].sort((a, b) => a - b);
  const messages = output.messages.map((m) => ({
    ...(m.area_id === undefined ? {} : { area_id: m.area_id, template_id: m.template_id }),
    unit_ids: sortedUnique(m.unit_ids),
    title: m.title.trim(),
    body: m.body.trim(),
    fields: Object.fromEntries(Object.entries(m.fields).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v.trim()])),
    assignee_ids: sortedUnique(m.assignee_ids),
    attachment_ids: sortedUnique(m.attachment_ids),
  }));
  messages.sort((a, b) => a.unit_ids[0] - b.unit_ids[0] || a.title.localeCompare(b.title));
  const discarded = output.discarded
    .map((d) => ({ unit_ids: sortedUnique(d.unit_ids), reason: d.reason.trim() }))
    .sort((a, b) => a.unit_ids[0] - b.unit_ids[0]);
  return { messages, discarded };
}
