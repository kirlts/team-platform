// UD-297: only the Editor changes the models of an area («Ligero» and «Mayor», UD-295). A member gets 403 for each model field, alone or
// mixed with another change, and the area keeps what it had; the Editor changes both and `null` goes back to the installation's default.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { get } from '../db/index.js'
import { addMember, login, makeEnv } from '../testing/helpers.js'

let env, editor, member, areaId
const api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
const stored = () => get(env.db, 'SELECT title, execute_model, execute_model_light FROM areas WHERE id = ?', areaId)

before(async () => {
  env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  editor = await login(env, 'ed@x.org')
  member = await login(env, 'ana@x.org')
  areaId = get(env.db, 'SELECT id FROM areas WHERE deleted_at IS NULL ORDER BY position, id LIMIT 1').id
})
after(async () => { await env.close() })

test('a member gets 403 changing either model, alone or with another field, and nothing is stored', async () => {
  const before = stored()
  for (const payload of [{ execute_model: 'claude-opus-5-5' }, { execute_model_light: 'claude-sonnet-5-5' }, { execute_model: null }, { execute_model_light: null }, { title: 'Otro nombre', execute_model: 'claude-fable-5-1' }]) {
    const res = await api('PATCH', `/areas/${areaId}`, member, payload)
    assert.equal(res.statusCode, 403, `${JSON.stringify(payload)}: ${res.body}`)
    assert.equal(res.json().code, 'forbidden')
  }
  assert.deepEqual(stored(), before, 'the area keeps its title and its models')
})

test('a request with no session is not a member either: 401, nothing is stored', async () => {
  const before = stored()
  const res = await env.app.inject({ method: 'PATCH', url: `/api/areas/${areaId}`, headers: { 'x-team-request': 'panel' }, payload: { execute_model: 'claude-opus-5-5' } })
  assert.equal(res.statusCode, 401, res.body)
  assert.deepEqual(stored(), before)
})

test('the Editor changes both models, and null goes back to the installation default', async () => {
  const set = await api('PATCH', `/areas/${areaId}`, editor, { execute_model: 'claude-opus-5-5', execute_model_light: 'claude-sonnet-5-5' })
  assert.equal(set.statusCode, 200, set.body)
  assert.deepEqual([stored().execute_model, stored().execute_model_light], ['claude-opus-5-5', 'claude-sonnet-5-5'])
  const reset = await api('PATCH', `/areas/${areaId}`, editor, { execute_model: null, execute_model_light: null })
  assert.equal(reset.statusCode, 200, reset.body)
  assert.deepEqual([stored().execute_model, stored().execute_model_light], [null, null])
})

test('a member still reads the models the area runs with', async () => {
  const res = await api('GET', '/areas', member)
  assert.equal(res.statusCode, 200, res.body)
  const area = res.json().find((a) => String(a.id) === String(areaId))
  assert.ok(area.execute_model && area.execute_model_light, 'both models are in the reading')
})
