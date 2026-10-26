// DELETE /members/:id without purge (UD-292): what the member published stays under «Miembro eliminado», what was not
// published goes, and the email is retired so the host ingress does not create the member again.

import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { exportJWK, SignJWT } from 'jose'
import { get } from '../db/index.js'
import { addMember, login, makeEnv, multipart, postInput, until } from '../testing/helpers.js'

async function team () {
  const env = await makeEnv({ worker: true, config: { identity: { login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' }) // id 1
  await addMember(env, { email: 'ana@x.org', name: 'Ana' }) // 2
  await addMember(env, { email: 'beto@x.org', name: 'Beto' }) // 3
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  env.publish = async (cookie, text, assigneeIds = []) => {
    const { input_id: id } = (await postInput(env, cookie, { text }, [])).json()
    const view = await until(async () => { const v = (await env.api('GET', `/inputs/${id}`, cookie)).json(); return v.status === 'proposed' ? v : null })
    const messages = view.proposal.messages.map((m) => ({ ...m, assignee_ids: assigneeIds, attachment_ids: [] }))
    const r = await env.api('POST', `/inputs/${id}/publish`, cookie, { messages })
    assert.equal(r.statusCode, 200, r.body)
    return { inputId: id, messageId: r.json().message_ids[0] }
  }
  env.reply = async (cookie, messageId, body) => {
    const { payload, headers } = await multipart({ body }, [])
    const r = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/replies`, payload, headers: { ...headers, cookie, 'x-team-request': 'panel' } })
    assert.equal(r.statusCode, 201, r.body)
    return r.json()
  }
  return env
}

test('published messages and replies stay with the author «Miembro eliminado»; the unpublished input goes', async () => {
  const env = await team()
  const mine = await env.publish(env.c.beto, 'de Beto')
  const other = await env.publish(env.c.ana, 'de Ana', [3])
  await env.reply(env.c.beto, other.messageId, 'respuesta de Beto')
  await env.reply(env.c.ed, mine.messageId, 'de Ed a Beto')
  const draft = (await postInput(env, env.c.beto, { text: 'borrador de Beto' }, [])).json().input_id
  await until(async () => (get(env.db, "SELECT 1 AS ok FROM inputs WHERE id = ? AND status = 'proposed'", draft) ? true : null))

  const r = await env.api('DELETE', '/members/3?confirm=true', env.c.ed)
  assert.equal(r.statusCode, 200, r.body)
  assert.deepEqual(r.json().deleted, { inputs: 1, messages: 0, replies: 0 })
  assert.deepEqual(r.json().kept, { inputs: 1, messages: 1, replies: 1 })
  assert.equal(get(env.db, 'SELECT id FROM members WHERE id = 3'), undefined)
  assert.equal(get(env.db, 'SELECT id FROM inputs WHERE id = ?', draft), undefined)

  const ghost = get(env.db, 'SELECT id, name, active, removed FROM members WHERE removed = 1')
  assert.deepEqual({ name: ghost.name, active: ghost.active }, { name: 'Miembro eliminado', active: 0 })
  const message = (await env.api('GET', `/messages/${mine.messageId}`, env.c.ed)).json()
  assert.equal(message.author_id, String(ghost.id))
  assert.equal(message.replies.length, 1) // the reply of Ed on the message stays too
  const answered = (await env.api('GET', `/messages/${other.messageId}`, env.c.ana)).json()
  assert.equal(answered.replies[0].author_id, String(ghost.id))
  assert.equal(answered.replies[0].body, 'respuesta de Beto')
  assert.deepEqual(answered.assignee_ids, [])
  const list = (await env.api('GET', '/members', env.c.ed)).json().items
  assert.equal(list.find((m) => m.id === String(ghost.id)).removed, true)
  // The placeholder cannot be edited, reactivated or deleted.
  assert.equal((await env.api('PATCH', `/members/${ghost.id}`, env.c.ed, { active: true })).statusCode, 404)
  assert.equal((await env.api('DELETE', `/members/${ghost.id}?confirm=true`, env.c.ed)).statusCode, 404)
  await env.close()
})

test('nobody deletes themselves and the last active Editor stays', async () => {
  const env = await team()
  assert.equal((await env.api('DELETE', '/members/2?confirm=true', env.c.ana)).json().code, 'cannot_delete_self')
  assert.equal((await env.api('DELETE', '/members/1?confirm=true', env.c.ana)).json().code, 'last_editor')
  assert.ok(get(env.db, 'SELECT id FROM members WHERE id = 1'))
  assert.equal((await env.api('DELETE', '/members/2?confirm=true', env.c.ed)).statusCode, 200) // a plain member is deleted by the Editor, and by any other person
  assert.equal((await env.api('DELETE', '/members/3?confirm=true', env.c.beto)).json().code, 'cannot_delete_self')
  await env.close()
})

test('a member deleted by someone who is not an Editor: any active person may', async () => {
  const env = await team()
  assert.equal((await env.api('DELETE', '/members/3?confirm=true', env.c.ana)).statusCode, 200)
  await env.close()
})

test('the removed email is retired: adding the member by hand takes it out of the list', async () => {
  const env = await team()
  assert.equal((await env.api('DELETE', '/members/3?confirm=true', env.c.ed)).statusCode, 200)
  assert.ok(get(env.db, "SELECT 1 AS r FROM retired_identities WHERE email = 'beto@x.org'"))
  const again = await env.api('POST', '/members', env.c.ed, { email: 'beto@x.org', name: 'Beto' })
  assert.equal(again.statusCode, 201, again.body)
  assert.equal(get(env.db, "SELECT 1 AS r FROM retired_identities WHERE email = 'beto@x.org'"), undefined)
  await env.close()
})

// The host ingress: a removed identity does not renew itself with a valid token from the host (the host signs a token on every entry).
const ISSUER = 'https://anfitrion.example'
const AUDIENCE = 'team-platform'
let JWKS_PORT = 0 // ephemeral, set after listen: two suites shared 8610 and collided with EADDRINUSE when run in parallel
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
let jwksServer
before(async () => {
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
  jwksServer = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })) })
  await new Promise((r) => jwksServer.listen(0, '127.0.0.1', r)); JWKS_PORT = jwksServer.address().port
})
after(() => new Promise((r) => jwksServer.close(r)))
const bearer = async (claims) => ({
  authorization: `Bearer ${await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey)}`
})

test('a removed identity does not come back when the host sends its token again', async () => {
  const env = await makeEnv({
    config: {
      identity: {
        provider: 'jwt', provision: 'host',
        delegated: { mode: 'jwt', secrets: ['s'], jwt: { jwksUrl: `http://127.0.0.1:${JWKS_PORT}/jwks.json`, jwksCooldownMs: 0, issuer: ISSUER, audience: AUDIENCE } }
      }
    }
  })
  const claims = { email: 'superadmin@host.example', name: 'Super Admin', role: 'member' }
  const editor = await bearer({ email: 'ed@host.example', name: 'Ed', role: 'editor' })
  assert.equal((await env.app.inject({ url: '/api/me', headers: editor })).statusCode, 200)
  const first = await env.app.inject({ url: '/api/me', headers: await bearer(claims) })
  assert.equal(first.statusCode, 200)
  const id = get(env.db, "SELECT id FROM members WHERE email = 'superadmin@host.example'").id
  const del = await env.app.inject({ method: 'DELETE', url: `/api/members/${id}?confirm=true`, headers: { ...editor, 'x-team-request': 'panel' } })
  assert.equal(del.statusCode, 200, del.body)
  const back = await env.app.inject({ url: '/api/me', headers: await bearer(claims) })
  assert.equal(back.statusCode, 403)
  assert.equal(back.json().code, 'member_retired')
  assert.equal(get(env.db, "SELECT id FROM members WHERE email = 'superadmin@host.example'"), undefined)
  // An explicit addition readmits the identity.
  const add = await env.app.inject({ method: 'POST', url: '/api/members', headers: { ...editor, 'x-team-request': 'panel' }, payload: { email: 'superadmin@host.example', name: 'Super Admin' } })
  assert.equal(add.statusCode, 201, add.body)
  assert.equal((await env.app.inject({ url: '/api/me', headers: await bearer(claims) })).statusCode, 200)
  await env.close()
})
