// Capability «Identidad local y delegada» (docs/CAPACIDADES-1.0.md): each installation signs in with its own email and password or delegates the entry to the host
// site (JWT, signed header, trusted header or redirect), and an expired session takes the person to the entry that works. Each source is an instance of its own;
// in each one a person identifies herself with the credential of that source, sends a message through the API (input, worker, publication) and reads it in the list.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { signHeader } from '../../src/identity/delegated.js'
import { addMember, login, makeEnv, tempDir } from '../../src/testing/helpers.js'
import { anfitrionJwt, enviarComo } from './apoyo.mjs'

let host
before(async () => { host = await anfitrionJwt() })
after(() => host.cerrar())

const SECRET = 'secreto-del-anfitrion'
const SSO_SECRET = 'secreto-sso'
const panelDir = () => {
  const dir = tempDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>Panel</title></head><body><div id="root"></div></body></html>')
  return dir
}

/** What Ana does with the credentials of her source: she is identified, sends, and reads her message in the list that she sees. */
async function anaEnviaYLee (env, credenciales, source) {
  const me = await env.app.inject({ url: '/api/me', headers: credenciales('GET', '/api/me'), remoteAddress: '127.0.0.1' })
  assert.equal(me.statusCode, 200, me.body)
  assert.equal(me.json().email, 'ana@x.org')
  if (source) assert.equal(me.json().source, source)
  const { messageId, call } = await enviarComo(env, credenciales, 'quiero saber el estado de mi solicitud')
  const list = await call('GET', '/messages')
  assert.equal(list.statusCode, 200, list.body)
  const found = list.json().items.find((m) => m.id === messageId)
  assert.ok(found, 'the message that Ana sent is not in her list')
  assert.equal(found.author_id, me.json().id)
  assert.equal((await call('GET', `/messages/${messageId}`)).json().id, messageId)
  return messageId
}

