import assert from 'node:assert/strict'
import { createHmac, generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { exportJWK, SignJWT } from 'jose'
import { get, run } from '../db/index.js'
import { addMember, TEST_PASSWORD, login, makeEnv } from '../testing/helpers.js'
import { signHeader } from './delegated.js'
import { routePolicies } from './index.js'
import { hashPassword, loadBlocklist, validatePassword, verifyPassword } from './password.js'

const noIpLimit = { identity: { login: { ipMax: 1000 } } }

// ---------------------------------------------------------------- passwords
test('Argon2id: PHC hash with the OWASP parameters, and verification', async () => {
  const { loadConfig } = await import('../config.js')
  const params = loadConfig({}).identity.argon2
  const hash = await hashPassword(TEST_PASSWORD, params)
  assert.match(hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/)
  assert.equal((await verifyPassword(TEST_PASSWORD, hash, params)).ok, true)
  assert.equal((await verifyPassword(TEST_PASSWORD + 'x', hash, params)).ok, false)
  assert.equal((await verifyPassword(TEST_PASSWORD, hash, params)).rehash, false)
  // Two hashes of the same password differ (different salt).
  assert.notEqual(hash, await hashPassword(TEST_PASSWORD, params))
})

test('if the parameters change, the old hash verifies and asks for a rehash', async () => {
  const { loadConfig } = await import('../config.js')
  const oldParams = loadConfig({ ARGON2_MEMORY_KIB: '8192' }).identity.argon2
  const freshParams = loadConfig({}).identity.argon2
  const hash = await hashPassword(TEST_PASSWORD, oldParams)
  assert.deepEqual(await verifyPassword(TEST_PASSWORD, hash, freshParams), { ok: true, rehash: true })
})

test('a value that is not PHC does not verify (and does not throw)', async () => {
  const { loadConfig } = await import('../config.js')
  assert.deepEqual(await verifyPassword('x', 'texto-plano', loadConfig({}).identity.argon2), { ok: false, rehash: false })
})

test('policy: 15 to 128 characters with no composition rules, NFKC and a blocklist', () => {
  const policyText = { minLength: 15, maxLength: 128 }
  assert.throws(() => validatePassword('corta', policyText), /al menos 15/)
  assert.throws(() => validatePassword('a'.repeat(129), policyText), /hasta 128/)
  validatePassword('a'.repeat(15), policyText) // no uppercase, digits or symbols: valid
  validatePassword('あ'.repeat(15), policyText) // counts characters, not bytes
  // NFKC: full-width «ｐａｓｓ…» is normalized before counting and comparing.
  const blockList = new Set(['contraseña-comun-1'])
  assert.throws(() => validatePassword('contraseña-comun-1', policyText, blockList), /no permitidas/)
  assert.equal(loadBlocklist(''), null)
})

// ---------------------------------------------------------------- login
test('successful login: __Host- cookie HttpOnly Secure SameSite=Lax, opaque token and only its hash in the database', async () => {
  const env = await makeEnv({ config: noIpLimit })
  await addMember(env, { email: 'ana@x.org', role: 'editor' })
  const res = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ana@x.org', password: TEST_PASSWORD } })
  assert.equal(res.statusCode, 200)
  const c = res.cookies[0]
  assert.equal(c.name, '__Host-session')
  assert.equal(c.httpOnly, true)
  assert.equal(c.secure, true)
  assert.equal(c.sameSite, 'Lax')
  assert.equal(c.path, '/')
  assert.equal(c.domain, undefined)
  assert.equal(Buffer.from(c.value, 'base64url').length, 32) // 32 random bytes
  const rows = env.db.prepare('SELECT id FROM sessions').all()
  assert.equal(rows.length, 1)
  assert.notEqual(rows[0].id, c.value) // the database does not store the token
  assert.equal(rows[0].id.length, 64) // hexadecimal SHA-256
  assert.deepEqual(res.json().member, { id: '1', email: 'ana@x.org', name: 'ana', role: 'editor' })
  await env.close()
})

test('the email is case-insensitive', async () => {
  const env = await makeEnv({ config: noIpLimit })
  await addMember(env, { email: 'ana@x.org' })
  const res = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ANA@X.ORG', password: TEST_PASSWORD } })
  assert.equal(res.statusCode, 200)
  await env.close()
})

test('a nonexistent email, a wrong password and a locked account respond exactly the same', async () => {
  const env = await makeEnv({ config: noIpLimit, clock: true })
  await addMember(env, { email: 'ana@x.org' })
  await addMember(env, { email: 'bloqueada@x.org' })
  run(env.db, "UPDATE credentials SET failed_count = ? WHERE member_id = 2", env.config.identity.login.hardCap)
  const attemptNo = async (email, password) => {
    env.clock.t += 3_600_000 // no pending wait
    const r = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
    return { status: r.statusCode, body: r.body }
  }
  const a = await attemptNo('nadie@x.org', TEST_PASSWORD)
  const b = await attemptNo('ana@x.org', 'incorrecta-incorrecta')
  const c = await attemptNo('bloqueada@x.org', TEST_PASSWORD) // even though the password is correct
  assert.equal(a.status, 401)
  assert.equal(JSON.parse(a.body).code, 'invalid_credentials') // a bad pair is not an ended session: the panel reads the code (`unauthenticated` says «La sesión terminó»)
  assert.deepEqual(a, b)
  assert.deepEqual(b, c)
  await env.close()
})

test('exponential wait per account (1 s, 2 s, 4 s) with Retry-After, also for nonexistent emails', async () => {
  const env = await makeEnv({ config: noIpLimit, clock: true })
  await addMember(env, { email: 'ana@x.org' })
  for (const email of ['ana@x.org', 'fantasma@x.org']) {
    let waits = []
    for (let i = 0; i < 3; i++) {
      const badTry = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'incorrecta-incorrecta' } })
      assert.equal(badTry.statusCode, 401)
      const immediate = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: TEST_PASSWORD } })
      assert.equal(immediate.statusCode, 429) // not even with the correct password while the wait lasts
      waits.push(Number(immediate.headers['retry-after']))
      env.clock.t += Number(immediate.headers['retry-after']) * 1000
    }
    assert.deepEqual(waits, [1, 2, 4])
    env.clock.t += 3_600_000
  }
  // Once the wait has passed, the correct password gets in and the counter goes back to zero.
  const ok = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ana@x.org', password: TEST_PASSWORD } })
  assert.equal(ok.statusCode, 200)
  assert.equal(get(env.db, 'SELECT failed_count FROM credentials WHERE member_id = 1').failed_count, 0)
  await env.close()
})

