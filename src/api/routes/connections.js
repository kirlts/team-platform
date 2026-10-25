// Provider connections: see, add, replace and retire the API keys, and diagnose (UD-120, UD-121). Any active person (UD-287).
//
// The key is a value in a request body and never anywhere else: it is sealed before it touches the database, it is not in
// any response (only its last four characters), not in an audit record, not in a log line and not in an error. A new key is
// tested with one minimal call before it replaces the old one; if the test fails the old key keeps working and the answer
// says why. Anything the provider answers is reduced to a cause, a status and a duration (providers/probe.js).

import { audit } from '../../domain/audit.js'
import {
  catalogEntry, connectionView, deleteConnection, envKeyAvailable, getConnection, isCustom, isReservedName, listConnections, listPresets, loadConnections, NAME_PATTERN, PRESET_NAMES,
  recordCheck, retireKey, storeKey, usedBy
} from '../../domain/connections.js'
import { conflict, notFound, unprocessable } from '../../domain/errors.js'
import { MODALITIES } from '../../domain/settings.js'

// Bounds of the request fields (UD-120). They refuse an empty or absurd value; they are not a model of any provider.
const KEY_MAX_CHARS = 512 // a real key is 20 to 200 characters (report 11 §6 point 13); four times the longest known
const KEY_MIN_CHARS = 8 // shorter than any real key
const MODEL_MAX_CHARS = 120 // the longest model identifier listed by OpenRouter (report 11 §5), rounded up
const LABEL_MAX_CHARS = 60 // a label fits one line of the provider list
const ADDRESS_MAX_CHARS = 300 // report 11 §5: the longest base address listed (an OpenRouter or Gemini path) has under 100 characters

const CAUSES = ['invalid_key', 'no_quota', 'model_not_found', 'no_network', 'rate_limited', 'timeout', 'bad_address', 'provider_error', 'unknown']
const CAUSE_MESSAGE = {
  invalid_key: 'El proveedor rechazó la clave.',
  no_quota: 'La cuenta del proveedor no tiene cuota disponible.',
  model_not_found: 'El proveedor no tiene ese modelo.',
  no_network: 'No hubo conexión con el proveedor.',
  rate_limited: 'El proveedor limitó la tasa de llamadas.',
  timeout: 'El proveedor no respondió a tiempo.',
  bad_address: 'La dirección del proveedor no existe.',
  provider_error: 'El proveedor devolvió un error propio.',
  unknown: 'La prueba falló por una causa no clasificada.'
}

const checkSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' }, cause: { type: ['string', 'null'], enum: [...CAUSES, null] }, status: { type: ['integer', 'null'] }, duration_ms: { type: 'integer' },
    model: { type: ['string', 'null'] }, models: { type: ['array', 'null'], items: { type: 'string' } }, model_listed: { type: ['boolean', 'null'] }, checked_at: { type: 'string' }
  }
}
const connectionSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' }, label: { type: 'string' }, kind: { type: 'string', enum: ['anthropic', 'openai-compatible', 'groq-speech'] }, custom: { type: 'boolean' },
    base_url: { type: ['string', 'null'] }, structured: { type: ['string', 'null'] }, status: { type: 'string', enum: ['no_key', 'configured', 'failing'] },
    key: { type: 'object', properties: { source: { type: ['string', 'null'] }, last4: { type: ['string', 'null'] }, updated_at: { type: ['string', 'null'] }, readable: { type: 'boolean' } } },
    used_by: { type: 'array', items: { type: 'string', enum: MODALITIES } },
    last_check: { type: ['object', 'null'], properties: { at: { type: 'string' }, ok: { type: 'boolean' }, cause: { type: ['string', 'null'] }, duration_ms: { type: 'integer' } } }
  }
}
const presetSchema = { type: 'object', properties: { name: { type: 'string' }, label: { type: 'string' }, kind: { type: 'string' }, base_url: { type: ['string', 'null'] }, suggested_model: { type: ['string', 'null'] }, structured: { type: ['string', 'null'] } } }
const nameParams = { type: 'object', required: ['name'], properties: { name: { type: 'string', pattern: NAME_PATTERN.source } } }

