// A write through the API is announced to the whole team as a `message` event with `reason: 'changed'`: the open screens read again
// what it made stale. Reads, failed writes and the progress of a job announce nothing.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addMember, login, makeEnv, multipart, openSse, postInput, until } from '../testing/helpers.js'
import { changeOfWrite } from './changes.js'

test('the roots a write makes stale, and the message it names', () => {
  const w = (method, routeUrl, params = {}, status = 200) => changeOfWrite({ method, routeUrl, params, status, prefix: '/api' })
  assert.deepEqual(w('POST', '/api/messages/:id/replies', { id: '7' }, 201), { reason: 'changed', roots: ['messages', 'areas', 'inputs'], message_id: '7' })
  assert.equal(w('PATCH', '/api/messages/:id/replies/:replyId', { id: '7', replyId: '3' }).message_id, '7')
  assert.equal(w('POST', '/api/replies/:id/restore', { id: '3' }).message_id, undefined, 'a reply id is not a message id')
  assert.equal(w('POST', '/api/messages/delete').message_id, undefined)
  assert.ok(w('PATCH', '/api/areas/:id', { id: '2' }).roots.includes('areas'))
  assert.ok(w('PATCH', '/api/members/:id', { id: '2' }).roots.includes('members'))
  assert.equal(w('GET', '/api/messages/:id', { id: '7' }), null)
  assert.equal(w('POST', '/api/messages/:id/replies', { id: '7' }, 403), null, 'a refused write changed nothing')
  assert.equal(w('POST', '/api/jobs/:id/progress', { id: '1' }), null, 'progress has its own event')
  assert.equal(w('POST', '/api/telemetry/ui'), null)
  assert.equal(w('POST', '/api/settings/providers/:slot/check', { slot: 'analyzer' }), null)
})

test('a reply made by one member reaches the stream of another as a change of that message', async () => {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, worker: true })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  const ana = await login(env, 'ana@x.org')
  const beto = await login(env, 'beto@x.org')
  const api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  const { input_id: id } = (await postInput(env, ana, { text: 'consulta en vivo' })).json()
  const view = await until(async () => {
    const v = (await api('GET', `/inputs/${id}`, ana)).json()
    return v.status === 'proposed' ? v : null
  })
  const messageId = String((await api('POST', `/inputs/${id}/publish`, ana, { messages: view.proposal.messages })).json().message_ids[0])
  const stream = await openSse(env, '/api/events', { cookie: ana })
  await stream.next(1) // replay
  const { payload, headers } = await multipart({ body: 'una respuesta de Beto' }, [])
  const r = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/replies`, payload, headers: { ...headers, cookie: beto, 'x-team-request': 'panel' } })
  assert.equal(r.statusCode, 201, r.body)
  const events = await stream.next(1)
  const change = events.find((e) => e.event === 'message' && e.data.reason === 'changed')
  assert.ok(change, JSON.stringify(events))
  assert.equal(change.data.message_id, messageId)
  assert.ok(change.data.roots.includes('messages'))
  stream.close()
  await env.close()
})
