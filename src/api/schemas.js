// JSON schemas for input and output (MASTER-SPEC §7.1). They are the source of the OpenAPI contract published by
// `GET /api/openapi.json`: contract first. The output ones go through fast-json-stringify: they serve the contract of
// the API and avoid leaking columns. They do not validate what a model returns (that is done by the domain's own
// Ajv instance, report 03 §7.1).
//
// API conventions:
//  - Every id travels as text in responses ({ type: 'string' } converts the database integer). In
//    inputs, text or integer is accepted; an id with an invalid format is a 400.
//  - Every POST and PATCH rejects unknown properties (additionalProperties: false).
//  - Every list is { items, page, limit, total } (src/api/pagination.js).

const id = { type: 'string' }
// fast-json-stringify does not convert a number to text in a type union: an id that may be missing is nullable text.
const nullableId = { type: 'string', nullable: true }
const nullableText = { type: 'string', nullable: true }
const intVar = { type: 'integer' }

/** Id in an input: accepts "12" or 12; Ajv converts it to an integer and rejects what is not one. */
export const idIn = { type: 'integer', minimum: 1 }

export const idParams = (nameValue = 'id') => ({
  type: 'object',
  required: [nameValue],
  properties: { [nameValue]: idIn }
})

export const errorSchema = {
  type: 'object',
  properties: { code: { type: 'string' }, message: { type: 'string' } },
  required: ['code', 'message'],
  additionalProperties: true
}

export const member = {
  type: 'object',
  properties: {
    id, email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', enum: ['member', 'editor'] },
    profile: { type: 'string' }, language: { type: 'string', enum: ['es-419', 'en'] }, active: { type: 'boolean' }, created_at: { type: 'string' }
  },
  required: ['id', 'email', 'name', 'role', 'language', 'active']
}

export const templateSummary = {
  type: 'object',
  properties: { id, area_id: id, name: { type: 'string' }, description: { type: 'string' }, updated_at: { type: 'string' }, deleted_at: nullableText }
}

export const template = {
  type: 'object',
  properties: { ...templateSummary.properties, body_markdown: { type: 'string' } }
}

export const area = {
  type: 'object',
  properties: {
    id, title: { type: 'string' }, description: { type: 'string' }, position: intVar, deleted_at: nullableText,
    open_count: intVar, unresolved_count: intVar, template_count: intVar,
    templates: { type: 'array', items: templateSummary }
  }
}

export const messageSummary = {
  type: 'object',
  properties: {
    mine: { type: 'object', properties: { open: intVar, answered: intVar, total: intVar } },
    items: { type: 'array', items: { type: 'object', properties: { message_id: id, title: { type: 'string' }, status: { type: 'string' }, at: { type: 'string' } } } },
    areas: { type: 'array', items: { type: 'object', properties: { area_id: id, open: intVar, answered: intVar, closed: intVar, mine_open: intVar } } }
  }
}

const attachmentSummary = {
  type: 'object',
  properties: { id, input_id: id, kind: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, size: intVar, extracted: { type: 'boolean' } }
}

const replyAttachmentSummary = {
  type: 'object',
  properties: { id, reply_id: id, kind: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, size: intVar }
}

export const reply = {
  type: 'object',
  properties: { id, message_id: id, author_id: id, body: { type: 'string' }, kind: { type: 'string', enum: ['answer', 'fix', 'clarification'] }, attachments: { type: 'array', items: replyAttachmentSummary }, attachment_kinds: { type: 'array', items: { type: 'string' } }, created_at: { type: 'string' } }
}

export const messageCard = {
  type: 'object',
  properties: {
    id, input_id: nullableId, area_id: id, template_id: nullableId, author_id: id,
    title: { type: 'string' }, body: { type: 'string' },
    fields: { type: 'object', additionalProperties: true },
    status: { type: 'string', enum: ['open', 'answered', 'closed'] },
    assignee_ids: { type: 'array', items: id },
    attachments: { type: 'array', items: attachmentSummary },
    attachment_kinds: { type: 'array', items: { type: 'string' } },
    reply_count: intVar,
    last_reply: { ...reply, nullable: true },
    created_at: { type: 'string' }, updated_at: { type: 'string' }, closed_at: nullableText
  }
}

