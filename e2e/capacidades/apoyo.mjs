// Support for the end-to-end tests of docs/CAPACIDADES-1.0.md (e2e/capacidades/*.e2e.test.js): a real instance (HTTP application, SQLite, queue and worker)
// with a team of three people and a way to send as a person does. Only the model providers and the Claude session are doubles.
// A test asserts what a person reads: the thread (`GET /api/messages/:id`), the lists and the card, never the tables.
import assert from 'node:assert/strict'
import { addMember, login, makeEnv, postInput, until } from '../../src/testing/helpers.js'

let sends = 0

/**
 * The instance with its team: Ed (Editor), Ana and Beto (members). `api(method, url, cookie, payload)` is the request of the panel.
 * `enviar(cookie, text, assignees)` is a person's send: input, analysis by the worker, review and publication; it returns the message id.
 */
export async function equipo ({ config = {}, modules = {}, worker = true } = {}) {
  const env = await makeEnv({ worker, modules, config: { identity: { login: { ipMax: 1000 } }, ...config } })
  env.ids = {
    ed: await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' }),
    ana: await addMember(env, { email: 'ana@x.org', name: 'Ana' }),
    beto: await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  }
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  env.enviar = async (cookie, text, assignees = null) => {
    const sent = await postInput(env, cookie, { text: `${text} (envío ${++sends})` })
    assert.equal(sent.statusCode, 202, sent.body)
    const inputId = sent.json().input_id
    const view = await until(async () => {
      const v = (await env.api('GET', `/inputs/${inputId}`, cookie)).json()
      return v.status === 'proposed' ? v : null
    }, { timeoutMs: 15000 })
    const messages = view.proposal.messages.map((m) => (assignees ? { ...m, assignee_ids: assignees } : m))
    const published = await env.api('POST', `/inputs/${inputId}/publish`, cookie, { messages })
    assert.equal(published.statusCode, 200, published.body)
    return published.json().message_ids[0]
  }
  env.hilo = async (id, cookie) => {
    const res = await env.api('GET', `/messages/${id}`, cookie)
    assert.equal(res.statusCode, 200, res.body)
    return res.json()
  }
  return env
}

/** A host site's JWKS server on an ephemeral port, and `firmar(claims)`: the token that site signs for one of its people (RS256, five minutes). */
export async function anfitrionJwt ({ issuer = 'https://anfitrion.example', audience = 'team-platform' } = {}) {
  const { generateKeyPairSync } = await import('node:crypto')
  const { createServer } = await import('node:http')
  const { exportJWK, SignJWT } = await import('jose')
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
  const server = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const sign = (claims, aud = audience, exp = '5m') => new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(issuer).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(keys.privateKey)
  return {
    config: { jwksUrl: `http://127.0.0.1:${server.address().port}/jwks.json`, jwksCooldownMs: 0, issuer, audience },
    firmar: async (claims, aud, exp) => ({ authorization: `Bearer ${await sign(claims, aud, exp)}` }),
    cerrar: () => new Promise((resolve) => server.close(resolve))
  }
}

/**
 * A send as a person does, with the credentials their identity source gives (`credenciales(method, url)` returns the headers of each request):
 * input, analysis by the worker, publication. Returns the message id. The instance must have a worker.
 */
export async function enviarComo (env, credenciales, text, assignees = null) {
  const { multipart } = await import('../../src/testing/helpers.js')
  const call = (method, url, payload) => env.app.inject({ method, url: `/api${url}`, headers: { ...credenciales(method, `/api${url}`), 'x-team-request': 'panel' }, payload, remoteAddress: '127.0.0.1' })
  const { payload, headers } = await multipart({ text: `${text} (envío ${++sends})` }, [])
  const sent = await env.app.inject({ method: 'POST', url: '/api/inputs', payload, headers: { ...headers, ...credenciales('POST', '/api/inputs'), 'x-team-request': 'panel' }, remoteAddress: '127.0.0.1' })
  assert.equal(sent.statusCode, 202, sent.body)
  const inputId = sent.json().input_id
  const view = await until(async () => {
    const v = (await call('GET', `/inputs/${inputId}`)).json()
    return v.status === 'proposed' ? v : null
  }, { timeoutMs: 15000 })
  const messages = view.proposal.messages.map((m) => (assignees ? { ...m, assignee_ids: assignees } : m))
  const published = await call('POST', `/inputs/${inputId}/publish`, { messages })
  assert.equal(published.statusCode, 200, published.body)
  return { messageId: published.json().message_ids[0], call }
}
