// UD-250 (H-3706): what was deleted is listed and restored from the screen, so the lists answer for it.
// `GET /messages?deleted=1`: the viewer's own deleted messages, every one for an Editor; plus areas, templates and discarded sends.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

async function team () {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, worker: true })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

async function publish (env, cookie, title) {
  const { input_id: id } = (await postInput(env, cookie, { text: title })).json()
  const view = await until(async () => {
    const v = (await env.api('GET', `/inputs/${id}`, cookie)).json()
    return v.status === 'proposed' ? v : null
  })
  const question = (await env.api('GET', '/areas', cookie)).json().find((a) => a.title === 'Pregunta')
  const r = await env.api('POST', `/inputs/${id}/publish`, cookie, { messages: [{ ...view.proposal.messages[0], title, body: `cuerpo ${title}`, area_id: question.id, template_id: question.templates[0].id, fields: { question: title }, assignee_ids: [] }] })
  assert.equal(r.statusCode, 200, r.body)
  return r.json().message_ids[0]
}

const ids = async (env, cookie, query) => (await env.api('GET', `/messages${query}`, cookie)).json().items.map((m) => m.id)

test('UD-250 · deleted messages are listed to their sender and to an Editor, never to another member, and restoring brings them back', async () => {
  const env = await team()
  const anas = await publish(env, env.c.ana, 'de ana')
  const betos = await publish(env, env.c.beto, 'de beto')
  const kept = await publish(env, env.c.ana, 'queda')
  for (const [id, cookie] of [[anas, env.c.ana], [betos, env.c.beto]]) assert.equal((await env.api('DELETE', `/messages/${id}?confirm=true`, cookie)).statusCode, 204)

  assert.deepEqual(await ids(env, env.c.ana, '?deleted=1'), [anas], 'the sender sees only their own')
  assert.deepEqual(await ids(env, env.c.beto, '?deleted=1'), [betos], 'a member does not see the ones of others')
  assert.deepEqual((await ids(env, env.c.ed, '?deleted=1')).sort(), [anas, betos].sort(), 'the Editor sees all of them')
  assert.deepEqual(await ids(env, env.c.ana, '?deleted=0'), [kept])
  assert.deepEqual(await ids(env, env.c.ana, ''), [kept], 'the plain list still ignores them')

  const page = (await env.api('GET', '/messages?deleted=1&limit=1&page=2', env.c.ed)).json()
  assert.equal(page.items.length, 1)
  assert.equal(page.total, 2)
  assert.ok(page.items[0].deleted_at, 'each one carries deleted_at')

  assert.equal((await env.api('POST', `/messages/${anas}/restore`, env.c.beto)).statusCode, 403, 'another member cannot restore it')
  assert.equal((await env.api('POST', `/messages/${anas}/restore`, env.c.ana)).statusCode, 200)
  assert.deepEqual(await ids(env, env.c.ana, '?deleted=1'), [])
  assert.deepEqual((await ids(env, env.c.ana, '')).sort(), [anas, kept].sort(), 'it is back in the list')
  assert.equal((await env.api('POST', `/messages/${betos}/restore`, env.c.ed)).statusCode, 200, 'the Editor restores anyone')
  assert.deepEqual(await ids(env, env.c.ed, '?deleted=1'), [])
  assert.equal((await env.api('GET', '/messages?deleted=2', env.c.ana)).statusCode, 400)
})

test('UD-250 · deleted areas and templates are listed to the Editor and come back with restore', async () => {
  const env = await team()
  const areas = (await env.api('GET', '/areas', env.c.ed)).json()
  const area = areas[0]
  assert.equal((await env.api('DELETE', `/areas/${area.id}?confirm=true`, env.c.ed)).statusCode, 204)
  assert.ok(!(await env.api('GET', '/areas', env.c.ed)).json().some((a) => a.id === area.id))
  const gone = (await env.api('GET', '/areas?include_deleted=true', env.c.ed)).json().filter((a) => a.deleted_at)
  assert.deepEqual(gone.map((a) => a.id), [area.id])
  assert.equal((await env.api('GET', '/areas?include_deleted=true', env.c.ana)).statusCode, 403)
  assert.equal((await env.api('POST', `/areas/${area.id}/restore`, env.c.ed)).statusCode, 200)
  assert.ok((await env.api('GET', '/areas', env.c.ed)).json().some((a) => a.id === area.id))

  const [template] = (await env.api('GET', `/areas/${area.id}/templates`, env.c.ed)).json()
  assert.equal((await env.api('DELETE', `/areas/${area.id}/templates/${template.id}?confirm=true`, env.c.ed)).statusCode, 204)
  const all = (await env.api('GET', `/areas/${area.id}/templates?include_deleted=true`, env.c.ed)).json()
  assert.deepEqual(all.filter((x) => x.deleted_at).map((x) => x.id), [template.id])
  assert.equal((await env.api('POST', `/templates/${template.id}/restore`, env.c.ed)).statusCode, 200)
  assert.ok((await env.api('GET', `/areas/${area.id}/templates`, env.c.ed)).json().some((x) => x.id === template.id))
})

test('UD-250 · a discarded send is listed with status=cancelled and comes back with restore', async () => {
  const env = await team()
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'descartable' })).json()
  await until(async () => ((await env.api('GET', `/inputs/${id}`, env.c.ana)).json().status === 'proposed' ? true : null))
  assert.equal((await env.api('POST', `/inputs/${id}/cancel`, env.c.ana)).statusCode, 200)
  const listed = (await env.api('GET', '/inputs?mine=1&status=cancelled', env.c.ana)).json().items
  assert.deepEqual(listed.map((i) => i.id), [id])
  assert.equal((await env.api('POST', `/inputs/${id}/restore`, env.c.ana)).statusCode, 200)
  assert.deepEqual((await env.api('GET', '/inputs?mine=1&status=cancelled', env.c.ana)).json().items, [])
})
