// Pruebas del contrato de la API: OpenAPI generado de los esquemas, convenciones comunes y operación del editor.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { all, get, openInitialized, run } from '../db/index.js'
import { bootstrapFirstEditor } from '../db/seed.js'
import { routePolicies } from '../identity/index.js'
import { addMember, CLAVE, login, makeEnv, postInput, tempDir, until } from '../testing/helpers.js'

const sinLimiteIp = { identity: { login: { ipMax: 1000 } } }
const aquí = path.dirname(fileURLToPath(import.meta.url))

async function equipo (opts = {}) {
  const env = await makeEnv({ ...opts, config: { ...sinLimiteIp, ...(opts.config ?? {}) } })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

// ---------------------------------------------------------------- OpenAPI
test('GET /api/openapi.json publica OpenAPI 3.1 con todas las rutas, sin sesión', async () => {
  const env = await makeEnv()
  const r = await env.app.inject({ url: '/api/openapi.json' })
  assert.equal(r.statusCode, 200)
  const doc = r.json()
  assert.equal(doc.openapi, '3.1.0')
  assert.equal(doc.info.title, 'team-platform API')
  for (const ruta of ['/api/inputs', '/api/inputs/{id}', '/api/inputs/{id}/publish', '/api/messages', '/api/messages/{id}/replies', '/api/areas', '/api/areas/{id}/restore',
    '/api/templates/{id}/restore', '/api/members/me', '/api/settings/providers', '/api/jobs', '/api/jobs/{id}/trace', '/api/audit', '/api/events', '/api/attachments/{id}', '/api/auth/login', '/api/me', '/api/health']) {
    assert.ok(doc.paths[ruta], `falta ${ruta} en el contrato`)
  }
  assert.ok(!doc.paths['/api/openapi.json']) // el contrato no se describe a sí mismo
  assert.deepEqual(doc.paths['/api/auth/login'].post.security, []) // pública
  assert.equal(doc.components.securitySchemes.session.in, 'cookie')
  assert.ok(doc.paths['/api/inputs'].post.requestBody.content['multipart/form-data'])
  assert.ok(doc.paths['/api/messages'].get.responses['200'])
  assert.ok(doc.paths['/api/messages'].get.responses['4XX'])
  assert.deepEqual(doc.paths['/api/inputs/{id}'].get.parameters.find((p) => p.name === 'id').schema.type, 'integer')
  assert.ok(!JSON.stringify(doc).includes('password_hash'))
  await env.close()
})

test('ninguna ruta queda sin esquema de respuesta', async () => {
  const env = await makeEnv()
  const sin = routePolicies.get(env.app)
    .filter((r) => !['HEAD', 'OPTIONS'].includes(r.method))
    .filter((r) => !r.schema?.response || !Object.keys(r.schema.response).some((c) => /^[23]\d\d$/.test(c)))
    .map((r) => `${r.method} ${r.url}`)
  assert.deepEqual(sin, [])
  await env.close()
})

test('todo POST y PATCH con cuerpo rechaza propiedades desconocidas (additionalProperties: false)', async () => {
  const env = await makeEnv()
  const estricto = (s) => s.additionalProperties === false || (s.anyOf ?? s.oneOf ?? []).length > 0 && (s.anyOf ?? s.oneOf).every(estricto)
  const flojas = routePolicies.get(env.app)
    .filter((r) => ['POST', 'PATCH'].includes(r.method) && r.schema?.body)
    .filter((r) => !estricto(r.schema.body))
    .map((r) => `${r.method} ${r.url}`)
  assert.deepEqual(flojas, [])
  // Y el cuerpo anidado de la publicación también.
  const publicar = routePolicies.get(env.app).find((r) => r.url.endsWith('/inputs/:id/publish'))
  assert.equal(publicar.schema.body.properties.messages.items.additionalProperties, false)
  await env.close()
})

// ---------------------------------------------------------------- convenciones
test('ids inválidos en el path son 400; 401 sin sesión y 403 sin rol son distintos; 404 si no existe', async () => {
  const env = await equipo()
  for (const url of ['/messages/abc', '/messages/0', '/messages/-1', '/inputs/1.5', '/areas/x/templates', '/jobs/uno/trace']) {
    const r = await env.api('GET', url, env.c.ed)
    assert.equal(r.statusCode, 400, url)
    assert.equal(r.json().code, 'validation')
  }
  assert.equal((await env.app.inject({ url: '/api/messages/1' })).statusCode, 401)
  assert.equal((await env.api('GET', '/jobs', env.c.ana)).statusCode, 403)
  assert.equal((await env.api('GET', '/messages/999', env.c.ana)).statusCode, 404)
  await env.close()
})

test('toda lista es { items, page, limit, total } con tope de 100 por página', async () => {
  const env = await equipo()
  for (const url of ['/messages', '/inputs', '/members']) {
    const r = await env.api('GET', url, env.c.ana)
    assert.equal(r.statusCode, 200, url)
    const cuerpo = r.json()
    assert.deepEqual(Object.keys(cuerpo).sort(), ['items', 'limit', 'page', 'total'], url)
    assert.equal(cuerpo.page, 1)
    assert.equal(cuerpo.limit, env.config.list.pageSize)
    assert.equal((await env.api('GET', `${url}?limit=100`, env.c.ana)).statusCode, 200, url)
    assert.equal((await env.api('GET', `${url}?limit=101`, env.c.ana)).statusCode, 400, url)
    assert.equal((await env.api('GET', `${url}?page=0`, env.c.ana)).statusCode, 400, url)
  }
  for (const url of ['/jobs', '/audit']) {
    const cuerpo = (await env.api('GET', url, env.c.ed)).json()
    assert.deepEqual(Object.keys(cuerpo).sort(), ['items', 'limit', 'page', 'total'], url)
    assert.equal((await env.api('GET', `${url}?limit=101`, env.c.ed)).statusCode, 400)
  }
  // Más allá del final: vacío, con el total verdadero.
  const lejos = (await env.api('GET', '/members?page=9', env.c.ana)).json()
  assert.deepEqual({ n: lejos.items.length, total: lejos.total, page: lejos.page }, { n: 0, total: 2, page: 9 })
  await env.close()
})

test('GET /inputs lista los propios con filtro por estado', async () => {
  const env = await equipo()
  await postInput(env, env.c.ana, { text: 'uno' })
  await postInput(env, env.c.ana, { text: 'dos' })
  await postInput(env, env.c.ed, { text: 'ajeno' })
  const lista = (await env.api('GET', '/inputs', env.c.ana)).json()
  assert.equal(lista.total, 2)
  assert.deepEqual(lista.items.map((i) => i.text), ['dos', 'uno'])
  assert.equal((await env.api('GET', '/inputs?status=published', env.c.ana)).json().total, 0)
  assert.equal((await env.api('GET', '/inputs?status=raro', env.c.ana)).statusCode, 400)
  await env.close()
})

test('el panel manda X-Team-Request: una petición no segura con cookie y sin la cabecera es 403', async () => {
  const env = await equipo()
  const sin = await env.app.inject({ method: 'POST', url: '/api/messages/1/close', headers: { cookie: env.c.ana } })
  assert.equal(sin.statusCode, 403)
  assert.equal(sin.json().code, 'csrf')
  const con = await env.app.inject({ method: 'POST', url: '/api/messages/1/close', headers: { cookie: env.c.ana, 'x-team-request': 'panel' } })
  assert.equal(con.statusCode, 404) // pasó la defensa
  // Sin cookie (un cliente de API con otra credencial) no hace falta.
  const login_ = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'x@x.org', password: CLAVE } })
  assert.equal(login_.statusCode, 401)
  await env.close()
})

