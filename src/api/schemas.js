// Esquemas JSON de entrada y salida (MASTER-SPEC §7.1). Son la fuente del contrato OpenAPI que publica
// `GET /api/openapi.json`: contrato primero. Los de salida pasan por fast-json-stringify: sirven al contrato de
// la API y para no filtrar columnas. No validan lo que devuelve un modelo (eso lo hace la instancia propia de
// Ajv del dominio, informe 03 §7.1).
//
// Convenciones de la API:
//  - Todo id viaja como texto en las respuestas ({ type: 'string' } convierte el entero de la base). En las
//    entradas se acepta texto o entero; un id con formato inválido es 400.
//  - Todo POST y PATCH rechaza propiedades desconocidas (additionalProperties: false).
//  - Toda lista es { items, page, limit, total } (src/api/pagination.js).

const id = { type: 'string' }
// fast-json-stringify no convierte número a texto en una unión de tipos: un id que puede faltar es texto anulable.
const nullableId = { type: 'string', nullable: true }
const nullableText = { type: 'string', nullable: true }
const intVar = { type: 'integer' }

/** Id en una entrada: acepta "12" o 12; Ajv lo convierte a entero y rechaza lo que no lo es. */
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
    responsibilities: { type: 'string' }, domains: { type: 'array', items: { type: 'string' } }, language: { type: 'string', enum: ['es-419', 'en'] }, created_at: { type: 'string' }
  },
  required: ['id', 'email', 'name', 'role', 'language']
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

const attachmentSummary = {
  type: 'object',
  properties: { id, input_id: id, kind: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, size: intVar }
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
    assignee_ids: { type: 'array', items: id }, attachment_ids: { type: 'array', items: id }, unit_ids: { type: 'array', items: id }
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
 * Propuesta (§7.5) que el emisor guarda como borrador (PATCH /inputs/:id/proposal) o publica: cada mensaje con su área y plantilla (la plantilla puede ir null y
 * entonces rige la primera vigente del área). `discarded` y `unit_ids` los trae la propuesta tal cual y se
 * aceptan sin usarse: la cobertura ya la verificó el analizador.
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
          unit_ids: { type: 'array', items: { type: 'integer' } }
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
