import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all } from '../db/index.js'
import { addMember, login, makeEnv, multipart } from '../testing/helpers.js'

// UD-024: the Editor keeps a markdown project description; every member reads it.
const noIpLimit = { identity: { login: { ipMax: 1000 } } }

async function team (config = {}) {
  const env = await makeEnv({ config: { ...noIpLimit, ...config } })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  env.upload = async (cookie, fields, files) => {
    const { payload, headers } = await multipart(fields, files)
    return env.app.inject({ method: 'PATCH', url: '/api/settings/project', payload, headers: { ...headers, cookie, 'x-team-request': 'panel' } })
  }
  return env
}

test('GET /settings/project lo lee cualquier miembro: nombre del proyecto y descripción vacía al inicio', async () => {
  const env = await team({ projectName: 'Atlas' })
  const r = await env.api('GET', '/settings/project', env.c.ana)
  assert.equal(r.statusCode, 200)
  assert.deepEqual(r.json(), { name: 'Atlas', description: '' })
  assert.equal((await env.app.inject({ method: 'GET', url: '/api/settings/project' })).statusCode, 401)
  await env.close()
})

test('PATCH /settings/project: sólo el editor; el texto queda guardado y se registra en la bitácora', async () => {
  const env = await team({ projectName: 'Atlas' })
  const markdown = '# Atlas\n\nStack: Node 24.\n\n- `src/api/`: rutas'
  assert.equal((await env.api('PATCH', '/settings/project', env.c.ana, { description: markdown })).statusCode, 403)
  const ok = await env.api('PATCH', '/settings/project', env.c.ed, { description: markdown })
  assert.equal(ok.statusCode, 200)
  assert.deepEqual(ok.json(), { name: 'Atlas', description: markdown })
  assert.equal((await env.api('GET', '/settings/project', env.c.ana)).json().description, markdown)
  const rows = all(env.db, "SELECT member_id, entity, detail_json FROM audit_log WHERE action = 'settings.project.update'")
  assert.equal(rows.length, 1)
  assert.equal(rows[0].entity, 'settings')
  assert.equal(JSON.parse(rows[0].detail_json).length, markdown.length)
  // Reemplaza, no acumula; vacío la borra.
  await env.api('PATCH', '/settings/project', env.c.ed, { description: '' })
  assert.equal((await env.api('GET', '/settings/project', env.c.ed)).json().description, '')
  assert.equal((await env.api('PATCH', '/settings/project', env.c.ed, {})).statusCode, 400)
  assert.equal((await env.api('PATCH', '/settings/project', env.c.ed, { description: 'x', extra: 1 })).statusCode, 400)
  await env.close()
})

test('el tope de la descripción es la perilla PROJECT_DESCRIPTION_MAX_CHARS y se aplica al JSON y al archivo', async () => {
  const env = await team({ project: { descriptionMaxChars: 50 } })
  assert.equal((await env.api('PATCH', '/settings/project', env.c.ed, { description: 'a'.repeat(50) })).statusCode, 200)
  const over = await env.api('PATCH', '/settings/project', env.c.ed, { description: 'a'.repeat(51) })
  assert.equal(over.statusCode, 413)
  assert.equal(over.json().code, 'too_large')
  // Se cuentan caracteres, no bytes: 50 letras con tilde caben aunque ocupen 100 bytes.
  assert.equal((await env.api('PATCH', '/settings/project', env.c.ed, { description: 'é'.repeat(50) })).statusCode, 200)
  const file = (content) => [{ field: 'file', name: 'proyecto.md', type: 'text/markdown', content }]
  assert.equal((await env.upload(env.c.ed, {}, file('é'.repeat(50)))).statusCode, 200)
  assert.equal((await env.upload(env.c.ed, {}, file('é'.repeat(51)))).statusCode, 413)
  assert.equal((await env.upload(env.c.ed, {}, file('a'.repeat(10000)))).statusCode, 413)
  assert.equal((await env.api('GET', '/settings/project', env.c.ed)).json().description, 'é'.repeat(50)) // lo rechazado no se guardó
  await env.close()
})

test('multipart: un archivo .md reemplaza la descripción; otro formato, vacío o sin nada se rechaza', async () => {
  const env = await team()
  const markdown = '# Proyecto\n\nÍndice de carpetas:\n\n- `src/`'
  const ok = await env.upload(env.c.ed, {}, [{ field: 'file', name: 'PROYECTO.MD', type: 'text/markdown', content: `﻿${markdown}` }])
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().description, markdown) // la marca de orden de bytes no se guarda
  const field = await env.upload(env.c.ed, { description: 'por campo' }, [])
  assert.equal(field.json().description, 'por campo')
  const notMd = await env.upload(env.c.ed, {}, [{ field: 'file', name: 'notas.txt', type: 'text/plain', content: 'x' }])
  assert.equal(notMd.statusCode, 415)
  assert.equal((await env.upload(env.c.ed, {}, [])).statusCode, 400)
  assert.equal((await env.upload(env.c.ana, {}, [{ field: 'file', name: 'a.md', type: 'text/markdown', content: 'x' }])).statusCode, 403)
  assert.equal((await env.api('GET', '/settings/project', env.c.ed)).json().description, 'por campo')
  await env.close()
})

test('el contrato OpenAPI documenta GET y PATCH de /settings/project, con JSON y multipart', async () => {
  const env = await team()
  const doc = (await env.app.inject({ method: 'GET', url: '/api/openapi.json' })).json()
  const path = doc.paths['/api/settings/project']
  assert.ok(path.get && path.patch)
  assert.ok(path.patch.requestBody.content['application/json'])
  assert.ok(path.patch.requestBody.content['multipart/form-data'])
  await env.close()
})
