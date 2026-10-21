// Configuración de proveedores (MASTER-SPEC §7.6). Sólo el editor. La base guarda el nombre del proveedor, el
// modelo y la dirección base; la llave vive en el entorno y no se lee ni se escribe acá (MASTER-SPEC §4.6).
// Un parche sólo se guarda si `createProviders` acepta la combinación: así un nombre inexistente se rechaza
// al configurarlo y no cuando falla el primer trabajo.

import { audit } from '../../domain/audit.js'
import { getProject, getProviderOverrides, getProviderSettings, MODALITIES, mergeOverrides, setProjectDescription, setProviderOverrides } from '../../domain/settings.js'
import { tooLarge, unprocessable } from '../../domain/errors.js'
import { readProjectUpload } from '../upload.js'

const itemVista = {
  type: 'object',
  properties: {
    slot: { type: 'string', enum: MODALITIES }, provider: { type: 'string' }, model: { type: 'string' }, base_url: { type: 'string' },
    available: { type: 'boolean' }, reason: { type: ['string', 'null'] }
  }
}

export function registerSettingsRoutes (app, ctx) {
  const { db, config, requireRole, modules } = ctx

  const view = () => {
    const stored = getProviderSettings(db, config)
    // `describe()` dice lo que `createProviders` efectivamente armó (proveedor, modelo y si falta una llave).
    const built = modules.getProviders?.()?.describe?.() ?? []
    return {
      analyzer: stored.analyzer,
      items: MODALITIES.map((slot) => {
        const real = built.find((s) => s.slot === slot)
        return {
          slot,
          provider: real?.provider ?? stored[slot].provider ?? '',
          model: real?.model ?? stored[slot].model ?? '',
          ...(stored[slot].base_url ? { base_url: stored[slot].base_url } : {}),
          available: real ? real.available : false,
          reason: real?.reason ?? null
        }
      })
    }
  }

  const responseSchema = { 200: { type: 'object', properties: { analyzer: { type: 'string', enum: ['api', 'harness'] }, items: { type: 'array', items: itemVista } } } }

  app.get('/settings/providers', { onRequest: [requireRole('editor')], schema: { summary: 'Proveedores de modelo configurados (nunca las llaves)', response: responseSchema } }, async () => view())

  app.patch('/settings/providers', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Cambiar el proveedor de una ranura, o el analizador',
      description: 'Cuerpo: { slot, provider, model, base_url? } o { analyzer }. Se rechaza lo que `createProviders` no acepta.',
      body: {
        anyOf: [
          { type: 'object', required: ['slot'], additionalProperties: false, minProperties: 2, properties: { slot: { type: 'string', enum: MODALITIES }, provider: { type: 'string', minLength: 1 }, model: { type: 'string', minLength: 1 }, base_url: { type: 'string' } } },
          { type: 'object', required: ['analyzer'], additionalProperties: false, properties: { analyzer: { type: 'string', enum: ['api', 'harness'] } } }
        ]
      },
      response: responseSchema
    }
  }, async (request) => {
    const { slot, analyzer, ...slotBody } = request.body
    const patchObj = analyzer !== undefined ? { analyzer } : { [slot]: slotBody }
    try {
      modules.buildProviders?.(mergeOverrides(getProviderOverrides(db), patchObj))
    } catch (error) {
      throw unprocessable(error.message, 'provider_invalid')
    }
    setProviderOverrides(db, patchObj)
    audit(db, { memberId: request.member.id, action: 'settings.providers', entity: 'settings', detail: analyzer !== undefined ? { analyzer } : { slot, provider: slotBody.provider, model: slotBody.model } })
    return view()
  })

  // Descripción del proyecto (UD-024): la lee cualquier miembro, la escribe el editor. Markdown libre, entero al analizador.
  const projectView = { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name', 'description'] }

  app.get('/settings/project', {
    onRequest: [requireRole('member')],
    schema: { summary: 'Nombre y descripción del proyecto', response: { 200: projectView } }
  }, async () => getProject(db, config))

  app.patch('/settings/project', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Cambiar la descripción del proyecto (editor)',
      description: 'JSON `{ description }` o multipart con un archivo `file` (.md) o un campo `description`. El texto reemplaza al anterior y viaja entero al analizador. El tope es `PROJECT_DESCRIPTION_MAX_CHARS` caracteres (413 `too_large` si lo supera).',
      // Per content type: the multipart body is read by the handler, only the JSON body is validated by schema.
      body: {
        content: {
          'application/json': {
            schema: { type: 'object', required: ['description'], additionalProperties: false, properties: { description: { type: 'string' } } }
          }
        }
      },
      response: { 200: projectView }
    }
  }, async (request) => {
    const maxChars = config.project.descriptionMaxChars
    const description = request.isMultipart() ? await readProjectUpload(request, maxChars) : request.body.description
    if ([...description].length > maxChars) throw tooLarge(`La descripción del proyecto supera el máximo de ${maxChars} caracteres.`)
    setProjectDescription(db, description)
    audit(db, { memberId: request.member.id, action: 'settings.project.update', entity: 'settings', detail: { length: [...description].length } })
    return getProject(db, config)
  })
}