test('GET /me trae project_name; GET /areas trae open_count y template_count; la lista de mensajes, reply_count y last_reply', async () => {
  const env = await equipo({ config: { projectName: 'Atlas' } })
  const me = (await env.api('GET', '/me', env.c.ana)).json()
  assert.equal(me.project_name, 'Atlas')
  assert.deepEqual(me.domains, [])
  assert.equal(typeof me.id, 'string')
  const areas = (await env.api('GET', '/areas', env.c.ana)).json()
  assert.ok(areas.every((a) => typeof a.open_count === 'number' && a.template_count === 1))
  await env.close()
})

test('borrado en blando: los mensajes de un área borrada siguen existiendo y siguen mostrándose', async () => {
  const env = await equipo({ worker: true })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'x' })).json()
  const v = await until(async () => { const r = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json(); return r.status === 'proposed' ? r : null })
  const pub = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: v.proposal.messages, discarded: v.proposal.discarded })
  assert.equal(pub.statusCode, 200, pub.body)
  const areaId = v.proposal.messages[0].area_id
  assert.equal((await env.api('DELETE', `/areas/${areaId}?confirm=true`, env.c.ed)).statusCode, 204)
  const lista = (await env.api('GET', '/messages', env.c.ana)).json()
  assert.equal(lista.total, 1)
  assert.equal(lista.items[0].area_id, areaId)
  // Una propuesta nueva no puede apuntar a un área borrada.
  const otro = (await postInput(env, env.c.ana, { text: 'otro' })).json()
  const v2 = await until(async () => { const r = (await env.api('GET', `/inputs/${otro.input_id}`, env.c.ana)).json(); return r.status === 'proposed' ? r : null })
  const mal = await env.api('POST', `/inputs/${otro.input_id}/publish`, env.c.ana, { messages: [{ ...v2.proposal.messages[0], area_id: areaId }] })
  assert.equal(mal.json().code, 'area_invalid')
  // Y el análisis ya no la ofrece.
  assert.ok(!all(env.db, 'SELECT id FROM areas WHERE deleted_at IS NULL').some((a) => String(a.id) === areaId))
  await env.close()
})

