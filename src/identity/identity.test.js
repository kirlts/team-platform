import assert from 'node:assert/strict'
import { createHmac, generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { exportJWK, SignJWT } from 'jose'
import { get, run } from '../db/index.js'
import { addMember, CLAVE, login, makeEnv } from '../testing/helpers.js'
import { firmarCabecera } from './delegated.js'
import { routePolicies } from './index.js'
import { hashPassword, loadBlocklist, validatePassword, verifyPassword } from './password.js'

const sinLimiteIp = { identity: { login: { ipMax: 1000 } } }

// ---------------------------------------------------------------- contraseñas
test('Argon2id: hash PHC con los parámetros de OWASP y verificación', async () => {
  const { loadConfig } = await import('../config.js')
  const params = loadConfig({}).identity.argon2
  const hash = await hashPassword(CLAVE, params)
  assert.match(hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/)
  assert.equal((await verifyPassword(CLAVE, hash, params)).ok, true)
  assert.equal((await verifyPassword(CLAVE + 'x', hash, params)).ok, false)
  assert.equal((await verifyPassword(CLAVE, hash, params)).rehash, false)
  // Dos hashes de la misma clave difieren (sal distinta).
  assert.notEqual(hash, await hashPassword(CLAVE, params))
})

test('si cambian los parámetros, el hash viejo verifica y pide rehash', async () => {
  const { loadConfig } = await import('../config.js')
  const viejos = loadConfig({ ARGON2_MEMORY_KIB: '8192' }).identity.argon2
  const nuevos = loadConfig({}).identity.argon2
  const hash = await hashPassword(CLAVE, viejos)
  assert.deepEqual(await verifyPassword(CLAVE, hash, nuevos), { ok: true, rehash: true })
})

test('un valor que no es PHC no verifica (y no lanza)', async () => {
  const { loadConfig } = await import('../config.js')
  assert.deepEqual(await verifyPassword('x', 'texto-plano', loadConfig({}).identity.argon2), { ok: false, rehash: false })
})

test('política: 15 a 128 caracteres sin reglas de composición, NFKC y lista de bloqueo', () => {
  const politica = { minLength: 15, maxLength: 128 }
  assert.throws(() => validatePassword('corta', politica), /al menos 15/)
  assert.throws(() => validatePassword('a'.repeat(129), politica), /hasta 128/)
  validatePassword('a'.repeat(15), politica) // sin mayúsculas, números ni símbolos: vale
  validatePassword('あ'.repeat(15), politica) // cuenta caracteres, no bytes
  // NFKC: «ｐａｓｓ…» de ancho completo se normaliza antes de contar y de comparar.
  const bloqueo = new Set(['contraseña-comun-1'])
  assert.throws(() => validatePassword('contraseña-comun-1', politica, bloqueo), /no permitidas/)
  assert.equal(loadBlocklist(''), null)
})

// ---------------------------------------------------------------- inicio de sesión
test('login correcto: cookie __Host- HttpOnly Secure SameSite=Lax, ficha opaca y sólo su hash en la base', async () => {
  const env = await makeEnv({ config: sinLimiteIp })
  await addMember(env, { email: 'ana@x.org', role: 'editor' })
  const res = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ana@x.org', password: CLAVE } })
  assert.equal(res.statusCode, 200)
  const c = res.cookies[0]
  assert.equal(c.name, '__Host-session')
  assert.equal(c.httpOnly, true)
  assert.equal(c.secure, true)
  assert.equal(c.sameSite, 'Lax')
  assert.equal(c.path, '/')
  assert.equal(c.domain, undefined)
  assert.equal(Buffer.from(c.value, 'base64url').length, 32) // 32 bytes al azar
  const filas = env.db.prepare('SELECT id FROM sessions').all()
  assert.equal(filas.length, 1)
  assert.notEqual(filas[0].id, c.value) // la base no guarda la ficha
  assert.equal(filas[0].id.length, 64) // SHA-256 hexadecimal
  assert.deepEqual(res.json().member, { id: 1, email: 'ana@x.org', name: 'ana', role: 'editor' })
  await env.close()
})

test('el correo no distingue mayúsculas', async () => {
  const env = await makeEnv({ config: sinLimiteIp })
  await addMember(env, { email: 'ana@x.org' })
  const res = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ANA@X.ORG', password: CLAVE } })
  assert.equal(res.statusCode, 200)
  await env.close()
})

test('correo inexistente, clave errónea y cuenta bloqueada responden exactamente lo mismo', async () => {
  const env = await makeEnv({ config: sinLimiteIp, clock: true })
  await addMember(env, { email: 'ana@x.org' })
  await addMember(env, { email: 'bloqueada@x.org' })
  run(env.db, "UPDATE credentials SET failed_count = ? WHERE member_id = 2", env.config.identity.login.hardCap)
  const intento = async (email, password) => {
    env.clock.t += 3_600_000 // sin espera pendiente
    const r = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
    return { status: r.statusCode, body: r.body }
  }
  const a = await intento('nadie@x.org', CLAVE)
  const b = await intento('ana@x.org', 'incorrecta-incorrecta')
  const c = await intento('bloqueada@x.org', CLAVE) // aunque la clave sea correcta
  assert.equal(a.status, 401)
  assert.deepEqual(a, b)
  assert.deepEqual(b, c)
  await env.close()
})

test('espera exponencial por cuenta (1 s, 2 s, 4 s) con Retry-After, también para correos inexistentes', async () => {
  const env = await makeEnv({ config: sinLimiteIp, clock: true })
  await addMember(env, { email: 'ana@x.org' })
  for (const email of ['ana@x.org', 'fantasma@x.org']) {
    let esperas = []
    for (let i = 0; i < 3; i++) {
      const mala = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'incorrecta-incorrecta' } })
      assert.equal(mala.statusCode, 401)
      const inmediata = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: CLAVE } })
      assert.equal(inmediata.statusCode, 429) // ni con la clave correcta mientras dure la espera
      esperas.push(Number(inmediata.headers['retry-after']))
      env.clock.t += Number(inmediata.headers['retry-after']) * 1000
    }
    assert.deepEqual(esperas, [1, 2, 4])
    env.clock.t += 3_600_000
  }
  // Pasada la espera, la clave correcta entra y el contador vuelve a cero.
  const ok = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ana@x.org', password: CLAVE } })
  assert.equal(ok.statusCode, 200)
  assert.equal(get(env.db, 'SELECT failed_count FROM credentials WHERE member_id = 1').failed_count, 0)
  await env.close()
})

