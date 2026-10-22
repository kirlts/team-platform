// Message and reply routes (MASTER-SPEC §7.1).

import { releaseBlobs } from '../../domain/storage.js'
import { addMessageAttachments, addReply, assertCanAddAttachments, assertCanReply, closeMessage, deleteMessage, deleteReply, getMessage, listMessages, messageSummary, reopenMessage, REPLY_KINDS, restoreMessage, restoreReply, updateMessage, updateReply } from '../../domain/messages.js'
import { withSpan } from '../../domain/tracing.js'
import { requireConfirm } from '../confirm.js'
import { pageEnvelope, pageParams, pageQuerySchema, pageResult } from '../pagination.js'
import { confirmQuery, idIn, idParams, messageCard, messageDetail, messagePatchBody, messageSummary as messageSummarySchema, replyPatchBody } from '../schemas.js'
import { readMessageAttachmentUpload, readReplyUpload } from '../upload.js'

export function registerMessageRoutes (app, ctx) {
  const { db, config, events, queue, requireRole } = ctx

  app.get('/messages', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Team messages, with filters',
      description: '`for`: «me» or a member id (messages assigned to). `involved=me`: los mensajes que afectan a quien tiene la sesión, con la misma regla que `/messages/summary`: asignados a esa persona, o emitidos por ella cuando ya tienen respuesta o están cerrados (UD-028). `replies=1`: only with replies, latest first; with `for`, those that involve that person. `deleted=1`: sólo los mensajes borrados (UD-250), los más recién borrados primero: quien los escribió ve los suyos y un Editor todos; se restauran con `POST /messages/:id/restore`.',
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...pageQuerySchema(config),
          for: { type: 'string', pattern: '^(me|[0-9]+)$' },
          involved: { type: 'string', enum: ['me'] },
          area: idIn,
          status: { type: 'string', enum: ['open', 'answered', 'closed'] },
          q: { type: 'string' },
          replies: { type: 'integer', enum: [0, 1] },
          deleted: { type: 'integer', enum: [0, 1] }
        }
      },
      response: { 200: pageEnvelope(messageCard) }
    }
  }, async (request) => {
    const q = request.query
    const p = pageParams(q, config)
    const r = listMessages(db, {
      viewerId: request.member.id,
      viewerRole: request.member.role,
      forMember: q.for === undefined ? null : q.for === 'me' ? 'me' : Number(q.for),
      involved: q.involved === 'me',
      area: q.area ?? null,
      status: q.status ?? null,
      q: q.q ?? null,
      replies: q.replies === 1,
      deleted: q.deleted === 1,
      limit: p.limit,
      offset: p.offset
    })
    return pageResult(r.items, r.total, p)
  })

  app.get('/messages/summary', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Lo que afecta a quien tiene la sesión, por estado, y los mensajes de cada área por estado',
      description: '`mine`: mensajes no cerrados que afectan al miembro, por su estado. `open`: asignados a él y abiertos; `answered`: asignados a él y respondidos, o emitidos por él con respuestas. `areas`: abiertos, respondidos y cerrados por área, y cuántos de los abiertos son suyos (UD-028, UD-041).',
      response: { 200: messageSummarySchema }
    }
  }, async (request) => messageSummary(db, request.member.id))

  app.get('/messages/:id', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'A message with its thread',
      description: 'Un mensaje borrado responde 404. `include_deleted=true` lo devuelve igual, con `deleted_at`, sólo a un Editor (UD-240); un Miembro recibe 403.',
      params: idParams(),
      querystring: { type: 'object', additionalProperties: false, properties: { include_deleted: { type: 'boolean' } } },
      response: { 200: messageDetail }
    }
  }, async (request, reply) => {
    if (request.query.include_deleted === true && request.member.role !== 'editor') {
      return reply.code(403).send({ code: 'forbidden', message: 'Ver lo borrado corresponde a un editor.' })
    }
    return getMessage(db, request.params.id, { includeDeleted: request.query.include_deleted === true })
  })

  const replyParams = { type: 'object', required: ['id', 'replyId'], properties: { id: idIn, replyId: idIn } }
  const spanOf = (request, name, extra = {}) => (fn) => withSpan(name, { 'team.message_id': String(request.params.id), 'team.member_id': String(request.member.id), ...extra }, fn)

  app.delete('/messages/:id', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Borrar un mensaje publicado (su emisor o un Editor; exige ?confirm=true)',
      description: 'Borrado en blando (UD-240): el mensaje deja de aparecer en las listas, los conteos, la búsqueda, los avisos y el hilo de sus respuestas, y `GET /messages/:id` responde 404. Lo deshace `POST /messages/:id/restore`. 403 `not_message_author` si quien pide no es el emisor ni un Editor; 404 si no existe o ya está borrado; 400 `confirm_required` sin la confirmación. Deja la fila `message.delete` en la bitácora.',
      params: idParams(),
      querystring: confirmQuery,
      response: { 204: { type: 'null', description: 'Message deleted; restored with POST /messages/:id/restore.' } }
    }
  }, async (request, reply) => {
    requireConfirm(request)
    spanOf(request, 'message.delete')(() => deleteMessage({ db, events }, { messageId: request.params.id, actor: request.member }))
    return reply.code(204).send()
  })

  app.post('/messages/:id/restore', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Restaurar un mensaje borrado (su emisor o un Editor)',
      description: 'Quita `deleted_at` y devuelve el mensaje con su hilo tal como estaba (UD-240). 409 `not_deleted` si no está borrado; 403 `not_message_author` si quien pide no es el emisor ni un Editor. Deja la fila `message.restore` en la bitácora.',
      params: idParams(),
      response: { 200: messageDetail }
    }
  }, async (request) => spanOf(request, 'message.restore')(() => restoreMessage({ db, events }, { messageId: request.params.id, actor: request.member })))

  app.delete('/messages/:id/replies/:replyId', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Borrar una respuesta (su autor o un Editor; exige ?confirm=true)',
      description: 'Borrado en blando (UD-240): la respuesta sale del hilo, del conteo y de la búsqueda, y el estado del mensaje se recalcula: `answered` vuelve a `open` si no queda ninguna respuesta vigente y el mensaje no está cerrado. Devuelve el mensaje con su hilo. Lo deshace `POST /replies/:id/restore`. 403 `not_reply_author` si quien pide no es el autor ni un Editor; 404 si la respuesta no existe, ya está borrada o no es de ese mensaje; 400 `confirm_required` sin la confirmación. Deja la fila `reply.delete` en la bitácora.',
      params: replyParams,
      querystring: confirmQuery,
      response: { 200: messageDetail }
    }
  }, async (request) => {
    requireConfirm(request)
    return spanOf(request, 'reply.delete', { 'team.reply_id': String(request.params.replyId) })(() => deleteReply({ db, events }, { messageId: request.params.id, replyId: request.params.replyId, actor: request.member }))
  })

  app.patch('/messages/:id/replies/:replyId', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Editar el texto de una respuesta (sólo su autor)',
      description: 'Edición en el lugar (UD-253). `version` es obligatoria: la que se leyó en la respuesta; si otra edición se coló en medio, 409 `edit_conflict` con la `version` vigente y no se escribe nada. Los adjuntos quedan como están. Una respuesta con adjuntos puede quedar sin texto; una sin adjuntos no (400 `reply_empty`). Repetir la misma edición deja el mismo estado y la misma `version`. Cada edición real sube `version`, fija `edited_at` y deja la fila `reply.edit` en la bitácora. Devuelve el mensaje con su hilo. 403 `not_reply_author` si quien pide no es el autor, tampoco un Editor; 404 si la respuesta no existe, está borrada o no es de ese mensaje.',
      params: replyParams,
      body: replyPatchBody,
      response: { 200: messageDetail }
    }
  }, async (request) => spanOf(request, 'reply.edit', { 'team.reply_id': String(request.params.replyId) })(() => updateReply({ db, events }, { messageId: request.params.id, replyId: request.params.replyId, actor: request.member, body: request.body.body, version: request.body.version })))

  app.post('/replies/:id/restore', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Restaurar una respuesta borrada (su autor o un Editor)',
      description: 'Quita `deleted_at` de la respuesta, recalcula el estado de su mensaje (`open` pasa a `answered` si no está cerrado) y devuelve el mensaje con su hilo (UD-240). 409 `not_deleted` si no está borrada; 403 `not_reply_author` si quien pide no es el autor ni un Editor; 404 si no existe o su mensaje está borrado. Deja la fila `reply.restore` en la bitácora.',
      params: idParams(),
      response: { 200: messageDetail }
    }
  }, async (request) => withSpan('reply.restore', { 'team.reply_id': String(request.params.id), 'team.member_id': String(request.member.id) },
    () => restoreReply({ db, events }, { replyId: request.params.id, actor: request.member })))

  app.patch('/messages/:id', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Editar un mensaje publicado (sólo su emisor): título, texto, campos, plantilla, área, destinatarios y adjuntos',
      description: 'Actualización parcial (UD-017, UD-071). `version` es obligatoria: la que se leyó en el mensaje; si otra edición se coló en medio, 409 `edit_conflict` con la `version` vigente y no se escribe nada. Cambiar el área exige `template_id` de esa área. `attachment_ids` reordena o quita adjuntos del envío del que nació el mensaje. Se puede editar un mensaje respondido o cerrado. Repetir la misma edición deja el mismo estado y la misma `version`. Cada edición real sube `version`, fija `edited_at`, deja una fila en `edits` (quién, cuándo y qué campos, sin valores) y avisa a los destinatarios nuevos. 403 `not_message_author` si no es el emisor, tampoco un editor; un valor inexistente o un campo desconocido es 400.',
      params: idParams(),
      body: messagePatchBody,
      response: { 200: messageDetail }
    }
  }, async (request) => withSpan('message.update', { 'team.message_id': String(request.params.id), 'team.member_id': String(request.member.id) },
    () => updateMessage({ db, events }, { messageId: request.params.id, actor: request.member, patch: request.body })))

  app.post('/messages/:id/attachments', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Agregar archivos o enlaces a un mensaje publicado (sólo su emisor)',
      description: 'Multipart: `version` (la leída del mensaje), `files[]` y `links[]`, con los mismos topes y el mismo almacenamiento que `POST /inputs`. Los adjuntos nuevos quedan al final y su lectura se encola como la de cualquier adjunto. Cuenta como una edición: sube `version`, fija `edited_at` y deja una fila en `edits`. 403 `not_message_author` si no es el emisor (tampoco un Editor), 409 `edit_conflict` si la versión venció, 400 `attachments_empty` si no trae nada. Quitar o reordenar adjuntos va por `PATCH /messages/:id` (`attachment_ids`).',
      params: idParams(),
      response: { 201: messageDetail }
    }
  }, async (request, reply) => {
    assertCanAddAttachments(db, request.params.id, request.member.id) // refuse before storing a large upload
    const input = await readMessageAttachmentUpload(request, config, db)
    let message
    try {
      message = addMessageAttachments({ db, queue, events }, { messageId: request.params.id, actor: request.member, ...input })
    } catch (error) {
      await releaseBlobs(db, config, input.files, { discard: true }) // a stale version leaves nothing behind (UD-072)
      throw error
    }
    await releaseBlobs(db, config, input.files, { discard: false })
    reply.code(201)
    return message
  })

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
      input = await readReplyUpload(request, config, db)
    } else {
      input = { body: request.body.body, kind: request.body.kind, files: [], links: [] }
    }
    let r
    try {
      r = addReply({ db, events }, { messageId: request.params.id, authorId: request.member.id, ...input, kind: input.kind ?? undefined })
    } catch (error) {
      await releaseBlobs(db, config, input.files, { discard: true })
      throw error
    }
    await releaseBlobs(db, config, input.files, { discard: false })
    reply.code(201)
    return r.message
  })

  for (const [verb, handlerFn, summaryText] of [['close', closeMessage, 'Close a message'], ['reopen', reopenMessage, 'Reopen a closed message']]) {
    app.post(`/messages/:id/${verb}`, {
      onRequest: [requireRole('member')],
      schema: { summary: summaryText, params: idParams(), response: { 200: messageDetail } }
    }, async (request) => withSpan(`message.${verb}`, { 'team.message_id': String(request.params.id), 'team.member_id': String(request.member.id) },
      () => handlerFn({ db, events }, request.params.id, request.member.id)))
  }
}