test('per-IP limit: the fourth attempt in the window gets 429', async () => {
  const env = await makeEnv()
  const codeList = []
  for (let i = 0; i < 4; i++) {
    codeList.push((await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `x${i}@x.org`, password: TEST_PASSWORD }, remoteAddress: '203.0.113.9' })).statusCode)
  }
  assert.deepEqual(codeList, [401, 401, 401, 429])
  await env.close()
})

test('with a trusted proxy, each client has its own counter (X-Forwarded-For)', async () => {
  const env = await makeEnv()
  let n = 0 // each attempt uses a different email: this measures the per-IP counter, not the per-account wait
  const ask = (ip) => env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `x${n++}@x.org`, password: TEST_PASSWORD }, remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': ip } })
  for (let i = 0; i < 3; i++) await ask('198.51.100.1')
  assert.equal((await ask('198.51.100.1')).statusCode, 429)
  assert.equal((await ask('198.51.100.2')).statusCode, 401) // another client, another counter
  await env.close()
})

test('without a trusted proxy, X-Forwarded-For cannot be forged to evade the limit', async () => {
  const env = await makeEnv()
  let n = 0
  const ask = (xff) => env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `y${n++}@x.org`, password: TEST_PASSWORD }, remoteAddress: '203.0.113.50', headers: { 'x-forwarded-for': xff } })
  for (let i = 0; i < 3; i++) await ask(`198.51.100.${i}`)
  assert.equal((await ask('198.51.100.99')).statusCode, 429)
  await env.close()
})

test('the session is regenerated on every login and logout invalidates it on the server', async () => {
  const env = await makeEnv({ config: noIpLimit })
  await addMember(env, { email: 'ana@x.org' })
  const c1 = await login(env, 'ana@x.org')
  const c2 = await login(env, 'ana@x.org')
  assert.notEqual(c1, c2)
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: c1 } })).statusCode, 200)
  const outText = await env.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { 'x-team-request': 'panel', cookie: c1 } })
  assert.equal(outText.statusCode, 204)
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: c1 } })).statusCode, 401) // the token is no longer valid even if the client keeps it
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: c2 } })).statusCode, 200)
  await env.close()
})

