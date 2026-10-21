// Provider connections (UD-120, UD-121). A connection is a provider the Editor can give a key to: the fixed ones
// (Anthropic, Groq transcription), the OpenAI-compatible presets (DeepSeek, Groq, OpenRouter, Gemini) and the custom ones
// the Editor adds with a base address. The key is stored sealed (vault.js); the database holds only the sealed text and the
// last four characters. The environment variables remain the value an installation starts with: a stored key wins over
// them, and when none is stored the variable is what serves (`source: 'environment'`).
//
// Nothing here returns, logs or audits a key: `keyFor` is the one function that opens it and its only callers are the
// builders of providers and probes.

import { all, get, run } from '../db/index.js'
import { iso } from '../db/util.js'
import { ANTHROPIC_DEFAULTS, GROQ_SPEECH_DEFAULTS, OPENAI_COMPATIBLE_PRESETS } from '../providers/index.js'
import { getProviderSettings, MODALITIES } from './settings.js'

export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/

/** The connections that always exist, and the presets offered when adding one. */
const FIXED = {
  anthropic: { label: 'Anthropic', kind: 'anthropic', baseUrl: ANTHROPIC_DEFAULTS.baseUrl, envKeys: ['ANTHROPIC_API_KEY'], suggestedModel: ANTHROPIC_DEFAULTS.model },
  'groq-speech': { label: 'Groq (transcripción)', kind: 'groq-speech', baseUrl: GROQ_SPEECH_DEFAULTS.baseUrl, envKeys: ['SPEECH_API_KEY', 'GROQ_API_KEY'], suggestedModel: GROQ_SPEECH_DEFAULTS.model }
}
const PRESET_LABELS = { deepseek: 'DeepSeek', groq: 'Groq', openrouter: 'OpenRouter', gemini: 'Gemini' }
const LEGACY = { 'openai-compatible': { label: 'Compatible con OpenAI', kind: 'openai-compatible', baseUrl: null, envKeys: ['OPENAI_COMPATIBLE_API_KEY'], suggestedModel: null, structured: 'json_schema' } }

function catalog () {
  const entries = { ...FIXED, ...LEGACY }
  for (const [name, preset] of Object.entries(OPENAI_COMPATIBLE_PRESETS)) {
    if (name === 'openai-compatible') continue
    entries[name] = { label: PRESET_LABELS[name] ?? name, kind: 'openai-compatible', baseUrl: preset.baseUrl, envKeys: [preset.keyVar], suggestedModel: preset.model, structured: preset.structured }
  }
  return entries
}

export const PRESET_NAMES = Object.keys(catalog()).filter((n) => !(n in FIXED) && !(n in LEGACY))

/** Presets offered by "add provider": the known OpenAI-compatible ones. A custom provider is the «other» option of the panel. */
export function listPresets () {
  const entries = catalog()
  return PRESET_NAMES.map((name) => ({ name, label: entries[name].label, kind: entries[name].kind, base_url: entries[name].baseUrl, suggested_model: entries[name].suggestedModel, structured: entries[name].structured }))
}

export const isReservedName = (name) => name in catalog()

const rowOf = (db, name) => get(db, 'SELECT * FROM provider_connections WHERE name = ?', name)

/** Value of the environment variable that would serve this connection, or undefined. Used to tell the source, never returned. */
function envKeyOf (env, name, entry) {
  for (const variable of entry.envKeys) if (env[variable]) return env[variable]
  return undefined
}

/** The provider each function effectively uses (what `Configuración` stored over what the environment says). */
export function effectiveProviders (db, config) {
  const settings = getProviderSettings(db, config)
  return {
    text: settings.text.provider || 'anthropic',
    vision: settings.vision.provider || settings.text.provider || 'anthropic', // vision inherits text when it declares nothing
    speech: settings.speech.provider || 'groq-speech'
  }
}

export const usedBy = (db, config, name) => MODALITIES.filter((slot) => effectiveProviders(db, config)[slot] === name)

/** { name → { apiKey, baseUrl, structured, custom } } of the stored keys and custom connections: what `createProviders` receives. */
export function loadConnections (db, vault) {
  const out = {}
  for (const row of all(db, 'SELECT * FROM provider_connections')) {
    let apiKey
    if (row.sealed_value) {
      try { apiKey = vault.open(row.sealed_value, row.name) } catch { apiKey = undefined } // an unreadable key is a missing key: the view says so
    }
    out[row.name] = { apiKey, baseUrl: row.base_url ?? undefined, structured: row.structured ?? undefined, custom: row.custom === 1 }
  }
  return out
}

/** A string that changes whenever a stored connection changes: the cache key of the built providers. */
export const connectionsVersion = (db) => all(db, 'SELECT name, updated_at FROM provider_connections ORDER BY name').map((r) => `${r.name}:${r.updated_at}`).join(',')

/** Which source serves the key of a connection: 'stored', 'environment' or null. */
function keySource (row, env, entry) {
  if (row?.sealed_value) return 'stored'
  return entry && envKeyOf(env, row?.name ?? '', entry) ? 'environment' : null
}

