// JSON schemas of the analyzer (report 02 §6.2 and MASTER-SPEC §7.5).
//
// All the schemas that go to a provider's grammar are static per template: member and attachment ids are
// integers that Ajv validates against the bundle, not a per-input `enum`, which would change the structure
// and force the grammar to be recompiled on every call (report 02 §6.2).
// No `maxItems`, `minLength` or `minItems` greater than 1 in the grammar: Anthropic does not support them [F1].
import { BLOOM_LEVELS } from '../domain/bloom.js';
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
      // H-3731: voice units whose first words finish the previous voice unit (the transcription cuts by time, not by sentence).
      // `at` copies the words where the unit really starts; the system checks that they are in the unit and moves the rest.
      split_at: {
        type: 'array',
        items: {
          type: 'object',
          properties: { unit_id: { type: 'integer' }, at: { type: 'string' } },
          required: ['unit_id', 'at'],
          additionalProperties: false,
        },
      },
      groups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            unit_ids: validation ? intArray({ minItems: 1, uniqueItems: true }) : intArray({ minItems: 1 }),
            // H-3730: each request the group carries, one line each, named before the area. The validation asks for exactly one
            // (a count, never a reading of the text); the decomposition receives it.
            // No `minLength` in the validation: an empty line is not a reason to fail a classification the system never reads.
            requests: { type: 'array', items: { type: 'string' } },
            // H-3731: units of the group that only close or sum up requests already said; they never make a group of their own.
            recap_unit_ids: intArray(),
            area_id: { type: 'integer', enum: areas.map((a) => a.id) },
            template_id: { type: 'integer', enum: templates.map((t) => t.id) },
          },
          required: ['unit_ids', ...(validation ? [] : ['requests', 'recap_unit_ids']), 'area_id', 'template_id'],
          additionalProperties: false,
        },
      },
      discarded: discardedSchema({ validation }),
    },
    required: [...(validation ? [] : ['split_at']), 'groups', 'discarded'],
    additionalProperties: false,
  };
}

/**
 * Schema of the split check (one group in, its requests out): each request with its own line and the units that state it.
 * Every unit of the group goes in exactly one request; the system checks it by sets (`validateSplit`).
 */
export function buildSplitSchema({ validation = false } = {}) {
  return {
    type: 'object',
    properties: {
      requests: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            unit_ids: validation ? intArray({ minItems: 1, uniqueItems: true }) : intArray({ minItems: 1 }),
            request: validation ? { type: 'string', minLength: 1 } : { type: 'string' },
          },
          required: ['unit_ids', 'request'],
          additionalProperties: false,
        },
      },
    },
    required: ['requests'],
    additionalProperties: false,
  };
}

function messageSchema(fieldsSchema, { validation, requireAssignee = false }) {
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
      // UD-292: the level of the request in the revised Bloom taxonomy, decided by the model that reads it; the system only maps the enum to a tier.
      // It goes before the assignees: who answers depends on whether the work is a direct fix, a diagnosis or a decision only a person takes.
      bloom_level: { type: 'string', enum: [...BLOOM_LEVELS] },
      // With a team, every message has an owner (H-86): the grammar of the model requires at least one id.
      assignee_ids: requireAssignee ? { ...ids, minItems: 1 } : ids,
      attachment_ids: ids,
      // H-3730: what a frame shows and nobody says aloud, kept out of the body («Observado, no dicho»). Empty when there is none.
      observed: { type: 'array', items: text },
      // H-3730: the units where the person comes back to this request after talking about another one. A message whose spoken
      // units are not one run must declare where each later run starts; the system checks the shape, never the text.
      resumes_at: ids,
    },
    // The grammar requires `observed` so the model always considers it; the validation accepts an output without it (an empty list).
    required: ['unit_ids', 'title', 'fields', 'body', 'assignee_ids', 'attachment_ids', ...(validation ? [] : ['bloom_level', 'observed', 'resumes_at'])],
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
export function buildDecompositionSchema(fields, { profile = 'anthropic', validation = false, withDiscarded = true, requireAssignee = false } = {}) {
  const fieldsSchema = compileFieldsSchema(fields, { profile, validation });
  const properties = { messages: { type: 'array', items: messageSchema(fieldsSchema, { validation, requireAssignee: requireAssignee && !validation }) } };
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
  // `source` is set by the system from the kind of the units (UD-021, H-3730), never by the model of the decomposition.
  message.properties = { unit_ids, area_id: { type: 'integer' }, template_id: { type: 'integer' }, ...rest, source: { type: 'string', enum: ['frame'] } };
  message.required = ['unit_ids', 'area_id', 'template_id', 'title', 'fields', 'body', 'assignee_ids', 'attachment_ids', ...(validation ? [] : ['bloom_level'])];
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
