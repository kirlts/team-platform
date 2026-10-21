// Rutas de mensajes y respuestas (MASTER-SPEC §7.1).

import { addReply, assertCanReply, closeMessage, getMessage, listMessages, messageSummary, reopenMessage, REPLY_KINDS, updateMessage } from '../../domain/messages.js'
import { withSpan } from '../../domain/tracing.js'
import { pageEnvelope, pageParams, pageQuerySchema, pageResult } from '../pagination.js'
import { idIn, idParams, messageCard, messageDetail, messagePatchBody, messageSummary as messageSummarySchema } from '../schemas.js'
import { readReplyUpload } from '../upload.js'

export function registerMessageRoutes (app, ctx) {
  const { db, config, events, requireRole } = ctx

  app.get('/messages', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Mensajes del equipo, con filtros',
      description: '`for`: «me» o el id de un miembro (mensajes asignados a). `replies=1`: sólo con respuestas, la última primero; con `for`, los que involucran a esa persona.',
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...pageQuerySchema(config),
          for: { type: 'string', pattern: '^(me|[0-9]+)$' },
          area: idIn,
          status: { type: 'string', enum: ['open', 'answered', 'closed'] },
          q: { type: 'string' },
          replies: { type: 'integer', enum: [0, 1] }
        }
      },
      response: { 200: pageEnvelope(messageCard) }
    }
  }, async (request) => {
    const q = request.query
    const p = pageParams(q, config)
    const r = listMessages(db, {
      viewerId: request.member.id,
      forMember: q.for === undefined ? null : q.for === 'me' ? 'me' : Number(q.for),
      area: q.area ?? null,
      status: q.status ?? null,
      q: q.q ?? null,
      replies: q.replies === 1,
      limit: p.limit,
      offset: p.offset
    })
    return pageResult(r.items, r.total, p)
  })

  app.get('/messages/summary', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Lo que afecta a quien tiene la sesión, por prioridad, y los abiertos por área',
      description: '`mine`: mensajes no cerrados que afectan al miembro. `red`: asignados a él y abiertos; `yellow`: asignados a él y respondidos; `blue`: emitidos por él, sin asignarle, con respuestas. `areas`: abiertos por área y cuántos son rojos para él (UD-028).',
      response: { 200: messageSummarySchema }
    }
  }, async (request) => messageSummary(db, request.member.id))

  app.get('/messages/:id', {
    onRequest: [requireRole('member')],
    schema: { summary: 'Un mensaje con su hilo', params: idParams(), response: { 200: messageDetail } }
  }, async (request) => getMessage(db, request.params.id))

  app.patch('/messages/:id', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Editar un mensaje en el lugar (su emisor o un editor): título, texto, campos, destinatarios y área',
      description: 'Actualización parcial (UD-017). Cambiar el área exige `template_id` de esa área. Se puede editar un mensaje respondido o cerrado. Repetir la misma edición deja el mismo estado. 403 si no es el emisor ni un editor; un valor inexistente o un campo desconocido es 400. No hay historial de versiones.',
      params: idParams(),
      body: messagePatchBody,
      response: { 200: messageDetail }
    }
  }, async (request) => withSpan('message.update', { 'team.message_id': String(request.params.id), 'team.member_id': String(request.member.id) },
    () => updateMessage({ db, events }, { messageId: request.params.id, actor: request.member, patch: request.body })))

  app.post('/messages/:id/replies', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Responder un mensaje, con archivos y enlaces opcionales (403 si quien responde es su emisor)',
      description: 'JSON `{ body, kind }` o multipart (`body`, `kind`, `files[]`, `links[]`) con los mismos topes y el mismo almacenamiento que `POST /inputs`. Una respuesta con archivos o enlaces puede ir sin texto. Los adjuntos se guardan y se sirven, no se analizan: `GET /replies/attachments/:id` entrega el archivo. Devuelve el mensaje con su hilo; cada respuesta lleva `attachments` y `attachment_kinds`.',
      params: idParams(),
      // Per content type: the multipart body is read by the handler, only the JSON body is validated by schema.
      body: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['body'],
              additionalProperties: false,
              properties: { body: { type: 'string' }, kind: { type: 'string', enum: REPLY_KINDS } }
            }
          }
        }
      },
      response: { 201: messageDetail }
    }
  }, async (request, reply) => {
    let input
    if (request.isMultipart()) {
      // Refuse before storing a large upload when the reply is not allowed anyway.
      assertCanReply(db, request.params.id, request.member.id)
      input = await readReplyUpload(request, config)
    } else {
      input = { body: request.body.body, kind: request.body.kind, files: [], links: [] }
    }
    const r = addReply({ db, events }, { messageId: request.params.id, authorId: request.member.id, ...input, kind: input.kind ?? undefined })
    reply.code(201)
    return r.message
  })

  for (const [verb, handlerFn, summaryText] of [['close', closeMessage, 'Cerrar un mensaje'], ['reopen', reopenMessage, 'Reabrir un mensaje cerrado']]) {
    app.post(`/messages/:id/${verb}`, {
      onRequest: [requireRole('member')],
      schema: { summary: summaryText, params: idParams(), response: { 200: messageDetail } }
    }, async (request) => withSpan(`message.${verb}`, { 'team.message_id': String(request.params.id), 'team.member_id': String(request.member.id) },
      () => handlerFn({ db, events }, request.params.id, request.member.id)))
  }
}
