// Member lifecycle for the Editor: soft deactivation with PATCH /members/:id { active }. A deactivated member
// cannot log in, keeps their history, and the team always keeps an active editor.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { get, run } from '../db/index.js'
import { updateMember } from '../domain/members.js'
import { addMember, login, makeEnv, postInput, TEST_PASSWORD, until } from '../testing/helpers.js'

async function team (opts = {}) {
  const env = await makeEnv({ ...opts, config: { identity: { login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' }) // id 1
  await addMember(env, { email: 'ana@x.org', name: 'Ana' }) // 2
  await addMember(env, { email: 'beto@x.org', name: 'Beto' }) // 3
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  env.tryLogin = (email, password = TEST_PASSWORD) => env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
  return env
}

test('an Editor deactivates a member: lists show active=false, the open session dies and login is refused with a Spanish message', async () => {
  const env = await team()
  assert.equal((await env.api('GET', '/members', env.c.ed)).json().items.every((m) => m.active === true), true)
  const r = await env.api('PATCH', '/members/3', env.c.ed, { active: false })
  assert.equal(r.statusCode, 200, r.body)
  assert.equal(r.json().active, false)
  assert.equal((await env.api('GET', '/members', env.c.ed)).json().items.find((m) => m.id === '3').active, false)

  assert.equal((await env.api('GET', '/me', env.c.beto)).statusCode, 401) // the session was closed
  const refused = await env.tryLogin('beto@x.org')
  assert.equal(refused.statusCode, 403)
  assert.equal(refused.json().code, 'account_inactive')
  assert.match(refused.json().message, /desactivada/)
  assert.equal((await env.tryLogin('beto@x.org', 'otra clave larga y distinta')).statusCode, 401) // a wrong password does not reveal the state
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'member.update' AND entity_id = 3").n, 1)
  await env.close()
})

test('a deactivated member keeps their history, and reactivating restores the login', async () => {
  const env = await team({ worker: true })
  const { input_id: id } = (await postInput(env, env.c.beto, { text: 'de Beto' })).json()
  const view = await until(async () => { const v = (await env.api('GET', `/inputs/${id}`, env.c.beto)).json(); return v.status === 'proposed' ? v : null })
  const messageId = (await env.api('POST', `/inputs/${id}/publish`, env.c.beto, { messages: view.proposal.messages })).json().message_ids[0]
  await env.api('POST', `/messages/${messageId}/replies`, env.c.ana, { body: 'hola' })

  await env.api('PATCH', '/members/3', env.c.ed, { active: false })
  const message = (await env.api('GET', `/messages/${messageId}`, env.c.ed)).json()
  assert.equal(message.author_id, '3') // still there, still his
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM inputs WHERE author_id = 3').n, 1)

  const back = await env.api('PATCH', '/members/3', env.c.ed, { active: true })
  assert.equal(back.json().active, true)
  assert.equal((await env.tryLogin('beto@x.org')).statusCode, 200)
  await env.close()
})

test('only an Editor can change active (403 for a member), and an unknown member is 404', async () => {
  const env = await team()
  const denied = await env.api('PATCH', '/members/3', env.c.ana, { active: false })
  assert.equal(denied.statusCode, 403)
  assert.equal(get(env.db, 'SELECT active FROM members WHERE id = 3').active, 1)
  assert.equal((await env.api('PATCH', '/members/me', env.c.ana, { active: false })).statusCode, 400) // not through the profile route
  assert.equal((await env.api('PATCH', '/members/999', env.c.ed, { active: false })).statusCode, 404)
  assert.equal((await env.api('PATCH', '/members/3', env.c.ed, { active: 'no' })).statusCode, 400)
  await env.close()
})

test('nobody deactivates their own account (409), not even an Editor', async () => {
  const env = await team()
  const r = await env.api('PATCH', '/members/1', env.c.ed, { active: false })
  assert.equal(r.statusCode, 409)
  assert.equal(r.json().code, 'cannot_deactivate_self')
  assert.match(r.json().message, /propia cuenta/)
  assert.equal(get(env.db, 'SELECT active FROM members WHERE id = 1').active, 1)
  assert.equal((await env.api('GET', '/me', env.c.ed)).statusCode, 200) // the session is untouched
  await env.close()
})

test('the last active Editor can be neither deactivated nor demoted', async () => {
  const env = await team()
  await addMember(env, { email: 'ed2@x.org', name: 'Ed2', role: 'editor' }) // id 4
  assert.equal((await env.api('PATCH', '/members/4', env.c.ed, { active: false })).statusCode, 200) // Ed still stands
  // Ed is now the only active editor.
  const demote = await env.api('PATCH', '/members/1', env.c.ed, { role: 'member' })
  assert.equal(demote.statusCode, 409)
  assert.equal(demote.json().code, 'last_editor')
  assert.match(demote.json().message, /editor activo/)
  // Through the domain, with another actor, deactivating the last active editor is refused too.
  assert.throws(() => updateMember(env.db, 1, { active: false }, { actorId: 2 }), (error) => error.status === 409 && error.code === 'last_editor')
  assert.equal(get(env.db, 'SELECT active FROM members WHERE id = 1').active, 1)
  // An inactive editor does not count: with Ed2 inactive, Ed2 reactivated, then Ed can step down.
  assert.equal((await env.api('PATCH', '/members/4', env.c.ed, { active: true })).statusCode, 200)
  assert.equal((await env.api('PATCH', '/members/1', env.c.ed, { role: 'member' })).statusCode, 200)
  await env.close()
})

test('a session of a deactivated member is rejected even if it was never destroyed', async () => {
  const env = await team()
  run(env.db, 'UPDATE members SET active = 0 WHERE id = 3') // bypasses the route on purpose
  assert.equal((await env.api('GET', '/me', env.c.beto)).statusCode, 401)
  await env.close()
})

test('a deactivated member receives no new assignment but keeps the ones they had', async () => {
  const env = await team({ worker: true })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'algo' })).json()
  const view = await until(async () => { const v = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json(); return v.status === 'proposed' ? v : null })
  const messageId = (await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: [{ ...view.proposal.messages[0], assignee_ids: [3] }] })).json().message_ids[0]
  await env.api('PATCH', '/members/3', env.c.ed, { active: false })

  const kept = await env.api('PATCH', `/messages/${messageId}`, env.c.ana, { version: 1, title: 'Sigue asignado', assignee_ids: [3] })
  assert.equal(kept.statusCode, 200, kept.body)
  assert.deepEqual(kept.json().assignee_ids, ['3'])
  const added = await env.api('PATCH', `/messages/${messageId}`, env.c.ana, { version: 2, assignee_ids: [3, 1] })
  assert.equal(added.statusCode, 200)
  const carla = await addMember(env, { email: 'carla@x.org', name: 'Carla' })
  run(env.db, 'UPDATE members SET active = 0 WHERE id = ?', carla) // a different inactive member, never assigned
  const refused = await env.api('PATCH', `/messages/${messageId}`, env.c.ana, { version: 3, assignee_ids: [3, 1, carla] })
  assert.equal(refused.statusCode, 400)
  assert.equal(refused.json().code, 'assignee_inactive')
  assert.match(refused.json().message, /desactivado/)
  await env.close()
})

