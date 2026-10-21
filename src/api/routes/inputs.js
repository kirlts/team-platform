// Rutas de inputs (MASTER-SPEC §7.1): crear (multipart, idempotente por hash), listar los propios, consultar,
// publicar, cancelar y, para el editor, reprocesar.

import { cancelInput, editInputText, getInputView, listInputs, proposalView as presentProposal, reprocessInput, submitInput } from '../../domain/inputs.js'
import { getMessage } from '../../domain/messages.js'
import { publishProposal, saveProposalDraft } from '../../domain/proposals.js'
import { withSpan } from '../../domain/tracing.js'
import { pageEnvelope, pageParams, pageQuerySchema, pageResult } from '../pagination.js'
import { idParams, inputView, messageDetail, proposalBody, proposalView, publishBody } from '../schemas.js'
import { readInputUpload } from '../upload.js'

const createdSchema = {
  type: 'object',
  properties: { input_id: { type: 'string' }, job_id: { type: 'string', nullable: true }, status: { type: 'string' }, duplicate: { type: 'boolean' }, restarted: { type: 'boolean' } }
}

export function registerInputRoutes (app, ctx) {
  const { db, config, queue, events, requireRole } = ctx

  app.post('/inputs', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Enviar un input (multipart: text, files[], links[])',
      description: 'Idempotente por contenido: el mismo texto normalizado, los mismos adjuntos por hash y el mismo emisor devuelven el input que ya existe (200). Un input nuevo, o uno fallido o cancelado que se reenvía, queda en cola (202).',
      response: { 200: createdSchema, 202: createdSchema }
    }
  }, async (request, reply) => {
    const { text, links, files } = await readInputUpload(request, config)
    const r = submitInput({ db, queue, events }, { authorId: request.member.id, text, files, links })
    // 202: el análisis queda en cola. 200: el mismo contenido ya existía y se devuelve lo que hay (§1.3).
    reply.code(r.created || r.restarted ? 202 : 200)
    return { input_id: r.input.id, job_id: r.jobId, status: r.input.status, duplicate: !r.created && !r.restarted, restarted: r.restarted }
  })

  app.get('/inputs', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Listar los inputs propios',
      description: 'Siempre los del miembro de la sesión. `status` admite uno o varios estados separados por coma. `mine=1` pide la bandeja de envíos (UD-025), por ejemplo `?mine=1&status=queued,extracting,analyzing,proposed`: orden de creación ascendente, con `percent`, `phrase` y `proposed_count` en cada elemento. Sin `mine`, el orden es el más reciente primero; `order` lo fija a mano.',
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...pageQuerySchema(config),
          status: { type: 'string', pattern: '^(queued|extracting|analyzing|proposed|published|failed|cancelled)(,(queued|extracting|analyzing|proposed|published|failed|cancelled))*$' },
          mine: { type: 'string', enum: ['1', 'true'] },
          order: { type: 'string', enum: ['asc', 'desc'] }
        }
      },
      response: { 200: pageEnvelope(inputView) }
    }
  }, async (request) => {
    const p = pageParams(request.query, config)
    const order = request.query.order ?? (request.query.mine ? 'asc' : 'desc')
    const r = listInputs({ db, queue, events }, request.member.id, { status: request.query.status ?? null, limit: p.limit, offset: p.offset, order })
    return pageResult(r.items, r.total, p)
  })

  app.get('/inputs/:id', {
    onRequest: [requireRole('member')],
    schema: { summary: 'Un input propio, con su avance y su propuesta', params: idParams(), response: { 200: inputView } }
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
      summary: 'Publicar la propuesta como mensajes (la enviada, o el borrador guardado si no se envía cuerpo)',
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
      summary: 'Cancelar un input propio y sus trabajos',
      params: idParams(),
      response: { 200: { type: 'object', properties: { input_id: { type: 'string' }, status: { type: 'string' }, cancelled_jobs: { type: 'array', items: { type: 'string' } } } } }
    }
  }, async (request) => {
    const r = cancelInput({ db, queue, events }, request.params.id, request.member.id)
    return { ...r, status: 'cancelled' }
  })

  app.post('/inputs/:id/reprocess', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Volver a encolar el análisis de un input ya extraído (su emisor o el editor)',
      description: 'Útil cuando cambió una plantilla o el análisis falló. Conserva las extracciones; sólo extrae lo que falte. Un miembro lo hace sobre sus propios inputs (en otro caso, 404); el editor, sobre cualquiera.',
      params: idParams(),
      response: { 202: { type: 'object', properties: { input_id: { type: 'string' }, job_id: { type: 'string' } } } }
    }
  }, async (request, reply) => {
    const r = reprocessInput({ db, queue, events }, request.params.id, request.member)
    reply.code(202)
    return r
  })
}
