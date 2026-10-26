// UD-301: the host asks for the notices of one person with the token it signed for her. Every check is a prohibition:
// the route never creates an account, never shows the notices of another member, never answers without the host's token.

import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { exportJWK, SignJWT } from 'jose'
import { all, get, run } from '../db/index.js'
import { addMember, makeEnv } from '../testing/helpers.js'

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

// The configuration of the host site: provisioning on, which is exactly what could create an account by asking.
const hostConfig = () => ({
  config: {
    identity: {
      provider: 'jwt',
      provision: 'host',
      delegated: { mode: 'jwt', secrets: ['secreto-agente'], jwt: { jwksUrl: `http://127.0.0.1:${JWKS_PORT}/jwks.json`, jwksCooldownMs: 0, issuer: ISSUER, audience: AUDIENCE } }
    }
  }
})
const bearer = async (claims) => ({ authorization: `Bearer ${await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey)}` })
const notices = async (env, claims, query = '') => env.app.inject({ url: `/api/host/notices${query}`, headers: await bearer(claims) })

/** Three messages: two assigned to Ana (one open, one answered), one assigned to Beto. */
function seedMessages (env, ids) {
  const area = get(env.db, 'SELECT id FROM areas ORDER BY id LIMIT 1').id
  const add = (title, status, createdAt, assignee) => {
    const id = run(env.db, 'INSERT INTO messages (area_id, author_id, title, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', area, ids.beto, title, 'texto', status, createdAt).lastInsertRowid
    run(env.db, 'INSERT INTO message_assignees (message_id, member_id) VALUES (?, ?)', id, assignee)
    return String(id)
  }
  return {
    abierto: add('Servidor caído', 'open', 1_700_000_000_000, ids.ana),
    respondido: add('Revisar el informe', 'answered', 1_700_000_100_000, ids.ana),
    deBeto: add('Aviso privado de Beto', 'open', 1_700_000_200_000, ids.beto)
  }
}

test('UD-301 · a member of the host token gets her own counts and her latest notices, open before answered, each with its path', async () => {
  const env = await makeEnv(hostConfig())
  const ids = { ana: await addMember(env, { email: 'ana@x.org', name: 'Ana' }), beto: await addMember(env, { email: 'beto@x.org', name: 'Beto' }) }
  const m = seedMessages(env, ids)
  const r = await notices(env, { email: 'ana@x.org', name: 'Ana' })
  assert.equal(r.statusCode, 200, r.body)
  const body = r.json()
  assert.equal(body.member.email, 'ana@x.org')
  assert.deepEqual(body.counts, { open: 1, answered: 1, total: 2 })
  assert.deepEqual(body.items.map((i) => i.message_id), [m.abierto, m.respondido])
  assert.equal(body.items[0].path, `/messages/${m.abierto}`)
  assert.equal(body.items[0].at, new Date(1_700_000_000_000).toISOString())
  assert.equal(JSON.stringify(body).includes('Aviso privado de Beto'), false, 'the notices of another member never come in her answer')
  // `limit` trims the list and not the count.
  const one = (await notices(env, { email: 'ana@x.org' }, '?limit=1')).json()
  assert.equal(one.items.length, 1)
  assert.equal(one.counts.total, 2)
  // And Beto gets his own: the one assigned to him, and the answered one he sent (UD-028). Never Ana's open one.
  const beto = (await notices(env, { email: 'beto@x.org' })).json()
  assert.deepEqual(beto.items.map((i) => i.message_id), [m.deBeto, m.respondido])
  assert.equal(JSON.stringify(beto).includes('Servidor caído'), false)
  await env.close()
})

test('UD-301 · an email that is not a member is 404 and nothing is created, although the host provisions on entry', async () => {
  const env = await makeEnv(hostConfig())
  await addMember(env, { email: 'ana@x.org' })
  const before = all(env.db, 'SELECT id FROM members').length
  const r = await notices(env, { email: 'nadie@x.org', name: 'Nadie', team_role: 'editor' })
  assert.equal(r.statusCode, 404)
  assert.equal(r.json().code, 'member_not_registered')
  assert.equal(all(env.db, 'SELECT id FROM members').length, before)
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'member.provision'").n, 0)
  await env.close()
})

test('UD-301 · asking applies no role and issues no session of our own', async () => {
  const env = await makeEnv(hostConfig())
  await addMember(env, { email: 'ana@x.org', role: 'member' })
  const r = await env.app.inject({ url: '/api/host/notices', headers: { ...(await bearer({ email: 'ana@x.org', role: 'editor' })), 'sec-fetch-site': 'same-origin' } })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().member.role, 'member', 'the declared role is not applied by a question')
  assert.equal(get(env.db, "SELECT role FROM members WHERE email = 'ana@x.org'").role, 'member')
  assert.equal(r.cookies.length, 0)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM sessions').n, 0)
  await env.close()
})

test('UD-301 · no token, a token with the wrong audience and a deactivated member are refused', async () => {
  const env = await makeEnv(hostConfig())
  const ana = await addMember(env, { email: 'ana@x.org' })
  assert.equal((await env.app.inject({ url: '/api/host/notices' })).statusCode, 401)
  const wrong = await new SignJWT({ email: 'ana@x.org' }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(ISSUER).setAudience('otro-servicio').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey)
  assert.equal((await env.app.inject({ url: '/api/host/notices', headers: { authorization: `Bearer ${wrong}` } })).statusCode, 401)
  run(env.db, 'UPDATE members SET active = 0 WHERE id = ?', ana)
  const off = await notices(env, { email: 'ana@x.org' })
  assert.equal(off.statusCode, 403)
  assert.equal(off.json().code, 'account_inactive')
  await env.close()
})
