// «Enviar como» (UD-255, H-3726): POST /inputs with `as_member_id`. The input and its messages belong to the member
// chosen, `sent_by_member_id` keeps who had the session, the audit row shows both, and the rules of «mine» follow the author.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get, run } from '../db/index.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

async function team ({ autoPublish = false } = {}) {
  const env = await makeEnv({ worker: true, autoPublish, config: { identity: { login: { ipMax: 1000 } } } })
  env.ids = {
    ana: await addMember(env, { email: 'ana@x.org', name: 'Ana' }),
    bruno: await addMember(env, { email: 'bruno@x.org', name: 'Bruno' }),
    ed: await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  }
  env.c = { ana: await login(env, 'ana@x.org'), bruno: await login(env, 'bruno@x.org'), ed: await login(env, 'ed@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

test('send as: multipart as_member_id makes the input and its messages belong to the chosen member', async () => {
  const env = await team({ autoPublish: true })
  const res = await postInput(env, env.c.ana, { text: 'Revisar la caldera del piso dos', as_member_id: String(env.ids.bruno) })
  assert.equal(res.statusCode, 202, res.body)
  const id = Number(res.json().input_id)
  const row = get(env.db, 'SELECT author_id, sent_by_member_id FROM inputs WHERE id = ?', id)
  assert.equal(row.author_id, env.ids.bruno)
  assert.equal(row.sent_by_member_id, env.ids.ana)
  await until(() => get(env.db, 'SELECT status FROM inputs WHERE id = ?', id).status === 'published')
  const messages = all(env.db, 'SELECT id, author_id FROM messages WHERE input_id = ?', id)
  assert.ok(messages.length > 0)
  for (const m of messages) assert.equal(m.author_id, env.ids.bruno)
  const detail = (await env.api('GET', `/messages/${messages[0].id}`, env.c.ed)).json()
  assert.equal(detail.author_id, String(env.ids.bruno))
  assert.equal(detail.sent_by_id, String(env.ids.ana))
  await env.close()
})

test('send as: JSON as_member_id is accepted and sending as oneself stores no sender', async () => {
  const env = await team()
  const other = await env.api('POST', '/inputs', env.c.ana, { text: 'Pedir repuestos', as_member_id: String(env.ids.bruno) })
  assert.equal(other.statusCode, 202, other.body)
  assert.equal(get(env.db, 'SELECT author_id FROM inputs WHERE id = ?', Number(other.json().input_id)).author_id, env.ids.bruno)
  const self = await env.api('POST', '/inputs', env.c.ana, { text: 'Llamar al proveedor', as_member_id: String(env.ids.ana) })
  assert.equal(self.statusCode, 202, self.body)
  const row = get(env.db, 'SELECT author_id, sent_by_member_id FROM inputs WHERE id = ?', Number(self.json().input_id))
  assert.equal(row.author_id, env.ids.ana)
  assert.equal(row.sent_by_member_id, null)
  await env.close()
})

test('send as: the input.create audit row is the session member and carries author and sender', async () => {
  const env = await team()
  const id = Number((await postInput(env, env.c.ana, { text: 'Cambiar el filtro', as_member_id: String(env.ids.bruno) })).json().input_id)
  const audit = (await env.api('GET', '/audit?action=input.create', env.c.ed)).json().items.find((a) => String(a.entity_id) === String(id))
  assert.equal(audit.member_id, String(env.ids.ana))
  assert.equal(audit.member_name, 'Ana')
  assert.equal(String(audit.detail.author_id), String(env.ids.bruno))
  assert.equal(String(audit.detail.sent_by_id), String(env.ids.ana))
  await env.close()
})

test('send as: an agent member cannot be impersonated (400 cannot_send_as_agent)', async () => {
  const env = await team()
  const agent = await addMember(env, { email: 'bot@x.org', name: 'Bot' })
  // The kind of member arrives with the agent members; the test adds the column when this branch does not have it yet.
  if (!all(env.db, 'PRAGMA table_info(members)').some((c) => c.name === 'kind')) run(env.db, "ALTER TABLE members ADD COLUMN kind TEXT NOT NULL DEFAULT 'person'")
  run(env.db, "UPDATE members SET kind = 'agent' WHERE id = ?", agent)
  const res = await postInput(env, env.c.ana, { text: 'Hazlo tú', as_member_id: String(agent) })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().code, 'cannot_send_as_agent')
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM inputs').n, 0)
  await env.close()
})

test('send as: an unknown or deactivated member is 400 send_as_invalid', async () => {
  const env = await team()
  for (const value of ['999', 'abc', '-1']) {
    const res = await postInput(env, env.c.ana, { text: `Envío ${value}`, as_member_id: value })
    assert.equal(res.statusCode, 400, value)
    assert.equal(res.json().code, 'send_as_invalid', value)
  }
  run(env.db, 'UPDATE members SET active = 0 WHERE id = ?', env.ids.bruno)
  const inactive = await env.api('POST', '/inputs', env.c.ana, { text: 'Para Bruno', as_member_id: String(env.ids.bruno) })
  assert.equal(inactive.statusCode, 400)
  assert.equal(inactive.json().code, 'send_as_invalid')
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM inputs').n, 0)
  await env.close()
})

test('send as: the sender sees what they sent on behalf of someone (UD-273); editing and cancelling follow the author', async () => {
  const env = await team()
  const id = Number((await postInput(env, env.c.ana, { text: 'Ordenar la bodega', as_member_id: String(env.ids.bruno), auto_publish: 'false' })).json().input_id)
  await until(() => get(env.db, 'SELECT status FROM inputs WHERE id = ?', id).status === 'proposed')
  const anaList = (await env.api('GET', '/inputs?mine=1', env.c.ana)).json().items.map((i) => i.id)
  const brunoList = (await env.api('GET', '/inputs?mine=1', env.c.bruno)).json().items
  assert.ok(anaList.includes(String(id)), 'the sender sees it in their tray (UD-273)')
  const own = brunoList.find((i) => i.id === String(id))
  assert.equal(own.sent_by_id, String(env.ids.ana))
  assert.equal((await env.api('GET', `/inputs/${id}`, env.c.ana)).statusCode, 200)
  assert.equal((await env.api('POST', `/inputs/${id}/cancel`, env.c.ana)).statusCode, 404)
  assert.equal((await env.api('PATCH', `/inputs/${id}`, env.c.ana, { text: 'otro' })).statusCode, 404)
  assert.equal((await env.api('POST', `/inputs/${id}/cancel`, env.c.bruno)).statusCode, 200)
  await env.close()
})