test('límite por IP: el cuarto intento en la ventana recibe 429', async () => {
  const env = await makeEnv()
  const codigos = []
  for (let i = 0; i < 4; i++) {
    codigos.push((await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `x${i}@x.org`, password: CLAVE }, remoteAddress: '203.0.113.9' })).statusCode)
  }
  assert.deepEqual(codigos, [401, 401, 401, 429])
  await env.close()
})

test('con proxy de confianza, cada cliente tiene su propio contador (X-Forwarded-For)', async () => {
  const env = await makeEnv()
  let n = 0 // cada intento usa un correo distinto: acá se mide el contador por IP, no la espera por cuenta
  const pedir = (ip) => env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `x${n++}@x.org`, password: CLAVE }, remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': ip } })
  for (let i = 0; i < 3; i++) await pedir('198.51.100.1')
  assert.equal((await pedir('198.51.100.1')).statusCode, 429)
  assert.equal((await pedir('198.51.100.2')).statusCode, 401) // otro cliente, otro contador
  await env.close()
})

test('sin proxy de confianza, X-Forwarded-For no se puede falsificar para esquivar el límite', async () => {
  const env = await makeEnv()
  let n = 0
  const pedir = (xff) => env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `y${n++}@x.org`, password: CLAVE }, remoteAddress: '203.0.113.50', headers: { 'x-forwarded-for': xff } })
  for (let i = 0; i < 3; i++) await pedir(`198.51.100.${i}`)
  assert.equal((await pedir('198.51.100.99')).statusCode, 429)
  await env.close()
})

