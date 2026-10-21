// Input routes (MASTER-SPEC §7.1): create (multipart, idempotent by hash), list one's own, query,
// publish, cancel and, for the editor, reprocess.

import { cancelInput, getInputView, listInputs, proposalView as presentProposal, reprocessInput, submitInput } from '../../domain/inputs.js'
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
      summary: 'Submit an input (multipart: text, files[], links[])',
      description: 'Idempotent by content: the same normalized text, the same attachments by hash and the same sender return the input that already exists (200). A new input, or a failed or cancelled one that is resubmitted, is queued (202).',
      response: { 200: createdSchema, 202: createdSchema }
    }
  }, async (request, reply) => {
    const { text, links, files } = await readInputUpload(request, config)
    const r = submitInput({ db, queue, events }, { authorId: request.member.id, text, files, links })
    // 202: the analysis is queued. 200: the same content already existed and what is there is returned (§1.3).
    reply.code(r.created || r.restarted ? 202 : 200)
    return { input_id: r.input.id, job_id: r.jobId, status: r.input.status, duplicate: !r.created && !r.restarted, restarted: r.restarted }
  })

  app.get('/inputs', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'List one\'s own inputs',
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { ...pageQuerySchema(config), status: { type: 'string', enum: ['queued', 'extracting', 'analyzing', 'proposed', 'published', 'failed', 'cancelled'] } }
      },
      response: { 200: pageEnvelope(inputView) }
    }
  }, async (request) => {
    const p = pageParams(request.query, config)
    const r = listInputs({ db, queue, events }, request.member.id, { status: request.query.status ?? null, limit: p.limit, offset: p.offset })
    return pageResult(r.items, r.total, p)
  })

  app.get('/inputs/:id', {
    onRequest: [requireRole('member')],
    schema: { summary: 'One of one\'s own inputs, with its progress and proposal', params: idParams(), response: { 200: inputView } }
  }, async (request) => getInputView({ db, queue, events }, request.params.id, request.member.id))

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
      summary: 'Cancel one\'s own input and its jobs',
      params: idParams(),
      response: { 200: { type: 'object', properties: { input_id: { type: 'string' }, status: { type: 'string' }, cancelled_jobs: { type: 'array', items: { type: 'string' } } } } }
    }
  }, async (request) => {
    const r = cancelInput({ db, queue, events }, request.params.id, request.member.id)
    return { ...r, status: 'cancelled' }
  })

  app.post('/inputs/:id/reprocess', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Re-enqueue the analysis of an already-extracted input (editor)',
      description: 'Useful when a template changed. Keeps the extractions; only extracts what is missing.',
      params: idParams(),
      response: { 202: { type: 'object', properties: { input_id: { type: 'string' }, job_id: { type: 'string' } } } }
    }
  }, async (request, reply) => {
    const r = reprocessInput({ db, queue, events }, request.params.id, request.member.id)
    reply.code(202)
    return r
  })
}
