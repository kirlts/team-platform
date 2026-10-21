// Rutas de mensajes y respuestas (MASTER-SPEC §7.1).

import { addReply, closeMessage, getMessage, listMessages, reopenMessage, REPLY_KINDS } from '../../domain/messages.js'
import { idParams, messageCard, messageDetail } from '../schemas.js'

export function registerMessageRoutes (app, ctx) {
  const { db, config, events, requireRole } = ctx

  app.get('/messages', {
    onRequest: [requireRole('member')],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          for: { type: 'string', pattern: '^(me|[0-9]+)$' }, // «me» o el id de un miembro
          area: { type: 'integer', minimum: 1 },
          status: { type: 'string', enum: ['open', 'answered', 'closed'] },
          q: { type: 'string' },
          replies: { type: 'integer', enum: [0, 1] },
          limit: { type: 'integer', minimum: 1, maximum: config.list.pageMax },
          offset: { type: 'integer', minimum: 0 }
        },
        additionalProperties: false
      },
      response: { 200: { type: 'object', properties: { items: { type: 'array', items: messageCard }, next_offset: { type: ['integer', 'null'] } } } }
    }
  }, async (request) => {
    const q = request.query
    return listMessages(db, {
      viewerId: request.member.id,
      forMember: q.for === undefined ? null : q.for === 'me' ? 'me' : Number(q.for),
      area: q.area ?? null,
      status: q.status ?? null,
      q: q.q ?? null,
      replies: q.replies === 1,
      limit: q.limit ?? config.list.pageSize,
      offset: q.offset ?? 0
    })
  })

  app.get('/messages/:id', {
    onRequest: [requireRole('member')],
    schema: { params: idParams(), response: { 200: messageDetail } }
  }, async (request) => getMessage(db, request.params.id))

  app.post('/messages/:id/replies', {
    onRequest: [requireRole('member')],
    schema: {
      params: idParams(),
      body: {
        type: 'object',
        required: ['body'],
        additionalProperties: false,
        properties: { body: { type: 'string' }, kind: { type: 'string', enum: REPLY_KINDS } }
      },
      response: { 201: messageDetail }
    }
  }, async (request, reply) => {
    const r = addReply({ db, events }, { messageId: request.params.id, authorId: request.member.id, body: request.body.body, kind: request.body.kind })
    reply.code(201)
    return r.message
  })

  for (const [accion, funcion] of [['close', closeMessage], ['reopen', reopenMessage]]) {
    app.post(`/messages/:id/${accion}`, {
      onRequest: [requireRole('member')],
      schema: { params: idParams(), response: { 200: messageDetail } }
    }, async (request) => funcion({ db, events }, request.params.id))
  }
}
