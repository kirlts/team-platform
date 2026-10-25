// Input routes (MASTER-SPEC §7.1): create (multipart, idempotent by hash), list one's own, query,
// publish, cancel, delete (UD-240) and reprocess.

import { forbidden } from '../../domain/errors.js'
import { freeBlobs, releaseBlobs } from '../../domain/storage.js'
import { cancelInput, deleteInput, editInputText, getInputView, listInputs, proposalView as presentProposal, reprocessInput, resolveRecipients, resolveSendAs, restoreInput, submitInput } from '../../domain/inputs.js'
import { getMessage } from '../../domain/messages.js'
import { publishProposal, saveProposalDraft } from '../../domain/proposals.js'
import { withSpan } from '../../domain/tracing.js'
import { requireConfirm } from '../confirm.js'
import { pageEnvelope, pageParams, pageQuerySchema, pageResult } from '../pagination.js'
import { idParams, inputView, messageDetail, proposalBody, proposalView, publishBody } from '../schemas.js'
import { readInputUpload } from '../upload.js'
import { isActivePerson } from '../../domain/members.js'

const createdSchema = {
  type: 'object',
  properties: { input_id: { type: 'string' }, job_id: { type: 'string', nullable: true }, status: { type: 'string' }, duplicate: { type: 'boolean' }, restarted: { type: 'boolean' } }
}