test('publicar acepta la propuesta tal cual la entrega GET (ids como texto, discarded y unit_ids) y una plantilla null usa la primera del área', async () => {
  const env = await equipo({ worker: true })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'x' })).json()
  const v = await until(async () => { const r = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json(); return r.status === 'proposed' ? r : null })
  const mensajes = v.proposal.messages.map((m) => ({ ...m, template_id: null, unit_ids: ['1', '2'], fields: { idea: 'i', motivation: 'm', reference: null } }))
  const r = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: mensajes, discarded: [{ unit_ids: ['3'], reason: 'saludo' }] })
  assert.equal(r.statusCode, 200, r.body)
  assert.match(r.json().messages[0].template_id, /^\d+$/) // se eligió la plantilla del área
  assert.deepEqual(r.json().messages[0].fields, { idea: 'i', motivation: 'm' })
  await env.close()
})

// ---------------------------------------------------------------- operación del editor
test('cola de trabajos: GET /jobs filtrable y DELETE /jobs purga los terminados sólo con confirm=true', async () => {
  const env = await equipo({ worker: true })
  for (const t of ['a', 'b', 'c']) await postInput(env, env.c.ana, { text: t })
  await until(() => get(env.db, "SELECT COUNT(*) AS n FROM jobs WHERE status = 'done'").n === 3)
  const todos = (await env.api('GET', '/jobs', env.c.ed)).json()
  assert.equal(todos.total, 3)
  assert.equal(todos.items[0].kind, 'analyze')
  assert.equal(todos.items[0].status, 'done')
  assert.equal(typeof todos.items[0].id, 'string')
  assert.equal((await env.api('GET', '/jobs?state=queued', env.c.ed)).json().total, 0)
  assert.equal((await env.api('GET', '/jobs?state=done&limit=2', env.c.ed)).json().items.length, 2)
  assert.equal((await env.api('GET', '/jobs?state=raro', env.c.ed)).statusCode, 400)

  const sin = await env.api('DELETE', '/jobs?state=done', env.c.ed)
  assert.equal(sin.statusCode, 400)
  assert.equal(sin.json().code, 'confirm_required')
  assert.equal((await env.api('DELETE', '/jobs?state=queued&confirm=true', env.c.ed)).statusCode, 400) // sólo terminados
  assert.equal((await env.api('DELETE', '/jobs?state=done&confirm=true', env.c.ana)).statusCode, 403)
  const purga = await env.api('DELETE', '/jobs?state=done&confirm=true', env.c.ed)
  assert.equal(purga.statusCode, 200)
  assert.equal(purga.json().purged, 3)
  assert.equal((await env.api('GET', '/jobs', env.c.ed)).json().total, 0)
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'jobs.purge'").n, 1)
  await env.close()
})