test('the session expires by inactivity and by absolute age', async () => {
  const env = await makeEnv({ config: noIpLimit, clock: true })
  await addMember(env, { email: 'ana@x.org' })
  const cookie = await login(env, 'ana@x.org')
  const s = env.config.identity.session
  env.clock.t += (s.idleMinutes - 1) * 60_000
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie } })).statusCode, 200) // active: renews
  env.clock.t += (s.idleMinutes + 1) * 60_000
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie } })).statusCode, 401) // idle
  const c2 = await login(env, 'ana@x.org')
  // Activity every 20 minutes (always under the inactivity limit): it drops only on reaching the absolute maximum.
  const stepCount = (s.absoluteHours * 60) / 20
  for (let i = 1; i < stepCount; i++) {
    env.clock.t += 20 * 60_000
    assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: c2 } })).statusCode, 200, `step ${i}`)
  }
  env.clock.t += 20 * 60_000 // the absolute hours are reached
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: c2 } })).statusCode, 401)
  await env.close()
})

test('changing the role of a member closes their sessions', async () => {
  const env = await makeEnv({ config: noIpLimit })
  await addMember(env, { email: 'ed@x.org', role: 'editor' })
  await addMember(env, { email: 'ana@x.org' })
  const editor = await login(env, 'ed@x.org')
  const ana = await login(env, 'ana@x.org')
  const r = await env.app.inject({ method: 'PATCH', url: '/api/members/2', headers: { 'x-team-request': 'panel', cookie: editor }, payload: { role: 'editor' } })
  assert.equal(r.statusCode, 200)
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: ana } })).statusCode, 401)
  await env.close()
})

test('changing your own password requires the current one, closes the other sessions and keeps the current one', async () => {
  const env = await makeEnv({ config: noIpLimit })
  await addMember(env, { email: 'ana@x.org' })
  const a = await login(env, 'ana@x.org')
  const b = await login(env, 'ana@x.org')
  const bad = await env.app.inject({ method: 'PATCH', url: '/api/members/me', headers: { 'x-team-request': 'panel', cookie: a }, payload: { current_password: 'no-es-la-actual-xxxx', new_password: 'otra clave larga de prueba' } })
  assert.equal(bad.statusCode, 401)
  const tooShort = await env.app.inject({ method: 'PATCH', url: '/api/members/me', headers: { 'x-team-request': 'panel', cookie: a }, payload: { current_password: TEST_PASSWORD, new_password: 'corta' } })
  assert.equal(tooShort.statusCode, 400)
  const ok = await env.app.inject({ method: 'PATCH', url: '/api/members/me', headers: { 'x-team-request': 'panel', cookie: a }, payload: { current_password: TEST_PASSWORD, new_password: 'otra clave larga de prueba' } })
  assert.equal(ok.statusCode, 200)
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: a } })).statusCode, 200)
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: b } })).statusCode, 401)
  assert.equal((await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ana@x.org', password: 'otra clave larga de prueba' } })).statusCode, 200)
  await env.close()
})

// ---------------------------------------------------------------- CSRF
test('CSRF: Sec-Fetch-Site cross-site and same-site are rejected on unsafe methods; same-origin and none pass', async () => {
  const env = await makeEnv({ config: noIpLimit })
  await addMember(env, { email: 'ana@x.org' })
  const cookie = await login(env, 'ana@x.org')
  const post = (headers) => env.app.inject({ method: 'POST', url: '/api/inputs/1/cancel', headers: { 'x-team-request': 'panel', cookie, ...headers } })
  assert.equal((await post({ 'sec-fetch-site': 'cross-site' })).statusCode, 403)
  assert.equal((await post({ 'sec-fetch-site': 'same-site' })).statusCode, 403)
  assert.equal((await post({ 'sec-fetch-site': 'same-origin' })).statusCode, 404) // it passed the defense; the input does not exist
  assert.equal((await post({ 'sec-fetch-site': 'none' })).statusCode, 404)
  // Safe methods are not touched.
  const get_ = await env.app.inject({ url: '/api/me', headers: { cookie, 'sec-fetch-site': 'cross-site' } })
  assert.equal(get_.statusCode, 200)
  await env.close()
})

test('CSRF: without Sec-Fetch-Site, Origin is compared with the host; with neither, it passes (non-browser client)', async () => {
  const env = await makeEnv({ config: noIpLimit })
  await addMember(env, { email: 'ana@x.org' })
  const cookie = await login(env, 'ana@x.org')
  const post = (headers) => env.app.inject({ method: 'POST', url: '/api/inputs/1/cancel', headers: { 'x-team-request': 'panel', cookie, host: 'team.example.org', ...headers } })
  assert.equal((await post({ origin: 'https://evil.example.com' })).statusCode, 403)
  assert.equal((await post({ origin: 'null' })).statusCode, 403)
  assert.equal((await post({ origin: 'https://team.example.org' })).statusCode, 404)
  assert.equal((await post({})).statusCode, 404)
  await env.close()
})

