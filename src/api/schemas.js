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
    kind: { type: 'string', enum: ['person', 'agent'], description: '«agent»: lo trabaja una sesión desatendida de Claude Code (UD-254); entra por cabecera firmada, nunca por contraseña.' },
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
    id, title: { type: 'string' }, description: { type: 'string' }, position: intVar, color: { type: 'string', description: 'Area color, `#rrggbb` (UD-045).' }, deleted_at: nullableText,
    open_count: intVar, unresolved_count: intVar, template_count: intVar,
    escalation_member_id: { type: ['string', 'null'], description: 'The person who decides in the area, the one a handoff goes to (UD-269): the one set, or the first active Editor.' },
    execute_model: { type: ['string', 'null'], description: 'The larger model of the area: where the light model\'s work escalates and the one of a message with no estimates; its own, or the installation\'s default (UD-292).' },
    execute_model_light: { type: ['string', 'null'], description: 'The light model of the area: its own, or the installation\'s light model (UD-292).' },
    guards: { type: 'array', description: 'The Guards of the area (UD-292): each wall with the mechanism that holds it; `person` marks one that is about a person.', items: { type: 'object', properties: { id: { type: 'integer' }, text: { type: 'string' }, mechanism: { type: 'string' }, person: { type: 'boolean' } } } },
    handoffs: { type: 'array', description: 'Handoffs to a person in the last 7 days, by person (UD-269).', items: { type: 'object', properties: { member_id: id, count: intVar } } },
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
  properties: { id, input_id: nullableId, kind: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, size: intVar, extracted: { type: 'boolean' } }
}

const replyAttachmentSummary = {
  type: 'object',
  properties: { id, reply_id: id, kind: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, size: intVar, extracted: { type: 'boolean' } }
}

export const reply = {
  type: 'object',
  properties: { id, message_id: id, author_id: id, body: { type: 'string' }, kind: { type: 'string', enum: ['answer', 'fix', 'clarification', 'forward'] }, forwarded_to: { ...nullableId, description: 'El miembro al que se reenvió el mensaje; sólo en una respuesta de tipo `forward` (UD-272).' }, attachments: { type: 'array', items: replyAttachmentSummary }, attachment_kinds: { type: 'array', items: { type: 'string' } }, retryable: { type: 'boolean', description: 'La respuesta avisa de un trabajo `execute` fallido que se puede lanzar otra vez con `POST /messages/:id/replies/:replyId/retry` (UD-282).' }, replaced_by_job_id: { ...nullableId, description: 'El trabajo que reintentó este aviso (UD-290); el aviso no se borra. El hilo lo omite cuando ese trabajo terminó.' }, retrying: { type: 'boolean', description: 'El trabajo que reintentó este aviso sigue en cola o corriendo: el hilo lo dibuja como «Reintentando» (UD-290).' }, mentions: { type: 'array', items: id, description: 'Los miembros que la respuesta menciona, elegidos en la lista de «@» (UD-278). Nunca se leen del texto.' }, created_at: { type: 'string' }, version: intVar, edited_at: nullableText }
}

export const messageCard = {
  type: 'object',
  properties: {
    id, input_id: nullableId, area_id: id, template_id: nullableId, author_id: id,
    sent_by_id: { ...nullableId, description: 'Who had the session when the input of the message was sent in the name of its author (UD-255); null when it is the author.' },
    title: { type: 'string' }, body: { type: 'string' },
    fields: { type: 'object', additionalProperties: true },
    status: { type: 'string', enum: ['open', 'answered', 'closed'] },
    assessment: { type: 'object', description: 'What the analyzer says about the message beyond its text, or a person changed (UD-292): what is expected of Claude, the Guards of the area it touches and its estimates.', properties: { expectation: { type: 'string' }, guards: { type: 'array', items: { type: 'integer' } }, estimates: { type: ['object', 'null'], additionalProperties: true, properties: { understand_vs_create: { type: 'number' }, irreversibility: { type: 'number' }, value_holder: { type: 'string', enum: ['person', 'model'] }, certainty: { type: 'number' }, reason: { type: 'string' } } }, by: { ...nullableId, description: 'The person who changed it by hand; null while it is the analyzer\'s.' } } },
    assignee_ids: { type: 'array', items: id },
    attachments: { type: 'array', items: attachmentSummary },
    attachment_kinds: { type: 'array', items: { type: 'string' } },
    reply_count: intVar,
    last_reply: { ...reply, nullable: true },
    created_at: { type: 'string' }, updated_at: { type: 'string' }, version: intVar, edited_at: nullableText, closed_at: nullableText,
    deleted_at: { ...nullableText, description: 'Set while the message is deleted (UD-240); only an active person of the team sees such a message, with include_deleted=true.' }
  }
}