test('la sesión se regenera en cada inicio y logout la invalida en el servidor', async () => {
  const env = await makeEnv({ config: sinLimiteIp })
  await addMember(env, { email: 'ana@x.org' })
  const c1 = await login(env, 'ana@x.org')
  const c2 = await login(env, 'ana@x.org')
  assert.notEqual(c1, c2)
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: c1 } })).statusCode, 200)
  const salida = await env.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: c1 } })
  assert.equal(salida.statusCode, 204)
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: c1 } })).statusCode, 401) // la ficha ya no vale aunque el cliente la conserve
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: c2 } })).statusCode, 200)
  await env.close()
})

test('la sesión vence por inactividad y por antigüedad absoluta', async () => {
  const env = await makeEnv({ config: sinLimiteIp, clock: true })
  await addMember(env, { email: 'ana@x.org' })
  const cookie = await login(env, 'ana@x.org')
  const s = env.config.identity.session
  env.clock.t += (s.idleMinutes - 1) * 60_000
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie } })).statusCode, 200) // activa: renueva
  env.clock.t += (s.idleMinutes + 1) * 60_000
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie } })).statusCode, 401) // ociosa
  const c2 = await login(env, 'ana@x.org')
  // Actividad cada 20 minutos (siempre bajo la inactividad): cae sólo por llegar al máximo absoluto.
  const pasos = (s.absoluteHours * 60) / 20
  for (let i = 1; i < pasos; i++) {
    env.clock.t += 20 * 60_000
    assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: c2 } })).statusCode, 200, `paso ${i}`)
  }
  env.clock.t += 20 * 60_000 // se cumplen las horas absolutas
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: c2 } })).statusCode, 401)
  await env.close()
})

test('cambiar el rol de un miembro cierra sus sesiones', async () => {
  const env = await makeEnv({ config: sinLimiteIp })
  await addMember(env, { email: 'ed@x.org', role: 'editor' })
  await addMember(env, { email: 'ana@x.org' })
  const editor = await login(env, 'ed@x.org')
  const ana = await login(env, 'ana@x.org')
  const r = await env.app.inject({ method: 'PATCH', url: '/api/members/2', headers: { cookie: editor }, payload: { role: 'editor' } })
  assert.equal(r.statusCode, 200)
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: ana } })).statusCode, 401)
  await env.close()
})

test('el cambio de contraseña propio exige la actual, cierra las demás sesiones y conserva la actual', async () => {
  const env = await makeEnv({ config: sinLimiteIp })
  await addMember(env, { email: 'ana@x.org' })
  const a = await login(env, 'ana@x.org')
  const b = await login(env, 'ana@x.org')
  const mal = await env.app.inject({ method: 'PATCH', url: '/api/members/me', headers: { cookie: a }, payload: { current_password: 'no-es-la-actual-xxxx', new_password: 'otra clave larga de prueba' } })
  assert.equal(mal.statusCode, 401)
  const corta = await env.app.inject({ method: 'PATCH', url: '/api/members/me', headers: { cookie: a }, payload: { current_password: CLAVE, new_password: 'corta' } })
  assert.equal(corta.statusCode, 400)
  const ok = await env.app.inject({ method: 'PATCH', url: '/api/members/me', headers: { cookie: a }, payload: { current_password: CLAVE, new_password: 'otra clave larga de prueba' } })
  assert.equal(ok.statusCode, 200)
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: a } })).statusCode, 200)
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: b } })).statusCode, 401)
  assert.equal((await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ana@x.org', password: 'otra clave larga de prueba' } })).statusCode, 200)
  await env.close()
})

