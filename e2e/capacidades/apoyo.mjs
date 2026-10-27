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
