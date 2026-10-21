// HP-014: publishing revalidates the edited proposal like the analyzer does, including that every unit of the input
// is in exactly one message or in `discarded` (a person who deletes a message in the preview sends its units to
// `discarded`; they are never silently lost).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { get } from '../db/index.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'

const UNITS = [1, 2, 3, 4].map((id) => ({ id, text: `unidad ${id}` }))
const numbered = async (bundle, opts) => ({ ...(await fakeAnalyze(bundle, opts)), units: UNITS })

async function setup () {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, worker: true, modules: { analyze: numbered } })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  env.cookie = await login(env, 'ana@x.org')
  env.api = (method, url, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie: env.cookie, 'x-team-request': 'panel' }, payload })
  const { input_id: id } = (await postInput(env, env.cookie, { text: 'cuatro cosas' })).json()
  const view = await until(async () => { const v = (await env.api('GET', `/inputs/${id}`)).json(); return v.status === 'proposed' ? v : null })
  const base = view.proposal.messages[0]
  const areas = (await env.api('GET', '/areas')).json()
  const idea = areas.find((a) => a.title === 'Idea')
  const msg = (title, unit_ids) => ({ ...base, title, area_id: idea.id, template_id: idea.templates[0].id, fields: { idea: title, motivation: 'm' }, unit_ids })
  return { env, id, msg }
}

test('HP-014 · units split between two messages and a discarded group publish', async () => {
  const { env, id, msg } = await setup()
  const r = await env.api('POST', `/inputs/${id}/publish`, { messages: [msg('uno', [1, 2]), msg('dos', [3])], discarded: [{ unit_ids: [4], reason: 'saludo' }] })
  assert.equal(r.statusCode, 200, r.body)
  assert.equal(r.json().message_ids.length, 2)
  await env.close()
})

test('HP-014 · a unit left in no message and not in discarded is refused (422) and nothing is published', async () => {
  const { env, id, msg } = await setup()
  const r = await env.api('POST', `/inputs/${id}/publish`, { messages: [msg('uno', [1, 2])], discarded: [{ unit_ids: [3], reason: 'x' }] }) // 4 is lost
  assert.equal(r.statusCode, 422)
  assert.equal(r.json().code, 'units_uncovered')
  assert.match(r.json().message, /unidades 4 no están en ningún mensaje/)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM messages').n, 0)
  assert.equal((await env.api('GET', `/inputs/${id}`)).json().status, 'proposed')
  await env.close()
})

test('HP-014 · deleting a message in the preview: its units must go to discarded, then it publishes', async () => {
  const { env, id, msg } = await setup()
  const deleted = await env.api('POST', `/inputs/${id}/publish`, { messages: [msg('uno', [1, 2])], discarded: [{ unit_ids: [4], reason: 'x' }] }) // the message of unit 3 vanished
  assert.equal(deleted.statusCode, 422)
  assert.equal(deleted.json().code, 'units_uncovered')
  assert.match(deleted.json().message, /unidades 3 /)
  const fixed = await env.api('POST', `/inputs/${id}/publish`, { messages: [msg('uno', [1, 2])], discarded: [{ unit_ids: [3, 4], reason: 'mensaje borrado' }] })
  assert.equal(fixed.statusCode, 200, fixed.body)
  await env.close()
})

test('HP-014 · a unit in two places or a unit the input does not have is refused (422)', async () => {
  const { env, id, msg } = await setup()
  const twice = await env.api('POST', `/inputs/${id}/publish`, { messages: [msg('uno', [1, 2]), msg('dos', [2, 3])], discarded: [{ unit_ids: [4], reason: 'x' }] })
  assert.equal(twice.statusCode, 422)
  assert.equal(twice.json().code, 'units_overlap')
  assert.match(twice.json().message, /unidad 2 está en más de un lugar/)
  const inDiscarded = await env.api('POST', `/inputs/${id}/publish`, { messages: [msg('uno', [1, 2, 3])], discarded: [{ unit_ids: [3, 4], reason: 'x' }] })
  assert.equal(inDiscarded.json().code, 'units_overlap')
  const unknown = await env.api('POST', `/inputs/${id}/publish`, { messages: [msg('uno', [1, 2, 3, 99])], discarded: [{ unit_ids: [4], reason: 'x' }] })
  assert.equal(unknown.statusCode, 422)
  assert.equal(unknown.json().code, 'unit_invalid')
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM messages').n, 0)
  await env.close()
})

test('HP-014 · the saved draft is held to the same rule when published without a body, though saving it is not', async () => {
  const { env, id, msg } = await setup()
  const incomplete = { messages: [msg('uno', [1, 2])], discarded: [] } // 3 and 4 are still nowhere
  assert.equal((await env.api('PATCH', `/inputs/${id}/proposal`, incomplete)).statusCode, 200) // the panel saves after every edit
  const refused = await env.api('POST', `/inputs/${id}/publish`)
  assert.equal(refused.statusCode, 422)
  assert.equal(refused.json().code, 'units_uncovered')
  assert.equal((await env.api('PATCH', `/inputs/${id}/proposal`, { ...incomplete, discarded: [{ unit_ids: [3, 4], reason: 'x' }] })).statusCode, 200)
  assert.equal((await env.api('POST', `/inputs/${id}/publish`)).statusCode, 200)
  await env.close()
})