// ---------------------------------------------------------------- CSRF
test('CSRF: Sec-Fetch-Site cross-site y same-site se rechazan en métodos no seguros; same-origin y none pasan', async () => {
  const env = await makeEnv({ config: sinLimiteIp })
  await addMember(env, { email: 'ana@x.org' })
  const cookie = await login(env, 'ana@x.org')
  const post = (headers) => env.app.inject({ method: 'POST', url: '/api/inputs/1/cancel', headers: { cookie, ...headers } })
  assert.equal((await post({ 'sec-fetch-site': 'cross-site' })).statusCode, 403)
  assert.equal((await post({ 'sec-fetch-site': 'same-site' })).statusCode, 403)
  assert.equal((await post({ 'sec-fetch-site': 'same-origin' })).statusCode, 404) // pasó la defensa; el input no existe
  assert.equal((await post({ 'sec-fetch-site': 'none' })).statusCode, 404)
  // Los métodos seguros no se tocan.
  const get_ = await env.app.inject({ url: '/api/me', headers: { cookie, 'sec-fetch-site': 'cross-site' } })
  assert.equal(get_.statusCode, 200)
  await env.close()
})

test('CSRF: sin Sec-Fetch-Site se compara Origin con el anfitrión; sin ninguno, pasa (cliente no navegador)', async () => {
  const env = await makeEnv({ config: sinLimiteIp })
  await addMember(env, { email: 'ana@x.org' })
  const cookie = await login(env, 'ana@x.org')
  const post = (headers) => env.app.inject({ method: 'POST', url: '/api/inputs/1/cancel', headers: { cookie, host: 'team.example.org', ...headers } })
  assert.equal((await post({ origin: 'https://evil.example.com' })).statusCode, 403)
  assert.equal((await post({ origin: 'null' })).statusCode, 403)
  assert.equal((await post({ origin: 'https://team.example.org' })).statusCode, 404)
  assert.equal((await post({})).statusCode, 404)
  await env.close()
})

test('CSRF: un origen listado en ALLOWED_ORIGINS pasa', async () => {
  const env = await makeEnv({ config: { ...sinLimiteIp, allowedOrigins: ['https://sitio.example.org'] } })
  await addMember(env, { email: 'ana@x.org' })
  const cookie = await login(env, 'ana@x.org')
  const r = await env.app.inject({ method: 'POST', url: '/api/inputs/1/cancel', headers: { cookie, origin: 'https://sitio.example.org', 'sec-fetch-site': 'cross-site' } })
  assert.equal(r.statusCode, 404)
  await env.close()
})

test('CSRF de inicio de sesión: un POST /auth/login desde otro sitio se rechaza', async () => {
  const env = await makeEnv({ config: sinLimiteIp })
  await addMember(env, { email: 'ana@x.org' })
  const r = await env.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'sec-fetch-site': 'cross-site' }, payload: { email: 'ana@x.org', password: CLAVE } })
  assert.equal(r.statusCode, 403)
  await env.close()
})

// ---------------------------------------------------------------- roles y política por ruta
test('denegar por omisión: toda ruta declara su política y el servidor no arranca con una que no', async () => {
  const env = await makeEnv()
  const rutas = routePolicies.get(env.app)
  assert.ok(rutas.length > 25)
  for (const r of rutas) assert.ok(['public', 'member', 'editor'].includes(r.policy), `${r.method} ${r.url}`)
  // Una ruta sin política hace fallar el registro.
  await assert.rejects(async () => {
    env.app.get('/api/sin-politica', async () => 'x')
    await env.app.ready()
  }, /no declara su política/)
  await env.close()
})