export const messageDetail = {
  type: 'object',
  properties: { ...messageCard.properties, replies: { type: 'array', items: reply } }
}

const proposalMessage = {
  type: 'object',
  additionalProperties: true,
  properties: {
    area_id: id, template_id: nullableId, title: { type: 'string' }, body: { type: 'string' },
    fields: { type: 'object', additionalProperties: true },
    assignee_ids: { type: 'array', items: id }, attachment_ids: { type: 'array', items: id }, unit_ids: { type: 'array', items: id },
    source: { type: 'string', enum: ['frame'] }
  }
}

/** The proposal as the API returns it (§7.5): ids as text. Null while the input has none. */
export const proposalView = {
  type: ['object', 'null'],
  properties: {
    messages: { type: 'array', items: proposalMessage },
    discarded: { type: 'array', items: { type: 'object', properties: { unit_ids: { type: 'array', items: id }, reason: { type: 'string' } } } }
  }
}

export const inputView = {
  type: 'object',
  properties: {
    id, author_id: id, text: { type: 'string' }, status: { type: 'string' }, error: nullableText, error_code: nullableText,
    created_at: { type: 'string' }, job_id: nullableId,
    percent: { type: ['integer', 'null'] }, phrase: nullableText, proposed_count: { type: 'integer' }, // UD-025: the tray of in-flight inputs
    attachments: {
      type: 'array',
      items: { type: 'object', properties: { ...attachmentSummary.properties, sha256: { type: 'string' }, extracted: { type: 'boolean' } } }
    },
    job: {
      type: ['object', 'null'],
      properties: { id, status: { type: 'string' }, attempts: intVar, percent: { type: ['integer', 'null'] }, phrase: nullableText, last_error: nullableText }
    },
    units: { type: 'array', items: { type: 'object', properties: { id, text: { type: 'string' } } } },
    proposal: proposalView,
    message_ids: { type: 'array', items: id }
  }
}

/**
 * Proposal (§7.5) that the sender saves as a draft (PATCH /inputs/:id/proposal) or publishes: each message with its area and
 * template (the template may be null and then the first current one of the area applies). `discarded` and `unit_ids`
 * come from the proposal as is and are accepted without being used: the analyzer already verified coverage.
 */
export const proposalBody = {
  type: 'object',
  additionalProperties: false,
  required: ['messages'],
  properties: {
    messages: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area_id', 'title', 'body'],
        properties: {
          area_id: idIn,
          template_id: { type: ['integer', 'null'], minimum: 1 },
          title: { type: 'string' },
          body: { type: 'string' },
          fields: { type: 'object', additionalProperties: { type: ['string', 'null'] } },
          assignee_ids: { type: 'array', items: idIn },
          attachment_ids: { type: 'array', items: idIn },
          unit_ids: { type: 'array', items: { type: 'integer' } },
          source: { type: 'string', enum: ['frame'] }
        }
      }
    },
    discarded: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { unit_ids: { type: 'array', items: { type: 'integer' } }, reason: { type: 'string' } } }
    }
  }
}

/** Publishing without a body publishes the saved draft (UD-017), so `messages` is not required here. */
export const publishBody = (() => { const { required: _required, ...rest } = proposalBody; return rest })()

/** In-place edit of a published message (UD-017): a partial update; unknown fields are 400. */
export const messagePatchBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    title: { type: 'string' },
    body: { type: 'string' },
    fields: { type: 'object', additionalProperties: { type: ['string', 'null'] } },
    assignee_ids: { type: 'array', items: idIn },
    area_id: idIn,
    template_id: idIn
  }
}

export const providerSlot = {
  type: 'object',
  additionalProperties: false,
  properties: { provider: { type: 'string', minLength: 1 }, model: { type: 'string', minLength: 1 }, base_url: { type: 'string' } }
}

export const confirmQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { confirm: { type: 'boolean' } }
}
