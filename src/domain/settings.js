// Provider settings (MASTER-SPEC §7.6). The database stores only the provider name, the model and the
// base URL; keys live in the environment and never pass through here (MASTER-SPEC §4.6).
//
// What is stored acts as an override of the environment: `providerEnv()` translates it to the variables read by
// `createProviders(env)` (TEXT_*, VISION_*, SPEECH_*), so changing a provider from `Configuración` does not
// require restarting or touching the environment.

import { all, get, run } from '../db/index.js'
import { defaultFraming } from '../analyze/prompts.js'
import { LANGUAGES } from './language.js'

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

const readSetting = (db, key) => {
  const row = get(db, 'SELECT value_json FROM settings WHERE key = ?', key)
  if (!row) return undefined
  try { return JSON.parse(row.value_json) } catch { return undefined }
}
const writeSetting = (db, key, value, now = Date.now) => run(db, `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`, key, JSON.stringify(value), now())

// ---- Project name (H-3722). Written by the Editor in Configuración; without a stored one, PROJECT_NAME is the name.
const PROJECT_NAME_KEY = 'project_name'

export function getProjectName (db, config) {
  const v = readSetting(db, PROJECT_NAME_KEY)
  return typeof v === 'string' && v.trim() ? v : config.projectName
}

/** An empty name goes back to the environment's. */
export function setProjectName (db, name, now = Date.now) {
  const v = String(name ?? '').trim()
  if (!v) run(db, 'DELETE FROM settings WHERE key = ?', PROJECT_NAME_KEY)
  else writeSetting(db, PROJECT_NAME_KEY, v, now)
}

/** What the analyzer receives (bundle.project): the project name and its description. */
export const getProject = (db, config) => ({ name: getProjectName(db, config), description: getProjectDescription(db) })

// ---- Analysis framing (H-3722). The paragraph that opens every system prompt of the analyzer: who the inbox belongs to
// and what an input tends to carry. One text per language, because each prompt set is written natively in its language
// and the account language changes the whole prompt (UD-018); a framing in another language would be the only foreign
// paragraph of the prompt. A language without a stored text uses the default of its set.
const FRAMING_KEY = 'analysis.framing'

function storedFraming (db) {
  const v = readSetting(db, FRAMING_KEY)
  return v && typeof v === 'object' ? v : {}
}

/** The framing the analyzer receives for a language: the stored text, or the default of the set. */
export function getFraming (db, language) {
  const v = storedFraming(db)[language]
  return typeof v === 'string' && v.trim() ? v : defaultFraming(language)
}

/** Per language: the text in force, the default and whether the Editor changed it. */
export function getFramingView (db) {
  const stored = storedFraming(db)
  return Object.fromEntries(LANGUAGES.map((lang) => {
    const own = typeof stored[lang] === 'string' && stored[lang].trim() ? stored[lang] : null
    return [lang, { value: own ?? defaultFraming(lang), default: defaultFraming(lang), custom: own !== null }]
  }))
}

/** Patch `{ language: text }`. An empty text, or the default itself, goes back to the default. */
export function setFraming (db, patch, now = Date.now) {
  const next = { ...storedFraming(db) }
  for (const [lang, text] of Object.entries(patch)) {
    const v = String(text ?? '').trim()
    if (!v || v === defaultFraming(lang)) delete next[lang]
    else next[lang] = v
  }
  writeSetting(db, FRAMING_KEY, next, now)
}

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

// ---- Interface telemetry (UD-091). One switch, written by the Editor; without a stored value the configuration decides.
const UI_TELEMETRY_KEY = 'telemetry.ui_enabled'

export function getUiTelemetryEnabled (db, config) {
  const row = get(db, 'SELECT value_json FROM settings WHERE key = ?', UI_TELEMETRY_KEY)
  if (!row) return config.uiTelemetry.enabledDefault
  try { const v = JSON.parse(row.value_json); return typeof v === 'boolean' ? v : config.uiTelemetry.enabledDefault } catch { return config.uiTelemetry.enabledDefault }
}

export function setUiTelemetryEnabled (db, enabled, now = Date.now) {
  run(db, `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`, UI_TELEMETRY_KEY, JSON.stringify(Boolean(enabled)), now())
}