test('CSRF: an origin listed in CORS_ORIGINS passes', async () => {
  const env = await makeEnv({ config: { ...noIpLimit, corsOrigins: ['https://sitio.example.org'] } })
  await addMember(env, { email: 'ana@x.org' })
  const cookie = await login(env, 'ana@x.org')
  const r = await env.app.inject({ method: 'POST', url: '/api/inputs/1/cancel', headers: { 'x-team-request': 'panel', cookie, origin: 'https://sitio.example.org', 'sec-fetch-site': 'cross-site' } })
  assert.equal(r.statusCode, 404)
  await env.close()
})

test('login CSRF: a POST /auth/login from another site is rejected', async () => {
  const env = await makeEnv({ config: noIpLimit })
  await addMember(env, { email: 'ana@x.org' })
  const r = await env.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'sec-fetch-site': 'cross-site' }, payload: { email: 'ana@x.org', password: TEST_PASSWORD } })
  assert.equal(r.statusCode, 403)
  await env.close()
})

// ---------------------------------------------------------------- roles and per-route policy
test('deny by default: every route declares its policy and the server does not start with one that does not', async () => {
  const env = await makeEnv()
  const routeList = routePolicies.get(env.app)
  assert.ok(routeList.length > 25)
  for (const r of routeList) assert.ok(['public', 'member', 'person', 'editor'].includes(r.policy), `${r.method} ${r.url}`)
  // A route without a policy makes registration fail.
  await assert.rejects(async () => {
    env.app.get('/api/sin-politica', async () => 'x')
    await env.app.ready()
  }, /does not declare its policy/)
  await env.close()
})

test('every protected route answers 401 without a session, and editor routes 403 to a member', async () => {
  const env = await makeEnv({ config: noIpLimit })
  await addMember(env, { email: 'ana@x.org' })
  const cookie = await login(env, 'ana@x.org')
  const routeList = routePolicies.get(env.app).filter((r) => r.method !== 'HEAD')
  let checked = 0
  for (const r of routeList) {
    if (r.policy === 'public') continue
    const url = r.url.replace(/:[A-Za-z]+/g, '1')
    const noSession = await env.app.inject({ method: r.method, url })
    assert.equal(noSession.statusCode, 401, `${r.method} ${url} without a session`)
    if (r.policy === 'editor') {
      const asMember = await env.app.inject({ method: r.method, url, headers: { cookie, 'x-team-request': 'panel' }, payload: r.method === 'GET' || r.method === 'DELETE' ? undefined : {} })
      assert.equal(asMember.statusCode, 403, `${r.method} ${url} as a member`)
    }
    checked++
  }
  assert.ok(checked >= 25)
  // The ones the spec marks as editor routes.
  const editorRoutes = new Set(routeList.filter((r) => r.policy === 'editor').map((r) => `${r.method} ${r.url.replace(/^\/api/, '')}`))
  for (const expectedRoute of ['POST /areas', 'PATCH /areas/:id', 'PATCH /settings/project', 'PATCH /settings/analysis', 'POST /areas/:id/templates']) {
    assert.ok(editorRoutes.has(expectedRoute), `${expectedRoute} debería ser de editor`)
  }
  await env.close()
})

test('a member edits only their own profile, language and password', async () => {
  const env = await makeEnv({ config: noIpLimit })
  await addMember(env, { email: 'ana@x.org' })
  const cookie = await login(env, 'ana@x.org')
  const ok = await env.app.inject({ method: 'PATCH', url: '/api/members/me', headers: { 'x-team-request': 'panel', cookie }, payload: { profile: 'Hago la API.\n\nPrefiero capturas.' } })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().profile, 'Hago la API.\n\nPrefiero capturas.')
  const tooLong = await env.app.inject({ method: 'PATCH', url: '/api/members/me', headers: { 'x-team-request': 'panel', cookie }, payload: { profile: 'x'.repeat(env.config.members.profileMaxLength + 1) } })
  assert.equal(tooLong.statusCode, 400)
  const atCap = await env.app.inject({ method: 'PATCH', url: '/api/members/me', headers: { 'x-team-request': 'panel', cookie }, payload: { profile: 'x'.repeat(env.config.members.profileMaxLength) } })
  assert.equal(atCap.statusCode, 200)
  for (const oldField of ['responsibilities', 'domains']) {
    const old = await env.app.inject({ method: 'PATCH', url: '/api/members/me', headers: { 'x-team-request': 'panel', cookie }, payload: { [oldField]: 'x' } })
    assert.equal(old.statusCode, 400, oldField)
  }
  for (const fieldName of ['role', 'name', 'email']) {
    const r = await env.app.inject({ method: 'PATCH', url: '/api/members/me', headers: { 'x-team-request': 'panel', cookie }, payload: { [fieldName]: 'editor' } })
    assert.equal(r.statusCode, 400, fieldName)
  }
  await env.close()
})

