// API of the provider connections (UD-120, UD-121): list, add, replace, retire, delete, diagnose and the test that runs
// before a function changes provider. Every call to a provider goes to the fake upstream (src/testing/connections-env.js).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { hasRow, storeKey } from '../domain/connections.js'
import { loadModules } from '../domain/modules.js'
import { createVault, generateMasterKey, keyId } from '../domain/vault.js'
import { connectionsEnv } from '../testing/connections-env.js'

const OK_ANTHROPIC = 'sk-ant-good-key-1111'
const OK_DEEPSEEK = 'sk-ds-good-key-2222'
const OK_CUSTOM = 'sk-custom-good-key-3333'
const BAD_KEY = 'sk-bad-fail-invalid_key-0000'

const connectionOf = (response, name) => response.json().items.find((c) => c.name === name)
const rowOf = (env, name) => get(env.db, 'SELECT * FROM provider_connections WHERE name = ?', name)
const auditRows = (env) => all(env.db, "SELECT * FROM audit_log WHERE action LIKE 'settings.connection.%' OR action = 'settings.providers' ORDER BY id")
const addCustom = (env, extra = {}) => env.ed('POST', '/settings/connections', { name: 'mi-proveedor', base_url: 'https://llm.example.test/v1', api_key: OK_CUSTOM, label: 'Mi proveedor', model: 'fake-model-a', ...extra })

test('every route of the connections is closed to anonymous users (401) and to Members (403)', async () => {
  const env = await connectionsEnv()
  try {
    const routes = [
      ['GET', '/settings/connections'],
      ['POST', '/settings/connections', { preset: 'deepseek', api_key: OK_DEEPSEEK }],
      ['PUT', '/settings/connections/anthropic/key', { api_key: OK_ANTHROPIC }],
      ['DELETE', '/settings/connections/anthropic/key'],
      ['DELETE', '/settings/connections/mi-proveedor'],
      ['POST', '/settings/connections/anthropic/check', {}],
      ['POST', '/settings/providers/text/check', {}],
      ['GET', '/settings/providers'],
      ['PATCH', '/settings/providers', { slot: 'text', provider: 'anthropic', model: 'm' }]
    ]
    for (const [method, url, payload] of routes) {
      assert.equal((await env.api(method, url, null, payload)).statusCode, 401, `${method} ${url} anonymous`)
      assert.equal((await env.api(method, url, env.c.ana, payload)).statusCode, 403, `${method} ${url} member`)
    }
    assert.equal(all(env.db, 'SELECT * FROM provider_connections').length, 0)
    assert.equal(env.upstream.seen.length, 0)
  } finally { await env.close() }
})

test('the list starts with the fixed connections without a key, and the presets offered', async () => {
  const env = await connectionsEnv()
  try {
    const r = await env.ed('GET', '/settings/connections')
    assert.equal(r.statusCode, 200)
    const { items, presets } = r.json()
    assert.deepEqual(items.map((c) => c.name).sort(), ['anthropic', 'groq-speech'])
    const anthropic = items.find((c) => c.name === 'anthropic')
    assert.equal(anthropic.status, 'no_key')
    assert.deepEqual(anthropic.key, { source: null, last4: null, updated_at: null, readable: true })
    assert.deepEqual(anthropic.used_by, ['text', 'vision'])
    assert.equal(anthropic.last_check, null)
    assert.deepEqual(items.find((c) => c.name === 'groq-speech').used_by, ['speech'])
    assert.deepEqual(presets.map((p) => p.name).sort(), ['deepseek', 'gemini', 'groq', 'openrouter'])
    assert.ok(presets.every((p) => p.base_url && p.kind === 'openai-compatible'))
  } finally { await env.close() }
})

test('a key from the environment shows as configured with source environment, no last four, and is never returned', async () => {
  const env = await connectionsEnv({ envVars: { ANTHROPIC_API_KEY: OK_ANTHROPIC, DEEPSEEK_API_KEY: OK_DEEPSEEK } })
  try {
    const r = await env.ed('GET', '/settings/connections')
    const anthropic = connectionOf(r, 'anthropic')
    assert.equal(anthropic.status, 'configured')
    assert.equal(anthropic.key.source, 'environment')
    assert.equal(anthropic.key.last4, null)
    assert.equal(connectionOf(r, 'groq-speech').status, 'no_key')
    const deepseek = connectionOf(r, 'deepseek') // a preset with a key in the environment is listed without being added
    assert.equal(deepseek.key.source, 'environment')
    assert.deepEqual(deepseek.used_by, [])
    assert.ok(!r.body.includes(OK_ANTHROPIC) && !r.body.includes(OK_DEEPSEEK))
  } finally { await env.close() }
})

