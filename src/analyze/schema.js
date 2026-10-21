// JSON schemas of the analyzer (report 02 §6.2 and MASTER-SPEC §7.5).
//
// All the schemas that go to a provider's grammar are static per template: member and attachment ids are
// integers that Ajv validates against the bundle, not a per-input `enum`, which would change the structure
// and force the grammar to be recompiled on every call (report 02 §6.2).
// No `maxItems`, `minLength` or `minItems` greater than 1 in the grammar: Anthropic does not support them [F1].
import { compileFieldsSchema } from './templates.js';

const intArray = (extra = {}) => ({ type: 'array', items: { type: 'integer' }, ...extra });

/**
 * Schema of the first call: groups the units of the input by area and template (idea.md: «one or several
 * messages that group the work into categories»). Each group is `{unit_ids, area_id, template_id}`; what
 * neither requests nor reports anything goes in `discarded`. Area and template are `enum`s of existing ids
 * (report 02 §4.3: reducing the value space collapses the disagreement between runs [F25]); `unit_ids` goes
 * first so that the model anchors the group to its evidence before deciding the category (report 02 §1.1).
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
  // `unit_ids` goes first: the model anchors the message to its evidence before writing it (report 02 §6.2).
  // All the properties are required, so the output order is that of the schema [F1].
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
 * Schema of the second call (and of the rescue): the list of messages with their units and what was discarded.
 * It can come with no messages when no unit is actionable: then everything goes in `discarded`.
 * @param {{name: string, label: string, required: boolean}[]} fields fields of the chosen template
 * @param {{profile?: 'anthropic'|'all-required', validation?: boolean, withDiscarded?: boolean}} [opts]
 *   `withDiscarded: false` removes `discarded`: in the per-group decomposition the only place where anything is
 *   discarded is the classification, and a model without thinking used `discarded` for data it had already put
 *   in the body of the message.
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
 * Schema of the complete Proposal (UD-008, MASTER-SPEC §7.5): each message carries its own area and template.
 * It is used as the harness `--json-schema` and, with `validation: true`, as the first validation layer of the
 * proposal assembled by `api`. `fields` is generic here: each message is checked afterwards against the fields
 * of its template.
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
