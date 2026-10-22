// Agent members (UD-254, UD-255, H-3724): an Editor creates one from the API and receives its secret once; the agent
// enters with the signed header keyed with that secret and never by password.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { signHeader } from '../identity/delegated.js'
import { addMember, login, makeEnv, TEST_PASSWORD } from '../testing/helpers.js'

describe('agent members', () => {
  let env, editor, agent
  before(async () => {
    env = await makeEnv()
    await addMember(env, { email: 'ed@x.org', role: 'editor' })
    editor = await login(env, 'ed@x.org')
  })
  after(() => env.close())

  const signed = (method, url, { email = agent.email, secret = agent.agent_secret, ts = Math.floor(Date.now() / 1000) } = {}) => ({
    'x-team-user': email, 'x-team-ts': String(ts), 'x-team-sig': signHeader(secret, { ts: String(ts), method, pathname: url.split('?')[0], email, bind: true })
  })

  it('an editor creates an agent with a profile and receives its secret once', async () => {
    const res = await env.app.inject({
      method: 'POST', url: '/api/members', headers: { cookie: editor, 'x-team-request': 'panel' },
      payload: { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Arreglo la interfaz y los errores de pantalla.' }
    })
    assert.equal(res.statusCode, 201, res.body)
    agent = res.json()
    assert.equal(agent.kind, 'agent')
    assert.equal(agent.profile, 'Arreglo la interfaz y los errores de pantalla.')
    assert.match(agent.agent_secret, /^[A-Za-z0-9_-]{43}$/)
    const listed = (await env.app.inject({ method: 'GET', url: '/api/members', headers: { cookie: editor } })).json().items
    const again = listed.find((m) => m.id === agent.id)
    assert.equal(again.kind, 'agent')
    assert.ok(!('agent_secret' in again), 'the secret is shown only once')
    assert.ok(!JSON.stringify(env.db.prepare('SELECT * FROM members_agent_credentials').all()).includes(agent.agent_secret), 'stored sealed, never in clear')
  })

  it('a person member keeps kind person', async () => {
    const res = await env.app.inject({ method: 'POST', url: '/api/members', headers: { cookie: editor, 'x-team-request': 'panel' }, payload: { email: 'ana@x.org', name: 'Ana' } })
    assert.equal(res.json().kind, 'person')
    assert.ok(!('agent_secret' in res.json()))
  })

  it('the agent enters with the signed header of its own secret', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/api/me', headers: signed('GET', '/api/me') })
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(res.json().email, 'claude@x.org')
    assert.equal(res.json().kind, 'agent')
  })

  it('a wrong secret, a stale timestamp or another path does not enter', async () => {
    for (const headers of [
      signed('GET', '/api/me', { secret: 'otro-secreto' }),
      signed('GET', '/api/me', { ts: Math.floor(Date.now() / 1000) - 3600 }),
      signed('GET', '/api/members')
    ]) {
      assert.equal((await env.app.inject({ method: 'GET', url: '/api/me', headers })).statusCode, 401)
    }
  })

  it('a person cannot enter with a signed header even with a valid-looking signature', async () => {
    const headers = signed('GET', '/api/me', { email: 'ana@x.org' })
    assert.equal((await env.app.inject({ method: 'GET', url: '/api/me', headers })).statusCode, 401)
  })

  it('the agent never enters by password: none on creation, none set later, login refused', async () => {
    const created = await env.app.inject({ method: 'POST', url: '/api/members', headers: { cookie: editor, 'x-team-request': 'panel' }, payload: { email: 'bot2@x.org', name: 'Bot', kind: 'agent', password: TEST_PASSWORD } })
    assert.equal(created.statusCode, 400)
    assert.equal(created.json().code, 'agent_has_no_password')
    const set = await env.app.inject({ method: 'PATCH', url: `/api/members/${agent.id}`, headers: { cookie: editor, 'x-team-request': 'panel' }, payload: { password: TEST_PASSWORD } })
    assert.equal(set.statusCode, 409)
    assert.equal(set.json().code, 'agent_has_no_password')
    const loginRes = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'claude@x.org', password: TEST_PASSWORD } })
    assert.equal(loginRes.statusCode, 401)
  })

  it('a deactivated agent does not enter', async () => {
    await env.app.inject({ method: 'PATCH', url: `/api/members/${agent.id}`, headers: { cookie: editor, 'x-team-request': 'panel' }, payload: { active: false } })
    assert.equal((await env.app.inject({ method: 'GET', url: '/api/me', headers: signed('GET', '/api/me') })).statusCode, 401)
  })
})
