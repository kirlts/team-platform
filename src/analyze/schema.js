// Esquemas JSON del analizador (informe 02 §6.2 y MASTER-SPEC §7.5).
//
// Todos los esquemas que van a la gramática de un proveedor son estáticos por plantilla: los ids de
// miembros y de adjuntos son enteros que Ajv valida contra el bundle, no un `enum` por input, que
// cambiaría la estructura y obligaría a recompilar la gramática en cada llamada (informe 02 §6.2).
// Sin `maxItems`, `minLength` ni `minItems` mayor que 1 en la gramática: Anthropic no los admite [F1].
import { compileFieldsSchema } from './templates.js';

const intArray = (extra = {}) => ({ type: 'array', items: { type: 'integer' }, ...extra });

/**
 * Esquema de la primera llamada: agrupa las unidades del input por área y plantilla (idea.md: «uno o varios
 * mensajes que agrupen el trabajo en categorías»). Cada grupo es `{unit_ids, area_id, template_id}`; lo que
 * no pide ni informa nada va en `discarded`. Área y plantilla son `enum` de ids existentes (informe 02 §4.3:
 * reducir el espacio de valores colapsa el desacuerdo entre corridas [F25]); `unit_ids` va primero para que el
 * modelo ancle el grupo a su evidencia antes de decidir la categoría (informe 02 §1.1).
 */
export function buildClassificationSchema({ areas, templates }, { validation = false } = {}) {
  return {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            unit_ids: validation ? intArray({ minItems: 1, uniqueItems: true }) : intArray({ minItems: 1 }),
            area_id: { type: 'integer', enum: areas.map((a) => a.id) },
            template_id: { type: 'integer', enum: templates.map((t) => t.id) },
          },
          required: ['unit_ids', 'area_id', 'template_id'],
          additionalProperties: false,
        },
      },
      discarded: discardedSchema({ validation }),
    },
    required: ['groups', 'discarded'],
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
 * @param {{profile?: 'anthropic'|'all-required', validation?: boolean, withDiscarded?: boolean}} [opts]
 *   `withDiscarded: false` quita `discarded`: en la descomposición por grupo el único lugar donde se descarta es la
 *   clasificación, y un modelo sin pensamiento usaba `discarded` para datos que ya había pasado al cuerpo del mensaje.
 */
export function buildDecompositionSchema(fields, { profile = 'anthropic', validation = false, withDiscarded = true } = {}) {
  const fieldsSchema = compileFieldsSchema(fields, { profile, validation });
  const properties = { messages: { type: 'array', items: messageSchema(fieldsSchema, { validation }) } };
  if (withDiscarded) properties.discarded = discardedSchema({ validation });
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/**
 * Esquema del Proposal completo (UD-008, MASTER-SPEC §7.5): cada mensaje lleva su propio área y plantilla.
 * Se usa como `--json-schema` del harness y, con `validation: true`, como primera capa de validación de la
 * propuesta armada por `api`. `fields` es genérico acá: cada mensaje se comprueba después contra los campos
 * de su plantilla.
 */
export function buildProposalSchema({ validation = false } = {}) {
  const base = buildDecompositionSchema([], { validation });
  const message = structuredClone(base.properties.messages.items);
  message.properties.fields = { type: 'object', additionalProperties: { type: ['string', 'null'] } };
  const { unit_ids, ...rest } = message.properties;
  message.properties = { unit_ids, area_id: { type: 'integer' }, template_id: { type: 'integer' }, ...rest };
  message.required = ['unit_ids', 'area_id', 'template_id', 'title', 'fields', 'body', 'assignee_ids', 'attachment_ids'];
  return {
    type: 'object',
    properties: {
      messages: { type: 'array', items: message },
      discarded: base.properties.discarded,
    },
    required: ['messages', 'discarded'],
    additionalProperties: false,
  };
}
