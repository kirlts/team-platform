// Carga de los módulos que escriben otros agentes: analizador, extractores y proveedores (src/contracts.md).
// Si el archivo no existe todavía, el servidor arranca igual y los trabajos fallan con un motivo claro.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { run } from '../db/index.js'
import { llmCostUsd } from './costs.js'
import { getProviderOverrides, providerEnv } from './settings.js'

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function importar (ruta) {
  const absoluta = path.resolve(srcDir, ruta)
  if (!existsSync(absoluta)) return null
  return import(pathToFileURL(absoluta).href) // si existe pero falla, el error sube: no se oculta un módulo roto
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
  const [analizador, extractor, proveedores] = await Promise.all([
    importar(config.modules.analyze),
    importar(config.modules.extract),
    importar(config.modules.providers)
  ])
  const faltan = []
  if (!analizador?.analyze) faltan.push(`analizador (${config.modules.analyze})`)
  if (!extractor?.extract) faltan.push(`extractores (${config.modules.extract})`)
  if (!proveedores?.createProviders) faltan.push(`proveedores (${config.modules.providers})`)
  for (const f of faltan) log(`Módulo no disponible: ${f}. Los trabajos que lo necesiten fallarán con ese motivo.`)

  const sobrescrituras = () => (db ? getProviderOverrides(db) : {})
  const construir = (overrides) => {
    if (!proveedores?.createProviders) return null
    return proveedores.createProviders({ ...env, ...providerEnv(overrides) })
  }
  let cache = { clave: null, providers: null }
  const getProviders = () => {
    const overrides = sobrescrituras()
    const clave = JSON.stringify(overrides)
    if (cache.clave !== clave || !cache.providers) cache = { clave, providers: construir(overrides) }
    return cache.providers
  }

  return {
    analyze: analizador?.analyze ?? null,
    warmTemplate: analizador?.warmTemplate ?? null,
    resolveAnalyzeConfig: analizador?.resolveConfig ?? null,
    extract: extractor?.extract ?? null,
    estimateAudioSeconds: extractor?.estimateAudioSeconds ?? null,
    // El presupuesto de audio por hora vive en el módulo de extractores; este proceso lo consulta antes de transcribir.
    audioBudget: extractor?.createAudioBudget ? extractor.createAudioBudget() : null,
    getProviders,
    getAnalyzer: () => sobrescrituras().analyzer ?? config.providers.analyzer,
    buildProviders: construir,
    providersModule: proveedores,
    missing: faltan
  }
}

/**
 * Calentamiento por evento al guardar una plantilla (MS §7.5): el analizador compila el esquema y calienta la
 * caché del prompt. No es una espera por reloj. Un fallo se registra y no afecta al guardado.
 */
export function installTemplateWarmup ({ domainEvents, modules, db, config, log = () => {} }) {
  domainEvents.on('template.saved', async (plantilla) => {
    if (!modules.warmTemplate) return
    try {
      const providers = modules.getProviders()
      if (!providers?.text || providers.text.unavailable) return // sin proveedor de texto no hay nada que calentar
      const llamada = await modules.warmTemplate({ providers, config: modules.resolveAnalyzeConfig?.(), templateMarkdown: plantilla.body_markdown })
      if (llamada?.provider) {
        run(db, `INSERT INTO llm_calls (job_id, provider, model, modality, input_tokens, output_tokens, cached_tokens, cost_usd, duration_ms, at)
                 VALUES (NULL, ?, ?, 'text', ?, ?, ?, ?, ?, ?)`,
        llamada.provider, llamada.model ?? 'desconocido', llamada.usage?.input_tokens ?? 0, llamada.usage?.output_tokens ?? 0, llamada.usage?.cached_tokens ?? 0,
        llmCostUsd(config, llamada.model, llamada.usage), llamada.duration_ms ?? 0, Date.now())
      }
    } catch (error) {
      log(`No se pudo calentar la plantilla «${plantilla.name}»: ${error.message}`)
    }
  })
}