test('toda ruta protegida responde 401 sin sesión, y las de editor 403 a un miembro', async () => {
  const env = await makeEnv({ config: sinLimiteIp })
  await addMember(env, { email: 'ana@x.org' })
  const cookie = await login(env, 'ana@x.org')
  const rutas = routePolicies.get(env.app).filter((r) => r.method !== 'HEAD')
  let verificadas = 0
  for (const r of rutas) {
    if (r.policy === 'public') continue
    const url = r.url.replace(/:[A-Za-z]+/g, '1')
    const sinSesion = await env.app.inject({ method: r.method, url })
    assert.equal(sinSesion.statusCode, 401, `${r.method} ${url} sin sesión`)
    if (r.policy === 'editor') {
      const comoMiembro = await env.app.inject({ method: r.method, url, headers: { cookie }, payload: r.method === 'GET' || r.method === 'DELETE' ? undefined : {} })
      assert.equal(comoMiembro.statusCode, 403, `${r.method} ${url} como miembro`)
    }
    verificadas++
  }
  assert.ok(verificadas >= 25)
  // Las que el spec marca como del editor.
  const del = new Set(rutas.filter((r) => r.policy === 'editor').map((r) => `${r.method} ${r.url.replace(/^\/api/, '')}`))
  for (const esperada of ['PATCH /members/:id', 'POST /areas', 'PATCH /areas/:id', 'GET /settings/providers', 'PATCH /settings/providers', 'POST /areas/:id/templates', 'POST /members']) {
    assert.ok(del.has(esperada), `${esperada} debería ser de editor`)
  }
  await env.close()
})

test('un miembro edita sólo su descripción y dominios', async () => {
  const env = await makeEnv({ config: sinLimiteIp })
  await addMember(env, { email: 'ana@x.org' })
  const cookie = await login(env, 'ana@x.org')
  const ok = await env.app.inject({ method: 'PATCH', url: '/api/members/me', headers: { cookie }, payload: { responsibilities: 'API', domains: 'backend' } })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().responsibilities, 'API')
  for (const campo of ['role', 'name', 'email']) {
    const r = await env.app.inject({ method: 'PATCH', url: '/api/members/me', headers: { cookie }, payload: { [campo]: 'editor' } })
    assert.equal(r.statusCode, 400, campo)
  }
  await env.close()
})

// ---------------------------------------------------------------- identidad delegada
const delegada = (extra) => ({ config: { identity: { provider: 'delegated', delegated: extra } } })
const firmado = (secreto, { email, ts = Math.floor(Date.now() / 1000), method = 'GET', pathname = '/api/me' }) => ({
  'x-team-user': email, 'x-team-ts': String(ts),
  'x-team-sig': firmarCabecera(secreto, { ts, method, pathname, email, bind: true })
})

test('signed-header: firma válida entra; firma, marca de tiempo, ruta o método alterados no', async () => {
  const env = await makeEnv(delegada({ mode: 'signed-header', secrets: ['secreto-uno'] }))
  await addMember(env, { email: 'ana@x.org', role: 'editor' })
  const ok = await env.app.inject({ url: '/api/me', headers: firmado('secreto-uno', { email: 'ana@x.org' }) })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().email, 'ana@x.org')
  assert.equal(ok.json().provider, 'delegated:signed-header')
  const malaFirma = await env.app.inject({ url: '/api/me', headers: firmado('otro-secreto', { email: 'ana@x.org' }) })
  assert.equal(malaFirma.statusCode, 401)
  const vieja = await env.app.inject({ url: '/api/me', headers: firmado('secreto-uno', { email: 'ana@x.org', ts: Math.floor(Date.now() / 1000) - 301 }) })
  assert.equal(vieja.statusCode, 401)
  const futura = await env.app.inject({ url: '/api/me', headers: firmado('secreto-uno', { email: 'ana@x.org', ts: Math.floor(Date.now() / 1000) + 301 }) })
  assert.equal(futura.statusCode, 401)
  // Una firma capturada para GET /api/me no sirve para otra ruta ni otro método (la firma cubre ambos).
  const otraRuta = await env.app.inject({ url: '/api/members', headers: firmado('secreto-uno', { email: 'ana@x.org' }) })
  assert.equal(otraRuta.statusCode, 401)
  const otroCorreo = await env.app.inject({ url: '/api/me', headers: { ...firmado('secreto-uno', { email: 'ana@x.org' }), 'x-team-user': 'otra@x.org' } })
  assert.equal(otroCorreo.statusCode, 401)
  assert.equal((await env.app.inject({ url: '/api/me' })).statusCode, 401)
  await env.close()
})

