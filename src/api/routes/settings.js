// Configuración de proveedores (MASTER-SPEC §7.6). Sólo el editor. La base guarda el nombre del proveedor, el
// modelo y la dirección base; la llave vive en el entorno y no se lee ni se escribe acá (MASTER-SPEC §4.6).
// Un parche sólo se guarda si `createProviders` acepta la combinación: así un nombre inexistente se rechaza
// al configurarlo y no cuando falla el primer trabajo.

import { audit } from '../../domain/audit.js'
import { getProviderOverrides, getProviderSettings, MODALITIES, mergeOverrides, setProviderOverrides } from '../../domain/settings.js'
import { unprocessable } from '../../domain/errors.js'

const itemVista = {
  type: 'object',
  properties: {
    slot: { type: 'string', enum: MODALITIES }, provider: { type: 'string' }, model: { type: 'string' }, base_url: { type: 'string' },
    available: { type: 'boolean' }, reason: { type: ['string', 'null'] }
  }
}

export function registerSettingsRoutes (app, ctx) {
  const { db, config, requireRole, modules } = ctx

  const vista = () => {
    const guardado = getProviderSettings(db, config)
    // `describe()` dice lo que `createProviders` efectivamente armó (proveedor, modelo y si falta una llave).
    const armado = modules.getProviders?.()?.describe?.() ?? []
    return {
      analyzer: guardado.analyzer,
      items: MODALITIES.map((slot) => {
        const real = armado.find((s) => s.slot === slot)
        return {
          slot,
          provider: real?.provider ?? guardado[slot].provider ?? '',
          model: real?.model ?? guardado[slot].model ?? '',
          ...(guardado[slot].base_url ? { base_url: guardado[slot].base_url } : {}),
          available: real ? real.available : false,
          reason: real?.reason ?? null
        }
      })
    }
  }

  const respuesta = { 200: { type: 'object', properties: { analyzer: { type: 'string', enum: ['api', 'harness'] }, items: { type: 'array', items: itemVista } } } }

  app.get('/settings/providers', { onRequest: [requireRole('editor')], schema: { summary: 'Proveedores de modelo configurados (nunca las llaves)', response: respuesta } }, async () => vista())

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
      response: respuesta
    }
  }, async (request) => {
    const { slot, analyzer, ...ranura } = request.body
    const parche = analyzer !== undefined ? { analyzer } : { [slot]: ranura }
    try {
      modules.buildProviders?.(mergeOverrides(getProviderOverrides(db), parche))
    } catch (error) {
      throw unprocessable(error.message, 'provider_invalid')
    }
    setProviderOverrides(db, parche)
    audit(db, { memberId: request.member.id, action: 'settings.providers', entity: 'settings', detail: analyzer !== undefined ? { analyzer } : { slot, provider: ranura.provider, model: ranura.model } })
    return vista()
  })
}
