// Rutas de mensajes y respuestas (MASTER-SPEC §7.1).

import { addReply, closeMessage, getMessage, listMessages, reopenMessage, REPLY_KINDS } from '../../domain/messages.js'
import { withSpan } from '../../domain/tracing.js'
import { pageEnvelope, pageParams, pageQuerySchema, pageResult } from '../pagination.js'
import { idIn, idParams, messageCard, messageDetail } from '../schemas.js'

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

  app.get('/messages/:id', {
    onRequest: [requireRole('member')],
    schema: { summary: 'Un mensaje con su hilo', params: idParams(), response: { 200: messageDetail } }
  }, async (request) => getMessage(db, request.params.id))

  app.post('/messages/:id/replies', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Responder un mensaje (403 si quien responde es su emisor)',
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

  for (const [verb, handlerFn, summaryText] of [['close', closeMessage, 'Cerrar un mensaje'], ['reopen', reopenMessage, 'Reabrir un mensaje cerrado']]) {
    app.post(`/messages/:id/${verb}`, {
      onRequest: [requireRole('member')],
      schema: { summary: summaryText, params: idParams(), response: { 200: messageDetail } }
    }, async (request) => withSpan(`message.${verb}`, { 'team.message_id': String(request.params.id), 'team.member_id': String(request.member.id) },
      () => handlerFn({ db, events }, request.params.id, request.member.id)))
  }
}
