// Esquemas JSON de entrada y salida (MASTER-SPEC §7.1). Los de salida pasan por fast-json-stringify: sirven
// al contrato de la API y para no filtrar columnas. No validan lo que devuelve un modelo (eso lo hace la
// instancia propia de Ajv del dominio, informe 03 §7.1).

const entero = { type: 'integer' }
const textoNulo = { type: ['string', 'null'] }

export const idParams = (nombre = 'id') => ({
  type: 'object',
  required: [nombre],
  properties: { [nombre]: { type: 'integer', minimum: 1 } }
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
    id: entero, email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', enum: ['member', 'editor'] },
    responsibilities: { type: 'string' }, domains: { type: 'string' }, created_at: { type: 'string' }
  },
  required: ['id', 'email', 'name', 'role']
}

export const templateSummary = {
  type: 'object',
  properties: { id: entero, area_id: entero, name: { type: 'string' }, description: { type: 'string' }, updated_at: { type: 'string' } }
}

export const template = {
  type: 'object',
  properties: { ...templateSummary.properties, body_markdown: { type: 'string' } }
}

export const area = {
  type: 'object',
  properties: {
    id: entero, title: { type: 'string' }, description: { type: 'string' }, position: entero,
    open_count: entero, unresolved_count: entero,
    templates: { type: 'array', items: templateSummary }
  }
}

const attachmentSummary = {
  type: 'object',
  properties: { id: entero, kind: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, size: entero }
}

export const messageCard = {
  type: 'object',
  properties: {
    id: entero, input_id: { type: ['integer', 'null'] }, status: { type: 'string', enum: ['open', 'answered', 'closed'] },
    title: { type: 'string' }, body: { type: 'string' },
    fields: { type: 'object', additionalProperties: true },
    area: { type: 'object', properties: { id: entero, title: { type: 'string' } } },
    template_id: { type: ['integer', 'null'] },
    author: { type: 'object', properties: { id: entero, name: { type: 'string' } } },
    assignees: { type: 'array', items: { type: 'object', properties: { id: entero, name: { type: 'string' } } } },
    attachments: { type: 'array', items: attachmentSummary },
    reply_count: entero, last_reply_at: textoNulo, created_at: { type: 'string' }, closed_at: textoNulo
  }
}

export const messageDetail = {
  type: 'object',
  properties: {
    ...messageCard.properties,
    replies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: entero, author: { type: 'object', properties: { id: entero, name: { type: 'string' } } },
          body: { type: 'string' }, kind: { type: 'string' }, created_at: { type: 'string' }
        }
      }
    }
  }
}

export const inputView = {
  type: 'object',
  properties: {
    id: entero, author_id: entero, text: { type: 'string' }, status: { type: 'string' }, error: textoNulo, error_code: textoNulo,
    created_at: { type: 'string' },
    attachments: {
      type: 'array',
      items: { type: 'object', properties: { ...attachmentSummary.properties, sha256: { type: 'string' }, extracted: { type: 'boolean' } } }
    },
    job: {
      type: ['object', 'null'],
      properties: { id: entero, status: { type: 'string' }, attempts: entero, percent: { type: ['integer', 'null'] }, phrase: textoNulo, last_error: textoNulo }
    },
    // La propuesta la escribe el analizador y puede traer campos propios (unit_ids, discarded…): se deja pasar entera.
    proposal: { type: ['object', 'null'], additionalProperties: true },
    message_ids: { type: 'array', items: entero }
  }
}

/** Propuesta editada que el emisor publica. Los campos desconocidos por mensaje se ignoran (unit_ids, etc.). */
export const publishBody = {
  type: 'object',
  required: ['area_id', 'template_id', 'messages'],
  properties: {
    area_id: { type: 'integer', minimum: 1 },
    template_id: { type: 'integer', minimum: 1 },
    messages: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['title', 'body'],
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
          fields: { type: 'object', additionalProperties: { type: 'string' } },
          assignee_ids: { type: 'array', items: { type: 'integer', minimum: 1 } },
          attachment_ids: { type: 'array', items: { type: 'integer', minimum: 1 } }
        }
      }
    }
  }
}

export const providerSlot = {
  type: 'object',
  properties: { provider: { type: 'string', minLength: 1 }, model: { type: 'string', minLength: 1 }, base_url: { type: 'string' } },
  additionalProperties: false
}