export function connectionView (db, config, env, row, name = row.name, vault = null) {
  const entry = catalog()[name]
  const source = keySource(row, env, entry)
  // A stored key this installation cannot open (another master key, a damaged value) is a failing key, and the view says so.
  let readable = true
  if (source === 'stored' && vault) { try { vault.open(row.sealed_value, name) } catch { readable = false } }
  const failing = row?.check_ok === 0 || !readable
  return {
    name,
    label: row?.label ?? entry?.label ?? name,
    kind: row?.kind ?? entry?.kind,
    custom: row ? row.custom === 1 : false,
    base_url: row?.base_url ?? entry?.baseUrl ?? null,
    structured: row?.structured ?? entry?.structured ?? null,
    status: source === null ? 'no_key' : failing ? 'failing' : 'configured',
    key: { source, last4: source === 'stored' ? row.last4 : null, updated_at: source === 'stored' && row.key_updated_at ? iso(row.key_updated_at) : null, readable },
    used_by: usedBy(db, config, name),
    last_check: row?.check_at ? { at: iso(row.check_at), ok: row.check_ok === 1, cause: row.check_cause ?? null, duration_ms: row.check_ms ?? 0 } : null
  }
}

/**
 * Connections the panel lists: the fixed ones, every stored or custom one, and any preset that has a key in the
 * environment or that a function uses.
 */
export function listConnections (db, config, env, vault = null) {
  const entries = catalog()
  const stored = new Map(all(db, 'SELECT * FROM provider_connections').map((r) => [r.name, r]))
  const names = new Set(Object.keys(FIXED))
  for (const name of stored.keys()) names.add(name)
  const used = effectiveProviders(db, config)
  for (const name of Object.keys(entries)) {
    if (names.has(name)) continue
    if (envKeyOf(env, name, entries[name]) || Object.values(used).includes(name)) names.add(name)
  }
  return [...names].map((name) => connectionView(db, config, env, stored.get(name) ?? { name }, name, vault))
}

export function getConnection (db, config, env, name, vault = null) {
  const row = rowOf(db, name)
  if (!row && !(name in catalog())) return null
  return connectionView(db, config, env, row ?? { name }, name, vault)
}

export const last4Of = (key) => String(key).slice(-4)

/**
 * Creates the row of a connection if it does not exist. Known connections get their label and kind from the
 * catalogue; a custom one brings its own.
 */
function ensureRow (db, name, fields, now) {
  if (rowOf(db, name)) return
  const entry = catalog()[name]
  const t = now()
  run(db, `INSERT INTO provider_connections (name, label, kind, custom, base_url, structured, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    name, fields?.label ?? entry.label, fields?.kind ?? entry.kind, entry ? 0 : 1, fields?.baseUrl ?? null, fields?.structured ?? null, t, t)
}

/** Stores a key (already tested) sealed, with its last four characters, and the result of the test that accepted it. */
export function storeKey (db, vault, name, apiKey, { fields = null, check = null, now = Date.now } = {}) {
  ensureRow(db, name, fields, now)
  const t = now()
  run(db, `UPDATE provider_connections SET sealed_value = ?, last4 = ?, key_updated_at = ?, updated_at = ? WHERE name = ?`, vault.seal(apiKey, name), last4Of(apiKey), t, t, name)
  if (check) recordCheck(db, name, check, now)
}

export function retireKey (db, name, now = Date.now) {
  const t = now()
  run(db, `UPDATE provider_connections SET sealed_value = NULL, last4 = NULL, key_updated_at = NULL, check_at = NULL, check_ok = NULL, check_cause = NULL, check_ms = NULL, updated_at = ? WHERE name = ?`, t, name)
}

export function deleteConnection (db, name) {
  run(db, 'DELETE FROM provider_connections WHERE name = ?', name)
}

/**
 * Records the outcome of a check on the connection (creating no row for a connection that has none). A model the
 * provider does not know says nothing against the key or the address, so it is not recorded as a failure.
 */
export function recordCheck (db, name, check, now = Date.now) {
  if (!rowOf(db, name)) return
  const ok = check.ok || check.cause === 'model_not_found'
  run(db, 'UPDATE provider_connections SET check_at = ?, check_ok = ?, check_cause = ?, check_ms = ?, updated_at = ? WHERE name = ?', now(), ok ? 1 : 0, ok ? null : check.cause, check.duration_ms, now(), name)
}

export const hasRow = (db, name) => Boolean(rowOf(db, name))
export const isCustom = (db, name) => rowOf(db, name)?.custom === 1
export const catalogEntry = (name) => catalog()[name] ?? null
export const envKeyAvailable = (env, name) => { const entry = catalog()[name]; return entry ? envKeyOf(env, name, entry) !== undefined : false }

/** Every sealed value, re-sealed under a new vault: the rotation of the master key (UD-121). Runs inside the caller's transaction. */
export function resealAll (db, from, to) {
  let n = 0
  for (const row of all(db, 'SELECT name, sealed_value FROM provider_connections WHERE sealed_value IS NOT NULL')) {
    run(db, 'UPDATE provider_connections SET sealed_value = ? WHERE name = ?', to.seal(from.open(row.sealed_value, row.name), row.name), row.name)
    n++
  }
  return n
}
