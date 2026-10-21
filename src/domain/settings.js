// Provider settings (MASTER-SPEC §7.6). The database stores only the provider name, the model and the
// base URL; keys live in the environment and never pass through here (MASTER-SPEC §4.6).
//
// What is stored acts as an override of the environment: `providerEnv()` translates it to the variables read by
// `createProviders(env)` (TEXT_*, VISION_*, SPEECH_*), so changing a provider from `Configuración` does not
// require restarting or touching the environment.

import { all, get, run } from '../db/index.js'

export const MODALITIES = ['text', 'vision', 'speech']
const SLOT_PREFIX = { text: 'TEXT', vision: 'VISION', speech: 'SPEECH' }

/** Stored overrides: { analyzer?, text?, vision?, speech? }. */
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

/** Effective values to display: what is stored over what the environment says. */
export function getProviderSettings (db, config) {
  const stored = getProviderOverrides(db)
  const effective = { analyzer: stored.analyzer ?? config.providers.analyzer }
  for (const m of MODALITIES) effective[m] = { ...config.providers[m], ...(stored[m] ?? {}) }
  return effective
}

/** Environment variables implied by the stored overrides. */
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

/** Merges a patch with what is stored (without writing). */
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


// ---- Project description (UD-024). Free Markdown written by the editor; it travels whole to the analyzer.
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

// ---- Publication mode (UD-070). `auto_publish` is the knob that returns to the review that preceded UD-070: on (the
// default), a valid proposal is published as soon as the analysis ends; off, it waits as `proposed` for its sender
// to confirm it with POST /inputs/:id/publish. The default is the owner's decision, not a measurement (UD-070).
const AUTO_PUBLISH_KEY = 'auto_publish'
export const AUTO_PUBLISH_DEFAULT = true

export function getAutoPublish (db) {
  const row = get(db, 'SELECT value_json FROM settings WHERE key = ?', AUTO_PUBLISH_KEY)
  if (!row) return AUTO_PUBLISH_DEFAULT
  try { const v = JSON.parse(row.value_json); return typeof v === 'boolean' ? v : AUTO_PUBLISH_DEFAULT } catch { return AUTO_PUBLISH_DEFAULT }
}

export function setAutoPublish (db, value, now = Date.now) {
  run(db, `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`, AUTO_PUBLISH_KEY, JSON.stringify(value), now())
}
