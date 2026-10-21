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
const idNulo = { type: ['string', 'null'] }
const textoNulo = { type: ['string', 'null'] }
const entero = { type: 'integer' }

/** Id en una entrada: acepta "12" o 12; Ajv lo convierte a entero y rechaza lo que no lo es. */
export const idIn = { type: 'integer', minimum: 1 }

export const idParams = (nombre = 'id') => ({
  type: 'object',
  required: [nombre],
  properties: { [nombre]: idIn }
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
    responsibilities: { type: 'string' }, domains: { type: 'array', items: { type: 'string' } }, created_at: { type: 'string' }
  },
  required: ['id', 'email', 'name', 'role']
}

export const templateSummary = {
  type: 'object',
  properties: { id, area_id: id, name: { type: 'string' }, description: { type: 'string' }, updated_at: { type: 'string' }, deleted_at: textoNulo }
}

export const template = {
  type: 'object',
  properties: { ...templateSummary.properties, body_markdown: { type: 'string' } }
}

export const area = {
  type: 'object',
  properties: {
    id, title: { type: 'string' }, description: { type: 'string' }, position: entero, deleted_at: textoNulo,
    open_count: entero, unresolved_count: entero, template_count: entero,
    templates: { type: 'array', items: templateSummary }
  }
}

const attachmentSummary = {
  type: 'object',
  properties: { id, input_id: id, kind: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, size: entero }
}

export const reply = {
  type: 'object',
  properties: { id, message_id: id, author_id: id, body: { type: 'string' }, kind: { type: 'string', enum: ['answer', 'fix', 'clarification'] }, created_at: { type: 'string' } }
}

export const messageCard = {
  type: 'object',
  properties: {
    id, input_id: idNulo, area_id: id, template_id: idNulo, author_id: id,
    title: { type: 'string' }, body: { type: 'string' },
    fields: { type: 'object', additionalProperties: true },
    status: { type: 'string', enum: ['open', 'answered', 'closed'] },
    assignee_ids: { type: 'array', items: id },
    attachments: { type: 'array', items: attachmentSummary },
    reply_count: entero,
    last_reply: { anyOf: [{ type: 'null' }, reply] },
    created_at: { type: 'string' }, closed_at: textoNulo
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
    area_id: id, template_id: idNulo, title: { type: 'string' }, body: { type: 'string' },
    fields: { type: 'object', additionalProperties: true },
    assignee_ids: { type: 'array', items: id }, attachment_ids: { type: 'array', items: id }, unit_ids: { type: 'array', items: id }
  }
}

export const inputView = {
  type: 'object',
  properties: {
    id, author_id: id, text: { type: 'string' }, status: { type: 'string' }, error: textoNulo, error_code: textoNulo,
    created_at: { type: 'string' }, job_id: idNulo,
    attachments: {
      type: 'array',
      items: { type: 'object', properties: { ...attachmentSummary.properties, sha256: { type: 'string' }, extracted: { type: 'boolean' } } }
    },
    job: {
      type: ['object', 'null'],
      properties: { id, status: { type: 'string' }, attempts: entero, percent: { type: ['integer', 'null'] }, phrase: textoNulo, last_error: textoNulo }
    },
    units: { type: 'array', items: { type: 'object', properties: { id, text: { type: 'string' } } } },
    proposal: {
      type: ['object', 'null'],
      properties: {
        messages: { type: 'array', items: proposalMessage },
        discarded: { type: 'array', items: { type: 'object', properties: { unit_ids: { type: 'array', items: id }, reason: { type: 'string' } } } }
      }
    },
    message_ids: { type: 'array', items: id }
  }
}

/**
 * Propuesta editada que el emisor publica: cada mensaje con su área y plantilla (la plantilla puede ir null y
 * entonces rige la primera vigente del área). `discarded` y `unit_ids` los trae la propuesta tal cual y se
 * aceptan sin usarse: la cobertura ya la verificó el analizador.
 */
export const publishBody = {
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