// ---------------------------------------------------------------- delegated identity
const delegatedConfig = (extra) => ({ config: { identity: { provider: 'delegated', delegated: extra } } })
const signedHeaders = (sharedSecret, { email, ts = Math.floor(Date.now() / 1000), method = 'GET', pathname = '/api/me' }) => ({
  'x-team-user': email, 'x-team-ts': String(ts),
  'x-team-sig': signHeader(sharedSecret, { ts, method, pathname, email, bind: true })
})

test('signed-header: a valid signature gets in; a tampered signature, timestamp, route or method does not', async () => {
  const env = await makeEnv(delegatedConfig({ mode: 'signed-header', secrets: ['secreto-uno'] }))
  await addMember(env, { email: 'ana@x.org', role: 'editor' })
  const ok = await env.app.inject({ url: '/api/me', headers: signedHeaders('secreto-uno', { email: 'ana@x.org' }) })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().email, 'ana@x.org')
  assert.equal(ok.json().provider, 'delegated:signed-header')
  const badSignature = await env.app.inject({ url: '/api/me', headers: signedHeaders('otro-secreto', { email: 'ana@x.org' }) })
  assert.equal(badSignature.statusCode, 401)
  const stale = await env.app.inject({ url: '/api/me', headers: signedHeaders('secreto-uno', { email: 'ana@x.org', ts: Math.floor(Date.now() / 1000) - 301 }) })
  assert.equal(stale.statusCode, 401)
  const future = await env.app.inject({ url: '/api/me', headers: signedHeaders('secreto-uno', { email: 'ana@x.org', ts: Math.floor(Date.now() / 1000) + 301 }) })
  assert.equal(future.statusCode, 401)
  // A signature captured for GET /api/me is no good for another route or method (the signature covers both).
  const otherRoute = await env.app.inject({ url: '/api/members', headers: signedHeaders('secreto-uno', { email: 'ana@x.org' }) })
  assert.equal(otherRoute.statusCode, 401)
  const otherEmail = await env.app.inject({ url: '/api/me', headers: { ...signedHeaders('secreto-uno', { email: 'ana@x.org' }), 'x-team-user': 'otra@x.org' } })
  assert.equal(otherEmail.statusCode, 401)
  assert.equal((await env.app.inject({ url: '/api/me' })).statusCode, 401)
  await env.close()
})

test('signed-header: accepts two secrets during rotation', async () => {
  const env = await makeEnv(delegatedConfig({ mode: 'signed-header', secrets: ['nuevo', 'viejo'] }))
  await addMember(env, { email: 'ana@x.org' })
  for (const s of ['nuevo', 'viejo']) assert.equal((await env.app.inject({ url: '/api/me', headers: signedHeaders(s, { email: 'ana@x.org' }) })).statusCode, 200)
  assert.equal((await env.app.inject({ url: '/api/me', headers: signedHeaders('retirado', { email: 'ana@x.org' }) })).statusCode, 401)
  await env.close()
})