test('local: Ana signs in with her email and password, sends and reads her message; a wrong password and a session without login are refused', async () => {
  const env = await makeEnv({ worker: true, config: { identity: { login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  assert.equal((await env.app.inject({ url: '/api/me' })).statusCode, 401)
  const cookie = await login(env, 'ana@x.org')
  await anaEnviaYLee(env, () => ({ cookie }), 'session')
  const wrong = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ana@x.org', password: 'otra clave larga de prueba' } })
  assert.equal(wrong.statusCode, 401)
  await env.close()
})

test('local: a session that expired is refused, and signing in again brings back the same messages', async () => {
  const env = await makeEnv({ worker: true, clock: true, config: { identity: { login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  const cookie = await login(env, 'ana@x.org')
  const { messageId } = await enviarComo(env, () => ({ cookie }), 'primer mensaje de la sesión')
  env.clock.t += (env.config.identity.session.idleMinutes + 1) * 60_000
  const expired = await env.app.inject({ url: '/api/me', headers: { cookie } })
  assert.equal(expired.statusCode, 401)
  assert.equal((await env.app.inject({ url: `/api/messages/${messageId}`, headers: { cookie } })).statusCode, 401)
  const again = await login(env, 'ana@x.org')
  assert.equal((await env.app.inject({ url: `/api/messages/${messageId}`, headers: { cookie: again } })).json().id, messageId)
  await env.close()
})

test('signed-header: Ana arrives with the headers that the host signs for each request and sends; a tampered signature does not get in', async () => {
  const env = await makeEnv({ worker: true, config: { identity: { provider: 'signed-header', delegated: { mode: 'signed-header', secrets: [SECRET] } } } })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  const headers = (method, pathname, secret = SECRET) => {
    const ts = Math.floor(Date.now() / 1000)
    return { 'x-team-user': 'ana@x.org', 'x-team-ts': String(ts), 'x-team-sig': signHeader(secret, { ts, method, pathname: pathname.split('?')[0], email: 'ana@x.org', bind: true }) }
  }
  await anaEnviaYLee(env, headers, 'signed-header')
  assert.equal((await env.app.inject({ url: '/api/me', headers: headers('GET', '/api/me', 'otro-secreto') })).statusCode, 401)
  await env.close()
})

test('jwt: Ana arrives with the token that the host signed, sends and reads; an expired token takes the page to the host entry and a fresh one comes back in', async () => {
  const env = await makeEnv({
    worker: true,
    config: { panelDist: panelDir(), identity: { provider: 'jwt', provision: 'closed', hostLoginUrl: 'https://anfitrion.example/entrar', delegated: { mode: 'jwt', secrets: [], jwt: host.config } } }
  })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  const fresh = await host.firmar({ email: 'ana@x.org' })
  const messageId = await anaEnviaYLee(env, () => fresh, 'jwt')
  // The host's token expired a minute ago: the API names the entry and the page goes to it, with the page that she asked for.
  const stale = await host.firmar({ email: 'ana@x.org' }, undefined, Math.floor(Date.now() / 1000) - 60)
  const api = await env.app.inject({ url: '/api/me', headers: stale })
  assert.equal(api.statusCode, 401)
  assert.equal(api.json().login_url, 'https://anfitrion.example/entrar')
  const page = await env.app.inject({ url: `/messages/${messageId}`, headers: stale })
  assert.equal(page.statusCode, 302)
  assert.equal(page.headers.location, `https://anfitrion.example/entrar?next=${encodeURIComponent(`/messages/${messageId}`)}`)
  // Back from the entry with a fresh token: the page opens and her message is where it was.
  assert.equal((await env.app.inject({ url: `/messages/${messageId}`, headers: { ...fresh, 'sec-fetch-site': 'same-origin' } })).statusCode, 200)
  assert.equal((await env.app.inject({ url: `/api/messages/${messageId}`, headers: fresh })).json().id, messageId)
  // A token for another service and a person who is not a member are refused, and nobody is created.
  assert.equal((await env.app.inject({ url: '/api/me', headers: await host.firmar({ email: 'ana@x.org' }, 'otro-servicio') })).statusCode, 401)
  assert.equal((await env.app.inject({ url: '/api/me', headers: await host.firmar({ email: 'nadie@x.org' }) })).statusCode, 403)
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM members').get().n, 1)
  await env.close()
})

test('trusted-header: Ana arrives through the proxy of the host and sends; the same header from another address is refused', async () => {
  const env = await makeEnv({ worker: true, config: { identity: { provider: 'trusted-header', delegated: { mode: 'trusted-header' } } } })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  const headers = () => ({ 'tailscale-user-login': 'ana@x.org' })
  await anaEnviaYLee(env, headers, 'trusted-header')
  assert.equal((await env.app.inject({ url: '/api/me', headers: headers(), remoteAddress: '203.0.113.7' })).statusCode, 401)
  await env.close()
})

test('sso-redirect: Ana goes to the host, comes back with the signed answer, gets a session and sends; the answer cannot be replayed', async () => {
  const env = await makeEnv({
    worker: true,
    config: { publicUrl: 'https://team.example', identity: { provider: 'sso-redirect', delegated: { mode: 'sso-redirect', sso: { loginUrl: 'https://anfitrion.example/sso', secret: SSO_SECRET } } } }
  })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  assert.equal((await env.app.inject({ url: '/api/me' })).json().login_url, '/api/auth/sso/start')
  const start = await env.app.inject({ url: '/api/auth/sso/start' })
  assert.equal(start.statusCode, 302)
  const target = new URL(start.headers.location)
  assert.equal(target.origin + target.pathname, 'https://anfitrion.example/sso')
  const nonce = JSON.parse(Buffer.from(target.searchParams.get('sso'), 'base64url').toString()).nonce
  const nonceCookie = start.cookies.find((c) => c.name === '__Host-sso')
  const back = () => {
    const sso = Buffer.from(JSON.stringify({ nonce, email: 'ana@x.org', external_id: 'u-1', email_verified: true })).toString('base64url')
    return env.app.inject({ url: `/api/auth/sso/callback?sso=${sso}&sig=${createHmac('sha256', SSO_SECRET).update(sso).digest('hex')}`, headers: { cookie: `${nonceCookie.name}=${nonceCookie.value}` } })
  }
  const arrived = await back()
  assert.equal(arrived.statusCode, 302)
  const session = arrived.cookies.find((c) => c.name === '__Host-session')
  await anaEnviaYLee(env, () => ({ cookie: `${session.name}=${session.value}` }), 'session')
  const again = await back()
  assert.equal(again.statusCode, 403, 'the answer of the host was accepted twice')
  assert.match(again.headers['content-type'], /json/, 'a client with no Accept keeps the JSON error')
  assert.equal(again.json().code, 'sso_invalid')
  // A browser reads the reason on a page with a link to the entry.
  const sso = Buffer.from(JSON.stringify({ nonce, email: 'ana@x.org', email_verified: true })).toString('base64url')
  const browser = await env.app.inject({
    url: `/api/auth/sso/callback?sso=${sso}&sig=${createHmac('sha256', SSO_SECRET).update(sso).digest('hex')}`,
    headers: { accept: 'text/html,application/xhtml+xml', cookie: `${nonceCookie.name}=${nonceCookie.value}` }
  })
  assert.equal(browser.statusCode, 403)
  assert.match(browser.headers['content-type'], /text\/html/)
  assert.match(browser.body, /<h2[^>]*>Inicio de sesión rechazado<\/h2>/)
  assert.match(browser.body, /<a class="btn btn-gel[^"]*hit" href="\/api\/auth\/sso\/start">Reintentar<\/a>/)
  assert.match(browser.body, /notice-theme\.js/)
  assert.doesNotMatch(browser.body, /sso_invalid|navegador|respuesta del inicio/)
  // The same answer sent again while the session is alive goes on to the panel, with no error.
  const alive = await env.app.inject({
    url: `/api/auth/sso/callback?sso=${sso}&sig=${createHmac('sha256', SSO_SECRET).update(sso).digest('hex')}`,
    headers: { accept: 'text/html', cookie: `${session.name}=${session.value}` }
  })
  assert.equal(alive.statusCode, 302)
  assert.equal(alive.headers.location, '/')
  // An email the host did not verify is the host's to fix: the page says who and offers no link back into the same error.
  const start2 = await env.app.inject({ url: '/api/auth/sso/start' })
  const nonce2 = JSON.parse(Buffer.from(new URL(start2.headers.location).searchParams.get('sso'), 'base64url').toString()).nonce
  const nonceCookie2 = start2.cookies.find((c) => c.name === '__Host-sso')
  const unverified = Buffer.from(JSON.stringify({ nonce: nonce2, email: 'ana@x.org', email_verified: false })).toString('base64url')
  const notVerified = await env.app.inject({
    url: `/api/auth/sso/callback?sso=${unverified}&sig=${createHmac('sha256', SSO_SECRET).update(unverified).digest('hex')}`,
    headers: { accept: 'text/html', cookie: `${nonceCookie2.name}=${nonceCookie2.value}` }
  })
  assert.equal(notVerified.statusCode, 403)
  assert.match(notVerified.body, /<h2[^>]*>Correo sin verificar<\/h2>/)
  assert.match(notVerified.body, /Lo corrige quien administra el sitio del equipo/)
  assert.doesNotMatch(notVerified.body, /<a /)
  await env.close()
})

/** Follows redirects of a browser navigation up to a limit; a loop fails the test. */
async function navegar (env, url, headers, limite = 5) {
  const visited = []
  let current = url
  for (let i = 0; i <= limite; i++) {
    visited.push(current)
    const res = await env.app.inject({ url: current, headers: { accept: 'text/html', ...headers }, remoteAddress: '203.0.113.7' })
    if (res.statusCode < 300 || res.statusCode >= 400) return { res, visited }
    current = res.headers.location
  }
  assert.fail(`redirect loop: ${visited.join(' -> ')}`)
}

test('trusted-header: a page from an untrusted address or with no header ends on a page, never in a redirect loop', async () => {
  const env = await makeEnv({ config: { panelDist: panelDir(), identity: { provider: 'trusted-header', delegated: { mode: 'trusted-header' } } } })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  for (const headers of [{ 'tailscale-user-login': 'ana@x.org' }, {}]) {
    for (const start of ['/', '/messages']) {
      const { res, visited } = await navegar(env, start, headers)
      assert.equal(res.statusCode, 401, visited.join(' -> '))
      assert.match(res.headers['content-type'], /text\/html/)
      assert.match(res.body, /<h2[^>]*>Sin acceso<\/h2>/)
      assert.match(res.body, /La entrada a esta instalación es por el sitio del equipo/)
      assert.doesNotMatch(res.body, /cabecera|TRUSTED_PROXIES|dirección no confiable/)
      // The exit with no host site is «Reintentar»: the destination asked for, which asks again and ends on the same page.
      assert.match(res.body, new RegExp(`<a class="btn btn-gel[^"]*hit" href="${start}">Reintentar</a>`))
      const again = await navegar(env, start, headers)
      assert.equal(again.res.statusCode, 401)
    }
  }
  const english = await navegar(env, '/', { 'accept-language': 'en-US,en;q=0.9' })
  assert.match(english.res.body, /<h2[^>]*>No access<\/h2>/)
  assert.match(english.res.body, />Retry<\/a>/)
  assert.match((await env.app.inject({ url: '/notice-theme.js' })).body, /team-theme/)
  // The API keeps answering JSON.
  const api = await env.app.inject({ url: '/api/me', remoteAddress: '203.0.113.7' })
  assert.equal(api.statusCode, 401)
  assert.equal(api.json().login_url, '/session/login')
  await env.close()
  // With the host's site declared the exit is a link to it, never a loop.
  const withSite = await makeEnv({ config: { panelDist: panelDir(), identity: { provider: 'trusted-header', hostSiteUrl: 'https://anfitrion.example', delegated: { mode: 'trusted-header' } } } })
  const site = await navegar(withSite, '/messages', {})
  assert.equal(site.res.statusCode, 401)
  assert.match(site.res.body, /<a class="btn btn-gel[^"]*hit" href="https:\/\/anfitrion\.example">Ir al sitio del equipo<\/a>/)
  await withSite.close()
  // A host that declares its entry still gets the redirect there.
  const declared = await makeEnv({ config: { panelDist: panelDir(), identity: { provider: 'trusted-header', hostLoginUrl: 'https://anfitrion.example/entrar', delegated: { mode: 'trusted-header' } } } })
  const page = await declared.app.inject({ url: '/', headers: { accept: 'text/html' }, remoteAddress: '203.0.113.7' })
  assert.equal(page.statusCode, 302)
  assert.match(page.headers.location, /^https:\/\/anfitrion\.example\/entrar\?next=/)
  await declared.close()
})