test('signed-header: acepta dos secretos durante la rotación', async () => {
  const env = await makeEnv(delegada({ mode: 'signed-header', secrets: ['nuevo', 'viejo'] }))
  await addMember(env, { email: 'ana@x.org' })
  for (const s of ['nuevo', 'viejo']) assert.equal((await env.app.inject({ url: '/api/me', headers: firmado(s, { email: 'ana@x.org' }) })).statusCode, 200)
  assert.equal((await env.app.inject({ url: '/api/me', headers: firmado('retirado', { email: 'ana@x.org' }) })).statusCode, 401)
  await env.close()
})

test('delegada: ningún modo da de alta miembros (403) y /auth/login no existe', async () => {
  const env = await makeEnv(delegada({ mode: 'signed-header', secrets: ['s'] }))
  const r = await env.app.inject({ url: '/api/me', headers: firmado('s', { email: 'desconocida@x.org' }) })
  assert.equal(r.statusCode, 403)
  assert.equal(r.json().code, 'member_not_registered')
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM members').n, 0) // no se creó nada
  assert.equal((await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.c', password: CLAVE } })).statusCode, 404)
  await env.close()
})

test('delegada: el rol sale de la base y no del proveedor (UD-007)', async () => {
  const env = await makeEnv(delegada({ mode: 'signed-header', secrets: ['s'] }))
  await addMember(env, { email: 'ana@x.org', role: 'member' })
  const r = await env.app.inject({ url: '/api/settings/providers', headers: firmado('s', { email: 'ana@x.org', pathname: '/api/settings/providers' }) })
  assert.equal(r.statusCode, 403)
  await env.close()
})

const JWT = { mode: 'jwt', jwt: { secret: 'clave-compartida-de-al-menos-32-bytes!!', issuer: 'https://anfitrion.example', audience: 'team-platform' } }
const firmarJwt = (payload, { secret = JWT.jwt.secret, alg = 'HS256', iss = JWT.jwt.issuer, aud = JWT.jwt.audience, exp = '5m' } = {}) =>
  new SignJWT(payload).setProtectedHeader({ alg }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(new TextEncoder().encode(secret))

test('jwt (secreto compartido): válido entra; issuer, audience, vencimiento, firma o algoritmo distintos no', async () => {
  const env = await makeEnv(delegada(JWT))
  await addMember(env, { email: 'ana@x.org' })
  const pedir = (ficha) => env.app.inject({ url: '/api/me', headers: { authorization: `Bearer ${ficha}` } })
  assert.equal((await pedir(await firmarJwt({ email: 'ana@x.org' }))).statusCode, 200)
  assert.equal((await pedir(await firmarJwt({ email: 'ana@x.org' }, { iss: 'https://otro' }))).statusCode, 401)
  assert.equal((await pedir(await firmarJwt({ email: 'ana@x.org' }, { aud: 'otra-app' }))).statusCode, 401)
  assert.equal((await pedir(await firmarJwt({ email: 'ana@x.org' }, { exp: Math.floor(Date.now() / 1000) - 60 }))).statusCode, 401)
  assert.equal((await pedir(await firmarJwt({ email: 'ana@x.org' }, { secret: 'otra-clave-compartida-de-32-bytes!!!!' }))).statusCode, 401)
  assert.equal((await pedir(await firmarJwt({ email: 'ana@x.org' }, { alg: 'HS512' }))).statusCode, 401) // el algoritmo lo fija la configuración
  const sinFirma = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ email: 'ana@x.org', iss: JWT.jwt.issuer, aud: JWT.jwt.audience })).toString('base64url')}.`
  assert.equal((await pedir(sinFirma)).statusCode, 401) // alg none
  assert.equal((await pedir(await firmarJwt({}))).statusCode, 401) // sin correo
  assert.equal((await pedir(await firmarJwt({ email: 'nadie@x.org' }))).statusCode, 403) // no registrado
  assert.equal((await env.app.inject({ url: '/api/me', headers: { authorization: 'Basic abc' } })).statusCode, 401)
  await env.close()
})

test('jwt (JWKS remoto RS256): elige la llave por kid y vuelve a pedirla ante un kid nuevo', async () => {
  const par1 = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const par2 = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = async (par, kid) => ({ ...(await exportJWK(par.publicKey)), kid, alg: 'RS256', use: 'sig' })
  let llaves = [await jwk(par1, 'k1')]
  const servidor = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: llaves })) })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${servidor.address().port}/jwks.json`
  const env = await makeEnv(delegada({ mode: 'jwt', jwt: { jwksUrl: url, jwksCooldownMs: 0, header: 'cf-access-jwt-assertion', issuer: 'https://anfitrion.example', audience: 'team-platform' } }))
  await addMember(env, { email: 'ana@x.org' })
  const firma = (par, kid) => new SignJWT({ email: 'ana@x.org' }).setProtectedHeader({ alg: 'RS256', kid }).setIssuer('https://anfitrion.example').setAudience('team-platform').setExpirationTime('5m').sign(par.privateKey)
  const pedir = (ficha) => env.app.inject({ url: '/api/me', headers: { 'cf-access-jwt-assertion': ficha } })
  assert.equal((await pedir(await firma(par1, 'k1'))).statusCode, 200)
  assert.equal((await pedir(await firma(par2, 'k1'))).statusCode, 401) // otra llave con el kid conocido
  llaves = [await jwk(par1, 'k1'), await jwk(par2, 'k2')] // el anfitrión rota
  assert.equal((await pedir(await firma(par2, 'k2'))).statusCode, 200)
  await env.close()
  await new Promise((r) => servidor.close(r))
})

