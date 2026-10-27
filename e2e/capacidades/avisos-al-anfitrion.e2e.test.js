// Capability «Avisos al anfitrión» (docs/CAPACIDADES-1.0.md): the host site asks, with the signed token of one of its people, for her counts and her latest
// notices, without creating her account and without seeing another person's. It starts from a send: a member sends through the API with her host token,
// the worker analyzes and the message is published to another member; the host reads that member's notices, and after the reply, the sender's.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { addMember, makeEnv } from '../../src/testing/helpers.js'
import { anfitrionJwt, enviarComo } from './apoyo.mjs'

let host
before(async () => { host = await anfitrionJwt() })
after(() => host.cerrar())

test('a send reaches the assignee\'s host notices; her reply makes it the sender\'s too and closing clears both; nobody reads another person\'s and nobody is created by asking', async () => {
  const env = await makeEnv({
    worker: true,
    config: { identity: { provider: 'jwt', provision: 'host', delegated: { mode: 'jwt', secrets: ['secreto'], jwt: host.config } } }
  })
  const ana = await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  const beto = await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  const tokenOf = async (email) => host.firmar({ email })
  const asBeto = { authorization: (await tokenOf('beto@x.org')).authorization }
  const asAna = { authorization: (await tokenOf('ana@x.org')).authorization }
  const notices = (headers, query = '') => env.app.inject({ url: `/api/host/notices${query}`, headers })

  // Beto sends with the token of his host and the message is for Ana.
  const sent = await enviarComo(env, () => asBeto, 'el servidor no responde desde las nueve', [ana])
  const messageId = sent.messageId
  const mine = await notices(asAna)
  assert.equal(mine.statusCode, 200, mine.body)
  assert.equal(mine.json().member.email, 'ana@x.org')
  assert.deepEqual(mine.json().counts, { open: 1, answered: 0, total: 1 })
  assert.equal(mine.json().items.length, 1)
  assert.equal(mine.json().items[0].message_id, messageId)
  assert.equal(mine.json().items[0].status, 'open')
  assert.equal(mine.json().items[0].path, `/messages/${messageId}`)
  // The notice is the message that Ana reads in her thread, at the path it names.
  const thread = await env.app.inject({ url: `/api${mine.json().items[0].path}`, headers: asAna })
  assert.equal(thread.statusCode, 200, thread.body)
  assert.equal(thread.json().id, messageId)
  assert.equal(thread.json().title, mine.json().items[0].title)
  // Beto, the sender of an unanswered message, has no notice from it.
  assert.deepEqual((await notices(asBeto)).json().counts, { open: 0, answered: 0, total: 0 })

  // Ana replies: the message is answered, it leaves her open ones and it becomes the sender's notice.
  const reply = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/replies`, headers: { ...asAna, 'x-team-request': 'panel' }, payload: { body: 'Ya lo reinicié.' } })
  assert.equal(reply.statusCode, 201, reply.body)
  const afterReply = (await notices(asBeto)).json()
  assert.deepEqual(afterReply.counts, { open: 0, answered: 1, total: 1 })
  assert.deepEqual(afterReply.items.map((i) => [i.message_id, i.status, i.path]), [[messageId, 'answered', `/messages/${messageId}`]])
  // Ana, who is assigned, keeps it as answered until it is closed (UD-028); closing it clears both.
  assert.deepEqual((await notices(asAna)).json().counts, { open: 0, answered: 1, total: 1 })
  const closed = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/close`, headers: { ...asBeto, 'x-team-request': 'panel' } })
  assert.equal(closed.statusCode, 200, closed.body)
  for (const headers of [asAna, asBeto]) assert.deepEqual((await notices(headers)).json().counts, { open: 0, answered: 0, total: 0 })

  // Prohibitions: the answer of one never carries the notices of another; an unknown person is not created; no token and a token for another service are refused.
  const members = () => env.db.prepare('SELECT COUNT(*) AS n FROM members').get().n
  const before = members()
  const unknown = await notices(await host.firmar({ email: 'nadie@x.org', name: 'Nadie', role: 'editor' }))
  assert.equal(unknown.statusCode, 404)
  assert.equal(unknown.json().code, 'member_not_registered')
  assert.equal(members(), before)
  assert.equal((await notices({})).statusCode, 401)
  assert.equal((await notices(await host.firmar({ email: 'ana@x.org' }, 'otro-servicio'))).statusCode, 401)
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0, 'asking opened a session')
  assert.ok(beto)
  await env.close()
})
