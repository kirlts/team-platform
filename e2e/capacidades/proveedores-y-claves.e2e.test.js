// Capability «Proveedores y claves» (docs/CAPACIDADES-1.0.md): a person of the team connects a provider from the API (the key is tested before it is saved),
// sets it as the model of the text function, and the next send is analyzed by the worker with that connection. The provider is a local server that speaks the
// chat-completions protocol and records the key of each request; the application builds its real providers over the real vault.
// Prohibitions on the way: a key that fails the test is not saved and the previous one keeps serving, a key in use cannot be withdrawn, and no key leaves in any answer.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { loadConnections } from '../../src/domain/connections.js'
import { analyze } from '../../src/analyze/index.js'
import { getProviderOverrides, providerEnv } from '../../src/domain/settings.js'
import { createVault, generateMasterKey, keyId } from '../../src/domain/vault.js'
import { createProviders, probeConnection, slotPlan } from '../../src/providers/index.js'
import { startLocalServer } from '../../src/providers/local-server.js'
import { addMember, fakeExtract, login, makeEnv, postInput, until } from '../../src/testing/helpers.js'

const KEY_OK = 'sk-proveedor-bueno-0001-ab12'
const KEY_NEW = 'sk-proveedor-bueno-0002-cd34'
const KEY_BAD = 'sk-proveedor-malo-0003-ef56'
const ACCEPTED = new Set([KEY_OK, KEY_NEW])

// The units are numbered in the first message that carries them; a retry appends feedback messages that do not.
const unitIdsIn = (messages) => {
  for (const m of messages.filter((x) => x.role === 'user')) {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    const ids = [...text.matchAll(/\[u(\d+)\]/g)].map((x) => Number(x[1]))
    if (ids.length) return [...new Set(ids)]
  }
  return []
}

/** What a model answers to each step of the analysis, given the schema the application demands. */
function answer (schema, messages) {
  const units = unitIdsIn(messages)
  if (schema.properties.cuts) return { cuts: [] }
  if (schema.properties.groups) {
    return { split_at: [], groups: [{ unit_ids: units, requests: ['request'], recap_unit_ids: [], area_id: catalog.area_id, template_id: catalog.id }], discarded: [] }
  }
  if (schema.properties.requests) return { requests: [{ unit_ids: units, request: 'request' }] }
  const fields = Object.keys(schema.properties.messages.items.properties.fields.properties ?? {})
  return { messages: [{ unit_ids: units, title: 'Título del proveedor propio', fields: Object.fromEntries(fields.map((n) => [n, 'dato'])), body: 'Cuerpo escrito por el modelo del proveedor propio.', assignee_ids: [], attachment_ids: [] }] }
}

let upstream
const catalog = { id: null, area_id: null } // the template the model picks: the first one of the installation, with its own area
before(async () => {
  upstream = await startLocalServer((req) => {
    const key = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    if (!ACCEPTED.has(key)) return { status: 401, body: { error: { type: 'authentication_error', message: `Incorrect API key provided: ${key}` } } }
    if (req.method === 'GET') return { body: { data: [{ id: 'modelo-a' }, { id: 'modelo-b' }] } }
    const schema = req.json?.response_format?.json_schema?.schema
    const content = schema ? JSON.stringify(answer(schema, req.json.messages)) : 'ok'
    return { body: { id: 'x', model: req.json.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 20, completion_tokens: 10 } } }
  })
})
after(() => upstream.close())

async function instancia () {
  const holder = { db: null }
  const masterKey = generateMasterKey()
  const vault = createVault({ key: masterKey, id: keyId(masterKey), source: 'test' })
  const envVars = {}
  const connectionsNow = () => loadConnections(holder.db, vault)
  const build = (overrides) => createProviders({ ...envVars, ...providerEnv(overrides) }, { connections: connectionsNow() })
  const modules = {
    vault, env: envVars, analyze, extract: fakeExtract, getAnalyzer: () => 'api',
    buildProviders: build,
    getProviders: () => build(getProviderOverrides(holder.db)),
    slotPlan: (slot, overrides = getProviderOverrides(holder.db)) => slotPlan({ ...envVars, ...providerEnv(overrides) }, slot, connectionsNow()),
    probe: (spec) => probeConnection({ ...spec, fetchImpl: fetch })
  }
  const env = await makeEnv({ worker: true, modules, config: { identity: { login: { ipMax: 1000 } } } })
  holder.db = env.db
  Object.assign(catalog, env.db.prepare('SELECT id, area_id FROM templates WHERE deleted_at IS NULL ORDER BY id').get())
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  env.cookie = await login(env, 'ana@x.org')
  env.api = (method, url, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie: env.cookie, 'x-team-request': 'panel' }, payload })
  return env
}