test('delegated: no mode creates members (403) and /auth/login does not exist', async () => {
  const env = await makeEnv(delegatedConfig({ mode: 'signed-header', secrets: ['s'] }))
  const r = await env.app.inject({ url: '/api/me', headers: signedHeaders('s', { email: 'desconocida@x.org' }) })
  assert.equal(r.statusCode, 403)
  assert.equal(r.json().code, 'member_not_registered')
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM members').n, 0) // nothing was created
  assert.equal((await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.c', password: TEST_PASSWORD } })).statusCode, 404)
  await env.close()
})

test('delegated: the role comes from the database and not from the provider (UD-007)', async () => {
  const env = await makeEnv(delegatedConfig({ mode: 'signed-header', secrets: ['s'] }))
  await addMember(env, { email: 'ana@x.org', role: 'member' })
  const r = await env.app.inject({ url: '/api/me', headers: signedHeaders('s', { email: 'ana@x.org', pathname: '/api/me' }) })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().role, 'member') // the database's role, not the provider's
  await env.close()
})

const JWT = { mode: 'jwt', jwt: { secret: 'clave-compartida-de-al-menos-32-bytes!!', issuer: 'https://anfitrion.example', audience: 'team-platform' } }
const signJwt = (payload, { secret = JWT.jwt.secret, alg = 'HS256', iss = JWT.jwt.issuer, aud = JWT.jwt.audience, exp = '5m' } = {}) =>
  new SignJWT(payload).setProtectedHeader({ alg }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(new TextEncoder().encode(secret))

test('jwt (shared secret): a valid one gets in; a different issuer, audience, expiry, signature or algorithm does not', async () => {
  const env = await makeEnv(delegatedConfig(JWT))
  await addMember(env, { email: 'ana@x.org' })
  const ask = (tokenValue) => env.app.inject({ url: '/api/me', headers: { authorization: `Bearer ${tokenValue}` } })
  assert.equal((await ask(await signJwt({ email: 'ana@x.org' }))).statusCode, 200)
  assert.equal((await ask(await signJwt({ email: 'ana@x.org' }, { iss: 'https://otro' }))).statusCode, 401)
  assert.equal((await ask(await signJwt({ email: 'ana@x.org' }, { aud: 'otra-app' }))).statusCode, 401)
  assert.equal((await ask(await signJwt({ email: 'ana@x.org' }, { exp: Math.floor(Date.now() / 1000) - 60 }))).statusCode, 401)
  assert.equal((await ask(await signJwt({ email: 'ana@x.org' }, { secret: 'otra-clave-compartida-de-32-bytes!!!!' }))).statusCode, 401)
  assert.equal((await ask(await signJwt({ email: 'ana@x.org' }, { alg: 'HS512' }))).statusCode, 401) // the algorithm is fixed by the configuration
  const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ email: 'ana@x.org', iss: JWT.jwt.issuer, aud: JWT.jwt.audience })).toString('base64url')}.`
  assert.equal((await ask(unsigned)).statusCode, 401) // alg none
  assert.equal((await ask(await signJwt({}))).statusCode, 401) // no email
  assert.equal((await ask(await signJwt({ email: 'nadie@x.org' }))).statusCode, 403) // not registered
  assert.equal((await env.app.inject({ url: '/api/me', headers: { authorization: 'Basic abc' } })).statusCode, 401)
  await env.close()
})

test('jwt (remote JWKS RS256): picks the key by kid and fetches again on a new kid', async () => {
  const pair1 = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pair2 = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = async (pair, kid) => ({ ...(await exportJWK(pair.publicKey)), kid, alg: 'RS256', use: 'sig' })
  let jwks = [await jwk(pair1, 'k1')]
  const serverProc = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: jwks })) })
  await new Promise((r) => serverProc.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${serverProc.address().port}/jwks.json`
  const env = await makeEnv(delegatedConfig({ mode: 'jwt', jwt: { jwksUrl: url, jwksCooldownMs: 0, header: 'cf-access-jwt-assertion', issuer: 'https://anfitrion.example', audience: 'team-platform' } }))
  await addMember(env, { email: 'ana@x.org' })
  const signature = (pair, kid) => new SignJWT({ email: 'ana@x.org' }).setProtectedHeader({ alg: 'RS256', kid }).setIssuer('https://anfitrion.example').setAudience('team-platform').setExpirationTime('5m').sign(pair.privateKey)
  const ask = (tokenValue) => env.app.inject({ url: '/api/me', headers: { 'cf-access-jwt-assertion': tokenValue } })
  assert.equal((await ask(await signature(pair1, 'k1'))).statusCode, 200)
  assert.equal((await ask(await signature(pair2, 'k1'))).statusCode, 401) // another key with the known kid
  jwks = [await jwk(pair1, 'k1'), await jwk(pair2, 'k2')] // the host rotates
  assert.equal((await ask(await signature(pair2, 'k2'))).statusCode, 200)
  await env.close()
  await new Promise((r) => serverProc.close(r))
})

test('trusted-header: only valid if the connection comes from a trusted address', async () => {
  const env = await makeEnv(delegatedConfig({ mode: 'trusted-header' }))
  await addMember(env, { email: 'ana@x.org' })
  const h = { 'tailscale-user-login': 'ana@x.org' }
  assert.equal((await env.app.inject({ url: '/api/me', headers: h, remoteAddress: '127.0.0.1' })).statusCode, 200)
  assert.equal((await env.app.inject({ url: '/api/me', headers: h, remoteAddress: '203.0.113.7' })).statusCode, 401) // anyone could set the header
  assert.equal((await env.app.inject({ url: '/api/me', headers: { 'tailscale-user-login': 'nadie@x.org' }, remoteAddress: '127.0.0.1' })).statusCode, 403)
  await env.close()
})