test('a stored key shows its last four, the time it was set and the functions that use it', async () => {
  const env = await connectionsEnv()
  try {
    const put = await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: OK_ANTHROPIC })
    assert.equal(put.statusCode, 200)
    const anthropic = connectionOf(await env.ed('GET', '/settings/connections'), 'anthropic')
    assert.equal(anthropic.status, 'configured')
    assert.equal(anthropic.key.source, 'stored')
    assert.equal(anthropic.key.last4, '1111')
    assert.ok(!Number.isNaN(Date.parse(anthropic.key.updated_at)))
    assert.deepEqual(anthropic.used_by, ['text', 'vision'])
    assert.equal(anthropic.last_check.ok, true)
    assert.equal(anthropic.last_check.cause, null)
  } finally { await env.close() }
})

test('a key that stopped working shows as failing with the cause of the last diagnosis', async () => {
  const env = await connectionsEnv()
  try {
    await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: OK_ANTHROPIC })
    env.upstream.revoked.add(OK_ANTHROPIC)
    const check = await env.ed('POST', '/settings/connections/anthropic/check', {})
    assert.equal(check.statusCode, 200) // a failed diagnosis is an answer, not an error
    assert.equal(check.json().check.ok, false)
    assert.equal(check.json().check.cause, 'invalid_key')
    const anthropic = connectionOf(await env.ed('GET', '/settings/connections'), 'anthropic')
    assert.equal(anthropic.status, 'failing')
    assert.equal(anthropic.last_check.ok, false)
    assert.equal(anthropic.last_check.cause, 'invalid_key')
    assert.equal(anthropic.key.last4, '1111') // the key is still there
  } finally { await env.close() }
})

test('a stored key sealed by another master key shows as unreadable and failing, and the environment key serves meanwhile', async () => {
  const env = await connectionsEnv({ envVars: { ANTHROPIC_API_KEY: OK_ANTHROPIC } })
  try {
    const stranger = createVault({ key: generateMasterKey(), id: 'ffffffff', source: 'test' })
    storeKey(env.db, stranger, 'anthropic', 'sk-ant-old-master-9999')
    const anthropic = connectionOf(await env.ed('GET', '/settings/connections'), 'anthropic')
    assert.equal(anthropic.key.readable, false)
    assert.equal(anthropic.status, 'failing')
    assert.equal(env.plan('text').apiKey, OK_ANTHROPIC)
  } finally { await env.close() }
})

test('add a preset: tested first, then stored sealed with its last four, and audited', async () => {
  const env = await connectionsEnv()
  try {
    const r = await env.ed('POST', '/settings/connections', { preset: 'deepseek', api_key: OK_DEEPSEEK })
    assert.equal(r.statusCode, 201, r.body)
    const { connection, check } = r.json()
    assert.equal(connection.name, 'deepseek')
    assert.equal(connection.label, 'DeepSeek')
    assert.equal(connection.custom, false)
    assert.equal(connection.status, 'configured')
    assert.equal(connection.key.last4, '2222')
    assert.equal(check.ok, true)
    assert.ok(Array.isArray(check.models))
    assert.deepEqual(env.upstream.seen.map((q) => q.key), [OK_DEEPSEEK, OK_DEEPSEEK]) // one call and the model list
    const row = rowOf(env, 'deepseek')
    assert.ok(row.sealed_value.startsWith('v1:'))
    assert.ok(!row.sealed_value.includes(OK_DEEPSEEK))
    assert.equal(env.connectionsNow().deepseek.apiKey, OK_DEEPSEEK)
  } finally { await env.close() }
})

test('add a preset: unknown preset 422, already with a key 409 connection_exists, bad body 400', async () => {
  const env = await connectionsEnv()
  try {
    const unknown = await env.ed('POST', '/settings/connections', { preset: 'nope', api_key: OK_DEEPSEEK })
    assert.equal(unknown.statusCode, 422)
    assert.equal(unknown.json().code, 'provider_invalid')
    assert.equal((await env.ed('POST', '/settings/connections', { preset: 'deepseek', api_key: OK_DEEPSEEK })).statusCode, 201)
    const again = await env.ed('POST', '/settings/connections', { preset: 'deepseek', api_key: 'sk-ds-other-key-4444' })
    assert.equal(again.statusCode, 409)
    assert.equal(again.json().code, 'connection_exists')
    assert.equal(env.connectionsNow().deepseek.apiKey, OK_DEEPSEEK)
    for (const body of [{ preset: 'deepseek' }, { preset: 'gemini', api_key: 'short' }, { preset: 'gemini', api_key: 'x'.repeat(513) }, { preset: 'gemini', api_key: OK_DEEPSEEK, extra: 1 }, { preset: 'gemini', api_key: { value: OK_DEEPSEEK } }]) {
      const bad = await env.ed('POST', '/settings/connections', body)
      assert.equal(bad.statusCode, 400, JSON.stringify(body))
      assert.equal(bad.json().code, 'validation')
    }
  } finally { await env.close() }
})