test('bitácora: quién creó, publicó, cerró, reabrió o editó áreas y plantillas, con fecha', async () => {
  const env = await equipo({ worker: true })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'x' })).json()
  const v = await until(async () => { const r = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json(); return r.status === 'proposed' ? r : null })
  const pub = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: v.proposal.messages })
  const mid = pub.json().message_ids[0]
  await env.api('POST', `/messages/${mid}/close`, env.c.ed)
  await env.api('POST', `/messages/${mid}/reopen`, env.c.ed)
  const area = (await env.api('POST', '/areas', env.c.ed, { title: 'Nueva', description: 'x' })).json()
  await env.api('PATCH', `/areas/${area.id}`, env.c.ed, { description: 'y' })
  const md = '---\nname: P\ndescription: d\n---\ncuerpo'
  const t = (await env.api('POST', `/areas/${area.id}/templates`, env.c.ed, { body_markdown: md })).json()
  await env.api('DELETE', `/areas/${area.id}/templates/${t.id}?confirm=true`, env.c.ed)

  assert.equal((await env.api('GET', '/audit', env.c.ana)).statusCode, 403)
  const log = (await env.api('GET', '/audit?limit=100', env.c.ed)).json()
  const acciones = log.items.map((e) => e.action)
  for (const a of ['input.create', 'input.publish', 'message.close', 'message.reopen', 'area.create', 'area.update', 'template.create', 'template.delete']) {
    assert.ok(acciones.includes(a), `falta ${a}`)
  }
  const cierre = log.items.find((e) => e.action === 'message.close')
  assert.equal(cierre.member_name, 'Ed')
  assert.equal(cierre.entity, 'message')
  assert.equal(cierre.entity_id, mid)
  assert.match(cierre.at, /^\d{4}-\d\d-\d\dT/)
  assert.ok(log.items[0].at >= log.items.at(-1).at) // la más reciente primero
  assert.equal((await env.api('GET', '/audit?action=message.close', env.c.ed)).json().total, 1)
  await env.close()
})

test('GET /jobs/:id/trace (editor) responde aunque la telemetría no esté instalada', async () => {
  const env = await equipo()
  assert.equal((await env.api('GET', '/jobs/1/trace', env.c.ana)).statusCode, 403)
  const r = await env.api('GET', '/jobs/1/trace', env.c.ed)
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().job_id, '1')
  assert.ok(Array.isArray(r.json().spans))
  await env.close()
})