test('sso-redirect: single-use nonce tied to the browser, signature, verified email and mapping by external identifier', async () => {
  const sharedSecret = 'secreto-sso'
  const env = await makeEnv({
    config: { publicUrl: 'https://team.example', identity: { provider: 'delegated', delegated: { mode: 'sso-redirect', sso: { loginUrl: 'https://anfitrion.example/sso', secret: sharedSecret } } } }
  })
  await addMember(env, { email: 'ana@x.org', role: 'editor' })
  await addMember(env, { email: 'otra@x.org' })
  const noSession = await env.app.inject({ url: '/api/me' })
  assert.equal(noSession.statusCode, 401)
  assert.equal(noSession.json().login_url, '/api/auth/sso/start')

  const startFlow = async () => {
    const r = await env.app.inject({ url: '/api/auth/sso/start' })
    assert.equal(r.statusCode, 302)
    const target = new URL(r.headers.location)
    assert.equal(target.origin + target.pathname, 'https://anfitrion.example/sso')
    const sso = target.searchParams.get('sso')
    assert.equal(target.searchParams.get('sig'), createHmac('sha256', sharedSecret).update(sso).digest('hex'))
    const payloadData = JSON.parse(Buffer.from(sso, 'base64url').toString())
    assert.equal(payloadData.return_sso_url, 'https://team.example/api/auth/sso/callback')
    const nonceCookie = r.cookies.find((c) => c.name === '__Host-sso')
    return { nonce: payloadData.nonce, cookie: `${nonceCookie.name}=${nonceCookie.value}` }
  }
  const callbackRes = async ({ nonce, cookie }, memberData, { secret = sharedSecret } = {}) => {
    const sso = Buffer.from(JSON.stringify({ nonce, ...memberData })).toString('base64url')
    const sig = createHmac('sha256', secret).update(sso).digest('hex')
    return env.app.inject({ url: `/api/auth/sso/callback?sso=${sso}&sig=${sig}`, headers: { cookie } })
  }

  // Happy path.
  const a = await startFlow()
  const ok = await callbackRes(a, { email: 'ana@x.org', external_id: 'u-77', email_verified: true })
  assert.equal(ok.statusCode, 302)
  assert.equal(ok.headers.location, '/')
  const sessionRow = ok.cookies.find((c) => c.name === '__Host-session')
  const me = await env.app.inject({ url: '/api/me', headers: { cookie: `${sessionRow.name}=${sessionRow.value}` } })
  assert.equal(me.json().email, 'ana@x.org')
  // The nonce is single use.
  assert.equal((await callbackRes(a, { email: 'ana@x.org', external_id: 'u-77', email_verified: true })).statusCode, 403)
  // Forged signature.
  const b = await startFlow()
  assert.equal((await callbackRes(b, { email: 'ana@x.org', email_verified: true }, { secret: 'otro' })).statusCode, 403)
  // Nonce from another browser: the cookie does not match.
  const c = await startFlow()
  assert.equal((await callbackRes({ nonce: c.nonce, cookie: b.cookie }, { email: 'ana@x.org', email_verified: true })).statusCode, 403)
  // Email not verified by the host.
  const d = await startFlow()
  assert.equal((await callbackRes(d, { email: 'ana@x.org', external_id: 'u-1', email_verified: false })).statusCode, 403)
  // Nonexistent member: not created.
  const e = await startFlow()
  const notMember = await callbackRes(e, { email: 'nadie@x.org', external_id: 'u-9', email_verified: true })
  assert.equal(notMember.statusCode, 403)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM members').n, 2)
  // Mapping by stable external identifier: u-77 is still Ana even if the host sends another email.
  const f = await startFlow()
  const byExternal = await callbackRes(f, { email: 'otra@x.org', external_id: 'u-77', email_verified: true })
  const s2 = byExternal.cookies.find((c) => c.name === '__Host-session')
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: `${s2.name}=${s2.value}` } })).json().email, 'ana@x.org')
  // Expired nonce.
  const g = await startFlow()
  run(env.db, 'UPDATE sso_nonces SET created_at = created_at - ?', (env.config.identity.delegated.sso.nonceMinutes + 1) * 60_000)
  assert.equal((await callbackRes(g, { email: 'ana@x.org', email_verified: true })).statusCode, 403)
  await env.close()
})

