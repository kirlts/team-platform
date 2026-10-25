// Message and reply routes (MASTER-SPEC §7.1).

import { freeBlobs, releaseBlobs } from '../../domain/storage.js'
import { get } from '../../db/index.js'
import { addMessageAttachments, addReply, addReplyAttachments, assertCanAddAttachments, assertCanReply, closeMessage, deleteMessage, deleteMessages, deleteReply, getMessage, listMessages, messageSummary, reopenMessage, setMessageAssessment, WRITABLE_REPLY_KINDS, restoreMessage, restoreMessages, restoreReply, updateMessage, updateReply } from '../../domain/messages.js'
import { forbidden, notFound } from '../../domain/errors.js'
import { forwardMessage } from '../../domain/forward.js'
import { withSpan } from '../../domain/tracing.js'
import { timingOfMessage } from '../../telemetry/timing.js'
import { requireConfirm } from '../confirm.js'
import { pageEnvelope, pageParams, pageQuerySchema, pageResult } from '../pagination.js'
import { confirmQuery, idIn, idParams, messageCard, messageDetail, messagePatchBody, messageSummary as messageSummarySchema, replyPatchBody } from '../schemas.js'
import { readMessageAttachmentUpload, readReplyUpload } from '../upload.js'
import { isActivePerson } from '../../domain/members.js'

