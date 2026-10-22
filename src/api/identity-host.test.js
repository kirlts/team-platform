// H-3720: identity governed entirely by the host site. A JWT RS256 signed by a test key (JWKS served from memory),
// sign-up on the first entry with the declared role, the role governed by the host, a session of our own that keeps the
// SSE alive, several sources at once, a cookie shared with the host's domain and the sign-out.

import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { exportJWK, SignJWT } from 'jose'
import { get } from '../db/index.js'
import { addMember, login, makeEnv, openSse, TEST_PASSWORD } from '../testing/helpers.js'
import { signHeader } from '../identity/delegated.js'

const ISSUER = 'https://anfitrion.example'
const AUDIENCE = 'team-platform'
const JWKS_PORT = 8600
const SSE_PORT = 8601
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
let jwksServer

before(async () => {
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
  jwksServer = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })) })
  await new Promise((r) => jwksServer.listen(JWKS_PORT, '127.0.0.1', r))
})
after(() => new Promise((r) => jwksServer.close(r)))

const jwtConfig = (identity = {}) => ({
  config: {
    identity: {
      provider: 'jwt',
      provision: 'host',
      ...identity,
      delegated: { mode: 'jwt', secrets: ['secreto-agente'], jwt: { jwksUrl: `http://127.0.0.1:${JWKS_PORT}/jwks.json`, jwksCooldownMs: 0, issuer: ISSUER, audience: AUDIENCE }, ...identity.delegated }
    }
  }
})
const signJwt = (claims, { exp = '5m' } = {}) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
  .setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime(exp).sign(keys.privateKey)
const bearer = async (claims, opts) => ({ authorization: `Bearer ${await signJwt(claims, opts)}` })
const browser = { 'sec-fetch-site': 'same-origin' }
const memberRow = (env, email) => get(env.db, 'SELECT id, name, role FROM members WHERE email = ?', email)
const cookieOf = (res, name = '__Host-session') => {
  const c = res.cookies.find((x) => x.name === name)
  return c ? `${c.name}=${c.value}` : null
}

test('provision=host: an unknown email is created on its first entry with the host name and role; member if it declares none', async () => {
  const env = await makeEnv(jwtConfig())
  const r = await env.app.inject({ url: '/api/me', headers: await bearer({ email: 'ana@x.org', name: 'Ana Pérez', role: 'editor' }) })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().role, 'editor')
  assert.equal(r.json().name, 'Ana Pérez')
  assert.equal(r.json().provider, 'delegated:jwt')
  assert.equal(r.json().source, 'jwt')
  assert.equal(r.json().role_managed_externally, true)
  const plain = await env.app.inject({ url: '/api/me', headers: await bearer({ email: 'ale@x.org' }) })
  assert.equal(plain.json().role, 'member')
  assert.equal(plain.json().name, 'ale')
  assert.equal(plain.json().role_managed_externally, false)
  // A role outside the two of the code counts as undeclared: member, and not governed.
  const odd = await env.app.inject({ url: '/api/me', headers: await bearer({ email: 'doc@x.org', role: 'superadmin' }) })
  assert.equal(odd.json().role, 'member')
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'member.provision'").n, 3)
  await env.close()
})

test('provision=closed (default): an unknown email is 403 member_not_registered and nothing is created', async () => {
  const env = await makeEnv(jwtConfig({ provision: 'closed' }))
  const r = await env.app.inject({ url: '/api/me', headers: await bearer({ email: 'nadie@x.org', role: 'editor' }) })
  assert.equal(r.statusCode, 403)
  assert.equal(r.json().code, 'member_not_registered')
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM members').n, 0)
  // With closed, the declared role does not touch the stored one (UD-007 outside host provisioning).
  await addMember(env, { email: 'ana@x.org', role: 'member' })
  const ana = await env.app.inject({ url: '/api/me', headers: await bearer({ email: 'ana@x.org', role: 'editor' }) })
  assert.equal(ana.json().role, 'member')
  await env.close()
})

test('the host governs the role: applied on every entry, and the local Editor gets 409 role_managed_externally', async () => {
  const env = await makeEnv(jwtConfig())
  const editor = await bearer({ email: 'martin@x.org', role: 'editor' })
  await env.app.inject({ url: '/api/me', headers: editor })
  const first = await env.app.inject({ url: '/api/me', headers: await bearer({ email: 'ana@x.org', role: 'editor' }) })
  const anaId = first.json().id
  // The host demotes Ana: his next entry applies it.
  const demoted = await env.app.inject({ url: '/api/me', headers: await bearer({ email: 'ana@x.org', role: 'member' }) })
  assert.equal(demoted.json().role, 'member')
  assert.equal(memberRow(env, 'ana@x.org').role, 'member')
  // The local Editor cannot raise nor lower him.
  const patch = async (id, payload) => env.app.inject({ method: 'PATCH', url: `/api/members/${id}`, headers: { ...(await bearer({ email: 'martin@x.org', role: 'editor' })), 'content-type': 'application/json' }, payload })
  const raise = await patch(anaId, { role: 'editor' })
  assert.equal(raise.statusCode, 409)
  assert.equal(raise.json().code, 'role_managed_externally')
  assert.equal(memberRow(env, 'ana@x.org').role, 'member')
  // The name still is the Editor's; and a member whose role the host never declared is edited as before.
  assert.equal((await patch(anaId, { name: 'Ana P.' })).statusCode, 200)
  await env.app.inject({ url: '/api/me', headers: await bearer({ email: 'libre@x.org' }) })
  const free = memberRow(env, 'libre@x.org')
  assert.equal((await patch(String(free.id), { role: 'editor' })).statusCode, 200)
  await env.close()
})

