// UD-251: the Editor's queue. GET /inputs?all=1 lists the sends of everybody with the name of the sender; a member gets 403.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

async function team () {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, autoPublish: 'default', worker: true })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

async function sendAndSettle (env, cookie, text) {
  const id = (await postInput(env, cookie, { text })).json().input_id
  await until(async () => ((await env.api('GET', `/inputs/${id}`, cookie)).json().status === 'published' ? true : null))
  return id
}

test('UD-251 · the Editor lists the sends of everybody with the sender name; each member keeps seeing only their own', async () => {
  const env = await team()
  const a = await sendAndSettle(env, env.c.ana, 'envío de Ana')
  const b = await sendAndSettle(env, env.c.beto, 'envío de Beto')
  const all = (await env.api('GET', '/inputs?all=1', env.c.ed)).json()
  assert.equal(all.total, 2)
  assert.deepEqual(all.items.map((i) => i.id).sort(), [a, b].sort())
  const names = Object.fromEntries(all.items.map((i) => [i.id, i.author_name]))
  assert.deepEqual(names, { [a]: 'Ana', [b]: 'Beto' })
  const own = (await env.api('GET', '/inputs', env.c.ana)).json()
  assert.deepEqual(own.items.map((i) => i.id), [a])
  assert.equal(own.items[0].author_name, undefined)
  const editorOwn = (await env.api('GET', '/inputs', env.c.ed)).json()
  assert.equal(editorOwn.total, 0, 'without all the Editor still sees only their own')
  await env.close()
})

test('UD-251 · a member who asks for all=1 sees the sends of everybody (UD-287)', async () => {
  const env = await team()
  await sendAndSettle(env, env.c.beto, 'envío de Beto')
  const res = await env.api('GET', '/inputs?all=1', env.c.ana)
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().items.length, 1)
  await env.close()
})

test('UD-251 · all=1 paginates like the own list and filters by status', async () => {
  const env = await team()
  for (let i = 0; i < 3; i++) await sendAndSettle(env, i % 2 ? env.c.ana : env.c.beto, `envío ${i}`)
  const first = (await env.api('GET', '/inputs?all=1&limit=2&page=1', env.c.ed)).json()
  const second = (await env.api('GET', '/inputs?all=1&limit=2&page=2', env.c.ed)).json()
  assert.equal(first.total, 3)
  assert.equal(first.items.length, 2)
  assert.equal(second.items.length, 1)
  assert.equal(new Set([...first.items, ...second.items].map((i) => i.id)).size, 3, 'no send repeats between pages')
  assert.ok(first.items[0].created_at >= first.items[1].created_at, 'newest first')
  const failed = (await env.api('GET', '/inputs?all=1&status=failed', env.c.ed)).json()
  assert.equal(failed.total, 0)
  await env.close()
})