test('add a custom provider: name, address and kind are stored, the test goes to its own address', async () => {
  const env = await connectionsEnv()
  try {
    const r = await addCustom(env, { base_url: 'https://llm.example.test/v1///', structured: 'json_object' })
    assert.equal(r.statusCode, 201, r.body)
    const { connection } = r.json()
    assert.equal(connection.name, 'mi-proveedor')
    assert.equal(connection.label, 'Mi proveedor')
    assert.equal(connection.custom, true)
    assert.equal(connection.kind, 'openai-compatible')
    assert.equal(connection.base_url, 'https://llm.example.test/v1')
    assert.equal(connection.structured, 'json_object')
    assert.equal(connection.key.last4, '3333')
    assert.ok(env.upstream.seen.every((q) => q.url.startsWith('https://llm.example.test/v1/')))
    assert.equal(connectionOf(await env.ed('GET', '/settings/connections'), 'mi-proveedor').custom, true)
  } finally { await env.close() }
})

test('add a custom provider: the label defaults to the name and a missing model still tests the key', async () => {
  const env = await connectionsEnv()
  try {
    const r = await addCustom(env, { label: undefined, model: undefined })
    assert.equal(r.statusCode, 201, r.body)
    assert.equal(r.json().connection.label, 'mi-proveedor')
    assert.equal(r.json().check.model, null)
    assert.equal(r.json().check.ok, true)
  } finally { await env.close() }
})

test('add a custom provider: invalid names, reserved names and bad addresses are refused with 422 and store nothing', async () => {
  const env = await connectionsEnv()
  try {
    const names = ['', 'a', 'UPPER', 'con espacio', 'con_guion', '-inicio', 'a'.repeat(41), 'ñandú']
    for (const name of names) {
      const r = await addCustom(env, { name })
      assert.equal(r.statusCode, 422, `name «${name}»`)
      assert.equal(r.json().code, 'provider_invalid')
    }
    const missingName = await env.ed('POST', '/settings/connections', { base_url: 'https://llm.example.test/v1', api_key: OK_CUSTOM })
    assert.equal(missingName.statusCode, 422)
    for (const name of ['anthropic', 'groq-speech', 'deepseek', 'groq', 'openrouter', 'gemini', 'openai-compatible']) {
      const r = await addCustom(env, { name })
      assert.equal(r.statusCode, 422, `reserved ${name}`)
      assert.equal(r.json().code, 'provider_invalid')
    }
    for (const base_url of ['http://example.com/v1', 'ftp://example.com/v1', 'not an address', 'javascript:alert(1)', 'https://', 'file:///etc/passwd']) {
      const r = await addCustom(env, { base_url })
      assert.equal(r.statusCode, 422, base_url)
      assert.equal(r.json().code, 'provider_invalid')
    }
    const noAddress = await env.ed('POST', '/settings/connections', { name: 'sin-direccion', api_key: OK_CUSTOM })
    assert.equal(noAddress.statusCode, 422)
    assert.equal(all(env.db, 'SELECT * FROM provider_connections').length, 0)
    assert.equal(env.upstream.seen.length, 0) // nothing was tested: the refusal comes first
  } finally { await env.close() }
})

test('add a custom provider: https and http toward this machine are accepted', async () => {
  const env = await connectionsEnv()
  try {
    const addresses = { 'uno-https': 'https://llm.example.test/v1', 'dos-local': 'http://localhost:11434/v1', 'tres-loop': 'http://127.0.0.1:8080/v1', 'cuatro-v6': 'http://[::1]:8080/v1' }
    for (const [name, base_url] of Object.entries(addresses)) {
      const r = await addCustom(env, { name, base_url })
      assert.equal(r.statusCode, 201, `${name} ${r.body}`)
    }
  } finally { await env.close() }
})

test('add a custom provider: a duplicate name is 409 connection_exists and keeps the first key', async () => {
  const env = await connectionsEnv()
  try {
    assert.equal((await addCustom(env)).statusCode, 201)
    const again = await addCustom(env, { api_key: 'sk-custom-second-key-5555' })
    assert.equal(again.statusCode, 409)
    assert.equal(again.json().code, 'connection_exists')
    assert.equal(env.connectionsNow()['mi-proveedor'].apiKey, OK_CUSTOM)
  } finally { await env.close() }
})

test('a failed test saves nothing: 422 provider_check_failed with the cause, for each cause', async () => {
  const env = await connectionsEnv()
  try {
    const causes = ['invalid_key', 'no_quota', 'rate_limited', 'provider_error', 'bad_address', 'no_network']
    for (const cause of causes) {
      const r = await env.ed('POST', '/settings/connections', { preset: 'openrouter', api_key: `sk-bad-fail-${cause}-0000` })
      assert.equal(r.statusCode, 422, cause)
      assert.equal(r.json().code, 'provider_check_failed')
      assert.equal(r.json().cause, cause)
      assert.match(r.json().message, /^[A-ZÁÉÍÓÚ]/) // Spanish message of the cause
      assert.equal(hasRow(env.db, 'openrouter'), false, cause)
    }
    const custom = await addCustom(env, { api_key: BAD_KEY })
    assert.equal(custom.statusCode, 422)
    assert.equal(custom.json().cause, 'invalid_key')
    assert.equal(hasRow(env.db, 'mi-proveedor'), false)
    const missing = await addCustom(env, { model: 'missing-model' })
    assert.equal(missing.json().cause, 'model_not_found')
    assert.equal(hasRow(env.db, 'mi-proveedor'), false)
    assert.equal(auditRows(env).length, 0)
  } finally { await env.close() }
})

