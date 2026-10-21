// UD-018: one language setting per account (es-419 or en), delivered to the analyzer as bundle.language.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { get, run } from '../db/index.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

async function team (opts = {}) {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, ...opts })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

test('UD-018 · the default language is es-419 in the account and in GET /me, and POST /members does not change it', async () => {
  const env = await team()
  assert.equal((await env.api('GET', '/me', env.c.ana)).json().language, 'es-419')
  assert.equal(get(env.db, 'SELECT language FROM members WHERE email = ?', 'ana@x.org').language, 'es-419')
  const created = await env.api('POST', '/members', env.c.ed, { email: 'new@x.org', name: 'Nuevo' })
  assert.equal(created.json().language, 'es-419')
  await env.close()
})

test('UD-018 · a member changes their own language through PATCH /members/me, and only theirs', async () => {
  const env = await team()
  const r = await env.api('PATCH', '/members/me', env.c.ana, { language: 'en' })
  assert.equal(r.statusCode, 200, r.body)
  assert.equal(r.json().language, 'en')
  assert.equal((await env.api('GET', '/me', env.c.ana)).json().language, 'en')
  assert.equal((await env.api('GET', '/me', env.c.ed)).json().language, 'es-419')
  assert.equal((await env.api('PATCH', '/members/me', env.c.ana, { language: 'es-419' })).json().language, 'es-419')
  await env.close()
})

test('UD-018 · any other language is 400 with a stable code and a Spanish message; nothing is stored', async () => {
  const env = await team()
  for (const bad of ['es', 'fr', 'EN', 'es-ES', 'español', '', 'en-US']) {
    const r = await env.api('PATCH', '/members/me', env.c.ana, { language: bad })
    assert.equal(r.statusCode, 400, `${bad}: ${r.body}`)
    assert.equal(r.json().code, 'validation')
    assert.match(r.json().message, /es-419, en/)
  }
  assert.equal((await env.api('GET', '/me', env.c.ana)).json().language, 'es-419')
  // The column itself refuses any other value (CHECK), whoever writes it.
  assert.throws(() => run(env.db, "UPDATE members SET language = 'fr' WHERE email = 'ana@x.org'"), /CHECK/)
  // The domain guard, for callers other than the route, carries its own code.
  const { requireLanguage } = await import('../domain/language.js')
  assert.throws(() => requireLanguage('fr'), (error) => error.status === 400 && error.code === 'language_invalid' && /es-419, en/.test(error.message))
  await env.close()
})

test('UD-018 · POST /inputs has no per-send language: an output_language field is ignored and the author language rules', async () => {
  const seen = []
  const env = await team({
    worker: true,
    modules: { analyze: async (bundle) => { seen.push(bundle.language); return { status: 'ok', proposal: { messages: [{ area_id: bundle.areas[0].id, template_id: bundle.templates.find((t) => t.area_id === bundle.areas[0].id).id, title: 't', body: 'b', fields: {}, assignee_ids: [], attachment_ids: [], unit_ids: [] }], discarded: [] }, units: [] } } }
  })
  const settled = (id) => until(async () => ['proposed', 'failed'].includes((await env.api('GET', `/inputs/${id}`, env.c.ana)).json().status))

  const first = (await postInput(env, env.c.ana, { text: 'uno' })).json().input_id
  await settled(first)
  assert.deepEqual(seen, ['es-419'])

  await env.api('PATCH', '/members/me', env.c.ana, { language: 'en' })
  const second = (await postInput(env, env.c.ana, { text: 'dos', output_language: 'fr' })).json().input_id
  await settled(second)
  assert.deepEqual(seen, ['es-419', 'en'])
  assert.ok(!('output_language' in (await env.api('GET', `/inputs/${second}`, env.c.ana)).json()))

  // The editor keeps their own language.
  const ed = await env.api('GET', '/me', env.c.ed)
  assert.equal(ed.json().language, 'es-419')
  await env.close()
})