export function registerMessageRoutes (app, ctx) {
  const { db, config, events, queue, requireRole } = ctx

  app.get('/messages', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Team messages, with filters',
      description: '`for`: «me» or a member id (messages assigned to). `involved=me`: los mensajes que afectan a quien tiene la sesión, con la misma regla que `/messages/summary`: asignados a esa persona, o emitidos por ella cuando ya tienen respuesta o están cerrados (UD-028). `replies=1`: only with replies, latest first; with `for`, those that involve that person. `deleted=1`: sólo los mensajes borrados (UD-250), los más recién borrados primero: quien los escribió ve los suyos y cualquier persona del equipo todos; se restauran con `POST /messages/:id/restore`.',
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
      description: 'Un mensaje borrado responde 404. `include_deleted=true` lo devuelve igual, con `deleted_at`, sólo a una persona del equipo (UD-240, UD-287); un agente recibe 403.',
      params: idParams(),
      querystring: { type: 'object', additionalProperties: false, properties: { include_deleted: { type: 'boolean' } } },
      response: { 200: messageDetail }
    }
  }, async (request, reply) => {
    if (request.query.include_deleted === true && !isActivePerson(db, request.member.id)) {
      return reply.code(403).send({ code: 'forbidden', message: 'Ver lo borrado corresponde a una persona del equipo.' })
    }
    return getMessage(db, request.params.id, { includeDeleted: request.query.include_deleted === true })
  })

  const ms = { type: 'integer', nullable: true }
  app.get('/messages/:id/timing', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Tiempos de la ejecución de un mensaje',
      description: 'Segundos hasta la primera respuesta y hasta la respuesta final (`first_reply_ms`, `final_reply_ms`, desde el inicio del trabajo `execute`; `*_since_message_ms` desde que se publicó el mensaje), tiempo total, fases (`create`, `run`, `destroy`), herramientas y subagentes de la sesión del más lento al más rápido (`slowest`) y consumo por turno (`turns`). `detail` es la parte técnica de la salida del agente (resultado, zona, causa, verificación, rama, archivos…) con el rótulo de la plantilla, y la referencia de la entrega: la respuesta del hilo sólo lleva el resumen (UD-276). `tree` es el subárbol de spans del trabajo, como `GET /jobs/:id/trace`. Con el trabajo en curso las cifras son `null` y `phase` dice en qué paso está. 404 si el mensaje no existe o no tiene trabajo de ejecución.',
      params: idParams(),
      response: {
        200: {
          type: 'object', additionalProperties: true,
          properties: {
            message_id: { type: 'string' }, job_id: { type: 'string' }, job_status: { type: 'string' }, trace_id: { type: 'string', nullable: true }, phase: { type: 'string', nullable: true },
            attempts: { type: 'integer' }, model: { type: 'string', nullable: true, description: 'El modelo con que corrió la sesión del trabajo (UD-292).' }, cost_usd: { type: 'number', nullable: true, description: 'Lo que costó la sesión hasta ahora, en USD (UD-292).' }, elapsed_ms: ms, first_reply_ms: ms, final_reply_ms: ms, first_reply_since_message_ms: ms, final_reply_since_message_ms: ms, total_ms: ms, queue_wait_ms: ms,
            phases: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, duration_ms: ms, offset_ms: ms, status: { type: 'string' } } } },
            slowest: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['tool', 'subagent'] }, name: { type: 'string' }, summary: { type: 'string', nullable: true }, duration_ms: ms, success: { type: 'boolean', nullable: true } } } },
            turns: { type: 'array', items: { type: 'object', additionalProperties: true } },
            detail: { type: 'object', nullable: true, properties: { entries: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } } } }, delivery_ref: { type: 'string', nullable: true } } },
            tree: { type: 'object', nullable: true, additionalProperties: true }
          }
        }
      }
    }
  }, async (request) => {
    getMessage(db, request.params.id) // 404 when the message does not exist or is deleted
    await ctx.telemetry?.flush() // a job that has just finished is visible too
    const timing = timingOfMessage(db, request.params.id)
    if (!timing) throw notFound('El mensaje no tiene trabajo de ejecución.')
    return timing
  })

  const replyParams = { type: 'object', required: ['id', 'replyId'], properties: { id: idIn, replyId: idIn } }
  const spanOf = (request, name, extra = {}) => (fn) => withSpan(name, { 'team.message_id': String(request.params.id), 'team.member_id': String(request.member.id), ...extra }, fn)

  app.delete('/messages/:id', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Borrar un mensaje publicado (su emisor o una persona del equipo; exige ?confirm=true)',
      description: 'Borrado en blando (UD-240): el mensaje deja de aparecer en las listas, los conteos, la búsqueda, los avisos y el hilo de sus respuestas, y `GET /messages/:id` responde 404. Lo deshace `POST /messages/:id/restore`. 403 `not_message_author` si quien pide no es el emisor ni una persona del equipo; 404 si no existe o ya está borrado; 400 `confirm_required` sin la confirmación. Deja la fila `message.delete` en la bitácora.',
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
      summary: 'Restaurar un mensaje borrado (su emisor o una persona del equipo)',
      description: 'Quita `deleted_at` y devuelve el mensaje con su hilo tal como estaba (UD-240). 409 `not_deleted` si no está borrado; 403 `not_message_author` si quien pide no es el emisor ni una persona del equipo. Deja la fila `message.restore` en la bitácora.',
      params: idParams(),
      response: { 200: messageDetail }
    }
  }, async (request) => spanOf(request, 'message.restore')(() => restoreMessage({ db, events }, { messageId: request.params.id, actor: request.member })))

  // Several at once (UD-253): one request and one transaction, so the permission check is all or nothing. `maxItems` is the page cap
  // of the API (config.list.pageMax): the panel marks at most the rows of one page.
  const bulkBody = {
    type: 'object',
    required: ['ids'],
    additionalProperties: false,
    properties: { ids: { type: 'array', minItems: 1, maxItems: config.list.pageMax, items: idIn } }
  }
  const bulkResult = { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } } }

  app.post('/messages/delete', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Borrar varios mensajes de una vez (su emisor o una persona del equipo; exige ?confirm=true)',
      description: `Borrado en blando de cada mensaje de \`ids\` (UD-253), en una sola transacción: todos o ninguno. 403 \`not_message_author\` con \`ids\` (los que quien pide no puede borrar) si alguno no es suyo y no es persona del equipo; 404 \`not_found\` con \`ids\` si alguno no existe o ya está borrado; 400 \`confirm_required\` sin la confirmación. Hasta ${config.list.pageMax} ids, el tope de página de la API. Deja una fila \`message.delete\` por mensaje en la bitácora. Lo deshace \`POST /messages/restore\` con los mismos \`ids\`.`,
      querystring: confirmQuery,
      body: bulkBody,
      response: { 200: bulkResult }
    }
  }, async (request) => {
    requireConfirm(request)
    const ids = withSpan('message.delete_many', { 'team.member_id': String(request.member.id), 'team.count': request.body.ids.length },
      () => deleteMessages({ db, events }, { ids: request.body.ids, actor: request.member }))
    return { ids }
  })

  app.post('/messages/restore', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Restaurar varios mensajes borrados de una vez (su emisor o una persona del equipo)',
      description: `Quita \`deleted_at\` de cada mensaje de \`ids\` (UD-253), en una sola transacción: todos o ninguno. 403 \`not_message_author\` con \`ids\` si alguno no es de quien pide y no es persona del equipo; 404 \`not_found\` con \`ids\` si alguno no existe; 409 \`not_deleted\` con \`ids\` si alguno no está borrado. Hasta ${config.list.pageMax} ids. Deja una fila \`message.restore\` por mensaje en la bitácora.`,
      body: bulkBody,
      response: { 200: bulkResult }
    }
  }, async (request) => ({
    ids: withSpan('message.restore_many', { 'team.member_id': String(request.member.id), 'team.count': request.body.ids.length },
      () => restoreMessages({ db, events }, { ids: request.body.ids, actor: request.member }))
  }))

  app.delete('/messages/:id/replies/:replyId', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Borrar una respuesta (su autor o una persona del equipo; exige ?confirm=true)',
      description: 'Borrado en blando (UD-240): la respuesta sale del hilo, del conteo y de la búsqueda, y el estado del mensaje se recalcula: `answered` vuelve a `open` si no queda ninguna respuesta vigente y el mensaje no está cerrado. Devuelve el mensaje con su hilo. Lo deshace `POST /replies/:id/restore`. 403 `not_reply_author` si quien pide no es el autor ni una persona del equipo; 404 si la respuesta no existe, ya está borrada o no es de ese mensaje; 400 `confirm_required` sin la confirmación. Deja la fila `reply.delete` en la bitácora.',
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
      summary: 'Editar una respuesta: su texto, sus adjuntos y sus menciones (sólo su autor)',
      description: 'Edición en el lugar (UD-253). `version` es obligatoria: la que se leyó en la respuesta; si otra edición se coló en medio, 409 `edit_conflict` con la `version` vigente y no se escribe nada. `body` es opcional (UD-279): `remove_attachment_ids` quita adjuntos de la respuesta y `mention_ids` suma menciones (con los efectos de una mención al escribir, sólo para quien aún no estaba mencionado; las que ya tenía se ignoran). Agregar adjuntos va por `POST /messages/:id/replies/:replyId/attachments`. Sin ningún cambio no hay edición. Una respuesta con adjuntos puede quedar sin texto; una sin adjuntos no (400 `reply_empty`). Repetir la misma edición deja el mismo estado y la misma `version`. Cada edición real sube `version`, fija `edited_at` y deja la fila `reply.edit` en la bitácora. Devuelve el mensaje con su hilo. 403 `not_reply_author` si quien pide no es el autor, tampoco otra persona del equipo; 404 si la respuesta no existe, está borrada o no es de ese mensaje.',
      params: replyParams,
      body: replyPatchBody,
      response: { 200: messageDetail }
    }
  }, async (request) => spanOf(request, 'reply.edit', { 'team.reply_id': String(request.params.replyId) })(async () => {
    let hashes = []
    const message = updateReply({ db, events }, { messageId: request.params.id, replyId: request.params.replyId, actor: request.member, body: request.body.body, version: request.body.version, mentionIds: request.body.mention_ids ?? [], removeAttachmentIds: request.body.remove_attachment_ids ?? [], onRemoved: (h) => { hashes = h } })
    if (hashes.length) await freeBlobs(db, config, hashes) // the files that no row references any more
    return message
  }))

  app.post('/messages/:id/replies/:replyId/attachments', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Agregar archivos o enlaces a una respuesta (sólo su autor)',
      description: 'Multipart: `version` (la leída de la respuesta), `files[]` y `links[]`, con los mismos topes y el mismo almacenamiento que `POST /inputs` (UD-279). Un audio o un video se transcribe como al escribir la respuesta. Cuenta como una edición: sube `version`, fija `edited_at` y deja `reply.edit`. 403 `not_reply_author` si no es el autor, 409 `edit_conflict` si la versión venció, 400 `attachments_empty` si no trae nada, 404 si la respuesta no existe. Quitar va por `PATCH` con `remove_attachment_ids`.',
      params: replyParams,
      response: { 201: messageDetail }
    }
  }, async (request, reply) => {
    const own = get(db, 'SELECT author_id FROM replies WHERE id = ? AND message_id = ? AND deleted_at IS NULL', request.params.replyId, request.params.id)
    if (!own) throw notFound('La respuesta no existe.')
    if (own.author_id !== request.member.id) throw forbidden('Sólo quien escribió la respuesta puede editarla.', 'not_reply_author') // refuse before storing a large upload
    const input = await readMessageAttachmentUpload(request, config, db)
    let message
    try {
      message = addReplyAttachments({ db, events }, { messageId: request.params.id, replyId: request.params.replyId, actor: request.member, ...input })
    } catch (error) {
      await releaseBlobs(db, config, input.files, { discard: true })
      throw error
    }
    await releaseBlobs(db, config, input.files, { discard: false })
    reply.code(201)
    return message
  })

  app.post('/replies/:id/restore', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Restaurar una respuesta borrada (su autor o una persona del equipo)',
      description: 'Quita `deleted_at` de la respuesta, recalcula el estado de su mensaje (`open` pasa a `answered` si no está cerrado) y devuelve el mensaje con su hilo (UD-240). 409 `not_deleted` si no está borrada; 403 `not_reply_author` si quien pide no es el autor ni una persona del equipo; 404 si no existe o su mensaje está borrado. Deja la fila `reply.restore` en la bitácora.',
      params: idParams(),
      response: { 200: messageDetail }
    }
  }, async (request) => withSpan('reply.restore', { 'team.reply_id': String(request.params.id), 'team.member_id': String(request.member.id) },
    () => restoreReply({ db, events }, { replyId: request.params.id, actor: request.member })))

  app.patch('/messages/:id', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Editar un mensaje publicado (sólo su emisor): título, texto, campos, plantilla, área, destinatarios y adjuntos',
      description: 'Actualización parcial (UD-017, UD-071). `version` es obligatoria: la que se leyó en el mensaje; si otra edición se coló en medio, 409 `edit_conflict` con la `version` vigente y no se escribe nada. Cambiar el área exige `template_id` de esa área. `attachment_ids` reordena o quita adjuntos del envío del que nació el mensaje. Se puede editar un mensaje respondido o cerrado. Repetir la misma edición deja el mismo estado y la misma `version`. Cada edición real sube `version`, fija `edited_at`, deja una fila en `edits` (quién, cuándo y qué campos, sin valores) y avisa a los destinatarios nuevos. 403 `not_message_author` si no es el emisor, tampoco otra persona del equipo; un valor inexistente o un campo desconocido es 400.',
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
      description: 'Multipart: `version` (la leída del mensaje), `files[]` y `links[]`, con los mismos topes y el mismo almacenamiento que `POST /inputs`. Los adjuntos nuevos quedan al final y su lectura se encola como la de cualquier adjunto. Cuenta como una edición: sube `version`, fija `edited_at` y deja una fila en `edits`. 403 `not_message_author` si no es el emisor (tampoco otra persona del equipo), 409 `edit_conflict` si la versión venció, 400 `attachments_empty` si no trae nada. Quitar o reordenar adjuntos va por `PATCH /messages/:id` (`attachment_ids`).',
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
      description: 'JSON `{ body, kind, mention_ids }` o multipart (`body`, `kind`, `mention_ids` repetido, `files[]`, `links[]`) con los mismos topes y el mismo almacenamiento que `POST /inputs`. Una respuesta con archivos o enlaces puede ir sin texto. Los adjuntos se guardan y se sirven, no se analizan: `GET /replies/attachments/:id` entrega el archivo. `mention_ids` (UD-278) son los miembros que la persona eligió en la lista que abre «@»: nunca se leen del texto. Cada uno pasa a los asignados del mensaje; una persona recibe un aviso y un agente recibe su trabajo `execute` con el hilo completo (si ya trabaja ese mensaje, la mención queda pendiente y la sesión en curso la toma en su siguiente paso, `POST /jobs/:id/mentions/take`, UD-285; si no alcanzó a tomarla, se atiende al terminar). 404 si un miembro no existe; 400 `assignee_inactive` si está desactivado, `mention_self` si es quien escribe, `mention_loop` si un agente menciona a otro agente. El emisor del mensaje sólo responde si menciona a alguien (esa respuesta no cuenta como respuesta y el mensaje queda `open`). Auditoría `message.mention` por cada uno. Devuelve el mensaje con su hilo; cada respuesta lleva `attachments`, `attachment_kinds` y `mentions`.',
      params: idParams(),
      // Per content type: the multipart body is read by the handler, only the JSON body is validated by schema.
      body: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['body'],
              additionalProperties: false,
              properties: { body: { type: 'string' }, kind: { type: 'string', enum: WRITABLE_REPLY_KINDS }, mention_ids: { type: 'array', items: idIn } }
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
      assertCanReply(db, request.params.id, request.member.id, { mentions: true }) // whether the sender mentions someone is known only after reading the form; addReply decides
      input = await readReplyUpload(request, config, db)
    } else {
      input = { body: request.body.body, kind: request.body.kind, files: [], links: [], mentionIds: request.body.mention_ids ?? [] }
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

  app.post('/messages/:id/forward', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Reenviar un mensaje a un miembro, con el motivo (UD-272)',
      description: 'El mismo mensaje suma a `member_id` entre sus asignados (no se crea otro) y el hilo gana una respuesta de tipo `forward`: autor quien reenvía, `forwarded_to` el destinatario y `body` el motivo, que es obligatorio. Un mensaje respondido vuelve a `open` para quien lo recibe. Si el destinatario es un agente, se encola su trabajo `execute` del mismo mensaje con el reenvío como contexto; la sesión decide si resuelve o investiga. Responde 201 con el mensaje y su hilo. 400 `forward_comment_required` sin motivo, 400 `forward_to_self` si el destinatario es quien reenvía, 400 `assignee_inactive` si está desactivado, 404 si el mensaje o el miembro no existen, 409 `message_closed` si el mensaje está cerrado, 409 `execute_busy` si el agente ya tiene un trabajo en cola o corriendo para el mensaje. Auditoría `message.forward`.',
      params: idParams(),
      body: { type: 'object', required: ['member_id', 'comment'], additionalProperties: false, properties: { member_id: idIn, comment: { type: 'string', minLength: 1 } } },
      response: { 201: messageDetail }
    }
  }, async (request, reply) => withSpan('message.forward', { 'team.message_id': String(request.params.id), 'team.member_id': String(request.member.id) }, () => {
    const { message } = forwardMessage({ db, events }, { messageId: request.params.id, actor: request.member, memberId: request.body.member_id, comment: request.body.comment })
    reply.code(201)
    return message
  }))

  app.put('/messages/:id/assessment', {
    onRequest: [requireRole('person')],
    schema: {
      summary: 'Cambiar a mano la evaluación de un mensaje (UD-292)',
      description: 'Cualquier persona activa del equipo cambia lo que el analizador dijo del mensaje: lo que se espera de Claude (`expectation`, texto libre), las Guardias del área que toca (`guards`, ids de la lista de la propia área) y quién tiene el valor que falta (`value_holder`). Decide el modelo y la apertura de la siguiente sesión; no reasigna ni toca una sesión en curso. `assessment.by` queda con quien lo cambió. Repetir el mismo valor no cambia nada.',
      params: idParams(),
      body: { type: 'object', minProperties: 1, additionalProperties: false, properties: { expectation: { type: 'string' }, guards: { type: 'array', items: { type: 'integer' } }, value_holder: { type: 'string', enum: ['person', 'model'] } } },
      response: { 200: messageDetail }
    }
  }, async (request) => withSpan('message.assessment', { 'team.message_id': String(request.params.id), 'team.member_id': String(request.member.id) },
    () => setMessageAssessment({ db, events }, { messageId: request.params.id, actor: request.member, patch: request.body })))

  for (const [verb, handlerFn, summaryText] of [['close', closeMessage, 'Close a message'], ['reopen', reopenMessage, 'Reopen a closed message']]) {
    app.post(`/messages/:id/${verb}`, {
      onRequest: [requireRole('member')],
      schema: { summary: summaryText, params: idParams(), response: { 200: messageDetail } }
    }, async (request) => withSpan(`message.${verb}`, { 'team.message_id': String(request.params.id), 'team.member_id': String(request.member.id) },
      () => handlerFn({ db, events }, request.params.id, request.member.id)))
  }
}