test('a test that times out answers 422 with cause timeout and does not hang', async () => {
  const env = await connectionsEnv({ config: { providers: { probe: { timeoutMs: 40 } } } })
  try {
    const r = await env.ed('POST', '/settings/connections', { preset: 'gemini', api_key: 'sk-bad-fail-timeout-0000' })
    assert.equal(r.statusCode, 422)
    assert.equal(r.json().cause, 'timeout')
    assert.equal(hasRow(env.db, 'gemini'), false)
  } finally { await env.close() }
})

test('replace a key: a failing new key leaves the previous one serving, unchanged', async () => {
  const env = await connectionsEnv()
  try {
    assert.equal((await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: OK_ANTHROPIC })).statusCode, 200)
    const before = rowOf(env, 'anthropic')
    const bad = await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: BAD_KEY })
    assert.equal(bad.statusCode, 422)
    assert.equal(bad.json().code, 'provider_check_failed')
    assert.equal(bad.json().cause, 'invalid_key')
    assert.equal(env.connectionsNow().anthropic.apiKey, OK_ANTHROPIC)
    assert.equal(rowOf(env, 'anthropic').sealed_value, before.sealed_value)
    assert.equal(rowOf(env, 'anthropic').last4, '1111')
    assert.equal(env.plan('text').apiKey, OK_ANTHROPIC)
  } finally { await env.close() }
})

test('replace a key: a working new key replaces the previous one and is the one used from then on', async () => {
  const env = await connectionsEnv()
  try {
    await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: OK_ANTHROPIC })
    const next = 'sk-ant-newer-key-7777'
    const r = await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: next })
    assert.equal(r.statusCode, 200, r.body)
    assert.equal(r.json().connection.key.last4, '7777')
    assert.equal(r.json().check.ok, true)
    assert.equal(env.connectionsNow().anthropic.apiKey, next)
    assert.equal(env.plan('text').apiKey, next)
    assert.equal(all(env.db, "SELECT * FROM provider_connections WHERE name = 'anthropic'").length, 1)
  } finally { await env.close() }
})

test('replace a key: the first stored key of a connection that ran on the environment replaces it', async () => {
  const env = await connectionsEnv({ envVars: { ANTHROPIC_API_KEY: OK_ANTHROPIC } })
  try {
    assert.equal(env.plan('text').apiKey, OK_ANTHROPIC)
    const stored = 'sk-ant-stored-key-8888'
    const r = await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: stored })
    assert.equal(r.statusCode, 200)
    assert.equal(r.json().connection.key.source, 'stored')
    assert.equal(env.plan('text').apiKey, stored)
  } finally { await env.close() }
})

test('replace a key: unknown connection 404, malformed name 400, rejected model 422 with the previous key intact', async () => {
  const env = await connectionsEnv()
  try {
    assert.equal((await env.ed('PUT', '/settings/connections/nope-nope/key', { api_key: OK_ANTHROPIC })).statusCode, 404)
    assert.equal((await env.ed('PUT', '/settings/connections/BAD!/key', { api_key: OK_ANTHROPIC })).statusCode, 400)
    assert.equal((await env.ed('PUT', '/settings/connections/anthropic/key', {})).statusCode, 400)
    await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: OK_ANTHROPIC })
    const model = await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: 'sk-ant-other-key-6666', model: 'missing-model' })
    assert.equal(model.statusCode, 422)
    assert.equal(model.json().cause, 'model_not_found')
    assert.equal(env.connectionsNow().anthropic.apiKey, OK_ANTHROPIC)
  } finally { await env.close() }
})

test('retire a key: blocked with provider_in_use and the list of functions while one depends on it and the environment has no other', async () => {
  const env = await connectionsEnv()
  try {
    await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: OK_ANTHROPIC })
    const r = await env.ed('DELETE', '/settings/connections/anthropic/key')
    assert.equal(r.statusCode, 409)
    assert.equal(r.json().code, 'provider_in_use')
    assert.deepEqual(r.json().used_by, ['text', 'vision'])
    assert.equal(env.connectionsNow().anthropic.apiKey, OK_ANTHROPIC)
  } finally { await env.close() }
})

test('retire a key: allowed when the environment has another key, which serves from then on', async () => {
  const env = await connectionsEnv({ envVars: { ANTHROPIC_API_KEY: OK_ANTHROPIC } })
  try {
    await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: 'sk-ant-stored-key-8888' })
    const r = await env.ed('DELETE', '/settings/connections/anthropic/key')
    assert.equal(r.statusCode, 200, r.body)
    assert.equal(r.json().connection.key.source, 'environment')
    assert.equal(rowOf(env, 'anthropic').sealed_value, null)
    assert.equal(env.plan('text').apiKey, OK_ANTHROPIC)
  } finally { await env.close() }
})

