// Esquemas JSON del analizador (informe 02 §6.2 y MASTER-SPEC §7.5).
//
// Todos los esquemas que van a la gramática de un proveedor son estáticos por plantilla: los ids de
// miembros y de adjuntos son enteros que Ajv valida contra el bundle, no un `enum` por input, que
// cambiaría la estructura y obligaría a recompilar la gramática en cada llamada (informe 02 §6.2).
// Sin `maxItems`, `minLength` ni `minItems` mayor que 1 en la gramática: Anthropic no los admite [F1].
import { compileFieldsSchema } from './templates.js';

const intArray = (extra = {}) => ({ type: 'array', items: { type: 'integer' }, ...extra });

/**
 * Esquema de la primera llamada: área y plantilla como `enum` de ids existentes (informe 02 §4.3:
 * reducir el espacio de valores colapsa el desacuerdo entre corridas [F25]).
 */
export function buildClassificationSchema({ areas, templates }) {
  return {
    type: 'object',
    properties: {
      area_id: { type: 'integer', enum: areas.map((a) => a.id) },
      template_id: { type: 'integer', enum: templates.map((t) => t.id) },
    },
    required: ['area_id', 'template_id'],
    additionalProperties: false,
  };
}

function messageSchema(fieldsSchema, { validation }) {
  // `unit_ids` va primero: el modelo ancla el mensaje a su evidencia antes de redactarlo (informe 02 §6.2).
  // Todas las propiedades son requeridas, así el orden de salida es el del esquema [F1].
  const unitIds = validation ? intArray({ minItems: 1, uniqueItems: true }) : intArray({ minItems: 1 });
  const ids = validation ? intArray({ uniqueItems: true }) : intArray();
  const text = validation ? { type: 'string', minLength: 1 } : { type: 'string' };
  return {
    type: 'object',
    properties: {
      unit_ids: unitIds,
      title: text,
      fields: fieldsSchema,
      body: text,
      assignee_ids: ids,
      attachment_ids: ids,
    },
    required: ['unit_ids', 'title', 'fields', 'body', 'assignee_ids', 'attachment_ids'],
    additionalProperties: false,
  };
}

function discardedSchema({ validation }) {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        unit_ids: validation ? intArray({ minItems: 1, uniqueItems: true }) : intArray({ minItems: 1 }),
        reason: validation ? { type: 'string', minLength: 1 } : { type: 'string' },
      },
      required: ['unit_ids', 'reason'],
      additionalProperties: false,
    },
  };
}

/**
 * Esquema de la segunda llamada (y del rescate): la lista de mensajes con sus unidades y lo descartado.
 * Puede venir sin mensajes cuando ninguna unidad es accionable: entonces todo va en `discarded`.
 * @param {{name: string, label: string, required: boolean}[]} fields campos de la plantilla elegida
 * @param {{profile?: 'anthropic'|'all-required', validation?: boolean}} [opts]
 */
export function buildDecompositionSchema(fields, { profile = 'anthropic', validation = false } = {}) {
  const fieldsSchema = compileFieldsSchema(fields, { profile, validation });
  return {
    type: 'object',
    properties: {
      messages: { type: 'array', items: messageSchema(fieldsSchema, { validation }) },
      discarded: discardedSchema({ validation }),
    },
    required: ['messages', 'discarded'],
    additionalProperties: false,
  };
}

/**
 * Esquema del Proposal completo que se pasa a `claude -p --json-schema` (UD-008, MASTER-SPEC §7.5).
 * `fields` es genérico acá: el harness elige la plantilla él mismo y el validador del sistema
 * comprueba después los campos contra la plantilla elegida.
 */
export function buildProposalSchema() {
  const base = buildDecompositionSchema([], { validation: false });
  const message = structuredClone(base.properties.messages.items);
  message.properties.fields = { type: 'object', additionalProperties: { type: ['string', 'null'] } };
  delete message.properties.fields.properties;
  return {
    type: 'object',
    properties: {
      area_id: { type: 'integer' },
      template_id: { type: 'integer' },
      messages: { type: 'array', items: message },
      discarded: base.properties.discarded,
    },
    required: ['area_id', 'template_id', 'messages', 'discarded'],
    additionalProperties: false,
  };
}
