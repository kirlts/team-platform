// UD-025: GET /inputs?mine=1&status=… is the tray of in-flight and to-review inputs of the panel.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { run } from '../db/index.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

async function team (opts = {}) {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, ...opts })
  await addMember(env, { email: 'ana@x.org' })
  await addMember(env, { email: 'beto@x.org' })
  env.c = { ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' } })
  env.send = async (cookie, text) => (await postInput(env, cookie, { text })).json().input_id
  return env
}

const TRAY = '/inputs?mine=1&status=queued,extracting,analyzing,proposed'

test('tray: own in-flight inputs in creation order, with percent, phrase and proposed_count', async () => {
  const env = await team()
  const ids = []
  for (const textValue of ['uno', 'dos', 'tres']) ids.push(await env.send(env.c.ana, textValue))
  await env.send(env.c.beto, 'de otra persona')
  const res = await env.api('GET', TRAY, env.c.ana)
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.deepEqual(body.items.map((i) => i.id), ids.map(String))
  assert.equal(body.total, 3)
  assert.deepEqual([body.page, body.limit], [1, env.config.list.pageSize])
  for (const item of body.items) {
    assert.equal(item.status, 'queued')
    assert.equal(item.percent, 0)
    assert.equal(item.phrase, 'En espera')
    assert.equal(item.proposed_count, 0)
  }
  await env.close()
})

test('tray: a proposed input reports 100 and the number of proposed messages; published, failed and cancelled stay out', async () => {
  const env = await team({ worker: true })
  const done = await env.send(env.c.ana, 'se analiza')
  await until(async () => (await env.api('GET', `/inputs/${done}`, env.c.ana)).json().status === 'proposed')
  const failed = await env.send(env.c.ana, 'se cancela')
  await env.api('POST', `/inputs/${failed}/cancel`, env.c.ana)
  const published = await env.send(env.c.ana, 'se publica')
  await until(async () => (await env.api('GET', `/inputs/${published}`, env.c.ana)).json().status === 'proposed')
  run(env.db, "UPDATE inputs SET status = 'published' WHERE id = ?", published)
  const body = (await env.api('GET', TRAY, env.c.ana)).json()
  assert.deepEqual(body.items.map((i) => i.id), [String(done)])
  assert.equal(body.items[0].percent, 100)
  assert.equal(body.items[0].phrase, 'Borrador listo')
  assert.equal(body.items[0].proposed_count, 1)
  await env.close()
})

test('tray: paginated like the rest of the lists', async () => {
  const env = await team()
  const ids = []
  for (const textValue of ['a', 'b', 'c', 'd', 'e']) ids.push(await env.send(env.c.ana, textValue))
  const page2 = (await env.api('GET', `${TRAY}&limit=2&page=2`, env.c.ana)).json()
  assert.deepEqual(page2.items.map((i) => i.id), [String(ids[2]), String(ids[3])])
  assert.deepEqual([page2.page, page2.limit, page2.total], [2, 2, 5])
  assert.equal((await env.api('GET', `${TRAY}&limit=101`, env.c.ana)).statusCode, 400)
  await env.close()
})

test('list: without mine the order is newest first, order overrides it, a single status still works', async () => {
  const env = await team()
  const ids = []
  for (const textValue of ['a', 'b', 'c']) ids.push(await env.send(env.c.ana, textValue))
  const idsOf = async (url) => (await env.api('GET', url, env.c.ana)).json().items.map((i) => i.id)
  assert.deepEqual(await idsOf('/inputs'), ids.map(String).reverse())
  assert.deepEqual(await idsOf('/inputs?order=asc'), ids.map(String))
  assert.deepEqual(await idsOf('/inputs?mine=1&order=desc'), ids.map(String).reverse())
  assert.deepEqual(await idsOf('/inputs?status=queued'), ids.map(String).reverse())
  assert.deepEqual(await idsOf('/inputs?status=proposed'), [])
  await env.close()
})

test('list: an unknown status or a mine value other than 1 is a 400', async () => {
  const env = await team()
  assert.equal((await env.api('GET', '/inputs?status=queued,done', env.c.ana)).statusCode, 400)
  assert.equal((await env.api('GET', '/inputs?status=', env.c.ana)).statusCode, 400)
  assert.equal((await env.api('GET', '/inputs?mine=0', env.c.ana)).statusCode, 400)
  assert.equal((await env.api('GET', '/inputs?mine=1&status=queued', env.c.beto)).statusCode, 200)
  assert.equal((await env.app.inject({ method: 'GET', url: '/api/inputs?mine=1' })).statusCode, 401)
  await env.close()
})

test('compact=1 leaves out units and proposal from the list and keeps the rest; the detail still carries them', async () => {
  const env = await team({ worker: true })
  const id = await env.send(env.c.ana, 'se analiza')
  await until(async () => (await env.api('GET', `/inputs/${id}`, env.c.ana)).json().status === 'proposed')
  const full = (await env.api('GET', '/inputs?mine=1&order=desc', env.c.ana)).json().items[0]
  assert.ok(full.proposal?.messages?.length > 0)
  const compact = (await env.api('GET', '/inputs?mine=1&order=desc&compact=1', env.c.ana)).json().items[0]
  assert.equal('units' in compact, false)
  assert.equal('proposal' in compact, false)
  const { units: _units, proposal: _proposal, ...rest } = full
  assert.deepEqual(compact, rest)
  assert.equal(compact.proposed_count, full.proposal.messages.length)
  const detail = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
  assert.ok(detail.proposal?.messages?.length > 0)
  assert.equal((await env.api('GET', '/inputs?mine=1&compact=2', env.c.ana)).statusCode, 400)
  await env.close()
})