test('retire a key: a key that comes from the environment is 409 key_from_environment', async () => {
  const env = await connectionsEnv({ envVars: { ANTHROPIC_API_KEY: OK_ANTHROPIC } })
  try {
    const r = await env.ed('DELETE', '/settings/connections/anthropic/key')
    assert.equal(r.statusCode, 409)
    assert.equal(r.json().code, 'key_from_environment')
    const none = await env.ed('DELETE', '/settings/connections/groq-speech/key')
    assert.equal(none.json().code, 'key_from_environment')
    assert.equal((await env.ed('DELETE', '/settings/connections/nope-nope/key')).statusCode, 404)
  } finally { await env.close() }
})

test('retire a key: an unused connection loses its key, its last four and its last diagnosis, and the row stays', async () => {
  const env = await connectionsEnv()
  try {
    await env.ed('POST', '/settings/connections', { preset: 'deepseek', api_key: OK_DEEPSEEK })
    const r = await env.ed('DELETE', '/settings/connections/deepseek/key')
    assert.equal(r.statusCode, 200)
    assert.equal(r.json().connection.status, 'no_key')
    assert.equal(r.json().connection.key.last4, null)
    assert.equal(r.json().connection.last_check, null)
    const row = rowOf(env, 'deepseek')
    assert.equal(row.sealed_value, null)
    assert.equal(row.last4, null)
    assert.equal(env.connectionsNow().deepseek.apiKey, undefined)
  } finally { await env.close() }
})

test('delete a custom provider: removes the row; refused with 404 for fixed or unknown ones and 409 while a function uses it', async () => {
  const env = await connectionsEnv()
  try {
    await addCustom(env)
    assert.equal((await env.ed('DELETE', '/settings/connections/anthropic')).statusCode, 404)
    assert.equal((await env.ed('DELETE', '/settings/connections/nope-nope')).statusCode, 404)
    await env.ed('POST', '/settings/connections', { preset: 'deepseek', api_key: OK_DEEPSEEK })
    assert.equal((await env.ed('DELETE', '/settings/connections/deepseek')).statusCode, 404) // a preset is not a custom provider
    const use = await env.ed('PATCH', '/settings/providers', { slot: 'text', provider: 'mi-proveedor', model: 'fake-model-a' })
    assert.equal(use.statusCode, 200, use.body)
    const blocked = await env.ed('DELETE', '/settings/connections/mi-proveedor')
    assert.equal(blocked.statusCode, 409)
    assert.equal(blocked.json().code, 'provider_in_use')
    assert.deepEqual(blocked.json().used_by, ['text', 'vision'])
    assert.equal((await env.ed('PATCH', '/settings/providers', { slot: 'text', provider: 'anthropic', model: 'm' })).statusCode, 422) // no anthropic key yet
    await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: OK_ANTHROPIC })
    assert.equal((await env.ed('PATCH', '/settings/providers', { slot: 'text', provider: 'anthropic', model: 'claude-haiku-5-5' })).statusCode, 200)
    const done = await env.ed('DELETE', '/settings/connections/mi-proveedor')
    assert.equal(done.statusCode, 200)
    assert.deepEqual(done.json(), { deleted: true })
    assert.equal(hasRow(env.db, 'mi-proveedor'), false)
  } finally { await env.close() }
})

test('diagnose a connection: 200 with the result and the model list, saved as the last diagnosis', async () => {
  const env = await connectionsEnv()
  try {
    await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: OK_ANTHROPIC })
    const before = rowOf(env, 'anthropic').check_at
    await new Promise((resolve) => setTimeout(resolve, 5)) // the stored time has millisecond resolution
    const r = await env.ed('POST', '/settings/connections/anthropic/check', {})
    assert.equal(r.statusCode, 200)
    const { check } = r.json()
    assert.equal(check.ok, true)
    assert.equal(check.cause, null)
    assert.deepEqual(check.models, ['fake-model-a', 'fake-model-b'])
    assert.equal(check.model, 'claude-haiku-5-5') // the model the text function has
    assert.ok(rowOf(env, 'anthropic').check_at > before)
  } finally { await env.close() }
})

test('diagnose a connection: uses the environment key when none is stored, and says so when there is none', async () => {
  const env = await connectionsEnv({ envVars: { ANTHROPIC_API_KEY: OK_ANTHROPIC } })
  try {
    const r = await env.ed('POST', '/settings/connections/anthropic/check', {})
    assert.equal(r.statusCode, 200)
    assert.ok(env.upstream.seen.every((q) => q.key === OK_ANTHROPIC))
    const none = await env.ed('POST', '/settings/connections/groq-speech/check', {})
    assert.equal(none.statusCode, 422)
    assert.equal(none.json().code, 'provider_no_key')
    assert.equal((await env.ed('POST', '/settings/connections/nope-nope/check', {})).statusCode, 404)
  } finally { await env.close() }
})