test('the analyzer bundle lists only active members', async () => {
  const seen = []
  const env = await team({ worker: true, modules: { analyze: async (bundle) => { seen.push(bundle.members.map((m) => m.id)); return { status: 'ok', proposal: { messages: [{ area_id: bundle.areas[0].id, template_id: bundle.templates.find((t) => t.area_id === bundle.areas[0].id).id, title: 't', body: 'b', fields: {}, assignee_ids: [], attachment_ids: [], unit_ids: [] }], discarded: [] }, units: [] } } } })
  await env.api('PATCH', '/members/3', env.c.ed, { active: false })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'x' })).json()
  await until(async () => (await env.api('GET', `/inputs/${id}`, env.c.ana)).json().status === 'proposed')
  assert.deepEqual(seen[0], [1, 2])
  await env.close()
})

test('development login refuses a deactivated member too', async () => {
  const env = await makeEnv({ config: { nodeEnv: 'development' } })
  await addMember(env, { email: 'dev@x.org', name: 'Dev' })
  run(env.db, "UPDATE members SET active = 0 WHERE email = 'dev@x.org'")
  const r = await env.app.inject({ method: 'POST', url: '/api/auth/dev-login', payload: { email: 'dev@x.org' } })
  assert.equal(r.statusCode, 403)
  assert.equal(r.json().code, 'account_inactive')
  await env.close()
})
