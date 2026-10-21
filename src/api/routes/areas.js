// Rutas de áreas y plantillas (MASTER-SPEC §7.1). Leer áreas lo hace cualquier miembro (la barra lateral, las
// insignias y los filtros las necesitan); crear, editar y todo lo de plantillas es del editor.

import { createArea, createTemplate, deleteTemplate, listAreas, listTemplates, updateArea, updateTemplate } from '../../domain/areas.js'
import { area, idParams, template } from '../schemas.js'

const plantillaCuerpo = {
  type: 'object',
  additionalProperties: false,
  properties: { body_markdown: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, description: { type: 'string', minLength: 1 } }
}

export function registerAreaRoutes (app, ctx) {
  const { db, requireRole, domainEvents } = ctx
  const plantillaParams = { type: 'object', required: ['id', 'templateId'], properties: { id: { type: 'integer', minimum: 1 }, templateId: { type: 'integer', minimum: 1 } } }

  app.get('/areas', { onRequest: [requireRole('member')], schema: { response: { 200: { type: 'array', items: area } } } },
    async () => listAreas(db))

  app.post('/areas', {
    onRequest: [requireRole('editor')],
    schema: {
      body: { type: 'object', required: ['title', 'description'], additionalProperties: false, properties: { title: { type: 'string', minLength: 1 }, description: { type: 'string', minLength: 1 }, position: { type: 'integer', minimum: 0 } } },
      response: { 201: area }
    }
  }, async (request, reply) => { reply.code(201); return createArea(db, request.body) })

  app.patch('/areas/:id', {
    onRequest: [requireRole('editor')],
    schema: {
      params: idParams(),
      body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { title: { type: 'string', minLength: 1 }, description: { type: 'string', minLength: 1 }, position: { type: 'integer', minimum: 0 } } },
      response: { 200: area }
    }
  }, async (request) => updateArea(db, request.params.id, request.body))

  app.get('/areas/:id/templates', {
    onRequest: [requireRole('editor')],
    schema: { params: idParams(), response: { 200: { type: 'array', items: template } } }
  }, async (request) => listTemplates(db, request.params.id))

  app.post('/areas/:id/templates', {
    onRequest: [requireRole('editor')],
    schema: { params: idParams(), body: { ...plantillaCuerpo, required: ['body_markdown'] }, response: { 201: template } }
  }, async (request, reply) => {
    const creada = createTemplate(db, request.params.id, request.body)
    domainEvents.emit('template.saved', creada) // el analizador calienta el esquema de salida por evento (MS §7.5)
    reply.code(201)
    return creada
  })

  app.patch('/areas/:id/templates/:templateId', {
    onRequest: [requireRole('editor')],
    schema: { params: plantillaParams, body: { ...plantillaCuerpo, minProperties: 1 }, response: { 200: template } }
  }, async (request) => {
    const actualizada = updateTemplate(db, request.params.id, request.params.templateId, request.body)
    domainEvents.emit('template.saved', actualizada)
    return actualizada
  })

  app.delete('/areas/:id/templates/:templateId', {
    onRequest: [requireRole('editor')],
    schema: { params: plantillaParams, response: { 204: { type: 'null', description: 'Plantilla eliminada.' } } }
  }, async (request, reply) => {
    deleteTemplate(db, request.params.id, request.params.templateId)
    return reply.code(204).send()
  })
}
