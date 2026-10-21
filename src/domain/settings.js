// Configuración de proveedores (MASTER-SPEC §7.6). La base guarda sólo el nombre del proveedor, el modelo y la
// dirección base; las llaves viven en el entorno y nunca pasan por acá (MASTER-SPEC §4.6).
//
// Lo guardado actúa como sobrescritura del entorno: `providerEnv()` lo traduce a las variables que lee
// `createProviders(env)` (TEXT_*, VISION_*, SPEECH_*), de modo que cambiar un proveedor desde Configuración no
// exige reiniciar ni tocar el entorno.

import { all, run } from '../db/index.js'

export const MODALITIES = ['text', 'vision', 'speech']
const PREFIJO = { text: 'TEXT', vision: 'VISION', speech: 'SPEECH' }

/** Sobrescrituras guardadas: { analyzer?, text?, vision?, speech? }. */
export function getProviderOverrides (db) {
  const filas = all(db, "SELECT key, value_json FROM settings WHERE key LIKE 'providers.%'")
  const salida = {}
  for (const f of filas) {
    const clave = f.key.slice('providers.'.length)
    const valor = JSON.parse(f.value_json)
    if (clave === 'analyzer') salida.analyzer = valor.value
    else if (MODALITIES.includes(clave)) salida[clave] = valor
  }
  return salida
}

/** Valores efectivos para mostrar: lo guardado sobre lo que dice el entorno. */
export function getProviderSettings (db, config) {
  const guardado = getProviderOverrides(db)
  const efectivo = { analyzer: guardado.analyzer ?? config.providers.analyzer }
  for (const m of MODALITIES) efectivo[m] = { ...config.providers[m], ...(guardado[m] ?? {}) }
  return efectivo
}

/** Variables de entorno que implican las sobrescrituras guardadas. */
export function providerEnv (overrides) {
  const env = {}
  for (const m of MODALITIES) {
    const o = overrides[m]
    if (!o) continue
    if (o.provider) env[`${PREFIJO[m]}_PROVIDER`] = o.provider
    if (o.model) env[`${PREFIJO[m]}_MODEL`] = o.model
    if (o.base_url) env[`${PREFIJO[m]}_BASE_URL`] = o.base_url
  }
  return env
}

/** Combina un parche con lo guardado (sin escribir). */
export function mergeOverrides (previo, patch) {
  const unido = { ...previo }
  for (const [clave, valor] of Object.entries(patch)) {
    unido[clave] = clave === 'analyzer' ? valor : { ...(previo[clave] ?? {}), ...valor }
  }
  return unido
}

export function setProviderOverrides (db, overrides, now = Date.now) {
  for (const [clave, valor] of Object.entries(overrides)) {
    const json = JSON.stringify(clave === 'analyzer' ? { value: valor } : valor)
    run(db, `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`, `providers.${clave}`, json, now())
  }
}