test('/health: lo básico es público; el detalle de base, cola y proveedores es del editor; 503 si la base no está migrada', async () => {
  const env = await equipo({ modules: { getProviders: () => ({ describe: () => [{ slot: 'text', provider: 'anthropic', model: 'm', available: false, reason: 'Falta ANTHROPIC_API_KEY' }] }) } })
  const anonimo = (await env.app.inject({ url: '/health' })).json()
  assert.deepEqual(Object.keys(anonimo).sort(), ['status', 'version'])
  const miembro = (await env.api('GET', '/health', env.c.ana)).json()
  assert.deepEqual(Object.keys(miembro).sort(), ['status', 'version'])
  const editor = (await env.api('GET', '/health', env.c.ed)).json()
  assert.equal(editor.db.status, 'ok')
  assert.equal(editor.db.journal_mode, 'wal')
  assert.equal(editor.db.schema_version, 1)
  assert.equal(typeof editor.queue, 'object')
  assert.equal(editor.worker, 'inline')
  assert.deepEqual(editor.providers[0], { slot: 'text', provider: 'anthropic', model: 'm', available: false, reason: 'Falta ANTHROPIC_API_KEY' })
  assert.ok(!JSON.stringify(editor).toLowerCase().includes('sk-'))
  // Base sin migrar: el sondeo de Docker debe poder ponerse rojo.
  run(env.db, 'PRAGMA user_version = 0')
  const caido = await env.app.inject({ url: '/health' })
  assert.equal(caido.statusCode, 503)
  assert.equal(caido.json().code, 'unavailable')
  run(env.db, 'PRAGMA user_version = 1')
  await env.close()
})

// ---------------------------------------------------------------- desarrollo y origen cruzado
test('POST /auth/dev-login existe sólo con NODE_ENV=development y entra sin contraseña', async () => {
  const prod = await makeEnv()
  assert.equal((await prod.app.inject({ method: 'POST', url: '/api/auth/dev-login', payload: { email: 'dev@x.org' } })).statusCode, 404)
  await prod.close()

  const dev = await makeEnv({ config: { nodeEnv: 'development' } })
  const r = await dev.app.inject({ method: 'POST', url: '/api/auth/dev-login', payload: { email: 'dev@x.org' } })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().member.role, 'editor')
  assert.equal(typeof r.json().member.id, 'string')
  const cookie = `${r.cookies[0].name}=${r.cookies[0].value}`
  assert.equal((await dev.app.inject({ url: '/api/me', headers: { cookie } })).json().email, 'dev@x.org')
  assert.equal((await dev.app.inject({ method: 'POST', url: '/api/auth/dev-login', payload: { email: 'dev@x.org', rol: 'x' } })).statusCode, 400) // estricto
  assert.equal(get(dev.db, 'SELECT COUNT(*) AS n FROM credentials').n, 0) // sin contraseñas sembradas
  await dev.close()
})

test('CORS: sin CORS_ORIGINS no hay cabeceras de origen cruzado; con ellas, sólo esos orígenes y con credenciales', async () => {
  const cerrado = await makeEnv()
  const sin = await cerrado.app.inject({ url: '/api/health', headers: { origin: 'https://otro.example' } })
  assert.equal(sin.headers['access-control-allow-origin'], undefined)
  await cerrado.close()

  const env = await makeEnv({ config: { corsOrigins: ['https://app.vercel.example'], identity: { cookieMode: 'cross-origin', login: { ipMax: 1000 } } } })
  const pre = await env.app.inject({ method: 'OPTIONS', url: '/api/messages/1/replies', headers: { origin: 'https://app.vercel.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-team-request' } })
  assert.equal(pre.statusCode, 204)
  assert.equal(pre.headers['access-control-allow-origin'], 'https://app.vercel.example')
  assert.equal(pre.headers['access-control-allow-credentials'], 'true')
  assert.match(pre.headers['access-control-allow-headers'], /x-team-request/)
  const ajeno = await env.app.inject({ url: '/api/health', headers: { origin: 'https://evil.example' } })
  assert.equal(ajeno.headers['access-control-allow-origin'], undefined)
  const propio = await env.app.inject({ url: '/api/health', headers: { origin: 'https://app.vercel.example' } })
  assert.equal(propio.headers['access-control-allow-origin'], 'https://app.vercel.example')
  await env.close()
})

