// Rutas de áreas y plantillas (MASTER-SPEC §7.1). Leer áreas lo hace cualquier miembro (la barra lateral, las
// insignias y los filtros las necesitan); crear, editar, borrar, restaurar y todo lo de plantillas es del editor.
// Borrar es en blando y exige ?confirm=true; los mensajes que referencian un área o plantilla nunca se pierden.

import {
  createArea, createTemplate, deleteArea, deleteTemplate, listAreas, listTemplates,
  restoreArea, restoreTemplate, updateArea, updateTemplate
} from '../../domain/areas.js'
import { mirrorTemplate, removeTemplateMirror } from '../../domain/template-files.js'
import { requireConfirm } from '../confirm.js'
import { area, confirmQuery, idParams, template } from '../schemas.js'

const plantillaCuerpo = {
  type: 'object',
  additionalProperties: false,
  properties: { body_markdown: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, description: { type: 'string', minLength: 1 } }
}

export function registerAreaRoutes (app, ctx) {
  const { db, config, requireRole, domainEvents } = ctx
  const plantillaParams = { type: 'object', required: ['id', 'templateId'], properties: { id: { type: 'integer', minimum: 1 }, templateId: { type: 'integer', minimum: 1 } } }
  const actor = (request) => ({ actorId: request.member.id })

  // Copia en archivos en el volumen (DATA_DIR/templates): la base manda, el archivo sirve a los respaldos.
  const copiar = (t) => { try { mirrorTemplate(config, t) } catch (e) { app.log.warn({ err: e }, 'no se pudo copiar la plantilla al volumen') } }

  app.get('/areas', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Áreas con sus conteos y plantillas (sin cuerpo)',
      querystring: { type: 'object', additionalProperties: false, properties: { include_deleted: { type: 'boolean' } } },
      response: { 200: { type: 'array', items: area } }
    }
  }, async (request, reply) => {
    // Las borradas sólo las ve el editor, para restaurarlas.
    if (request.query.include_deleted === true && request.member.role !== 'editor') {
      return reply.code(403).send({ code: 'forbidden', message: 'Ver lo borrado corresponde a un editor.' })
    }
    return listAreas(db, { includeDeleted: request.query.include_deleted === true })
  })

  app.post('/areas', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Crear un área',
      body: { type: 'object', required: ['title', 'description'], additionalProperties: false, properties: { title: { type: 'string', minLength: 1 }, description: { type: 'string', minLength: 1 }, position: { type: 'integer', minimum: 0 } } },
      response: { 201: area }
    }
  }, async (request, reply) => { reply.code(201); return createArea(db, request.body, actor(request)) })

  app.patch('/areas/:id', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Editar un área',
      params: idParams(),
      body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { title: { type: 'string', minLength: 1 }, description: { type: 'string', minLength: 1 }, position: { type: 'integer', minimum: 0 } } },
      response: { 200: area }
    }
  }, async (request) => updateArea(db, request.params.id, request.body, actor(request)))

  app.delete('/areas/:id', {
    onRequest: [requireRole('editor')],
    schema: { summary: 'Borrar un área en blando (exige ?confirm=true)', params: idParams(), querystring: confirmQuery, response: { 204: { type: 'null', description: 'Área borrada; se restaura con POST /areas/:id/restore.' } } }
  }, async (request, reply) => {
    requireConfirm(request)
    deleteArea(db, request.params.id, actor(request))
    return reply.code(204).send()
  })

  app.post('/areas/:id/restore', {
    onRequest: [requireRole('editor')],
    schema: { summary: 'Restaurar un área borrada', params: idParams(), response: { 200: area } }
  }, async (request) => restoreArea(db, request.params.id, actor(request)))

  app.get('/areas/:id/templates', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Plantillas de un área, con el archivo completo',
      params: idParams(),
      querystring: { type: 'object', additionalProperties: false, properties: { include_deleted: { type: 'boolean' } } },
      response: { 200: { type: 'array', items: template } }
    }
  }, async (request) => listTemplates(db, request.params.id, { includeDeleted: request.query.include_deleted === true }))

  app.post('/areas/:id/templates', {
    onRequest: [requireRole('editor')],
    schema: { summary: 'Crear una plantilla (body_markdown es el archivo completo con su encabezado)', params: idParams(), body: { ...plantillaCuerpo, required: ['body_markdown'] }, response: { 201: template } }
  }, async (request, reply) => {
    const creada = createTemplate(db, request.params.id, request.body, actor(request))
    copiar(creada)
    domainEvents.emit('template.saved', creada) // el analizador calienta el esquema de salida por evento (MS §7.5)
    reply.code(201)
    return creada
  })

  app.patch('/areas/:id/templates/:templateId', {
    onRequest: [requireRole('editor')],
    schema: { summary: 'Editar una plantilla', params: plantillaParams, body: { ...plantillaCuerpo, minProperties: 1 }, response: { 200: template } }
  }, async (request) => {
    const actualizada = updateTemplate(db, request.params.id, request.params.templateId, request.body, actor(request))
    copiar(actualizada)
    domainEvents.emit('template.saved', actualizada)
    return actualizada
  })

  app.delete('/areas/:id/templates/:templateId', {
    onRequest: [requireRole('editor')],
    schema: { summary: 'Borrar una plantilla en blando (exige ?confirm=true)', params: plantillaParams, querystring: confirmQuery, response: { 204: { type: 'null', description: 'Plantilla borrada; se restaura con POST /templates/:id/restore.' } } }
  }, async (request, reply) => {
    requireConfirm(request)
    deleteTemplate(db, request.params.id, request.params.templateId, actor(request))
    try { removeTemplateMirror(config, request.params.id, request.params.templateId) } catch (e) { app.log.warn({ err: e }, 'no se pudo retirar la copia de la plantilla') }
    return reply.code(204).send()
  })

  app.post('/templates/:id/restore', {
    onRequest: [requireRole('editor')],
    schema: { summary: 'Restaurar una plantilla borrada', params: idParams(), response: { 200: template } }
  }, async (request) => {
    const restaurada = restoreTemplate(db, request.params.id, actor(request))
    copiar(restaurada)
    return restaurada
  })
}