export const messageDetail = {
  type: 'object',
  properties: {
    ...messageCard.properties,
    trace_id: { ...nullableText, description: 'Trace of the message (UD-262): the same id covers its sending, analysis, publication and execution.' },
    observed: { type: 'array', items: { type: 'string' }, description: 'What a video frame shows and nobody says, outside the body; empty when there is none.' },
    replies: { type: 'array', items: reply },
    pending_delivery: {
      type: 'object', nullable: true,
      description: 'UD-275: la entrega retenida que espera la revisión de una persona; null si no hay. `delivering_job_id` es la entrega en cola o corriendo tras aprobarla.',
      properties: { branch: { type: 'string' }, held_reason: { type: 'string' }, job_id: { type: 'string' }, agent_id: { type: 'string', nullable: true }, delivering_job_id: { type: 'string', nullable: true }, state: { type: 'string', enum: ['held', 'delivering', 'failed'], description: 'UD-289: `held` espera la revisión, `delivering` se está entregando, `failed` la última entrega falló y no llegó a producción.' } }
    },
    edits: { type: 'array', items: { type: 'object', properties: { id, member_id: id, at: { type: 'string' }, version: intVar, fields: { type: 'array', items: { type: 'string' } } } } }
  }
}

const proposalMessage = {
  type: 'object',
  additionalProperties: true,
  properties: {
    area_id: id, template_id: nullableId, title: { type: 'string' }, body: { type: 'string' },
    fields: { type: 'object', additionalProperties: true },
    assignee_ids: { type: 'array', items: id }, attachment_ids: { type: 'array', items: id }, unit_ids: { type: 'array', items: id },
    source: { type: 'string', enum: ['frame'] },
    expectation: { type: 'string' }, guards_touched: { type: 'array', items: { type: 'integer' } }, understand_vs_create: { type: 'number' }, irreversibility: { type: 'number' }, value_holder: { type: 'string', enum: ['person', 'model'] }, certainty: { type: 'number' }, estimate_reason: { type: 'string' },
    observed: { type: 'array', items: { type: 'string', minLength: 1 } }
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

/** Numeric variables of a progress code (H-3722): `{ n, total }` and the like. */
const progressVars = { type: 'object', additionalProperties: { type: 'number' } }

export const inputView = {
  type: 'object',
  properties: {
    id, author_id: id, sent_by_id: { ...nullableId, description: 'Who had the session when it was sent in the name of the author (UD-255); null when it is the author.' }, recipient_ids: { type: 'array', items: id, description: 'The members the send is addressed to (UD-291); empty when the automatic routing assigned.' }, text: { type: 'string' }, status: { type: 'string' }, error: nullableText, error_code: nullableText,
    created_at: { type: 'string' }, updated_at: { type: 'string' }, job_id: nullableId,
    percent: { type: ['integer', 'null'] }, phrase: nullableText, code: nullableText, vars: progressVars, proposed_count: { type: 'integer' }, // UD-025: the tray of in-flight inputs; H-3722: `code`
    attachments: {
      type: 'array',
      items: { type: 'object', properties: { ...attachmentSummary.properties, sha256: { type: 'string' }, extracted: { type: 'boolean' } } }
    },
    job: {
      type: ['object', 'null'],
      properties: { id, status: { type: 'string' }, attempts: intVar, percent: { type: ['integer', 'null'] }, phrase: nullableText, code: nullableText, vars: progressVars, last_error: nullableText }
    },
    units: { type: 'array', items: { type: 'object', properties: { id, text: { type: 'string' } } } },
    proposal: proposalView,
    message_ids: { type: 'array', items: id },
    messages: { type: 'array', items: { type: 'object', properties: { id, title: { type: 'string' }, area_id: id, status: { type: 'string', enum: ['open', 'answered', 'closed'] }, edited_at: nullableText } } }
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
          source: { type: 'string', enum: ['frame'] },
          expectation: { type: 'string' }, guards_touched: { type: 'array', items: { type: 'integer' } }, understand_vs_create: { type: 'number', minimum: 0, maximum: 1 }, irreversibility: { type: 'number', minimum: 0, maximum: 1 }, value_holder: { type: 'string', enum: ['person', 'model'] }, certainty: { type: 'number', minimum: 0, maximum: 1 }, estimate_reason: { type: 'string' },
          observed: { type: 'array', items: { type: 'string', minLength: 1 } }
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

/** Edit of a published message by its author (UD-071): a partial update plus the `version` read; unknown fields are 400. */
export const messagePatchBody = {
  type: 'object',
  additionalProperties: false,
  required: ['version'],
  minProperties: 2,
  properties: {
    version: { type: 'integer', minimum: 1 },
    attachment_ids: { type: 'array', items: idIn },
    title: { type: 'string' },
    body: { type: 'string' },
    fields: { type: 'object', additionalProperties: { type: ['string', 'null'] } },
    assignee_ids: { type: 'array', items: idIn },
    area_id: idIn,
    template_id: idIn
  }
}

/** Edit of the text of a reply by its author (UD-253): the new text plus the `version` read. */
export const replyPatchBody = {
  type: 'object',
  additionalProperties: false,
  required: ['version'],
  properties: {
    body: { type: 'string' }, version: { type: 'integer', minimum: 1 },
    mention_ids: { type: 'array', items: idIn },
    remove_attachment_ids: { type: 'array', items: idIn }
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