test('a browser identified by the JWT gets a session of our own as long as the token, renewed with it, and the SSE lives on it', async () => {
  const env = await makeEnv(jwtConfig())
  const exp = Math.floor(Date.now() / 1000) + 600
  const r = await env.app.inject({ url: '/api/me', headers: { ...(await bearer({ email: 'ana@x.org' }, { exp })), ...browser } })
  assert.equal(r.statusCode, 200)
  const c = r.cookies.find((x) => x.name === '__Host-session')
  assert.ok(c)
  assert.equal(c.httpOnly, true)
  assert.equal(c.secure, true)
  assert.equal(c.sameSite, 'Lax')
  assert.ok(Math.abs(c.maxAge - (exp - Math.floor(Date.now() / 1000))) <= 2, `maxAge ${c.maxAge}`)
  assert.equal(get(env.db, 'SELECT expires_at FROM sessions').expires_at, exp * 1000)
  const cookie = `${c.name}=${c.value}`
  // The cookie alone identifies the person (what EventSource sends).
  const viaCookie = await env.app.inject({ url: '/api/me', headers: { cookie } })
  assert.equal(viaCookie.statusCode, 200)
  assert.equal(viaCookie.json().source, 'session')
  // A renewed host token moves the end of the same session; no new row.
  const later = exp + 900
  const renewed = await env.app.inject({ url: '/api/me', headers: { ...(await bearer({ email: 'ana@x.org' }, { exp: later })), ...browser, cookie } })
  assert.equal(renewed.cookies.find((x) => x.name === '__Host-session').value, c.value)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n, MAX(expires_at) AS e FROM sessions').n, 1)
  assert.equal(get(env.db, 'SELECT expires_at FROM sessions').expires_at, later * 1000)
  // A non-browser client (no Sec-Fetch-Site) does not leave a session per request.
  const agent = await env.app.inject({ url: '/api/me', headers: await bearer({ email: 'ana@x.org' }) })
  assert.equal(agent.cookies.length, 0)
  // SSE on the cookie of our own, over a real socket.
  await env.app.listen({ host: '127.0.0.1', port: SSE_PORT })
  env.baseUrl = `http://127.0.0.1:${SSE_PORT}`
  const stream = await openSse(env, '/api/events', { cookie })
  assert.equal(stream.status, 200)
  env.events.publish({ kind: 'message', memberId: Number(r.json().id), data: { message_id: 7, title: 'Hola', author_id: 1 } })
  env.events.drain?.()
  const [evt] = await stream.next(1)
  assert.equal(evt?.event, 'message')
  stream.close()
  await env.close()
})

test('two sources at once: people with the host JWT and the agent member with signed-header; local can sit with jwt', async () => {
  const env = await makeEnv(jwtConfig({ provider: 'jwt,signed-header' }))
  await addMember(env, { email: 'claude@x.org', role: 'member' })
  const person = await env.app.inject({ url: '/api/me', headers: await bearer({ email: 'ana@x.org' }) })
  assert.equal(person.json().source, 'jwt')
  assert.equal(person.json().provider, 'delegated:jwt,delegated:signed-header')
  const ts = Math.floor(Date.now() / 1000)
  const agentHeaders = { 'x-team-user': 'claude@x.org', 'x-team-ts': String(ts), 'x-team-sig': signHeader('secreto-agente', { ts, method: 'GET', pathname: '/api/me', email: 'claude@x.org', bind: true }) }
  const agent = await env.app.inject({ url: '/api/me', headers: agentHeaders })
  assert.equal(agent.statusCode, 200)
  assert.equal(agent.json().email, 'claude@x.org')
  assert.equal(agent.json().source, 'signed-header')
  // Deny by default holds: neither credential, nothing.
  assert.equal((await env.app.inject({ url: '/api/me' })).statusCode, 401)
  assert.equal((await env.app.inject({ url: '/api/me', headers: { ...agentHeaders, 'x-team-sig': 'f'.repeat(64) } })).statusCode, 401)
  await env.close()

  const mixed = await makeEnv(jwtConfig({ provider: 'local,jwt', login: { ipMax: 1000 } }))
  await addMember(mixed, { email: 'agente@x.org' })
  const cookie = await login(mixed, 'agente@x.org', TEST_PASSWORD)
  const viaLocal = await mixed.app.inject({ url: '/api/me', headers: { cookie } })
  assert.equal(viaLocal.json().source, 'session')
  assert.equal(viaLocal.json().provider, 'local,delegated:jwt')
  assert.equal((await mixed.app.inject({ url: '/api/me', headers: await bearer({ email: 'ana@x.org' }) })).json().source, 'jwt')
  await mixed.close()
})

