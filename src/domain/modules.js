// Carga de los módulos que escriben otros agentes: analizador, extractores y proveedores (src/contracts.md).
// Si el archivo no existe todavía, el servidor arranca igual y los trabajos fallan con un motivo claro.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getProviderOverrides, providerEnv } from './settings.js'

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function importFile (routePath) {
  const absolutePath = path.resolve(srcDir, routePath)
  if (!existsSync(absolutePath)) return null
  return import(pathToFileURL(absolutePath).href) // si existe pero falla, el error sube: no se oculta un módulo roto
}

/**
 * Devuelve el conjunto de módulos listo para el pipeline y la API:
 *   analyze, extract, estimateAudioSeconds, audioBudget, warmTemplate, resolveAnalyzeConfig, providersModule
 *   getProviders()   proveedores vigentes. Se reconstruyen cuando Configuración cambia lo guardado (el proceso
 *                    del worker lee la base cada vez, así que ve el cambio aunque lo haya hecho otro proceso).
 *   getAnalyzer()    'api' | 'harness' vigente
 *   buildProviders(overrides)  construye proveedores con sobrescrituras de prueba (valida un parche sin guardarlo)
 */
export async function loadModules (config, { db = null, env = process.env, log = () => {} } = {}) {
  const [analyzerModule, extractor, providerSet] = await Promise.all([
    importFile(config.modules.analyze),
    importFile(config.modules.extract),
    importFile(config.modules.providers)
  ])
  const absent = []
  if (!analyzerModule?.analyze) absent.push(`analizador (${config.modules.analyze})`)
  if (!extractor?.extract) absent.push(`extractores (${config.modules.extract})`)
  if (!providerSet?.createProviders) absent.push(`proveedores (${config.modules.providers})`)
  for (const f of absent) log(`Módulo no disponible: ${f}. Los trabajos que lo necesiten fallarán con ese motivo.`)

  const overridesNow = () => (db ? getProviderOverrides(db) : {})
  const build = (overrides) => {
    if (!providerSet?.createProviders) return null
    return providerSet.createProviders({ ...env, ...providerEnv(overrides) })
  }
  let cache = { lookupKey: null, providers: null }
  const getProviders = () => {
    const overrides = overridesNow()
    const lookupKey = JSON.stringify(overrides)
    if (cache.lookupKey !== lookupKey || !cache.providers) cache = { lookupKey, providers: build(overrides) }
    return cache.providers
  }

  return {
    analyze: analyzerModule?.analyze ?? null,
    warmTemplate: analyzerModule?.warmTemplate ?? null,
    resolveAnalyzeConfig: analyzerModule?.resolveConfig ?? null,
    extract: extractor?.extract ?? null,
    estimateAudioSeconds: extractor?.estimateAudioSeconds ?? null,
    // El presupuesto de audio por hora vive en el módulo de extractores; este proceso lo consulta antes de transcribir.
    audioBudget: extractor?.createAudioBudget ? extractor.createAudioBudget() : null,
    getProviders,
    getAnalyzer: () => overridesNow().analyzer ?? config.providers.analyzer,
    buildProviders: build,
    providersModule: providerSet,
    missing: absent
  }
}

/**
 * Calentamiento por evento al guardar una plantilla (MS §7.5): el analizador compila el esquema y calienta la
 * caché del prompt. No es una espera por reloj. La llamada queda en `spans` como cualquier otra (UD-014). Un fallo
 * se registra y no afecta al guardado.
 */
export function installTemplateWarmup ({ domainEvents, modules, log = () => {} }) {
  domainEvents.on('template.saved', async (tpl) => {
    if (!modules.warmTemplate) return
    try {
      const providers = modules.getProviders()
      if (!providers?.text || providers.text.unavailable) return // sin proveedor de texto no hay nada que calentar
      await modules.warmTemplate({ providers, config: modules.resolveAnalyzeConfig?.(), templateMarkdown: tpl.body_markdown })
    } catch (error) {
      log(`No se pudo calentar la plantilla «${tpl.name}»: ${error.message}`)
    }
  })
}
