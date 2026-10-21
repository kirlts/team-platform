// Configuración de proveedores (MASTER-SPEC §7.6). Sólo el editor. La base guarda el nombre del proveedor, el
// modelo y la dirección base; la llave vive en el entorno y no se lee ni se escribe acá (MASTER-SPEC §4.6).
// Un parche sólo se guarda si `createProviders` acepta la combinación: así un nombre inexistente se rechaza
// al configurarlo y no cuando falla el primer trabajo.

import { getProviderOverrides, getProviderSettings, mergeOverrides, setProviderOverrides } from '../../domain/settings.js'
import { unprocessable } from '../../domain/errors.js'
import { providerSlot } from '../schemas.js'

export function registerSettingsRoutes (app, ctx) {
  const { db, config, requireRole, modules } = ctx

  const vista = () => ({
    ...getProviderSettings(db, config),
    // Lo que `createProviders` efectivamente armó: proveedor, modelo y si falta una llave (nunca la llave).
    slots: modules.getProviders?.()?.describe?.() ?? []
  })

  const slotVista = { type: 'object', properties: { slot: { type: 'string' }, provider: { type: ['string', 'null'] }, model: { type: ['string', 'null'] }, available: { type: 'boolean' }, reason: { type: ['string', 'null'] } } }
  const respuesta = {
    200: {
      type: 'object',
      properties: {
        analyzer: { type: 'string' },
        text: providerSlot, vision: providerSlot, speech: providerSlot,
        slots: { type: 'array', items: slotVista }
      }
    }
  }

  app.get('/settings/providers', { onRequest: [requireRole('editor')], schema: { response: respuesta } }, async () => vista())

  app.patch('/settings/providers', {
    onRequest: [requireRole('editor')],
    schema: {
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: { analyzer: { type: 'string', enum: ['api', 'harness'] }, text: providerSlot, vision: providerSlot, speech: providerSlot }
      },
      response: respuesta
    }
  }, async (request) => {
    const candidato = mergeOverrides(getProviderOverrides(db), request.body)
    try {
      modules.buildProviders?.(candidato)
    } catch (error) {
      throw unprocessable(error.message, 'provider_invalid')
    }
    setProviderOverrides(db, request.body)
    return vista()
  })
}