test('cookie cross-origin: SameSite=None; Secure, y el gancho CSRF acepta sólo los orígenes de la lista', async () => {
  const env = await makeEnv({ config: { corsOrigins: ['https://app.vercel.example'], identity: { cookieMode: 'cross-origin', login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ana@x.org' })
  const post = (headers) => env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ana@x.org', password: CLAVE }, headers })
  const ok = await post({ origin: 'https://app.vercel.example', 'sec-fetch-site': 'cross-site' })
  assert.equal(ok.statusCode, 200)
  const c = ok.cookies[0]
  assert.equal(c.name, '__Host-session')
  assert.equal(c.sameSite, 'None')
  assert.equal(c.secure, true)
  assert.equal(c.httpOnly, true)
  assert.equal((await post({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).statusCode, 403)
  assert.equal((await post({ 'sec-fetch-site': 'cross-site' })).statusCode, 403) // cruzado y sin origen declarado
  assert.equal((await post({ origin: env.baseUrl ?? 'http://localhost:3000', 'sec-fetch-site': 'same-origin' })).statusCode, 403) // el propio origen tampoco está en la lista
  // Con la cookie, la petición no segura desde el origen listado pasa si trae X-Team-Request.
  const cookie = `${c.name}=${c.value}`
  const cierre = await env.app.inject({ method: 'POST', url: '/api/messages/1/close', headers: { cookie, origin: 'https://app.vercel.example', 'sec-fetch-site': 'cross-site', 'x-team-request': 'panel' } })
  assert.equal(cierre.statusCode, 404)
  await env.close()
})

test('la configuración de origen cruzado se valida al arrancar', async () => {
  const { loadConfig } = await import('../config.js')
  assert.throws(() => loadConfig({ COOKIE_MODE: 'cross-origin' }), /CORS_ORIGINS/)
  assert.throws(() => loadConfig({ COOKIE_MODE: 'cross-origin', CORS_ORIGINS: 'https://a.example/ruta' }), /sin ruta/)
  assert.throws(() => loadConfig({ COOKIE_MODE: 'cross-origin', CORS_ORIGINS: 'https://a.example', COOKIE_INSECURE_DEV: 'true' }), /Secure/)
  assert.throws(() => loadConfig({ CORS_ORIGINS: 'no-es-un-origen' }), /origen válido/)
  assert.equal(loadConfig({ COOKIE_MODE: 'same-origin' }).corsOrigins.length, 0)
  assert.equal(loadConfig({ DATA_DIR: '/x' }).dbFile, '/x/team.db')
  assert.equal(loadConfig({ DATA_DIR: '/x', DB_PATH: '/y/z.db' }).dbFile, '/y/z.db')
  assert.equal(loadConfig({}).dataDir, '/data')
})

// ---------------------------------------------------------------- instalación y proceso
test('el primer editor sale de ADMIN_EMAIL sólo si no hay miembros, con contraseña generada o la de ADMIN_PASSWORD', async () => {
  const env = await makeEnv({ config: { adminEmail: 'jefe@x.org' } })
  const r = await bootstrapFirstEditor(env.db, env.config)
  assert.equal(r.generated, true)
  assert.ok(r.password.length >= 15)
  assert.equal(get(env.db, "SELECT role FROM members WHERE email = 'jefe@x.org'").role, 'editor')
  assert.equal(await bootstrapFirstEditor(env.db, env.config), null) // ya hay miembros: no eleva a nadie
  const entra = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'jefe@x.org', password: r.password } })
  assert.equal(entra.statusCode, 200)
  await env.close()

  const otro = await makeEnv({ config: { adminEmail: 'jefa@x.org', adminPassword: 'clave elegida por quien instala' } })
  const r2 = await bootstrapFirstEditor(otro.db, otro.config)
  assert.equal(r2.generated, false)
  await otro.close()
})

test('plantillas editadas: quedan copiadas en DATA_DIR/templates y se retiran al borrarlas', async () => {
  const env = await equipo()
  const { existsSync, readFileSync } = await import('node:fs')
  const area = (await env.api('GET', '/areas', env.c.ed)).json()[0]
  const t = area.templates[0]
  const nuevo = '---\nname: Editada\ndescription: d\n---\ncuerpo nuevo'
  const r = await env.api('PATCH', `/areas/${area.id}/templates/${t.id}`, env.c.ed, { body_markdown: nuevo })
  assert.equal(r.statusCode, 200)
  const archivo = path.join(env.config.dataDir, 'templates', `area-${area.id}`, `template-${t.id}.md`)
  assert.equal(readFileSync(archivo, 'utf8'), nuevo)
  await env.api('DELETE', `/areas/${area.id}/templates/${t.id}?confirm=true`, env.c.ed)
  assert.equal(existsSync(archivo), false)
  await env.close()
})

test('SIGTERM al proceso cierra ordenado en menos de 10 s y deja el trabajo en curso en la cola', async () => {
  const dir = tempDir()
  const raiz = path.resolve(aquí, '../..')
  const entorno = {
    ...process.env, DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', LOG_LEVEL: 'info', ADMIN_EMAIL: 'jefe@x.org', ADMIN_PASSWORD: CLAVE,
    ANALYZE_MODULE: path.join(raiz, 'src/testing/slow-analyze.js'), COOKIE_INSECURE_DEV: 'true'
  }
  const hijo = spawn(process.execPath, ['src/server.js'], { cwd: raiz, env: entorno, stdio: ['ignore', 'pipe', 'pipe'] })
  let salida = ''
  hijo.stdout.on('data', (d) => { salida += d })
  hijo.stderr.on('data', (d) => { salida += d })
  const hasta = (re, ms = 15000) => until(() => re.test(salida), { timeoutMs: ms })
  await hasta(/API escuchando en http:\/\/127\.0\.0\.1:\d+/)
  const puerto = /API escuchando en http:\/\/127\.0\.0\.1:(\d+)/.exec(salida)[1] // PORT=0 pide uno libre; el registro lo informa
  const base = `http://127.0.0.1:${puerto}`
  const entrada = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'jefe@x.org', password: CLAVE }) })
  assert.equal(entrada.status, 200)
  const cookie = entrada.headers.getSetCookie()[0].split(';')[0]
  const form = new FormData()
  form.append('text', 'algo que se queda analizando')
  const envio = await fetch(`${base}/api/inputs`, { method: 'POST', headers: { cookie, 'x-team-request': 'panel' }, body: form })
  assert.equal(envio.status, 202)
  const sse = await fetch(`${base}/api/events`, { headers: { cookie } }) // un flujo abierto no debe frenar el cierre
  assert.equal(sse.status, 200)
  const db = openInitialized({ ...(await import('../config.js')).loadConfig({ DATA_DIR: dir }) })
  await until(() => get(db, "SELECT status FROM inputs WHERE id = 1").status === 'analyzing')
  const t0 = Date.now()
  hijo.kill('SIGTERM')
  const codigo = await new Promise((r) => hijo.on('close', r))
  const duracion = Date.now() - t0
  assert.equal(codigo, 0, salida)
  assert.ok(duracion < 10000, `tardó ${duracion} ms`)
  const trabajo = get(db, 'SELECT status, attempts FROM jobs WHERE id = 1')
  assert.deepEqual({ ...trabajo }, { status: 'queued', attempts: 0 }) // vuelve a la cola con el intento reembolsado
  assert.match(salida, /apagado completo/)
  // Cada línea del worker lleva job_id e input_id, y todo es JSON.
  const lineas = salida.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const delTrabajo = lineas.filter((l) => l.job_id !== undefined)
  assert.ok(delTrabajo.length >= 2)
  assert.ok(delTrabajo.every((l) => l.input_id === 1 || l.input_id === '1'))
  assert.ok(lineas.some((l) => /Primer editor creado/.test(l.msg)) && !salida.includes(CLAVE)) // la contraseña de ADMIN_PASSWORD nunca se imprime
  db.close()
  rmSync(dir, { recursive: true, force: true })
})
