// Loading of the modules that other agents write: analyzer, extractors and providers (src/contracts.md).
// If the file does not exist yet, the server starts anyway and the jobs fail with a clear reason.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getProviderOverrides, providerEnv } from './settings.js'

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function importFile (routePath) {
  const absolutePath = path.resolve(srcDir, routePath)
  if (!existsSync(absolutePath)) return null
  return import(pathToFileURL(absolutePath).href) // if it exists but fails, the error propagates: a broken module is not hidden
}

/**
 * Returns the set of modules ready for the pipeline and the API:
 *   analyze, extract, estimateAudioSeconds, audioBudget, warmTemplate, resolveAnalyzeConfig, providersModule
 *   getProviders()   current providers. They are rebuilt when `Configuración` changes what is stored (the worker
 *                    process reads the database every time, so it sees the change even if another process made it).
 *   getAnalyzer()    current 'api' | 'harness'
 *   buildProviders(overrides)  builds providers with test overrides (validates a patch without saving it)
 */
export async function loadModules (config, { db = null, env = process.env, log = () => {} } = {}) {
  const [analyzerModule, extractor, providerSet] = await Promise.all([
    importFile(config.modules.analyze),
    importFile(config.modules.extract),
    importFile(config.modules.providers)
  ])
  const absent = []
  if (!analyzerModule?.analyze) absent.push(`analyzer (${config.modules.analyze})`)
  if (!extractor?.extract) absent.push(`extractors (${config.modules.extract})`)
  if (!providerSet?.createProviders) absent.push(`providers (${config.modules.providers})`)
  for (const f of absent) log(`Module not available: ${f}. Jobs that need it will fail with that reason.`)

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
    // The hourly audio budget lives in the extractors module; this process consults it before transcribing.
    audioBudget: extractor?.createAudioBudget ? extractor.createAudioBudget() : null,
    getProviders,
    getAnalyzer: () => overridesNow().analyzer ?? config.providers.analyzer,
    buildProviders: build,
    providersModule: providerSet,
    missing: absent
  }
}

/**
 * Event-driven warm-up when a template is saved (MS §7.5): the analyzer compiles the schema and warms the
 * prompt cache. It is not a clock-based wait. The call is recorded in `spans` like any other (UD-014). A failure
 * is logged and does not affect saving.
 */
export function installTemplateWarmup ({ domainEvents, modules, getProject = () => undefined, log = () => {} }) {
  domainEvents.on('template.saved', async (tpl) => {
    if (!modules.warmTemplate) return
    try {
      const providers = modules.getProviders()
      if (!providers?.text || providers.text.unavailable) return // without a text provider there is nothing to warm
      await modules.warmTemplate({ providers, config: modules.resolveAnalyzeConfig?.(), templateMarkdown: tpl.body_markdown, project: getProject() })
    } catch (error) {
      log(`Could not warm the template «${tpl.name}»: ${error.message}`)
    }
  })
}
