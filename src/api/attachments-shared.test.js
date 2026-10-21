// idea.md: one attachment can belong to several messages. Exercised through the API with a scripted analysis, not through the schema alone.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { parseTemplate } from '../domain/template-file.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

async function team (opts = {}) {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, ...opts })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  env.c = { ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

const waitProposed = (env, id) => until(async () => {
  const v = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
  if (v.status === 'failed') throw new Error(v.error)
  return v.status === 'proposed' ? v : null
})

test('one attachment shared by two messages: both return it and removing it from one keeps it in the other', async () => {
  // The scripted analysis splits the input in two messages that both point at the first attachment.
  const analyze = async (bundle) => {
    const area = bundle.areas[0]
    const template = bundle.templates.find((t) => t.area_id === area.id)
    const fields = Object.fromEntries(parseTemplate(template.body_markdown).fields.filter((f) => f.required).map((f) => [f.name, 'dato']))
    const shared = bundle.attachments[0].id
    const message = (title) => ({ area_id: area.id, template_id: template.id, title, body: title, fields, assignee_ids: [], attachment_ids: [shared], unit_ids: [] })
    return { status: 'ok', proposal: { messages: [message('Primero'), message('Segundo')], discarded: [] }, units: [], calls: [], stats: {} }
  }
  const env = await team({ worker: true, modules: { analyze } })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'dos cosas con la misma captura' }, [{ field: 'files', name: 'captura.png', type: 'image/png', content: 'PNG!' }])).json()
  const view = await waitProposed(env, id)
  assert.equal(view.proposal.messages.length, 2)
  assert.equal(view.proposal.messages[0].attachment_ids[0], view.proposal.messages[1].attachment_ids[0])
  const sharedId = view.proposal.messages[0].attachment_ids[0]

  const published = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: view.proposal.messages })
  assert.equal(published.statusCode, 200, published.body)
  const [first, second] = published.json().message_ids
  assert.notEqual(first, second)
  for (const messageId of [first, second]) {
    const detail = (await env.api('GET', `/messages/${messageId}`, env.c.beto)).json()
    assert.deepEqual(detail.attachments.map((a) => String(a.id)), [String(sharedId)])
  }
  assert.equal(all(env.db, 'SELECT * FROM attachments WHERE input_id = ?', id).length, 1) // one file, two messages

  // The sender takes it out of the first message: the second keeps it, and so does the file.
  const removed = await env.api('PATCH', `/messages/${first}`, env.c.ana, { version: get(env.db, 'SELECT version FROM messages WHERE id = ?', first).version, attachment_ids: [] })
  assert.equal(removed.statusCode, 200, removed.body)
  assert.equal((await env.api('GET', `/messages/${first}`, env.c.beto)).json().attachments.length, 0)
  const kept = (await env.api('GET', `/messages/${second}`, env.c.beto)).json()
  assert.deepEqual(kept.attachments.map((a) => String(a.id)), [String(sharedId)])
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM attachments WHERE id = ?', Number(sharedId)).n, 1)
  await env.close()
})
