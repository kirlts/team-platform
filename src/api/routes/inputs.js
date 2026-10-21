// Input routes (MASTER-SPEC §7.1): create (multipart, idempotent by hash), list one's own, query,
// publish, cancel and, for the editor, reprocess.

import { cancelInput, getInputView, listInputs, reprocessInput, submitInput } from '../../domain/inputs.js'
import { getMessage } from '../../domain/messages.js'
import { publishProposal } from '../../domain/proposals.js'
import { withSpan } from '../../domain/tracing.js'
import { pageEnvelope, pageParams, pageQuerySchema, pageResult } from '../pagination.js'
import { idParams, inputView, messageDetail, publishBody } from '../schemas.js'
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

  app.post('/inputs/:id/publish', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Publish the proposal (edited or not) as messages',
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
