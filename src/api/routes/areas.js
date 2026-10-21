// Area and template routes (MASTER-SPEC §7.1). Any member can read areas (the sidebar, the badges and the
// filters need them); creating, editing, deleting, restoring and everything about templates belongs to the editor.
// Deleting is soft and requires ?confirm=true; messages that reference an area or template are never lost.

import {
  createArea, createTemplate, deleteArea, deleteTemplate, listAreas, listTemplates,
  AREA_COLOR_PATTERN, restoreArea, restoreTemplate, updateArea, updateTemplate
} from '../../domain/areas.js'
import { mirrorTemplate, removeTemplateMirror } from '../../domain/template-files.js'
import { requireConfirm } from '../confirm.js'
import { area, confirmQuery, idParams, template } from '../schemas.js'

const templateBody = {
  type: 'object',
  additionalProperties: false,
  properties: { body_markdown: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, description: { type: 'string', minLength: 1 } }
}

const colorProp = { type: 'string', pattern: AREA_COLOR_PATTERN }

export function registerAreaRoutes (app, ctx) {
  const { db, config, requireRole, domainEvents } = ctx
  const templateParams = { type: 'object', required: ['id', 'templateId'], properties: { id: { type: 'integer', minimum: 1 }, templateId: { type: 'integer', minimum: 1 } } }
  const actor = (request) => ({ actorId: request.member.id })

  // File copy in the volume (DATA_DIR/templates): the database rules, the file serves the backups.
  const mirror = (t) => { try { mirrorTemplate(config, t) } catch (e) { app.log.warn({ err: e }, 'could not copy the template to the volume') } }

  app.get('/areas', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Areas with their counts and templates (without body)',
      querystring: { type: 'object', additionalProperties: false, properties: { include_deleted: { type: 'boolean' } } },
      response: { 200: { type: 'array', items: area } }
    }
  }, async (request, reply) => {
    // Only the editor sees the deleted ones, to restore them.
    if (request.query.include_deleted === true && request.member.role !== 'editor') {
      return reply.code(403).send({ code: 'forbidden', message: 'Ver lo borrado corresponde a un editor.' })
    }
    return listAreas(db, { includeDeleted: request.query.include_deleted === true })
  })

  app.post('/areas', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Create an area',
      body: { type: 'object', required: ['title', 'description'], additionalProperties: false, properties: { title: { type: 'string', minLength: 1 }, description: { type: 'string', minLength: 1 }, position: { type: 'integer', minimum: 0 }, color: colorProp } },
      response: { 201: area }
    }
  }, async (request, reply) => { reply.code(201); return createArea(db, request.body, actor(request)) })

  app.patch('/areas/:id', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Edit an area',
      params: idParams(),
      body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { title: { type: 'string', minLength: 1 }, description: { type: 'string', minLength: 1 }, position: { type: 'integer', minimum: 0 }, color: colorProp } },
      response: { 200: area }
    }
  }, async (request) => updateArea(db, request.params.id, request.body, actor(request)))

  app.delete('/areas/:id', {
    onRequest: [requireRole('editor')],
    schema: { summary: 'Soft-delete an area (requires ?confirm=true)', params: idParams(), querystring: confirmQuery, response: { 204: { type: 'null', description: 'Area deleted; restored with POST /areas/:id/restore.' } } }
  }, async (request, reply) => {
    requireConfirm(request)
    deleteArea(db, request.params.id, actor(request))
    return reply.code(204).send()
  })

  app.post('/areas/:id/restore', {
    onRequest: [requireRole('editor')],
    schema: { summary: 'Restore a deleted area', params: idParams(), response: { 200: area } }
  }, async (request) => restoreArea(db, request.params.id, actor(request)))

  app.get('/areas/:id/templates', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Templates of an area, with the complete file',
      params: idParams(),
      querystring: { type: 'object', additionalProperties: false, properties: { include_deleted: { type: 'boolean' } } },
      response: { 200: { type: 'array', items: template } }
    }
  }, async (request) => listTemplates(db, request.params.id, { includeDeleted: request.query.include_deleted === true }))

  app.post('/areas/:id/templates', {
    onRequest: [requireRole('editor')],
    schema: { summary: 'Create a template (body_markdown is the complete file with its header)', params: idParams(), body: { ...templateBody, required: ['body_markdown'] }, response: { 201: template } }
  }, async (request, reply) => {
    const createdTemplate = createTemplate(db, request.params.id, request.body, actor(request))
    mirror(createdTemplate)
    domainEvents.emit('template.saved', createdTemplate) // the analyzer warms the output schema on the event (MS §7.5)
    reply.code(201)
    return createdTemplate
  })

  app.patch('/areas/:id/templates/:templateId', {
    onRequest: [requireRole('editor')],
    schema: { summary: 'Edit a template', params: templateParams, body: { ...templateBody, minProperties: 1 }, response: { 200: template } }
  }, async (request) => {
    const updatedTemplate = updateTemplate(db, request.params.id, request.params.templateId, request.body, actor(request))
    mirror(updatedTemplate)
    domainEvents.emit('template.saved', updatedTemplate)
    return updatedTemplate
  })

  app.delete('/areas/:id/templates/:templateId', {
    onRequest: [requireRole('editor')],
    schema: { summary: 'Soft-delete a template (requires ?confirm=true)', params: templateParams, querystring: confirmQuery, response: { 204: { type: 'null', description: 'Template deleted; restored with POST /templates/:id/restore.' } } }
  }, async (request, reply) => {
    requireConfirm(request)
    deleteTemplate(db, request.params.id, request.params.templateId, actor(request))
    try { removeTemplateMirror(config, request.params.id, request.params.templateId) } catch (e) { app.log.warn({ err: e }, 'could not remove the template copy') }
    return reply.code(204).send()
  })

  app.post('/templates/:id/restore', {
    onRequest: [requireRole('editor')],
    schema: { summary: 'Restore a deleted template', params: idParams(), response: { 200: template } }
  }, async (request) => {
    const restored = restoreTemplate(db, request.params.id, actor(request))
    mirror(restored)
    return restored
  })
}
