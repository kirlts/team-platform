// Configuración de proveedores (MASTER-SPEC §7.6). Sólo el editor. La base guarda el nombre del proveedor y
// el modelo; la llave vive en el entorno y no se lee ni se escribe acá (MASTER-SPEC §4.6).

import { getProviderSettings, setProviderSettings } from '../../domain/settings.js'
import { unprocessable } from '../../domain/errors.js'
import { providerSlot } from '../schemas.js'

export function registerSettingsRoutes (app, ctx) {
  const { db, config, requireRole, modules } = ctx

  const vista = () => ({
    ...getProviderSettings(db, config),
    // Los proveedores que el módulo de proveedores declara; null si todavía no está instalado.
    catalog: modules.providersModule?.catalog ?? null
  })

  const respuesta = {
    200: {
      type: 'object',
      properties: {
        analyzer: { type: 'string' },
        text: providerSlot, vision: providerSlot, speech: providerSlot,
        catalog: { type: ['object', 'null'], additionalProperties: true }
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
    const catalogo = modules.providersModule?.catalog
    for (const modalidad of ['text', 'vision', 'speech']) {
      const nombre = request.body[modalidad]?.provider
      if (nombre && catalogo?.[modalidad] && !catalogo[modalidad].includes(nombre)) {
        throw unprocessable(`El proveedor «${nombre}» no está disponible para ${modalidad}.`, 'provider_unknown')
      }
    }
    setProviderSettings(db, request.body)
    return vista()
  })
}
