// Provider settings (MASTER-SPEC §7.6). Editor only. The database stores the provider name, the
// model and the base URL; the key lives in the environment and is neither read nor written here (MASTER-SPEC §4.6).
// A patch is only saved if `createProviders` accepts the combination: that way a nonexistent name is rejected
// when configured and not when the first job fails.

import { audit } from '../../domain/audit.js'
import { getAutoPublish, getFramingView, getProject, getProviderOverrides, getProviderSettings, MODALITIES, mergeOverrides, setAutoPublish, setFraming, setProjectDescription, setProjectName, setProviderOverrides } from '../../domain/settings.js'
import { LANGUAGES } from '../../domain/language.js'
import { getConnection } from '../../domain/connections.js'
import { tooLarge, unprocessable } from '../../domain/errors.js'
import { readProjectUpload } from '../upload.js'
import { probeSlotChange } from './connections.js'

const itemVista = {
  type: 'object',
  properties: {
    slot: { type: 'string', enum: MODALITIES }, provider: { type: 'string' }, model: { type: 'string' }, base_url: { type: 'string' },
    available: { type: 'boolean' }, reason: { type: ['string', 'null'] },
    key_last4: { type: ['string', 'null'] }, status: { type: 'string', enum: ['no_key', 'configured', 'failing'] }
  }
}

