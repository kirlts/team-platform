// `observed`: what a video frame shows and nobody says. It travels outside the body, from the proposal (draft and
// publication) to the published message, and GET /messages/:id returns it as an array, empty when there is none.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { get } from '../db/index.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'

const SEEN = ['La pantalla muestra un error 500 en la esquina', 'El botón Guardar está gris']

async function setup ({ analyze = fakeAnalyze, autoPublish } = {}) {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, worker: true, modules: { analyze }, ...(autoPublish ? { autoPublish } : {}) })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  env.cookie = await login(env, 'ana@x.org')
  env.api = (method, url, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie: env.cookie, 'x-team-request': 'panel' }, payload })
  const { input_id: id } = (await postInput(env, env.cookie, { text: 'un video de la pantalla' })).json()
  const view = await until(async () => { const v = (await env.api('GET', `/inputs/${id}`)).json(); return ['proposed', 'published'].includes(v.status) ? v : null })
  return { env, id, view }
}

test('observed saved in the draft comes back in the proposal and reaches the published message', async () => {
  const { env, id, view } = await setup()
  const proposal = { ...view.proposal, messages: view.proposal.messages.map((m, i) => (i === 0 ? { ...m, observed: SEEN } : m)) }
  const saved = await env.api('PATCH', `/inputs/${id}/proposal`, proposal)
  assert.equal(saved.statusCode, 200, saved.body)
  assert.deepEqual((await env.api('GET', `/inputs/${id}`)).json().proposal.messages[0].observed, SEEN)

  const published = await env.api('POST', `/inputs/${id}/publish`)
  assert.equal(published.statusCode, 200, published.body)
  const [first] = published.json().message_ids
  const message = (await env.api('GET', `/messages/${first}`)).json()
  assert.deepEqual(message.observed, SEEN)
  assert.equal(message.body.includes(SEEN[0]), false) // outside the body
  assert.equal(get(env.db, 'SELECT observed_json FROM messages WHERE id = ?', Number(first)).observed_json, JSON.stringify(SEEN))
  await env.close()
})

test('a message without observed returns an empty array and stores NULL', async () => {
  const { env, id } = await setup()
  const published = await env.api('POST', `/inputs/${id}/publish`)
  assert.equal(published.statusCode, 200, published.body)
  const [first] = published.json().message_ids
  assert.deepEqual((await env.api('GET', `/messages/${first}`)).json().observed, [])
  assert.equal(get(env.db, 'SELECT observed_json FROM messages WHERE id = ?', Number(first)).observed_json, null)
  await env.close()
})

test('an empty observation is refused (400) when saving the draft', async () => {
  const { env, id, view } = await setup()
  const proposal = { ...view.proposal, messages: view.proposal.messages.map((m) => ({ ...m, observed: [''] })) }
  assert.equal((await env.api('PATCH', `/inputs/${id}/proposal`, proposal)).statusCode, 400)
  await env.close()
})

test('the automatic publication carries the observed of the analyzer proposal to the message', async () => {
  const analyze = async (bundle, opts) => {
    const r = await fakeAnalyze(bundle, opts)
    return { ...r, proposal: { ...r.proposal, messages: r.proposal.messages.map((m) => ({ ...m, observed: SEEN })) } }
  }
  const { env, view } = await setup({ analyze, autoPublish: 'default' })
  assert.equal(view.status, 'published')
  const [first] = view.message_ids
  assert.deepEqual((await env.api('GET', `/messages/${first}`)).json().observed, SEEN)
  await env.close()
})
