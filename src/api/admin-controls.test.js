// UD-252: the Editor's controls that lived only in the API or the command line: another member's password and the sample set.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { test } from 'node:test'
import { get } from '../db/index.js'
import { addMember, login, makeEnv, TEST_PASSWORD } from '../testing/helpers.js'

async function setup () {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } } })
  const bruno = await addMember(env, { email: 'bruno@x.org', name: 'Bruno' })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  env.bruno = bruno
  env.c = { ed: await login(env, 'ed@x.org'), bruno: await login(env, 'bruno@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

test('the Editor sets another member\'s password: their sessions close and the new one signs in', async () => {
  const env = await setup()
  try {
    const NEW = 'otra clave larga de prueba 77'
    assert.equal((await env.api('GET', '/me', env.c.bruno)).statusCode, 200)
    const r = await env.api('PATCH', `/members/${env.bruno}`, env.c.ed, { password: NEW })
    assert.equal(r.statusCode, 200, r.body)
    assert.equal((await env.api('GET', '/me', env.c.bruno)).statusCode, 401)
    assert.ok(await login(env, 'bruno@x.org', NEW))
    await assert.rejects(login(env, 'bruno@x.org', TEST_PASSWORD))
  } finally { await env.close() }
})

test('a short password is refused with the policy code and a member cannot set another\'s', async () => {
  const env = await setup()
  try {
    const short = await env.api('PATCH', `/members/${env.bruno}`, env.c.ed, { password: 'abc' })
    assert.equal(short.statusCode, 400, short.body)
    assert.ok(short.json().code)
    assert.ok(await login(env, 'bruno@x.org', TEST_PASSWORD))
    const ed = get(env.db, "SELECT id FROM members WHERE email = 'ed@x.org'").id
    assert.equal((await env.api('PATCH', `/members/${ed}`, env.c.bruno, { password: 'otra clave larga de prueba 77' })).statusCode, 403)
  } finally { await env.close() }
})

test('POST /ops/seed needs confirm, is for the Editor, and creates one input per example in the name of who asks', async () => {
  const env = await setup()
  try {
    assert.equal((await env.api('POST', '/ops/seed', env.c.ed)).json().code, 'confirm_required')
    assert.equal((await env.api('POST', '/ops/seed?confirm=true', env.c.bruno)).statusCode, 403)
    const total = readdirSync(env.config.examplesDir).filter((n) => !n.startsWith('.')).length
    const r = await env.api('POST', '/ops/seed?confirm=true', env.c.ed)
    assert.equal(r.statusCode, 202, r.body)
    assert.deepEqual(r.json(), { created: total, existing: 0 })
    const ed = get(env.db, "SELECT id FROM members WHERE email = 'ed@x.org'").id
    assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM inputs WHERE author_id = ?', ed).n, total)
    assert.ok(get(env.db, 'SELECT COUNT(*) AS n FROM attachments').n >= 3)
    const again = await env.api('POST', '/ops/seed?confirm=true', env.c.ed)
    assert.deepEqual(again.json(), { created: 0, existing: total })
  } finally { await env.close() }
})