test('diagnose a connection: the result of the environment key is saved too, so the list can show it failing', async () => {
  const env = await connectionsEnv({ envVars: { ANTHROPIC_API_KEY: OK_ANTHROPIC } })
  try {
    env.upstream.revoked.add(OK_ANTHROPIC)
    const r = await env.ed('POST', '/settings/connections/anthropic/check', {})
    assert.equal(r.json().check.cause, 'invalid_key')
    const anthropic = connectionOf(await env.ed('GET', '/settings/connections'), 'anthropic')
    assert.equal(anthropic.status, 'failing')
    assert.equal(anthropic.last_check.cause, 'invalid_key')
    assert.equal(anthropic.key.source, 'environment')
  } finally { await env.close() }
})

test('diagnose a connection: a model the provider does not know is reported but does not mark the key as failing', async () => {
  const env = await connectionsEnv()
  try {
    await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: OK_ANTHROPIC })
    const r = await env.ed('POST', '/settings/connections/anthropic/check', { model: 'missing-model' })
    assert.equal(r.statusCode, 200)
    assert.equal(r.json().check.cause, 'model_not_found')
    assert.deepEqual(r.json().check.models, ['fake-model-a', 'fake-model-b'])
    const anthropic = connectionOf(await env.ed('GET', '/settings/connections'), 'anthropic')
    assert.equal(anthropic.status, 'configured')
    assert.equal(anthropic.last_check.ok, true)
    assert.equal((await env.ed('POST', '/settings/connections/anthropic/check', { model: 'x', extra: 1 })).statusCode, 400)
  } finally { await env.close() }
})

test('diagnose a connection: a hung provider ends at the configured deadline with 200 and cause timeout', async () => {
  const env = await connectionsEnv({ envVars: { ANTHROPIC_API_KEY: 'sk-ant-fail-timeout-0001' }, config: { providers: { probe: { timeoutMs: 40 } } } })
  try {
    const r = await env.ed('POST', '/settings/connections/anthropic/check', {})
    assert.equal(r.statusCode, 200)
    assert.equal(r.json().check.cause, 'timeout')
  } finally { await env.close() }
})

test('diagnose a function: probes the provider and model the function uses today and answers 200 even if it fails', async () => {
  const env = await connectionsEnv({ envVars: { ANTHROPIC_API_KEY: OK_ANTHROPIC, GROQ_API_KEY: 'gsk-good-key-1212' } })
  try {
    const text = await env.ed('POST', '/settings/providers/text/check', {})
    assert.equal(text.statusCode, 200)
    assert.deepEqual({ slot: text.json().slot, provider: text.json().provider, model: text.json().model, ok: text.json().check.ok }, { slot: 'text', provider: 'anthropic', model: 'claude-haiku-5-5', ok: true })
    const speech = await env.ed('POST', '/settings/providers/speech/check', {})
    assert.equal(speech.json().provider, 'groq-speech')
    assert.equal(speech.json().check.cause, 'model_not_found') // transcription is proved by the list, and the fake lists only its own two models
    assert.deepEqual(speech.json().check.models, ['fake-model-a', 'fake-model-b'])
    assert.equal(speech.json().check.model_listed, false)
    env.upstream.revoked.add(OK_ANTHROPIC)
    const failed = await env.ed('POST', '/settings/providers/vision/check', {})
    assert.equal(failed.statusCode, 200)
    assert.equal(failed.json().check.cause, 'invalid_key')
    assert.equal((await env.ed('POST', '/settings/providers/nope/check', {})).statusCode, 400)
  } finally { await env.close() }
})

test('diagnose a function: without a key it is 422 provider_no_key and no call is made', async () => {
  const env = await connectionsEnv()
  try {
    const r = await env.ed('POST', '/settings/providers/text/check', {})
    assert.equal(r.statusCode, 422)
    assert.equal(r.json().code, 'provider_no_key')
    assert.equal(env.upstream.seen.length, 0)
  } finally { await env.close() }
})

test('diagnose a function: the result is saved on the stored connection it used', async () => {
  const env = await connectionsEnv()
  try {
    await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: OK_ANTHROPIC })
    env.upstream.revoked.add(OK_ANTHROPIC)
    await env.ed('POST', '/settings/providers/text/check', {})
    assert.equal(rowOf(env, 'anthropic').check_ok, 0)
    assert.equal(rowOf(env, 'anthropic').check_cause, 'invalid_key')
  } finally { await env.close() }
})

test('change a function: the new provider is tested first and saved only if the test passes', async () => {
  const env = await connectionsEnv({ envVars: { ANTHROPIC_API_KEY: OK_ANTHROPIC, DEEPSEEK_API_KEY: OK_DEEPSEEK } })
  try {
    const r = await env.ed('PATCH', '/settings/providers', { slot: 'text', provider: 'deepseek', model: 'deepseek-flash' })
    assert.equal(r.statusCode, 200, r.body)
    const text = r.json().items.find((i) => i.slot === 'text')
    assert.equal(text.provider, 'deepseek')
    assert.equal(text.model, 'deepseek-flash')
    assert.ok(env.upstream.seen.some((q) => q.url.startsWith('https://api.deepseek.com/') && q.key === OK_DEEPSEEK))
    assert.equal((await env.ed('GET', '/settings/providers')).json().items.find((i) => i.slot === 'text').provider, 'deepseek')
    assert.equal(all(env.db, "SELECT * FROM settings WHERE key = 'providers.text'").length, 1)
  } finally { await env.close() }
})

