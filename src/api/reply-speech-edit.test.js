// The audio of a reply is read (UD-278) and an agent called by a mention waits for it; the author edits their reply: attachments in and out, a mention added.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { addMember, login, makeEnv, multipart, postInput, until } from '../testing/helpers.js'

async function team () {
  const env = await makeEnv({ worker: true, config: { identity: { login: { ipMax: 1000 } } } })
  env.ids = {
    ed: await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' }),
    ana: await addMember(env, { email: 'ana@x.org', name: 'Ana' }),
    beto: await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  }
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  const created = await env.api('POST', '/members', env.c.ed, { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Perfil del agente.' })
  env.ids.claude = Number(created.json().id)
  return env
}
async function openMessage (env) {
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'algo' })).json()
  const view = await until(async () => {
    const v = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
    return v.status === 'proposed' ? v : null
  })
  const r = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: view.proposal.messages.map((m) => ({ ...m, assignee_ids: [env.ids.ed] })) })
  return r.json().message_ids[0]
}
const AUDIO = { name: 'nota.webm', content: Buffer.from('audio-de-prueba'), type: 'audio/webm' }
const PHOTO = { name: 'foto.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]), type: 'image/png' }
const post = async (env, id, cookie, fields, files) => {
  const { payload, headers } = await multipart(fields, files)
  return env.app.inject({ method: 'POST', url: `/api/messages/${id}/replies`, payload, headers: { ...headers, cookie, 'x-team-request': 'panel' } })
}
const count = (env, sql, ...p) => get(env.db, sql, ...p).n

test('the audio of a reply is queued to be read without holding up the reply, stored on its row and served with the same access as the file', async () => {
  const env = await team()
  const id = await openMessage(env)
  const r = await post(env, id, env.c.beto, { body: 'va por audio' }, [AUDIO, PHOTO])
  assert.equal(r.statusCode, 201, r.body)
  const reply = r.json().replies.at(-1)
  const audio = reply.attachments.find((a) => a.kind === 'audio')
  const jobs = all(env.db, "SELECT message_id, payload_json FROM jobs WHERE kind = 'extract' AND message_id = ?", id)
  assert.equal(jobs.length, 1, 'only the audio is read, not the photo')
  assert.deepEqual(JSON.parse(jobs[0].payload_json).reply_attachment_id, Number(audio.id))
  await until(() => get(env.db, 'SELECT extracted_text AS t FROM reply_attachments WHERE id = ?', audio.id).t !== null)
  const served = await env.api('GET', `/replies/attachments/${audio.id}/transcript`, env.c.ed)
  assert.equal(served.statusCode, 200, served.body)
  assert.equal(served.json().text, 'extraído de audio')
  const thread = (await env.api('GET', `/messages/${id}`, env.c.ed)).json()
  assert.equal(thread.replies.at(-1).attachments.find((a) => a.kind === 'audio').extracted, true)
  assert.equal((await env.api('GET', `/replies/attachments/${reply.attachments.find((a) => a.kind === 'image').id}/transcript`, env.c.ed)).statusCode, 404, 'a photo has none')
  assert.equal((await env.api('GET', `/replies/attachments/${audio.id}/transcript`, '')).statusCode, 401)
  await env.close()
})

test('a reply with only an audio can mention someone: the text may be empty', async () => {
  const env = await team()
  const id = await openMessage(env)
  const r = await post(env, id, env.c.beto, { body: '', mention_ids: [String(env.ids.ana)] }, [AUDIO])
  assert.equal(r.statusCode, 201, r.body)
  assert.deepEqual(r.json().replies.at(-1).mentions, [String(env.ids.ana)])
  await env.close()
})

test('an agent mentioned in a reply with audio starts when the speech is text, not before', async () => {
  const env = await team()
  const id = await openMessage(env)
  await env.worker.stop() // the reading stays queued: the mention must wait for it
  const r = await post(env, id, env.c.ed, { body: '@Claude escucha esto', mention_ids: [String(env.ids.claude)] }, [AUDIO])
  assert.equal(r.statusCode, 201, r.body)
  const replyId = Number(r.json().replies.at(-1).id)
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'execute'"), 0, 'waiting for the speech')
  assert.equal(get(env.db, 'SELECT pending FROM reply_mentions WHERE reply_id = ? AND member_id = ?', replyId, env.ids.claude).pending, 1)
  env.worker.start() // the reading runs and its end calls for the agent
  await until(() => count(env, "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'execute'") === 1)
  const stored = get(env.db, "SELECT extracted_text AS t FROM reply_attachments WHERE kind = 'audio'").t
  assert.equal(stored, 'extraído de audio', 'the text was there when the agent was enqueued')
  assert.equal(JSON.parse(get(env.db, "SELECT payload_json AS p FROM jobs WHERE kind = 'execute'").p).mention.reply_id, replyId)
  await env.close()
})

test('editing: the author takes attachments off and adds others; nobody else does; a stale version is a 409', async () => {
  const env = await team()
  const id = await openMessage(env)
  await env.worker.stop()
  const first = await post(env, id, env.c.beto, { body: 'con adjunto' }, [PHOTO])
  const reply = first.json().replies.at(-1)
  const photoId = reply.attachments[0].id
  const patch = (cookie, payload) => env.api('PATCH', `/messages/${id}/replies/${reply.id}`, cookie, payload)
  assert.equal((await patch(env.c.ed, { version: 1, remove_attachment_ids: [photoId] })).statusCode, 403)
  const add = async (cookie, version, files) => {
    const { payload, headers } = await multipart({ version: String(version) }, files)
    return env.app.inject({ method: 'POST', url: `/api/messages/${id}/replies/${reply.id}/attachments`, payload, headers: { ...headers, cookie, 'x-team-request': 'panel' } })
  }
  assert.equal((await add(env.c.ed, 1, [AUDIO])).statusCode, 403)
  const added = await add(env.c.beto, 1, [AUDIO])
  assert.equal(added.statusCode, 201, added.body)
  const afterAdd = added.json().replies.at(-1)
  assert.deepEqual(afterAdd.attachments.map((a) => a.kind), ['image', 'audio'])
  assert.equal(afterAdd.version, 2)
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'extract' AND message_id = ?", id), 1, 'the added audio is queued to be read')
  assert.equal((await add(env.c.beto, 1, [AUDIO])).statusCode, 409, 'stale version')
  const removed = await patch(env.c.beto, { version: 2, remove_attachment_ids: [photoId] })
  assert.equal(removed.statusCode, 200, removed.body)
  assert.deepEqual(removed.json().replies.at(-1).attachments.map((a) => a.kind), ['audio'])
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM reply_attachments WHERE id = ?', photoId), 0)
  // The reply cannot end with neither text nor attachments.
  const audioId = removed.json().replies.at(-1).attachments[0].id
  const empty = await patch(env.c.beto, { version: 3, body: '', remove_attachment_ids: [audioId] })
  assert.equal(empty.statusCode, 400)
  assert.equal(empty.json().code, 'reply_empty')
  assert.equal((await patch(env.c.beto, { version: 3, remove_attachment_ids: [99999] })).statusCode, 404)
  await env.close()
})

test('editing a reply to add a mention gives the effects only to the member who was not mentioned yet', async () => {
  const env = await team()
  const id = await openMessage(env)
  await env.worker.stop()
  const first = await env.api('POST', `/messages/${id}/replies`, env.c.beto, { body: '@Ana mira', mention_ids: [env.ids.ana] })
  const reply = first.json().replies.at(-1)
  const seen = { ana: [], ed: [] }
  env.events.subscribe(env.ids.ana, (e) => seen.ana.push(JSON.parse(e.data_json)))
  env.events.subscribe(env.ids.ed, (e) => seen.ed.push(JSON.parse(e.data_json)))
  const r = await env.api('PATCH', `/messages/${id}/replies/${reply.id}`, env.c.beto, { version: 1, mention_ids: [env.ids.ana, env.ids.ed, env.ids.claude] })
  assert.equal(r.statusCode, 200, r.body)
  assert.deepEqual(r.json().replies.at(-1).mentions.sort(), [env.ids.ana, env.ids.ed, env.ids.claude].map(String).sort())
  assert.equal(seen.ana.filter((d) => d.reason === 'mention').length, 0, 'Ana was already mentioned: no second notice')
  assert.equal(seen.ed.filter((d) => d.reason === 'mention').length, 1)
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'execute'"), 1, 'the agent is called once')
  const audits = all(env.db, "SELECT detail_json FROM audit_log WHERE action = 'message.mention'").map((a) => JSON.parse(a.detail_json).member)
  assert.deepEqual(audits.sort(), [env.ids.ana, env.ids.ed, env.ids.claude].sort())
  // The same edit again changes nothing: no new version.
  const again = await env.api('PATCH', `/messages/${id}/replies/${reply.id}`, env.c.beto, { version: 2, mention_ids: [env.ids.ana, env.ids.ed, env.ids.claude] })
  assert.equal(again.json().replies.at(-1).version, 2)
  await env.close()
})
