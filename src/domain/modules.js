// Carga de los módulos que escriben otros agentes: analizador, extractores y proveedores (src/contracts.md).
// Si el archivo no existe todavía, el servidor arranca igual y los trabajos fallan con un motivo claro.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function importar (ruta) {
  const absoluta = path.resolve(srcDir, ruta)
  if (!existsSync(absoluta)) return null
  return import(pathToFileURL(absoluta).href) // si existe pero falla, el error sube: no se oculta un módulo roto
}

/**
 * Devuelve { analyze, extract, providers, missing }. `getSettings` entrega la configuración vigente de
 * proveedores cada vez que se pide (editable desde Configuración sin reiniciar).
 */
export async function loadModules (config, { getSettings, log = () => {} } = {}) {
  const [analizador, extractor, proveedores] = await Promise.all([
    importar(config.modules.analyze),
    importar(config.modules.extract),
    importar(config.modules.providers)
  ])
  const faltan = []
  if (!analizador?.analyze) faltan.push(`analizador (${config.modules.analyze})`)
  if (!extractor?.extract) faltan.push(`extractores (${config.modules.extract})`)
  let providers = null
  if (proveedores?.createProviders) providers = proveedores.createProviders({ config, getSettings })
  else faltan.push(`proveedores (${config.modules.providers})`)
  for (const f of faltan) log(`Módulo no disponible: ${f}. Los trabajos que lo necesiten fallarán con ese motivo.`)
  // El presupuesto de audio por hora vive en el módulo de extractores; este proceso lo consulta antes de transcribir.
  const audioBudget = extractor?.createAudioBudget ? extractor.createAudioBudget() : null
  return {
    analyze: analizador?.analyze ?? null,
    extract: extractor?.extract ?? null,
    estimateAudioSeconds: extractor?.estimateAudioSeconds ?? null,
    audioBudget,
    providers,
    providersModule: proveedores,
    getSettings,
    missing: faltan
  }
}