test('change a function: a failing test answers 422 and the previous configuration stays untouched', async () => {
  const env = await connectionsEnv({ envVars: { ANTHROPIC_API_KEY: OK_ANTHROPIC, DEEPSEEK_API_KEY: 'sk-ds-bad-fail-no_quota-0000' } })
  try {
    const r = await env.ed('PATCH', '/settings/providers', { slot: 'text', provider: 'deepseek', model: 'deepseek-flash' })
    assert.equal(r.statusCode, 422)
    assert.equal(r.json().code, 'provider_check_failed')
    assert.equal(r.json().cause, 'no_quota')
    assert.equal(all(env.db, "SELECT * FROM settings WHERE key LIKE 'providers.%'").length, 0)
    const text = (await env.ed('GET', '/settings/providers')).json().items.find((i) => i.slot === 'text')
    assert.equal(text.provider, 'anthropic')
    assert.equal(auditRows(env).length, 0)
    const model = await env.ed('PATCH', '/settings/providers', { slot: 'text', provider: 'anthropic', model: 'missing-model' })
    assert.equal(model.statusCode, 422)
    assert.equal(model.json().cause, 'model_not_found')
    assert.equal(all(env.db, "SELECT * FROM settings WHERE key LIKE 'providers.%'").length, 0)
  } finally { await env.close() }
})

test('change a function: a previous valid setting survives a later failing change', async () => {
  const env = await connectionsEnv({ envVars: { ANTHROPIC_API_KEY: OK_ANTHROPIC, DEEPSEEK_API_KEY: OK_DEEPSEEK } })
  try {
    assert.equal((await env.ed('PATCH', '/settings/providers', { slot: 'text', provider: 'deepseek', model: 'deepseek-flash' })).statusCode, 200)
    env.upstream.revoked.add(OK_ANTHROPIC)
    const r = await env.ed('PATCH', '/settings/providers', { slot: 'text', provider: 'anthropic', model: 'claude-haiku-5-5' })
    assert.equal(r.statusCode, 422)
    const text = (await env.ed('GET', '/settings/providers')).json().items.find((i) => i.slot === 'text')
    assert.equal(text.provider, 'deepseek')
  } finally { await env.close() }
})

test('change a function: no key is 422 provider_no_key, unknown provider is 422 provider_invalid, a bad body is 400', async () => {
  const env = await connectionsEnv({ envVars: { ANTHROPIC_API_KEY: OK_ANTHROPIC } })
  try {
    const noKey = await env.ed('PATCH', '/settings/providers', { slot: 'text', provider: 'gemini', model: 'gemini-x' })
    assert.equal(noKey.statusCode, 422)
    assert.equal(noKey.json().code, 'provider_no_key')
    const unknown = await env.ed('PATCH', '/settings/providers', { slot: 'text', provider: 'does-not-exist', model: 'm' })
    assert.equal(unknown.statusCode, 422)
    assert.equal(unknown.json().code, 'provider_invalid')
    for (const body of [{}, { slot: 'text' }, { slot: 'nope', provider: 'anthropic' }, { slot: 'text', provider: '' }, { slot: 'text', provider: 'anthropic', extra: 1 }, { analyzer: 'other' }]) {
      assert.equal((await env.ed('PATCH', '/settings/providers', body)).statusCode, 400, JSON.stringify(body))
    }
    assert.equal(all(env.db, "SELECT * FROM settings WHERE key LIKE 'providers.%'").length, 0)
  } finally { await env.close() }
})

test('change a function: the analyzer is saved without a provider test', async () => {
  const env = await connectionsEnv()
  try {
    const r = await env.ed('PATCH', '/settings/providers', { analyzer: 'harness' })
    assert.equal(r.statusCode, 200)
    assert.equal(r.json().analyzer, 'harness')
    assert.equal(env.upstream.seen.length, 0)
  } finally { await env.close() }
})

test('change a function to a custom provider: the test goes to its address with its stored key', async () => {
  const env = await connectionsEnv()
  try {
    await addCustom(env)
    const before = env.upstream.seen.length
    const r = await env.ed('PATCH', '/settings/providers', { slot: 'text', provider: 'mi-proveedor', model: 'fake-model-b' })
    assert.equal(r.statusCode, 200, r.body)
    const calls = env.upstream.seen.slice(before)
    assert.ok(calls.length > 0)
    assert.ok(calls.every((q) => q.url.startsWith('https://llm.example.test/v1/') && q.key === OK_CUSTOM))
    const connection = connectionOf(await env.ed('GET', '/settings/connections'), 'mi-proveedor')
    assert.deepEqual(connection.used_by, ['text', 'vision'])
  } finally { await env.close() }
})

