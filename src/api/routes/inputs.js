// Rutas de inputs (MASTER-SPEC §7.1): crear (multipart, idempotente por hash), consultar, publicar, cancelar.

import { cancelInput, getInputView, submitInput } from '../../domain/inputs.js'
import { getMessage } from '../../domain/messages.js'
import { publishProposal } from '../../domain/proposals.js'
import { idParams, inputView, messageDetail, publishBody } from '../schemas.js'
import { readInputUpload } from '../upload.js'

export function registerInputRoutes (app, ctx) {
  const { db, config, queue, events, requireRole } = ctx

  app.post('/inputs', {
    onRequest: [requireRole('member')],
    schema: {
      response: {
        200: { type: 'object', properties: { input_id: { type: 'integer' }, job_id: { type: ['integer', 'null'] }, status: { type: 'string' }, duplicate: { type: 'boolean' }, restarted: { type: 'boolean' } } },
        202: { type: 'object', properties: { input_id: { type: 'integer' }, job_id: { type: ['integer', 'null'] }, status: { type: 'string' }, duplicate: { type: 'boolean' }, restarted: { type: 'boolean' } } }
      }
    }
  }, async (request, reply) => {
    const { text, links, files } = await readInputUpload(request, config)
    const r = submitInput({ db, queue, events }, { authorId: request.member.id, text, files, links })
    // 202: el análisis queda en cola. 200: el mismo contenido ya existía y se devuelve lo que hay (§1.3).
    reply.code(r.created || r.restarted ? 202 : 200)
    return { input_id: r.input.id, job_id: r.jobId, status: r.input.status, duplicate: !r.created && !r.restarted, restarted: r.restarted }
  })

  app.get('/inputs/:id', {
    onRequest: [requireRole('member')],
    schema: { params: idParams(), response: { 200: inputView } }
  }, async (request) => getInputView({ db, queue, events }, request.params.id, request.member.id))

  app.post('/inputs/:id/publish', {
    onRequest: [requireRole('member')],
    schema: {
      params: idParams(),
      body: publishBody,
      response: { 200: { type: 'object', properties: { message_ids: { type: 'array', items: { type: 'integer' } }, messages: { type: 'array', items: messageDetail } } } }
    }
  }, async (request) => {
    const ids = publishProposal({ db, events }, { inputId: request.params.id, memberId: request.member.id, proposal: request.body })
    return { message_ids: ids, messages: ids.map((id) => getMessage(db, id)) }
  })

  app.post('/inputs/:id/cancel', {
    onRequest: [requireRole('member')],
    schema: {
      params: idParams(),
      response: { 200: { type: 'object', properties: { input_id: { type: 'integer' }, status: { type: 'string' }, cancelled_jobs: { type: 'array', items: { type: 'integer' } } } } }
    }
  }, async (request) => {
    const r = cancelInput({ db, queue, events }, request.params.id, request.member.id)
    return { ...r, status: 'cancelled' }
  })
}