test('signed-header: the host declares role and name in signed headers; a tampered role does not get in', async () => {
  const env = await makeEnv(jwtConfig({ provider: 'signed-header' }))
  const ts = Math.floor(Date.now() / 1000)
  const name = encodeURIComponent('Íñigo')
  const sig = signHeader('secreto-agente', { ts, method: 'GET', pathname: '/api/me', email: 'inigo@x.org', bind: true, role: 'editor', name })
  const h = { 'x-team-user': 'inigo@x.org', 'x-team-ts': String(ts), 'x-team-sig': sig, 'x-team-role': 'editor', 'x-team-name': name }
  const ok = await env.app.inject({ url: '/api/me', headers: h })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().role, 'editor')
  assert.equal(ok.json().name, 'Íñigo')
  assert.equal((await env.app.inject({ url: '/api/me', headers: { ...h, 'x-team-role': 'member' } })).statusCode, 401)
  await env.close()
})

test('COOKIE_DOMAIN: the session cookie is shared with the host under its own name; the host JWT can come in a cookie of its domain', async () => {
  const env = await makeEnv(jwtConfig({ cookieDomain: '.ejemplo.cl', cookieName: 'tp_sid', jwtCookieName: 'host_jwt' }))
  const token = await signJwt({ email: 'ana@x.org' })
  const r = await env.app.inject({ url: '/api/me', headers: { cookie: `host_jwt=${token}`, ...browser } })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().source, 'jwt')
  const c = r.cookies.find((x) => x.name === 'tp_sid')
  assert.ok(c, 'own session under COOKIE_NAME')
  assert.equal(c.domain, '.ejemplo.cl')
  assert.equal(c.secure, true)
  assert.equal(c.httpOnly, true)
  assert.equal(c.sameSite, 'Lax')
  assert.equal(r.cookies.some((x) => x.name.startsWith('__Host-')), false)
  // The host cookie is an ambient credential: an unsafe request with it needs X-Team-Request (CSRF).
  const csrf = await env.app.inject({ method: 'PATCH', url: '/api/members/me', headers: { cookie: `host_jwt=${token}`, 'content-type': 'application/json' }, payload: { profile: 'x' } })
  assert.equal(csrf.statusCode, 403)
  assert.equal(csrf.json().code, 'csrf')
  await env.close()
  const defaults = await makeEnv(jwtConfig({ cookieDomain: '.ejemplo.cl' }))
  const d = await defaults.app.inject({ url: '/api/me', headers: { ...(await bearer({ email: 'ana@x.org' })), ...browser } })
  assert.ok(d.cookies.find((x) => x.name === 'team_session'))
  await defaults.close()
})

test('sign-out: closes the session of our own in a host mode; with LOGOUT_URL it names the host sign-out', async () => {
  const env = await makeEnv(jwtConfig({ logoutUrl: 'https://anfitrion.example/salir' }))
  const r = await env.app.inject({ url: '/api/me', headers: { ...(await bearer({ email: 'ana@x.org' })), ...browser } })
  const cookie = cookieOf(r)
  const out = await env.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, 'x-team-request': 'panel' } })
  assert.equal(out.statusCode, 200)
  assert.deepEqual(out.json(), { logout_url: 'https://anfitrion.example/salir' })
  const cleared = out.cookies.find((x) => x.name === '__Host-session')
  assert.equal(cleared.value, '')
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM sessions').n, 0)
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie } })).statusCode, 401)
  await env.close()
  const plain = await makeEnv(jwtConfig())
  assert.equal((await plain.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { 'x-team-request': 'panel' } })).statusCode, 204)
  await plain.close()
})

test('configuration: a list of sources is validated, and a domain cookie cannot carry the __Host- prefix', async () => {
  const { loadConfig } = await import('../config.js')
  assert.throws(() => loadConfig({ IDENTITY_PROVIDER: 'local,oauth' }), /«oauth»/)
  assert.throws(() => loadConfig({ IDENTITY_PROVIDER: 'local,signed-header' }), /DELEGATED_SECRETS/)
  assert.throws(() => loadConfig({ COOKIE_DOMAIN: '.ejemplo.cl', COOKIE_NAME: '__Host-x' }), /__Host-/)
  assert.throws(() => loadConfig({ IDENTITY_PROVISION: 'abierto' }), /IDENTITY_PROVISION/)
  assert.equal(loadConfig({ IDENTITY_PROVIDER: 'jwt,signed-header', JWT_SECRET: 's', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', DELEGATED_SECRETS: 'x' }).identity.provider, 'jwt,signed-header')
})