export function registerInputRoutes (app, ctx) {
  const { db, config, queue, events, requireRole } = ctx

  app.post('/inputs', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Submit an input (multipart: text, files[], links[], auto_publish, as_member_id, recipient_ids[]; or JSON { text, links, auto_publish, as_member_id, recipient_ids })',
      description: '`as_member_id` (UD-255, «Enviar como») envía en nombre de otro miembro: el input y los mensajes que nazcan de él tienen ese `author_id`, y las reglas de «mío» (lista, editar, cancelar, borrar) siguen a ese autor. `sent_by_id` guarda al miembro de la sesión cuando es distinto del autor, y la auditoría `input.create` lo registra como quien actuó, con `detail.author_id` y `detail.sent_by_id`. Cualquier miembro envía como cualquier miembro activo de tipo persona; sin el campo, o con el propio id, el autor es el miembro de la sesión. Un miembro agente es 400 `cannot_send_as_agent`; uno inexistente o desactivado, 400 `send_as_invalid`. `auto_publish=false` (UD-072) pide que ESTE envío no se publique solo: su propuesta espera como `proposed` aunque la perilla del proyecto esté encendida, y se publica a mano con `POST /inputs/:id/publish` o se cancela. `true` o sin el campo sigue la perilla. Cualquier otro valor es 400 `auto_publish_invalid`; en un envío repetido (ya existente) el campo no cambia lo que ya hay. `recipient_ids` (UD-291) son los miembros a quienes va el envío, uno o varios, un agente como Claude entre ellos: pasan a ser los asignados de cada mensaje que nazca del envío y el enrutamiento automático no reasigna (sigue eligiendo área y plantilla); un agente entre ellos recibe su trabajo al publicarse el mensaje, sin otra confirmación (UD-286). Vacío o ausente, el enrutamiento automático asigna como siempre. Es la única puerta: no hay una ruta aparte para un agente. Un id que no es un miembro activo es 400 `recipient_invalid`; en multipart se repite el campo, uno por destinatario. El envío sólo con JSON no lleva archivos. Idempotent by content: the same normalized text, the same attachments by hash and the same sender return the input that already exists (200). A new input, or a failed or cancelled one that is resubmitted, is queued (202).',
      response: { 200: createdSchema, 202: createdSchema }
    }
  }, async (request, reply) => {
    const { text, links, files, keepDraft, asMemberId, recipientIds } = await readInputUpload(request, config, db)
    let r
    try {
      const authorId = resolveSendAs(db, request.member.id, asMemberId)
      const recipients = resolveRecipients(db, recipientIds)
      r = submitInput({ db, queue, events }, { authorId, sentById: request.member.id, text, files, links, keepDraft, recipientIds: recipients })
    } catch (error) {
      await releaseBlobs(db, config, files, { discard: true })
      throw error
    }
    await releaseBlobs(db, config, files, { discard: false })
    // 202: the analysis is queued. 200: the same content already existed and what is there is returned (§1.3).
    reply.code(r.created || r.restarted ? 202 : 200)
    return { input_id: r.input.id, job_id: r.jobId, status: r.input.status, duplicate: !r.created && !r.restarted, restarted: r.restarted }
  })

  app.get('/inputs', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Listar los inputs propios',
      description: 'Los del miembro de la sesión; con `all=1` (una persona del equipo; 403 para un agente) los de todos, cada uno con `author_name`, el nombre de su emisor (la cola del equipo, UD-251). `status` admite uno o varios estados separados por coma; sin `status` vienen todos (en cola, leyendo, analizando, propuesta, publicado, fallido y cancelado), paginados. Es el historial y el estado de los envíos propios (UD-070): un envío publicado trae sus mensajes en `messages` (id, título, área, estado y `edited_at`), uno fallido su `error` y `error_code`, y uno con la publicación automática apagada o bloqueada queda `proposed` (con `error_code: publish_blocked` si no se pudo publicar). `mine=1` pide el orden de creación ascendente con `percent`, `phrase` y `proposed_count` (la bandeja en vuelo de UD-025), por ejemplo `?mine=1&status=queued,extracting,analyzing,proposed`; sin `mine` el orden es el más reciente primero, y `order=desc|asc` lo fija a mano (el historial: `?mine=1&order=desc`).',
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...pageQuerySchema(config),
          status: { type: 'string', pattern: '^(queued|extracting|analyzing|proposed|published|failed|cancelled)(,(queued|extracting|analyzing|proposed|published|failed|cancelled))*$' },
          mine: { type: 'string', enum: ['1', 'true'] },
          order: { type: 'string', enum: ['asc', 'desc'] },
          all: { type: 'string', enum: ['1', 'true'] },
          compact: { type: 'string', enum: ['1', 'true'], description: 'Deja fuera `units` y `proposal` de cada envío (la mayor parte de los bytes de un historial largo); el detalle `GET /inputs/{id}` los trae.' }
        }
      },
      response: { 200: pageEnvelope({ ...inputView, properties: { ...inputView.properties, author_name: { type: 'string', nullable: true } } }) }
    }
  }, async (request) => {
    const p = pageParams(request.query, config)
    const order = request.query.order ?? (request.query.mine ? 'asc' : 'desc')
    const everyone = request.query.all !== undefined
    if (everyone && !isActivePerson(db, request.member.id)) throw forbidden('Sólo una persona del equipo lista los envíos de todos.')
    const r = listInputs({ db, queue, events }, request.member.id, { status: request.query.status ?? null, limit: p.limit, offset: p.offset, order, everyone, compact: request.query.compact !== undefined })
    return pageResult(r.items, r.total, p)
  })

  app.get('/inputs/:id', {
    onRequest: [requireRole('member')],
    schema: { summary: 'One of one\'s own inputs, with its progress and proposal', params: idParams(), response: { 200: inputView } }
  }, async (request) => getInputView({ db, queue, events }, request.params.id, request.member.id))

  app.patch('/inputs/:id', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Cambiar el texto de un input propio y volver a analizarlo',
      description: 'Sólo su emisor, mientras esté `proposed` o `failed`. Reemplaza el texto, descarta la propuesta vigente y encola el análisis otra vez con el texto nuevo; los adjuntos y sus extracciones se conservan. 404 si el input no es suyo; 409 si está en otro estado (`not_editable`) o si ya existe otro envío suyo con ese contenido (`duplicate_input`); 400 si el envío queda vacío.',
      params: idParams(),
      body: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } },
      response: { 200: inputView }
    }
  }, async (request) => editInputText({ db, config, queue, events }, request.params.id, request.member.id, request.body.text))

  app.patch('/inputs/:id/proposal', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Guardar la propuesta editada como borrador (sólo su emisor, mientras esté propuesta)',
      description: 'La propuesta completa (§7.5) reemplaza al borrador vigente y sobrevive al cierre de la pestaña (UD-017). Sólo se valida la forma y los ids (área, plantilla, miembros, adjuntos, unidades; un valor inválido o un campo desconocido es 400): un título, un texto o un campo obligatorio de la plantilla todavía vacío se acepta y se guarda, y publicar exige que estén completos (422). Guardar dos veces lo mismo deja el mismo estado. 403 si no es el emisor; 409 si el input ya se publicó o no tiene propuesta lista.',
      params: idParams(),
      body: proposalBody,
      response: { 200: proposalView }
    }
  }, async (request) => {
    const draft = await withSpan('input.proposal.update', { 'team.input_id': String(request.params.id), 'team.member_id': String(request.member.id) }, () =>
      saveProposalDraft({ db, events }, { inputId: request.params.id, memberId: request.member.id, proposal: request.body }))
    return presentProposal(draft)
  })

  app.post('/inputs/:id/publish', {
    onRequest: [requireRole('member')],
    preValidation: async (request) => { request.body ??= {} }, // no body: publish the saved draft
    schema: {
      summary: 'Publicar a mano la propuesta como mensajes (la enviada, o el borrador guardado si no se envía cuerpo)',
      description: 'Con la publicación automática encendida (UD-070, por omisión) el análisis ya publicó: un envío publicado es 409 `already_published` y no se duplica nada. Este camino queda para la propuesta que esperó (perilla `auto_publish` apagada) o que el análisis no pudo publicar (`error_code: publish_blocked`).',
      params: idParams(),
      body: publishBody,
      response: { 200: { type: 'object', properties: { message_ids: { type: 'array', items: { type: 'string' } }, messages: { type: 'array', items: messageDetail } } } }
    }
  }, async (request) => {
    const ids = await withSpan('input.publish', { 'team.input_id': String(request.params.id), 'team.member_id': String(request.member.id) }, () =>
      publishProposal({ db, events }, { inputId: request.params.id, memberId: request.member.id, proposal: request.body }))
    return { message_ids: ids, messages: ids.map((mid) => getMessage(db, mid)) }
  })

  app.post('/inputs/:id/cancel', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Cancel one\'s own input and its jobs',
      params: idParams(),
      response: { 200: { type: 'object', properties: { input_id: { type: 'string' }, status: { type: 'string' }, cancelled_jobs: { type: 'array', items: { type: 'string' } } } } }
    }
  }, async (request) => {
    const r = cancelInput({ db, queue, events }, request.params.id, request.member.id)
    return { ...r, status: 'cancelled' }
  })

  app.post('/inputs/:id/restore', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Deshacer el descarte de un input propio',
      description: 'Devuelve un input cancelado a `proposed` (con la propuesta y las ediciones que tenía) o, si no llegó a tener propuesta, a `failed`. No vuelve a analizar. 404 si no es suyo; 409 si no está cancelado (`not_cancelled`).',
      params: idParams(),
      response: { 200: { type: 'object', properties: { input_id: { type: 'string' }, status: { type: 'string' } } } }
    }
  }, async (request) => restoreInput({ db, events }, request.params.id, request.member.id))

  app.delete('/inputs/:id', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Borrar un envío con sus adjuntos, trabajos y propuesta (su emisor o una persona del equipo; exige ?confirm=true)',
      description: 'Borrado real, sin restauración (UD-240). Cancela los trabajos en cola o corriendo y borra el input, sus adjuntos, sus trabajos con sus eventos y su propuesta. Los mensajes publicados desde ese envío quedan, con sus archivos (`input_id` pasa a nulo); con `with_messages=true` se borran también, con sus respuestas. Libera del volumen los archivos que ya nadie referencia. 404 si el input no es suyo y quien pide no es una persona del equipo; 400 `confirm_required` sin la confirmación. Bitácora `input.delete`.',
      params: idParams(),
      querystring: { type: 'object', additionalProperties: false, properties: { confirm: { type: 'boolean' }, with_messages: { type: 'boolean' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            input_id: { type: 'string' },
            deleted: { type: 'object', properties: { attachments: { type: 'integer' }, jobs: { type: 'integer' }, messages: { type: 'integer' } } },
            freed_bytes: { type: 'integer' }
          }
        }
      }
    }
  }, async (request) => {
    requireConfirm(request)
    const r = deleteInput({ db, queue, events }, request.params.id, request.member, { withMessages: request.query.with_messages === true })
    const freed = await freeBlobs(db, config, r.hashes)
    return { input_id: r.input_id, deleted: r.deleted, freed_bytes: freed }
  })

  app.post('/inputs/:id/reprocess', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Volver a encolar el análisis de un input ya extraído (su emisor o una persona del equipo)',
      description: 'Útil cuando cambió una plantilla, el modelo o las áreas, o cuando el análisis falló. Conserva las extracciones; sólo extrae lo que falte. Un agente lo hace sobre sus propios inputs con propuesta, fallidos o cancelados (en otro caso, 404); una persona del equipo, sobre cualquiera (UD-287). Un envío publicado lo reprocesa cualquiera de ellas: sus mensajes vivos pasan a la papelera con sus respuestas, restaurables (UD-240), la propuesta se descarta y el envío vuelve a la cola sin confirmación; `set_aside` trae la cuenta de mensajes y de respuestas apartados. En vuelo, 409 `not_reprocessable`.',
      params: idParams(),
      response: {
        202: {
          type: 'object',
          properties: {
            input_id: { type: 'string' },
            job_id: { type: 'string' },
            set_aside: { type: 'object', properties: { messages: { type: 'integer' }, replies: { type: 'integer' } } }
          }
        }
      }
    }
  }, async (request, reply) => {
    const r = reprocessInput({ db, queue, events }, request.params.id, request.member)
    reply.code(202)
    return r
  })
}
