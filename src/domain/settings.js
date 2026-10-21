// Configuración de proveedores (MASTER-SPEC §7.6). La base guarda sólo el nombre del proveedor y el modelo;
// las llaves viven en el entorno y nunca pasan por acá (MASTER-SPEC §4.6).

import { all, get, run } from '../db/index.js'

export const MODALITIES = ['text', 'vision', 'speech']

/** Valores efectivos: los de la base sobre los del entorno. */
export function getProviderSettings (db, config) {
  const filas = Object.fromEntries(all(db, "SELECT key, value_json FROM settings WHERE key LIKE 'providers.%'").map((f) => [f.key, JSON.parse(f.value_json)]))
  const efectivo = { analyzer: filas['providers.analyzer']?.value ?? config.providers.analyzer }
  for (const m of MODALITIES) efectivo[m] = { ...config.providers[m], ...(filas[`providers.${m}`] ?? {}) }
  return efectivo
}

export function setProviderSettings (db, patch, now = Date.now) {
  for (const [clave, valor] of Object.entries(patch)) {
    if (clave === 'analyzer') {
      run(db, `INSERT INTO settings (key, value_json, updated_at) VALUES ('providers.analyzer', ?, ?)
               ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`, JSON.stringify({ value: valor }), now())
    } else if (MODALITIES.includes(clave)) {
      const previo = get(db, 'SELECT value_json FROM settings WHERE key = ?', `providers.${clave}`)
      const unido = { ...(previo ? JSON.parse(previo.value_json) : {}), ...valor }
      run(db, `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`, `providers.${clave}`, JSON.stringify(unido), now())
    }
  }
}
