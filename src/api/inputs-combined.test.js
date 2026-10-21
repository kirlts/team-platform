// idea.md: one send can carry text, image, video, document and link.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { get } from '../db/index.js'
import { addMember, login, makeEnv, postInput } from '../testing/helpers.js'

async function team () {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  env.c = { ana: await login(env, 'ana@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

test('one send with text, image, video, document and link creates four attachments and one analysis job', async () => {
  const env = await team()
  const sent = await postInput(env, env.c.ana, { text: 'mira esto', links: 'https://example.org/nota' }, [
    { field: 'files', name: 'foto.png', type: 'image/png', content: 'PNG!' },
    { field: 'files', name: 'clip.mp4', type: 'video/mp4', content: 'MP4!' },
    { field: 'files', name: 'informe.pdf', type: 'application/pdf', content: '%PDF-1.4' }
  ])
  assert.equal(sent.statusCode, 202, sent.body)
  const id = sent.json().input_id
  const view = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
  assert.equal(view.text, 'mira esto') // the text is the input itself; the other four are its attachments
  assert.deepEqual(view.attachments.map((a) => a.kind).sort(), ['document', 'image', 'link', 'video'])
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM attachments WHERE input_id = ?', id).n, 4)
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'analyze'").n, 1)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM inputs').n, 1)
  await env.close()
})