export function registerSettingsRoutes (app, ctx) {
  const { db, config, requireRole, modules } = ctx
  const env = modules.env ?? process.env

  /** State and last four characters of the key of the provider a function uses (never the key). */
  const connectionFacts = (provider) => {
    const connection = provider && modules.vault ? getConnection(db, config, env, provider, modules.vault) : null
    return connection ? { key_last4: connection.key.last4, status: connection.status } : {}
  }

  const view = () => {
    const stored = getProviderSettings(db, config)
    // `describe()` reports what `createProviders` actually built (provider, model and whether a key is missing).
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
          reason: real?.reason ?? null,
          ...connectionFacts(real?.provider ?? stored[slot].provider)
        }
      })
    }
  }

  const responseSchema = { 200: { type: 'object', properties: { analyzer: { type: 'string', enum: ['api', 'harness'] }, items: { type: 'array', items: itemVista } } } }

  app.get('/settings/providers', { onRequest: [requireRole('editor')], schema: { summary: 'Configured model providers (never the keys)', response: responseSchema } }, async () => view())

  app.patch('/settings/providers', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Change the provider of a slot, or the analyzer',
      description: 'Body: { slot, provider, model, base_url? } or { analyzer }. Anything `createProviders` does not accept is rejected. A change of function is tested with one minimal call before it is saved: if the test fails nothing changes and the answer is 422 `provider_check_failed` with the cause (UD-120).',
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
    const merged = mergeOverrides(getProviderOverrides(db), patchObj)
    try {
      modules.buildProviders?.(merged)
    } catch {
      // The builder's own message is English and repeats what was typed; a key pasted by mistake in the name must not come back.
      throw unprocessable('Ese proveedor no existe o su configuración no es válida.', 'provider_invalid')
    }
    if (analyzer === undefined) await probeSlotChange(ctx, slot, merged) // the previous setting stays when the test fails
    setProviderOverrides(db, patchObj)
    audit(db, { memberId: request.member.id, action: 'settings.providers', entity: 'settings', detail: analyzer !== undefined ? { analyzer } : { slot, provider: slotBody.provider, model: slotBody.model } })
    return view()
  })

  // Project description (UD-024): any member reads it, the editor writes it. Free Markdown, passed whole to the analyzer.
  const projectView = { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, max_chars: { type: 'integer', description: 'Tope de caracteres de la descripción (PROJECT_DESCRIPTION_MAX_CHARS); el panel lo muestra como contador.' }, name_max_chars: { type: 'integer', description: 'Tope de caracteres del nombre (PROJECT_NAME_MAX_CHARS).' } }, required: ['name', 'description'] }
  const projectWithLimit = () => ({ ...getProject(db, config), max_chars: config.project.descriptionMaxChars, name_max_chars: config.project.nameMaxChars })

  app.get('/settings/project', {
    onRequest: [requireRole('member')],
    schema: { summary: 'Nombre y descripción del proyecto', response: { 200: projectView } }
  }, async () => projectWithLimit())

  app.patch('/settings/project', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Cambiar el nombre o la descripción del proyecto (editor)',
      description: 'JSON `{ description?, name? }` o multipart con un archivo `file` (.md) o un campo `description`. La descripción reemplaza a la anterior y viaja entera al analizador; su tope es `PROJECT_DESCRIPTION_MAX_CHARS` caracteres (413 `too_large` si lo supera). `name` es el nombre que muestra la barra superior; vacío vuelve a `PROJECT_NAME` (H-3722), tope `PROJECT_NAME_MAX_CHARS`.',
      // Per content type: the multipart body is read by the handler, only the JSON body is validated by schema.
      body: {
        content: {
          'application/json': {
            schema: { type: 'object', minProperties: 1, additionalProperties: false, properties: { description: { type: 'string' }, name: { type: 'string' } } }
          }
        }
      },
      response: { 200: projectView }
    }
  }, async (request) => {
    const maxChars = config.project.descriptionMaxChars
    const description = request.isMultipart() ? await readProjectUpload(request, maxChars) : request.body.description
    const name = request.isMultipart() ? undefined : request.body.name
    if (name !== undefined && [...name.trim()].length > config.project.nameMaxChars) throw tooLarge(`El nombre del proyecto supera el máximo de ${config.project.nameMaxChars} caracteres.`)
    if (description !== undefined && [...description].length > maxChars) throw tooLarge(`La descripción del proyecto supera el máximo de ${maxChars} caracteres.`)
    if (name !== undefined) {
      setProjectName(db, name)
      audit(db, { memberId: request.member.id, action: 'settings.project.name', entity: 'settings', detail: { name: getProject(db, config).name } })
    }
    if (description !== undefined) {
      setProjectDescription(db, description)
      audit(db, { memberId: request.member.id, action: 'settings.project.update', entity: 'settings', detail: { length: [...description].length } })
    }
    return projectWithLimit()
  })

  // Publication mode (UD-070): any member reads it, the editor writes it.
  const publicationView = { type: 'object', properties: { auto_publish: { type: 'boolean' } }, required: ['auto_publish'] }

  app.get('/settings/publication', {
    onRequest: [requireRole('member')],
    schema: { summary: 'Modo de publicación', description: '`auto_publish`: con `true` (por omisión) los mensajes de una propuesta válida se publican solos al terminar el análisis; con `false` la propuesta espera la confirmación de su emisor (UD-070).', response: { 200: publicationView } }
  }, async () => ({ auto_publish: getAutoPublish(db) }))

  app.patch('/settings/publication', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Cambiar el modo de publicación (editor)',
      description: 'Con `auto_publish: false` vuelve la revisión previa: la propuesta queda `proposed` hasta que su emisor la publique. Sólo afecta a los análisis que terminen después; lo ya publicado no se toca.',
      body: { type: 'object', required: ['auto_publish'], additionalProperties: false, properties: { auto_publish: { type: 'boolean' } } },
      response: { 200: publicationView }
    }
  }, async (request) => {
    setAutoPublish(db, request.body.auto_publish)
    audit(db, { memberId: request.member.id, action: 'settings.publication', entity: 'settings', detail: { auto_publish: request.body.auto_publish } })
    return { auto_publish: getAutoPublish(db) }
  })

  // Analysis framing (H-3722): the paragraph that opens every system prompt, one per language. Editor only, read and write.
  const framingItem = { type: 'object', properties: { value: { type: 'string' }, default: { type: 'string' }, custom: { type: 'boolean' } }, required: ['value', 'default', 'custom'] }
  const analysisView = {
    type: 'object',
    properties: {
      framing: { type: 'object', properties: Object.fromEntries(LANGUAGES.map((l) => [l, framingItem])), required: LANGUAGES },
      max_chars: { type: 'integer', description: 'Tope de caracteres de cada encuadre (ANALYSIS_FRAMING_MAX_CHARS).' }
    },
    required: ['framing', 'max_chars']
  }
  const analysisWithLimit = () => ({ framing: getFramingView(db), max_chars: config.analysis.framingMaxChars })

  app.get('/settings/analysis', {
    onRequest: [requireRole('editor')],
    schema: { summary: 'Encuadre del análisis (editor)', description: 'Por idioma: el texto vigente, el de omisión y si el Editor lo cambió (H-3722).', response: { 200: analysisView } }
  }, async () => analysisWithLimit())

  app.patch('/settings/analysis', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Cambiar el encuadre del análisis (editor)',
      description: '`{ framing: { "es-419"?: texto, en?: texto } }`. El texto abre las instrucciones de sistema del analizador en ese idioma; vacío vuelve al de omisión. Tope `ANALYSIS_FRAMING_MAX_CHARS` caracteres por idioma (413 `too_large`). Sólo afecta a los análisis que empiecen después.',
      body: {
        type: 'object', required: ['framing'], additionalProperties: false,
        properties: { framing: { type: 'object', minProperties: 1, additionalProperties: false, properties: Object.fromEntries(LANGUAGES.map((l) => [l, { type: 'string' }])) } }
      },
      response: { 200: analysisView }
    }
  }, async (request) => {
    const max = config.analysis.framingMaxChars
    for (const text of Object.values(request.body.framing)) {
      if ([...text.trim()].length > max) throw tooLarge(`El encuadre del análisis supera el máximo de ${max} caracteres.`)
    }
    setFraming(db, request.body.framing)
    audit(db, { memberId: request.member.id, action: 'settings.analysis.framing', entity: 'settings', detail: { languages: Object.keys(request.body.framing) } })
    return analysisWithLimit()
  })
}