test('GET /settings/providers carries key_last4 and status for each function, never the key', async () => {
  const env = await connectionsEnv({ envVars: { GROQ_API_KEY: 'gsk-env-key-5656' } })
  try {
    const none = (await env.ed('GET', '/settings/providers')).json().items
    assert.equal(none.find((i) => i.slot === 'text').status, 'no_key')
    assert.equal(none.find((i) => i.slot === 'text').key_last4, null)
    const fromEnvironment = none.find((i) => i.slot === 'speech')
    assert.equal(fromEnvironment.status, 'configured')
    assert.equal(fromEnvironment.key_last4, null)
    await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: OK_ANTHROPIC })
    const r = await env.ed('GET', '/settings/providers')
    const items = r.json().items
    assert.equal(items.find((i) => i.slot === 'text').key_last4, '1111')
    assert.equal(items.find((i) => i.slot === 'text').status, 'configured')
    assert.equal(items.find((i) => i.slot === 'vision').key_last4, '1111')
    env.upstream.revoked.add(OK_ANTHROPIC)
    await env.ed('POST', '/settings/providers/text/check', {})
    assert.equal((await env.ed('GET', '/settings/providers')).json().items.find((i) => i.slot === 'text').status, 'failing')
    assert.ok(!r.body.includes(OK_ANTHROPIC))
  } finally { await env.close() }
})

test('audit: every change leaves a row with action, member and entity, and no key value anywhere in it', async () => {
  const env = await connectionsEnv({ envVars: { ANTHROPIC_API_KEY: OK_ANTHROPIC, DEEPSEEK_API_KEY: OK_DEEPSEEK } })
  try {
    const editorId = get(env.db, "SELECT id FROM members WHERE email = 'ed@x.org'").id
    await env.ed('POST', '/settings/connections', { preset: 'gemini', api_key: 'sk-gem-good-key-0001' })
    await env.ed('PUT', '/settings/connections/gemini/key', { api_key: 'sk-gem-good-key-0002' })
    await env.ed('DELETE', '/settings/connections/gemini/key')
    await addCustom(env)
    await env.ed('DELETE', '/settings/connections/mi-proveedor')
    await env.ed('PATCH', '/settings/providers', { slot: 'text', provider: 'deepseek', model: 'deepseek-flash' })
    const rows = auditRows(env)
    assert.deepEqual(rows.map((r) => [r.action, r.entity, r.entity_id]), [
      ['settings.connection.add', 'connection', 'gemini'],
      ['settings.connection.key_replace', 'connection', 'gemini'],
      ['settings.connection.key_retire', 'connection', 'gemini'],
      ['settings.connection.add', 'connection', 'mi-proveedor'],
      ['settings.connection.delete', 'connection', 'mi-proveedor'],
      ['settings.providers', 'settings', null]
    ])
    assert.ok(rows.every((r) => r.member_id === editorId && r.at > 0))
    const text = JSON.stringify(rows)
    for (const secret of ['sk-gem-good-key', OK_CUSTOM, OK_DEEPSEEK, OK_ANTHROPIC, '0001', '0002', '3333']) assert.ok(!text.includes(secret), secret)
    const viaApi = (await env.ed('GET', '/audit?limit=50')).body
    assert.ok(!viaApi.includes('sk-gem-good-key'))
  } finally { await env.close() }
})

test('the functions use the stored key over the environment variable, and the variable again once it is retired', async () => {
  const env = await connectionsEnv({ envVars: { ANTHROPIC_API_KEY: OK_ANTHROPIC } })
  const original = globalThis.fetch
  try {
    const stored = 'sk-ant-stored-key-8888'
    await env.ed('PUT', '/settings/connections/anthropic/key', { api_key: stored })
    const used = []
    globalThis.fetch = async (url, init) => { used.push(new Headers(init.headers).get('x-api-key')); return new Response('{}', { status: 500 }) } // never leaves the process
    const built = env.modules.getProviders()
    assert.equal(built.describe().find((s) => s.slot === 'text').available, true)
    await built.text.complete({ messages: [{ role: 'user', content: 'x' }] }).catch(() => {})
    assert.deepEqual(used, [stored])
    await env.ed('DELETE', '/settings/connections/anthropic/key')
    used.length = 0
    await env.modules.getProviders().text.complete({ messages: [{ role: 'user', content: 'x' }] }).catch(() => {})
    assert.deepEqual(used, [OK_ANTHROPIC])
  } finally {
    globalThis.fetch = original
    await env.close()
  }
})

test('loadModules wires the vault and the stored keys: a key stored from the API is the one the providers get', async () => {
  const env = await connectionsEnv()
  try {
    const modules = await loadModules(env.config, { db: env.db, env: { ANTHROPIC_API_KEY: OK_ANTHROPIC } })
    assert.equal(modules.slotPlan('text').apiKey, OK_ANTHROPIC)
    storeKey(env.db, modules.vault, 'anthropic', 'sk-ant-stored-key-8888')
    assert.equal(modules.slotPlan('text').apiKey, 'sk-ant-stored-key-8888')
    assert.equal(modules.getProviders().describe().find((s) => s.slot === 'text').available, true)
    assert.equal(modules.vault.source, 'file') // no SECRETS_KEY in the environment: the key file in the data directory
    assert.equal(typeof modules.probe, 'function')
  } finally { await env.close() }
})