test('invalid configuration prevents startup (no issuer/audience, no secrets, no publicUrl)', async () => {
  const { loadConfig } = await import('../config.js')
  assert.throws(() => loadConfig({ IDENTITY_PROVIDER: 'delegated', DELEGATED_MODE: 'signed-header' }), /DELEGATED_SECRETS/)
  assert.throws(() => loadConfig({ IDENTITY_PROVIDER: 'delegated', DELEGATED_MODE: 'jwt', JWT_SECRET: 'x' }), /JWT_ISSUER/)
  assert.throws(() => loadConfig({ IDENTITY_PROVIDER: 'delegated', DELEGATED_MODE: 'sso-redirect', SSO_LOGIN_URL: 'https://a', SSO_SECRET: 'x' }), /PUBLIC_URL/)
})

test('H-2605, H-3720 · /me names the provider and the source; every provider has a sign-out that closes the session of our own', async () => {
  const logout = (env, cookie) => env.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { 'x-team-request': 'panel', ...(cookie ? { cookie } : {}) } })
  const trusted = await makeEnv(delegatedConfig({ mode: 'trusted-header' }))
  await addMember(trusted, { email: 'ana@x.org' })
  const me = await trusted.app.inject({ url: '/api/me', headers: { 'tailscale-user-login': 'ana@x.org', 'sec-fetch-site': 'same-origin' }, remoteAddress: '127.0.0.1' })
  assert.equal(me.json().provider, 'delegated:trusted-header')
  assert.equal(me.json().source, 'trusted-header')
  const own = me.cookies.find((c) => c.name === '__Host-session')
  assert.ok(own, 'a browser identified by the proxy gets a session of our own')
  const out = await logout(trusted, `${own.name}=${own.value}`)
  assert.equal(out.statusCode, 204)
  assert.equal(get(trusted.db, 'SELECT COUNT(*) AS n FROM sessions').n, 0) // destroyed on the server
  // The proxy still says who the person is: the panel keeps its button hidden here unless LOGOUT_URL names the host's sign-out.
  await trusted.close()

  const local = await makeEnv(noIpLimit)
  await addMember(local, { email: 'ana@x.org' })
  const cookie = await login(local, 'ana@x.org')
  assert.equal((await local.app.inject({ url: '/api/me', headers: { cookie } })).json().provider, 'local')
  assert.equal((await logout(local)).statusCode, 204)
  await local.close()

  const sso = await makeEnv({ config: { publicUrl: 'https://team.example', identity: { provider: 'delegated', delegated: { mode: 'sso-redirect', sso: { loginUrl: 'https://anfitrion.example/sso', secret: 'secreto-sso' } } } } })
  assert.equal((await logout(sso)).statusCode, 204) // the panel keeps its button here
  await sso.close()
})

// A token issued before a role change never undoes it (the session of the host outlives the change).
test('jwt (host provision): an older token does not overwrite a role applied by a newer one', async () => {
  const env = await makeEnv({ config: { identity: { provider: 'delegated', provision: 'host', jwtRoleClaim: 'team_role', delegated: JWT } } })
  const withIat = (claims, iat) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuer(JWT.jwt.issuer).setAudience(JWT.jwt.audience).setIssuedAt(iat)
      .setExpirationTime('1h').sign(new TextEncoder().encode(JWT.jwt.secret))
  const ask = async (claims, iat) => env.app.inject({ url: '/api/me', headers: { authorization: `Bearer ${await withIat(claims, iat)}` } })
  const roleNow = () => get(env.db, 'SELECT role FROM members WHERE email = ?', 'ana@x.org').role
  const t0 = Math.floor(Date.now() / 1000) - 600
  assert.equal((await ask({ email: 'ana@x.org', team_role: 'member' }, t0)).statusCode, 200)
  assert.equal(roleNow(), 'member')
  assert.equal((await ask({ email: 'ana@x.org', team_role: 'editor' }, t0 + 300)).statusCode, 200)
  assert.equal(roleNow(), 'editor')
  // the open session still carries the token from before the change
  assert.equal((await ask({ email: 'ana@x.org', team_role: 'member' }, t0)).statusCode, 200)
  assert.equal(roleNow(), 'editor')
  // a newer token lowers it again: the host governs
  assert.equal((await ask({ email: 'ana@x.org', team_role: 'member' }, t0 + 400)).statusCode, 200)
  assert.equal(roleNow(), 'member')
})