/** The address of a provider: https, or http only toward this machine (a local server). */
function validAddress (text) {
  let url
  try { url = new URL(text) } catch { return false }
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}

export function registerConnectionRoutes (app, ctx) {
  const { db, config, requireRole, modules } = ctx
  const env = modules.env ?? process.env
  const vault = modules.vault
  const person = [requireRole('person')]
  const timeoutMs = config.providers.probe.timeoutMs

  const view = (name) => connectionView(db, config, env, db.prepare('SELECT * FROM provider_connections WHERE name = ?').get(name) ?? { name }, name, vault)

  /** The key that serves a connection: the stored one, opened, or the environment's. Undefined if there is none. */
  function currentKey (name) {
    const stored = loadConnections(db, vault)[name]?.apiKey
    if (stored) return stored
    const entry = catalogEntry(name)
    for (const variable of entry?.envKeys ?? []) if (env[variable]) return env[variable]
    return undefined
  }

  /** The model a connection is tested with when the request does not say: the one a function using it already has, else its suggestion. */
  function modelFor (name, requested) {
    if (requested) return requested
    for (const slot of usedBy(db, config, name)) {
      const model = modules.slotPlan?.(slot)?.model
      if (model) return model
    }
    return catalogEntry(name)?.suggestedModel ?? null
  }

  const runProbe = ({ kind, apiKey, baseUrl, model }) => {
    if (!modules.probe) throw unprocessable('No hay módulo de proveedores para probar la conexión.', 'provider_invalid')
    return modules.probe({ kind, apiKey, baseUrl: baseUrl ?? undefined, model: model ?? undefined, timeoutMs })
  }

  const failed = (check) => unprocessable(CAUSE_MESSAGE[check.cause] ?? CAUSE_MESSAGE.unknown, 'provider_check_failed', { cause: check.cause ?? 'unknown', status_code: check.status ?? undefined, duration_ms: check.duration_ms })

  const bodyKey = { type: 'string', minLength: KEY_MIN_CHARS, maxLength: KEY_MAX_CHARS } // a real key is 20 to 200 characters; the bounds only refuse an empty or absurd value

  app.get('/settings/connections', {
    onRequest: person,
    schema: { summary: 'Proveedores conectados, sin sus claves', description: 'Cada conexión con su estado (`no_key`, `configured`, `failing`), el origen de la clave (`stored` o `environment`), sus últimos 4 caracteres y las funciones que la usan. Las claves no salen nunca por la API.', response: { 200: { type: 'object', properties: { items: { type: 'array', items: connectionSchema }, presets: { type: 'array', items: presetSchema } } } } }
  }, async () => ({ items: listConnections(db, config, env, vault), presets: listPresets() }))

  app.post('/settings/connections', {
    onRequest: person,
    schema: {
      summary: 'Agregar un proveedor compatible con OpenAI',
      description: 'Un preajuste (`preset`) o uno propio (`name` y `base_url`). La clave se prueba antes de guardarse; si la prueba falla no se guarda nada (422 `provider_check_failed`).',
      body: { type: 'object', required: ['api_key'], additionalProperties: false, properties: { preset: { type: 'string' }, name: { type: 'string' }, label: { type: 'string', maxLength: LABEL_MAX_CHARS }, base_url: { type: 'string', maxLength: ADDRESS_MAX_CHARS }, structured: { type: 'string', enum: ['json_schema', 'tool', 'json_object'] }, api_key: bodyKey, model: { type: 'string', maxLength: MODEL_MAX_CHARS } } },
      response: { 201: { type: 'object', properties: { connection: connectionSchema, check: checkSchema } } }
    }
  }, async (request, reply) => {
    const { preset, label, structured, api_key: apiKey, model } = request.body
    let name = preset
    let fields = null
    if (preset) {
      if (!PRESET_NAMES.includes(preset)) throw unprocessable('Ese preajuste no existe.', 'provider_invalid')
    } else {
      name = request.body.name
      if (!name || !NAME_PATTERN.test(name) || isReservedName(name)) throw unprocessable('El nombre debe tener de 2 a 40 letras minúsculas, números o guiones, y no ser el de un proveedor conocido.', 'provider_invalid')
      if (!request.body.base_url || !validAddress(request.body.base_url)) throw unprocessable('La dirección debe ser https, o http hacia esta misma máquina.', 'provider_invalid')
      fields = { label: label || name, kind: 'openai-compatible', baseUrl: request.body.base_url.replace(/\/+$/, ''), structured: structured ?? 'json_schema' }
    }
    const existing = db.prepare('SELECT sealed_value FROM provider_connections WHERE name = ?').get(name)
    if (existing && (preset ? existing.sealed_value : true)) throw conflict(preset ? 'Ese proveedor ya tiene una clave; se reemplaza desde su fila.' : 'Ya existe un proveedor con ese nombre.', 'connection_exists')
    const entry = catalogEntry(name)
    const check = await runProbe({ kind: entry?.kind ?? fields.kind, apiKey, baseUrl: fields?.baseUrl ?? entry?.baseUrl, model: model ?? entry?.suggestedModel })
    if (!check.ok) throw failed(check)
    storeKey(db, vault, name, apiKey, { fields: fields ?? (label ? { label } : null), check })
    audit(db, { memberId: request.member.id, action: 'settings.connection.add', entity: 'connection', entityId: name, detail: { provider: name, custom: !preset } })
    return reply.code(201).send({ connection: view(name), check })
  })

  app.put('/settings/connections/:name/key', {
    onRequest: person,
    schema: {
      summary: 'Reemplazar la clave de un proveedor, con prueba previa',
      description: 'La clave nueva se prueba con una llamada mínima. Sólo si funciona reemplaza a la anterior; si falla, la anterior sigue activa y la respuesta es 422 `provider_check_failed` con la causa.',
      params: nameParams,
      body: { type: 'object', required: ['api_key'], additionalProperties: false, properties: { api_key: bodyKey, model: { type: 'string', maxLength: MODEL_MAX_CHARS } } },
      response: { 200: { type: 'object', properties: { connection: connectionSchema, check: checkSchema } } }
    }
  }, async (request) => {
    const { name } = request.params
    if (!getConnection(db, config, env, name, vault)) throw notFound('No existe ese proveedor.')
    const entry = catalogEntry(name)
    const row = db.prepare('SELECT * FROM provider_connections WHERE name = ?').get(name)
    const check = await runProbe({ kind: row?.kind ?? entry.kind, apiKey: request.body.api_key, baseUrl: row?.base_url ?? entry?.baseUrl, model: modelFor(name, request.body.model) })
    if (!check.ok) throw failed(check)
    storeKey(db, vault, name, request.body.api_key, { check })
    audit(db, { memberId: request.member.id, action: 'settings.connection.key_replace', entity: 'connection', entityId: name, detail: { provider: name, used_by: usedBy(db, config, name) } })
    return { connection: view(name), check }
  })

  app.delete('/settings/connections/:name/key', {
    onRequest: person,
    schema: {
      summary: 'Retirar la clave guardada de un proveedor',
      description: 'Bloqueado (409 `provider_in_use`, con `used_by`) si una función depende de esa clave y el entorno no tiene otra. Una clave que viene del entorno del servidor no se retira desde aquí (409 `key_from_environment`).',
      params: nameParams,
      response: { 200: { type: 'object', properties: { connection: connectionSchema } } }
    }
  }, async (request) => {
    const { name } = request.params
    if (!getConnection(db, config, env, name, vault)) throw notFound('No existe ese proveedor.')
    const stored = db.prepare('SELECT sealed_value FROM provider_connections WHERE name = ?').get(name)?.sealed_value
    if (!stored) throw conflict('La clave de este proveedor viene del entorno del servidor; se retira quitando su variable.', 'key_from_environment')
    const users = usedBy(db, config, name)
    if (users.length && !envKeyAvailable(env, name)) {
      throw conflict(`Las funciones ${users.join(', ')} usan este proveedor; hay que cambiarlas antes de retirar la clave.`, 'provider_in_use', { used_by: users })
    }
    retireKey(db, name)
    audit(db, { memberId: request.member.id, action: 'settings.connection.key_retire', entity: 'connection', entityId: name, detail: { provider: name } })
    return { connection: view(name) }
  })

  app.delete('/settings/connections/:name', {
    onRequest: person,
    schema: {
      summary: 'Eliminar un proveedor propio',
      description: 'Sólo los proveedores agregados por el equipo. 409 `provider_in_use` si una función lo usa.',
      params: nameParams,
      response: { 200: { type: 'object', properties: { deleted: { type: 'boolean' } } } }
    }
  }, async (request) => {
    const { name } = request.params
    if (!isCustom(db, name)) throw notFound('No existe un proveedor propio con ese nombre.')
    const users = usedBy(db, config, name)
    if (users.length) throw conflict(`Las funciones ${users.join(', ')} usan este proveedor; hay que cambiarlas antes de eliminarlo.`, 'provider_in_use', { used_by: users })
    deleteConnection(db, name)
    audit(db, { memberId: request.member.id, action: 'settings.connection.delete', entity: 'connection', entityId: name, detail: { provider: name } })
    return { deleted: true }
  })

  app.post('/settings/connections/:name/check', {
    onRequest: person,
    schema: {
      summary: 'Diagnosticar un proveedor',
      description: 'Una llamada mínima con la clave vigente. Responde 200 aunque la prueba falle: `ok`, `cause`, `status`, `duration_ms` y, si el proveedor la ofrece, la lista de modelos. Guarda el resultado como último diagnóstico.',
      params: nameParams,
      body: { type: 'object', additionalProperties: false, properties: { model: { type: 'string', maxLength: MODEL_MAX_CHARS } } },
      response: { 200: { type: 'object', properties: { check: checkSchema } } }
    }
  }, async (request) => {
    const { name } = request.params
    if (!getConnection(db, config, env, name, vault)) throw notFound('No existe ese proveedor.')
    const apiKey = currentKey(name)
    if (!apiKey) throw unprocessable('Este proveedor no tiene clave.', 'provider_no_key', { provider: name })
    const entry = catalogEntry(name)
    const row = db.prepare('SELECT * FROM provider_connections WHERE name = ?').get(name)
    const check = await runProbe({ kind: row?.kind ?? entry.kind, apiKey, baseUrl: row?.base_url ?? entry?.baseUrl, model: modelFor(name, request.body?.model) })
    recordCheck(db, name, check)
    return { check }
  })

  app.post('/settings/providers/:slot/check', {
    onRequest: person,
    schema: {
      summary: 'Diagnosticar una función',
      description: 'La llamada mínima va al proveedor y al modelo que la función usa hoy. Responde 200 con el resultado aunque falle.',
      params: { type: 'object', required: ['slot'], properties: { slot: { type: 'string', enum: MODALITIES } } },
      response: { 200: { type: 'object', properties: { check: checkSchema, slot: { type: 'string' }, provider: { type: 'string' }, model: { type: ['string', 'null'] } } } }
    }
  }, async (request) => {
    const { slot } = request.params
    const plan = modules.slotPlan?.(slot)
    if (!plan) throw unprocessable('No hay módulo de proveedores para diagnosticar.', 'provider_invalid')
    if (!plan.apiKey) throw unprocessable('Este proveedor no tiene clave.', 'provider_no_key', { provider: plan.provider })
    const check = await runProbe(plan)
    recordCheck(db, plan.provider, check)
    return { check, slot, provider: plan.provider, model: plan.model }
  })
}

/** Probes a function under the overrides a change would leave: the test that runs before PATCH /settings/providers saves. */
export async function probeSlotChange ({ db, config, modules }, slot, overrides) {
  if (!modules.probe || !modules.slotPlan) return null // without a providers module there is nothing to test
  const plan = modules.slotPlan(slot, overrides)
  if (!plan) return null
  if (!plan.apiKey) throw unprocessable('Este proveedor no tiene clave.', 'provider_no_key', { provider: plan.provider })
  const check = await modules.probe({ ...plan, baseUrl: plan.baseUrl ?? undefined, model: plan.model ?? undefined, timeoutMs: config.providers.probe.timeoutMs })
  recordCheck(db, plan.provider, check)
  if (!check.ok) {
    throw unprocessable(CAUSE_MESSAGE[check.cause] ?? CAUSE_MESSAGE.unknown, 'provider_check_failed', { cause: check.cause ?? 'unknown', status_code: check.status ?? undefined, duration_ms: check.duration_ms })
  }
  return { plan, check }
}