/** Ana sends and the worker analyzes with the connection in use; returns the proposal she reviews. */
async function enviarYLeerPropuesta (env, text) {
  const sent = await postInput(env, env.cookie, { text })
  assert.equal(sent.statusCode, 202, sent.body)
  const inputId = sent.json().input_id
  return until(async () => {
    const v = (await env.api('GET', `/inputs/${inputId}`)).json()
    if (v.status === 'failed') throw new Error(`the analysis failed: ${JSON.stringify(v.job)}`)
    return v.status === 'proposed' ? v : null
  }, { timeoutMs: 20000 })
}
const textCalls = () => upstream.requests.filter((r) => r.method === 'POST' && r.json?.response_format)

test('a connection added from the API serves the next analysis; a bad key does not replace it; nothing returns a key', async () => {
  const env = await instancia()
  const answers = []
  const call = async (method, url, payload) => { const r = await env.api(method, url, payload); answers.push(r.body); return r }

  // Connect: the key is tested against the provider before it is stored.
  const added = await call('POST', '/settings/connections', { name: 'mi-proveedor', label: 'Mi proveedor', base_url: upstream.url, api_key: KEY_OK, model: 'modelo-a' })
  assert.equal(added.statusCode, 201, added.body)
  assert.ok(upstream.requests.some((r) => r.headers.authorization === `Bearer ${KEY_OK}`), 'the key was not tested against the provider')
  const listed = (await call('GET', '/settings/connections')).json().items.find((c) => c.name === 'mi-proveedor')
  assert.equal(listed.status, 'configured')
  assert.equal(listed.key.last4, 'ab12')
  assert.equal(listed.last_check.ok, true)

  // Use it for the text function: the change is tested first and is what the list of functions then says.
  const used = await call('PATCH', '/settings/providers', { slot: 'text', provider: 'mi-proveedor', model: 'modelo-a' })
  assert.equal(used.statusCode, 200, used.body)
  const slot = used.json().items.find((i) => i.slot === 'text')
  assert.equal(slot.provider, 'mi-proveedor')
  assert.equal(slot.model, 'modelo-a')
  const diagnosis = await call('POST', '/settings/providers/text/check', {})
  assert.equal(diagnosis.json().check.ok, true)
  assert.equal(diagnosis.json().provider, 'mi-proveedor')

  // The send: the worker analyzes with that connection and the person reads what its model wrote.
  const before = textCalls().length
  const proposal = await enviarYLeerPropuesta(env, 'necesito el informe del trimestre')
  assert.equal(proposal.proposal.messages[0].title, 'Título del proveedor propio')
  assert.equal(proposal.proposal.messages[0].body, 'Cuerpo escrito por el modelo del proveedor propio.')
  const made = textCalls().slice(before)
  assert.ok(made.length >= 2, 'the analysis made fewer than two calls to the provider')
  assert.ok(made.every((r) => r.headers.authorization === `Bearer ${KEY_OK}` && r.json.model === 'modelo-a'), 'a call of the analysis did not use the stored key and the chosen model')

  // A key that fails the test is refused and the previous one keeps serving the next analysis.
  const bad = await call('PUT', '/settings/connections/mi-proveedor/key', { api_key: KEY_BAD })
  assert.equal(bad.statusCode, 422)
  assert.equal(bad.json().code, 'provider_check_failed')
  assert.equal((await call('GET', '/settings/connections')).json().items.find((c) => c.name === 'mi-proveedor').key.last4, 'ab12')
  const mark = upstream.requests.length
  await enviarYLeerPropuesta(env, 'otra consulta distinta sobre el informe')
  assert.ok(textCalls().filter((r) => upstream.requests.indexOf(r) >= mark).every((r) => r.headers.authorization === `Bearer ${KEY_OK}`))

  // A key that works replaces it, and from then on the analysis uses the new one.
  assert.equal((await call('PUT', '/settings/connections/mi-proveedor/key', { api_key: KEY_NEW })).statusCode, 200)
  const mark2 = upstream.requests.length
  await enviarYLeerPropuesta(env, 'una tercera consulta con la clave nueva')
  const later = upstream.requests.slice(mark2).filter((r) => r.method === 'POST' && r.json?.response_format)
  assert.ok(later.length > 0 && later.every((r) => r.headers.authorization === `Bearer ${KEY_NEW}`))

  // A key in use cannot be withdrawn, and the connection cannot be deleted while a function uses it.
  const withdrawn = await call('DELETE', '/settings/connections/mi-proveedor/key')
  assert.equal(withdrawn.statusCode, 409)
  assert.equal(withdrawn.json().code, 'provider_in_use')
  assert.equal((await call('DELETE', '/settings/connections/mi-proveedor')).statusCode, 409)

  // No answer carried a key, the audit does not either, and the key is sealed in the database.
  for (const key of [KEY_OK, KEY_NEW, KEY_BAD]) {
    for (const body of answers) assert.ok(!body.includes(key), `an answer carried the key ${key.slice(-4)}`)
    assert.ok(!(await call('GET', '/audit')).body.includes(key), 'the audit carries a key')
    assert.ok(!JSON.stringify(env.db.prepare('SELECT * FROM provider_connections').all()).includes(key), 'a key is stored in clear')
  }
  assert.ok(env.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'settings.connection.%'").get().n >= 2)
  await env.close()
})
