// Configuración de proveedores (MASTER-SPEC §7.6). La base guarda sólo el nombre del proveedor, el modelo y la
// dirección base; las llaves viven en el entorno y nunca pasan por acá (MASTER-SPEC §4.6).
//
// Lo guardado actúa como sobrescritura del entorno: `providerEnv()` lo traduce a las variables que lee
// `createProviders(env)` (TEXT_*, VISION_*, SPEECH_*), de modo que cambiar un proveedor desde Configuración no
// exige reiniciar ni tocar el entorno.

import { all, get, run } from '../db/index.js'

export const MODALITIES = ['text', 'vision', 'speech']
const SLOT_PREFIX = { text: 'TEXT', vision: 'VISION', speech: 'SPEECH' }

/** Sobrescrituras guardadas: { analyzer?, text?, vision?, speech? }. */
export function getProviderOverrides (db) {
  const rows = all(db, "SELECT key, value_json FROM settings WHERE key LIKE 'providers.%'")
  const outText = {}
  for (const f of rows) {
    const lookupKey = f.key.slice('providers.'.length)
    const val = JSON.parse(f.value_json)
    if (lookupKey === 'analyzer') outText.analyzer = val.value
    else if (MODALITIES.includes(lookupKey)) outText[lookupKey] = val
  }
  return outText
}

/** Valores efectivos para mostrar: lo guardado sobre lo que dice el entorno. */
export function getProviderSettings (db, config) {
  const stored = getProviderOverrides(db)
  const effective = { analyzer: stored.analyzer ?? config.providers.analyzer }
  for (const m of MODALITIES) effective[m] = { ...config.providers[m], ...(stored[m] ?? {}) }
  return effective
}

/** Variables de entorno que implican las sobrescrituras guardadas. */
export function providerEnv (overrides) {
  const env = {}
  for (const m of MODALITIES) {
    const o = overrides[m]
    if (!o) continue
    if (o.provider) env[`${SLOT_PREFIX[m]}_PROVIDER`] = o.provider
    if (o.model) env[`${SLOT_PREFIX[m]}_MODEL`] = o.model
    if (o.base_url) env[`${SLOT_PREFIX[m]}_BASE_URL`] = o.base_url
  }
  return env
}

/** Combina un parche con lo guardado (sin escribir). */
export function mergeOverrides (previous, patch) {
  const merged = { ...previous }
  for (const [lookupKey, val] of Object.entries(patch)) {
    merged[lookupKey] = lookupKey === 'analyzer' ? val : { ...(previous[lookupKey] ?? {}), ...val }
  }
  return merged
}

export function setProviderOverrides (db, overrides, now = Date.now) {
  for (const [lookupKey, val] of Object.entries(overrides)) {
    const json = JSON.stringify(lookupKey === 'analyzer' ? { value: val } : val)
    run(db, `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`, `providers.${lookupKey}`, json, now())
  }
}


// ---- Descripción del proyecto (UD-024). Markdown libre que escribe el editor; viaja entera al analizador.
const PROJECT_DESCRIPTION_KEY = 'project_description'

export function getProjectDescription (db) {
  const row = get(db, 'SELECT value_json FROM settings WHERE key = ?', PROJECT_DESCRIPTION_KEY)
  if (!row) return ''
  try { const v = JSON.parse(row.value_json); return typeof v === 'string' ? v : '' } catch { return '' }
}

export function setProjectDescription (db, description, now = Date.now) {
  run(db, `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`, PROJECT_DESCRIPTION_KEY, JSON.stringify(description), now())
}

/** What the analyzer receives (bundle.project): the project name and its description. */
export const getProject = (db, config) => ({ name: config.projectName, description: getProjectDescription(db) })
