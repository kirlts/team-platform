// GET /attachments/:id/transcript: the text extracted from an audio or a video, for the panel's gallery.
// Same access as the file: the sender before publishing, the whole team after; a link, a photo or a file without text has none.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { run } from '../db/index.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

async function team () {
  const env = await makeEnv({ worker: true, config: { identity: { login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  env.c = { ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

test('the transcript of an audio is served with the access of the file and is absent where there is no text', async () => {
  const env = await team()
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'x', links: 'https://example.org' }, [
    { field: 'files', name: 'nota.wav', type: 'audio/wav', content: 'RIFF' },
    { field: 'files', name: 'foto.png', type: 'image/png', content: 'PNG!' }
  ])).json()
  const view = await until(async () => {
    const v = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
    return v.status === 'proposed' ? v : null
  })
  const [audio, photo, link] = view.attachments
  const ask = (cookie, att) => env.app.inject({ url: `/api/attachments/${att.id}/transcript`, headers: cookie ? { cookie } : {} })
  // The text is set directly: what the speech provider writes is not what is under test here.
  run(env.db, "UPDATE attachments SET extracted_text = ?, extracted_at = 1 WHERE id = ?", '00:00 Hola equipo', audio.id)
  run(env.db, "UPDATE attachments SET extracted_text = ?, extracted_at = 1 WHERE id = ?", 'una foto', photo.id)

  assert.equal((await ask(env.c.ana, audio)).json().text, '00:00 Hola equipo')
  assert.equal((await ask(null, audio)).statusCode, 401)
  assert.equal((await ask(env.c.beto, audio)).statusCode, 404) // unpublished: only the sender
  assert.equal((await ask(env.c.ana, photo)).statusCode, 404) // a photo has a description, not a transcript
  assert.equal((await ask(env.c.ana, link)).statusCode, 404)
  assert.equal((await env.app.inject({ url: '/api/attachments/99999/transcript', headers: { cookie: env.c.ana } })).statusCode, 404)

  await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: [{ ...view.proposal.messages[0], attachment_ids: [audio.id] }] })
  assert.equal((await ask(env.c.beto, audio)).statusCode, 200) // published in a message: the team reads it
  const message = (await env.api('GET', '/messages', env.c.beto)).json().items[0]
  assert.equal(message.attachments[0].extracted, true) // the panel offers the transcript only where this says so
  const doc = (await env.app.inject({ url: '/api/openapi.json' })).json()
  assert.ok(doc.paths['/api/attachments/{id}/transcript'].get.responses['200'])
  await env.close()
})