test('trusted-header: sólo vale si la conexión viene de una dirección de confianza', async () => {
  const env = await makeEnv(delegada({ mode: 'trusted-header' }))
  await addMember(env, { email: 'ana@x.org' })
  const h = { 'tailscale-user-login': 'ana@x.org' }
  assert.equal((await env.app.inject({ url: '/api/me', headers: h, remoteAddress: '127.0.0.1' })).statusCode, 200)
  assert.equal((await env.app.inject({ url: '/api/me', headers: h, remoteAddress: '203.0.113.7' })).statusCode, 401) // cualquiera fijaría la cabecera
  assert.equal((await env.app.inject({ url: '/api/me', headers: { 'tailscale-user-login': 'nadie@x.org' }, remoteAddress: '127.0.0.1' })).statusCode, 403)
  await env.close()
})

test('sso-redirect: nonce de uso único atado al navegador, firma, correo verificado y mapeo por identificador externo', async () => {
  const secreto = 'secreto-sso'
  const env = await makeEnv({
    config: { publicUrl: 'https://team.example', identity: { provider: 'delegated', delegated: { mode: 'sso-redirect', sso: { loginUrl: 'https://anfitrion.example/sso', secret: secreto } } } }
  })
  await addMember(env, { email: 'ana@x.org', role: 'editor' })
  await addMember(env, { email: 'otra@x.org' })
  const sinSesion = await env.app.inject({ url: '/api/me' })
  assert.equal(sinSesion.statusCode, 401)
  assert.equal(sinSesion.json().login_url, '/api/auth/sso/start')

  const inicio = async () => {
    const r = await env.app.inject({ url: '/api/auth/sso/start' })
    assert.equal(r.statusCode, 302)
    const destino = new URL(r.headers.location)
    assert.equal(destino.origin + destino.pathname, 'https://anfitrion.example/sso')
    const sso = destino.searchParams.get('sso')
    assert.equal(destino.searchParams.get('sig'), createHmac('sha256', secreto).update(sso).digest('hex'))
    const carga = JSON.parse(Buffer.from(sso, 'base64url').toString())
    assert.equal(carga.return_sso_url, 'https://team.example/api/auth/sso/callback')
    const nonceCookie = r.cookies.find((c) => c.name === '__Host-sso')
    return { nonce: carga.nonce, cookie: `${nonceCookie.name}=${nonceCookie.value}` }
  }
  const retorno = async ({ nonce, cookie }, datos, { secret = secreto } = {}) => {
    const sso = Buffer.from(JSON.stringify({ nonce, ...datos })).toString('base64url')
    const sig = createHmac('sha256', secret).update(sso).digest('hex')
    return env.app.inject({ url: `/api/auth/sso/callback?sso=${sso}&sig=${sig}`, headers: { cookie } })
  }

  // Camino feliz.
  const a = await inicio()
  const ok = await retorno(a, { email: 'ana@x.org', external_id: 'u-77', email_verified: true })
  assert.equal(ok.statusCode, 302)
  assert.equal(ok.headers.location, '/')
  const sesion = ok.cookies.find((c) => c.name === '__Host-session')
  const me = await env.app.inject({ url: '/api/me', headers: { cookie: `${sesion.name}=${sesion.value}` } })
  assert.equal(me.json().email, 'ana@x.org')
  // El nonce es de un solo uso.
  assert.equal((await retorno(a, { email: 'ana@x.org', external_id: 'u-77', email_verified: true })).statusCode, 403)
  // Firma falsa.
  const b = await inicio()
  assert.equal((await retorno(b, { email: 'ana@x.org', email_verified: true }, { secret: 'otro' })).statusCode, 403)
  // Nonce de otro navegador: la cookie no coincide.
  const c = await inicio()
  assert.equal((await retorno({ nonce: c.nonce, cookie: b.cookie }, { email: 'ana@x.org', email_verified: true })).statusCode, 403)
  // Correo sin verificar por el anfitrión.
  const d = await inicio()
  assert.equal((await retorno(d, { email: 'ana@x.org', external_id: 'u-1', email_verified: false })).statusCode, 403)
  // Miembro inexistente: no se da de alta.
  const e = await inicio()
  const noMiembro = await retorno(e, { email: 'nadie@x.org', external_id: 'u-9', email_verified: true })
  assert.equal(noMiembro.statusCode, 403)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM members').n, 2)
  // Mapeo por identificador externo estable: u-77 sigue siendo Ana aunque el anfitrión mande otro correo.
  const f = await inicio()
  const porExterno = await retorno(f, { email: 'otra@x.org', external_id: 'u-77', email_verified: true })
  const s2 = porExterno.cookies.find((c) => c.name === '__Host-session')
  assert.equal((await env.app.inject({ url: '/api/me', headers: { cookie: `${s2.name}=${s2.value}` } })).json().email, 'ana@x.org')
  // Nonce vencido.
  const g = await inicio()
  run(env.db, 'UPDATE sso_nonces SET created_at = created_at - ?', (env.config.identity.delegated.sso.nonceMinutes + 1) * 60_000)
  assert.equal((await retorno(g, { email: 'ana@x.org', email_verified: true })).statusCode, 403)
  await env.close()
})

test('la configuración inválida impide arrancar (sin issuer/audience, sin secretos, sin publicUrl)', async () => {
  const { loadConfig } = await import('../config.js')
  assert.throws(() => loadConfig({ IDENTITY_PROVIDER: 'delegated', DELEGATED_MODE: 'signed-header' }), /DELEGATED_SECRETS/)
  assert.throws(() => loadConfig({ IDENTITY_PROVIDER: 'delegated', DELEGATED_MODE: 'jwt', JWT_SECRET: 'x' }), /JWT_ISSUER/)
  assert.throws(() => loadConfig({ IDENTITY_PROVIDER: 'delegated', DELEGATED_MODE: 'sso-redirect', SSO_LOGIN_URL: 'https://a', SSO_SECRET: 'x' }), /PUBLIC_URL/)
})
