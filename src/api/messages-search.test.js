// GET /messages?q= searches the title, the body, the values of the template fields and the text of the replies (idea.md).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

test('q finds a message by a template field value or by the text of a reply, and not by a field name', async () => {
  const env = await makeEnv({ worker: true, config: { identity: { login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  const ana = await login(env, 'ana@x.org')
  const beto = await login(env, 'beto@x.org')
  const api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  const areas = (await api('GET', '/areas', ana)).json()
  const question = areas.find((a) => a.title === 'Pregunta')
  const idea = areas.find((a) => a.title === 'Idea')
  const make = async (title, area, fields) => {
    const { input_id: id } = (await postInput(env, ana, { text: title })).json()
    const view = await until(async () => {
      const v = (await api('GET', `/inputs/${id}`, ana)).json()
      return v.status === 'proposed' ? v : null
    })
    const r = await api('POST', `/inputs/${id}/publish`, ana, { messages: [{ ...view.proposal.messages[0], title, body: `cuerpo de ${title}`, area_id: area.id, template_id: area.templates[0].id, fields, assignee_ids: [] }] })
    assert.equal(r.statusCode, 200, r.body)
    return r.json().message_ids[0]
  }
  const byField = await make('primero', question, { question: 'zorzal en el techo' })
  const byReply = await make('segundo', idea, { idea: 'otra', motivation: 'm' })
  const none = await make('tercero', question, { question: 'nada especial' })
  assert.equal((await api('POST', `/messages/${byReply}/replies`, beto, { body: 'se resolvió con un cormorán' })).statusCode, 201)

  const ids = async (query) => (await api('GET', `/messages?q=${encodeURIComponent(query)}`, ana)).json().items.map((m) => m.id)
  assert.deepEqual(await ids('zorzal'), [byField]) // value of a template field
  assert.deepEqual(await ids('cormorán'), [byReply]) // text of a reply
  assert.deepEqual(await ids('primero'), [byField]) // title, as before
  assert.deepEqual(await ids('cuerpo de tercero'), [none]) // body, as before
  assert.deepEqual(await ids('question'), []) // the name of a field is not content
  assert.deepEqual(await ids('motivation'), [])
  assert.equal((await api('GET', '/messages?q=zorzal', ana)).json().total, 1) // the total counts the same rows
  // The number of the message, with or without `#`, finds it; a number that is not an id finds only the text that contains it.
  assert.deepEqual(await ids(String(byReply)), [byReply])
  assert.deepEqual(await ids(`#${byReply}`), [byReply])
  assert.deepEqual(await ids('99999'), [])
  assert.deepEqual(await ids('#99999'), [])
  await env.close()
})
