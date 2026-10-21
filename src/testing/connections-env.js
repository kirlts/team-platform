// Test support for the provider connections (UD-120, UD-121): the application over a real vault, the real provider
// builders and a fake upstream that fails according to the text of the key. Nothing here is imported from production code
// and nothing leaves the process: every provider call goes to `createFakeUpstream`.

import { loadConnections } from '../domain/connections.js'
import { getProviderOverrides, providerEnv } from '../domain/settings.js'
import { createVault, generateMasterKey, keyId } from '../domain/vault.js'
import { createFakeUpstream } from '../providers/fake.js'
import { createProviders, probeConnection, slotPlan } from '../providers/index.js'
import { addMember, login, makeEnv } from './helpers.js'

const noIpLimit = { identity: { login: { ipMax: 1000 } } }

/**
 * An upstream like `createFakeUpstream` that also (1) answers 401 to a key in `revoked`, whatever its text, and (2) repeats
 * the key in the body of every error, as some providers do, so that a leak through an error body would be visible.
 * `seen` lists { url, key } of every request.
 */
export function createEchoUpstream () {
  const inner = createFakeUpstream()
  const revoked = new Set()
  const seen = []
  async function fetchImpl (url, init = {}) {
    const headers = new Headers(init.headers)
    const key = headers.get('x-api-key') ?? (headers.get('authorization') ?? '').replace(/^Bearer /, '')
    seen.push({ url: String(url), key })
    const response = revoked.has(key)
      ? new Response(JSON.stringify({ error: { type: 'authentication_error', message: 'revoked' } }), { status: 401, headers: { 'content-type': 'application/json' } })
      : await inner.fetchImpl(url, init)
    if (response.ok) return response
    const body = await response.json().catch(() => ({}))
    const echoed = { ...body, error: { ...(body.error ?? {}), message: `Incorrect API key provided: ${key}` }, echo: key }
    return new Response(JSON.stringify(echoed), { status: response.status, headers: { 'content-type': 'application/json' } })
  }
  return { fetchImpl, requests: inner.requests, revoked, seen }
}

/**
 * Environment with a team (one Editor, one Member) and the provider modules wired like `loadModules` does.
 * `envVars` plays the role of the server environment (ANTHROPIC_API_KEY, DEEPSEEK_API_KEY...).
 * Returns the usual `makeEnv` result plus: `upstream`, `vault`, `envVars`, `c` (cookies `ed`, `ana`), `api(method, url, cookie, payload)`,
 * `ed(method, url, payload)`, and `plan(slot)`.
 */
export async function connectionsEnv ({ envVars = {}, config = {}, logger = false, telemetry = false, vault = null, upstream = createEchoUpstream() } = {}) {
  const holder = { db: null }
  const masterKey = generateMasterKey()
  const theVault = vault ?? createVault({ key: masterKey, id: keyId(masterKey), source: 'test' })
  const connectionsNow = () => loadConnections(holder.db, theVault)
  const overridesNow = () => getProviderOverrides(holder.db)
  const build = (overrides) => createProviders({ ...envVars, ...providerEnv(overrides) }, { connections: connectionsNow() })
  const modules = {
    vault: theVault,
    env: envVars,
    buildProviders: build,
    getProviders: () => build(overridesNow()),
    slotPlan: (slot, overrides = overridesNow()) => slotPlan({ ...envVars, ...providerEnv(overrides) }, slot, connectionsNow()),
    probe: (spec) => probeConnection({ ...spec, fetchImpl: upstream.fetchImpl })
  }
  const env = await makeEnv({ config: { ...noIpLimit, ...config }, modules, logger, telemetry })
  holder.db = env.db
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org') }
  env.upstream = upstream
  env.vault = theVault
  env.envVars = envVars
  env.api = (method, url, cookie, payload, headers = {}) => env.app.inject({ method, url: `/api${url}`, headers: { ...(cookie ? { cookie } : {}), 'x-team-request': 'panel', ...headers }, payload })
  env.ed = (method, url, payload) => env.api(method, url, env.c.ed, payload)
  env.plan = (slot) => modules.slotPlan(slot)
  env.connectionsNow = connectionsNow
  return env
}
