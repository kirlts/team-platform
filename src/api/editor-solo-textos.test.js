// UD-287: the Editor role gives exactly one privilege, changing configured texts. A table of routes falsifies the class:
// only the routes of configured texts accept nothing but an Editor; every other one accepts any active person.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMember, isActivePerson } from '../domain/members.js'
import { routePolicies } from '../identity/index.js'
import { addMember, login, makeEnv } from '../testing/helpers.js'

// The configured texts: areas and templates, the project name and description, the analysis framing. (The profile of an
// agent member is the same privilege inside `POST /members` and `PATCH /members/:id`, checked by field below.)
const TEXT_ROUTES = [
  'POST /areas', 'PATCH /areas/:id', 'DELETE /areas/:id', 'POST /areas/:id/restore',
  'POST /areas/:id/templates', 'PATCH /areas/:id/templates/:templateId', 'DELETE /areas/:id/templates/:templateId', 'POST /templates/:id/restore',
  'PATCH /settings/project', 'PATCH /settings/analysis'
]
// UD-286 (the delivery branch) takes these two out of the Editor; until it merges they may still be Editor routes.
const PENDING_UD_286 = ['POST /messages/:id/deliver', 'POST /messages/:id/discard-delivery']

const key = (r) => `${r.method} ${r.url.replace(/^\/api/, '')}`

async function team () {
  const env = await makeEnv()
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

test('only the routes of configured texts ask for the Editor; the rest ask for a person or a member', async () => {
  const env = await makeEnv()
  const editorRoutes = routePolicies.get(env.app).filter((r) => r.policy === 'editor' && !['HEAD', 'OPTIONS'].includes(r.method)).map(key).sort()
  const unexpected = editorRoutes.filter((k) => !TEXT_ROUTES.includes(k) && !PENDING_UD_286.includes(k))
  assert.deepEqual(unexpected, [], 'a route that is not a configured text asks for the Editor')
  for (const k of TEXT_ROUTES) assert.ok(editorRoutes.includes(k), `${k} is a configured text and asks for the Editor`)
  // The routes that used to ask for the Editor now ask for a person.
  const asPerson = routePolicies.get(env.app).filter((r) => r.policy === 'person').map(key)
  for (const k of ['GET /jobs', 'DELETE /jobs', 'GET /jobs/:id/trace', 'GET /audit', 'POST /ops/reset', 'POST /ops/seed', 'GET /settings/providers', 'PATCH /settings/providers',
    'PATCH /settings/publication', 'GET /settings/analysis', 'GET /telemetry/ui-summary', 'PATCH /settings/telemetry', 'POST /members', 'PATCH /members/:id', 'DELETE /members/:id',
    'GET /areas/:id/templates', 'POST /messages/:id/execute']) assert.ok(asPerson.includes(k), `${k} asks for a person`)
  await env.close()
})

test('a member without the Editor role is not refused by the routes that were the Editor\'s, and is by the configured texts', async () => {
  const env = await team()
  const { ana, ed } = env.c
  const area = (await env.api('POST', '/areas', ed, { title: 'Ideas', description: 'Lo que se le ocurre al equipo' })).json()
  for (const [method, url, payload] of [
    ['GET', '/jobs', undefined], ['GET', '/audit', undefined], ['GET', '/settings/providers', undefined], ['GET', '/settings/analysis', undefined],
    ['GET', '/telemetry/ui-summary', undefined], ['GET', '/inputs?all=1', undefined], ['GET', '/messages?deleted=1', undefined], ['GET', '/areas?include_deleted=true', undefined],
    ['GET', `/areas/${area.id}/templates`, undefined], ['PATCH', '/settings/publication', { auto_publish: true }], ['PATCH', '/settings/telemetry', { ui_enabled: false }],
    ['POST', '/members', { email: 'nuevo@x.org', name: 'Nuevo' }]
  ]) {
    const r = await env.api(method, url, ana, payload)
    assert.notEqual(r.statusCode, 403, `${method} ${url} refused a member: ${r.body}`)
    assert.ok(r.statusCode < 500, `${method} ${url} -> ${r.statusCode}`)
  }
  const refused = [
    ['POST', '/areas', { title: 'Otra', description: 'x' }], ['PATCH', `/areas/${area.id}`, { description: 'y' }], ['DELETE', `/areas/${area.id}?confirm=true`, undefined],
    ['POST', `/areas/${area.id}/restore`, undefined], ['PATCH', '/settings/project', { description: 'texto' }], ['PATCH', '/settings/analysis', { framing: { en: 'text' } }],
    ['POST', '/members', { email: 'otro@x.org', name: 'Otro', profile: 'perfil' }]
  ]
  for (const [method, url, payload] of refused) {
    const r = await env.api(method, url, ana, payload)
    assert.equal(r.statusCode, 403, `${method} ${url} accepted a member`)
  }
  // And the Editor still changes them.
  assert.equal((await env.api('PATCH', '/settings/project', ed, { description: 'texto' })).statusCode, 200)
  await env.close()
})

test('the profile of an agent is the Editor\'s; the rest of a member is any person\'s', async () => {
  const env = await team()
  const { ana, ed } = env.c
  const agentId = createMember(env.db, { email: 'claude@x.org', name: 'Claude', kind: 'agent' })
  assert.equal((await env.api('PATCH', `/members/${agentId}`, ana, { profile: 'Hago esto' })).statusCode, 403)
  assert.equal((await env.api('PATCH', `/members/${agentId}`, ed, { profile: 'Hago esto' })).statusCode, 200)
  assert.equal((await env.api('PATCH', `/members/${agentId}`, ana, { name: 'Claude B' })).statusCode, 200)
  await env.close()
})

test('an agent is not a person of the team: it does not delete what is not its own', async () => {
  const env = await team()
  const agentId = createMember(env.db, { email: 'claude@x.org', name: 'Claude', kind: 'agent' })
  const anaId = env.db.prepare("SELECT id FROM members WHERE email = 'ana@x.org'").get().id
  assert.equal(isActivePerson(env.db, agentId), false)
  assert.equal(isActivePerson(env.db, anaId), true)
  await env.close()
})
