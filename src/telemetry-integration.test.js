// UD-014: lo que pasa por un modelo queda trazado. La telemetría es global del proceso, así que este archivo
// la inicia una sola vez; cada archivo de prueba corre en su propio proceso.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get } from './db/index.js'
import { errorType, withGenAiCall, withSpan } from './telemetry/api.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from './testing/helpers.js'

/** Analizador que se comporta como el real: cada llamada a un modelo pasa por `withGenAiCall`. */
const instrumentedAnalyze = (failFirst = false) => {
  let calls = 0
  return async (bundle, opts) => {
    calls++
    await withSpan('analyze', { 'team.step': 'analyze' }, async () => {
      await withGenAiCall({ provider: 'anthropic', model: 'claude-haiku-5-5', modality: 'text', request: { messages: [{ role: 'user', content: bundle.text }], effort: 'low' } }, async () => ({
        text: '{"ok":true}', model: 'claude-haiku-5-5', usage: { input_tokens: 1000, output_tokens: 200, cached_tokens: 0 }
      }))
    })
    if (failFirst && calls === 1) throw new Error('503 del proveedor')
    return fakeAnalyze(bundle, opts)
  }
}

test('un trabajo deja su árbol de spans: job, analyze y la llamada al modelo, con tokens y costo (HP-002)', async () => {
  const env = await makeEnv({ telemetry: true, worker: true, config: { identity: { login: { ipMax: 1000 } }, worker: { retryBaseMs: 5, retryMaxMs: 10 } }, modules: { analyze: instrumentedAnalyze(true) } })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  const ana = await login(env, 'ed@x.org')
  const send = await postInput(env, ana, { text: 'hola equipo' })
  const { input_id: inputId, job_id: jobId } = send.json()
  await until(() => get(env.db, 'SELECT status FROM inputs WHERE id = ?', inputId).status === 'proposed')

  const trace = await env.app.inject({ url: `/api/jobs/${jobId}/trace`, headers: { cookie: ana } })
  assert.equal(trace.statusCode, 200, trace.body)
  const body = trace.json()
  assert.equal(body.job_id, jobId)
  assert.equal(body.trace_ids.length, 2) // un árbol por intento de la cola: el primero falló y se reintentó
  const walk = (nodes) => nodes.flatMap((n) => [n, ...walk(n.children)])
  const spans = walk(body.roots)
  const jobs = spans.filter((s) => s.name === 'job')
  assert.equal(jobs.length, 2)
  assert.deepEqual(jobs.map((j) => j.attributes['team.outcome']).sort(), ['done', 'requeued'])
  assert.equal(jobs[0].attributes['team.input_id'], inputId)
  assert.equal(jobs[0].attributes['team.step'], 'job')
  assert.equal(jobs.find((j) => j.attributes['team.outcome'] === 'requeued').attributes['error.type'], errorType(new Error('x')))
  const chat = spans.filter((s) => s.name === 'chat claude-haiku-5-5')
  assert.equal(chat.length, 2)
  // La llamada cuelga de `analyze`, que cuelga del trabajo: el contexto pasa por los await.
  const analyzeSpan = spans.find((s) => s.name === 'analyze')
  assert.ok(analyzeSpan.children.some((c) => c.name === 'chat claude-haiku-5-5'))
  assert.ok(jobs.some((j) => j.children.some((c) => c.name === 'analyze')))
  assert.equal(chat[0].events[0].name, 'gen_ai.client.inference.operation.details') // el contenido va en el evento
  assert.equal(typeof chat[0].start_ns, 'string') // los nanosegundos viajan como texto
  assert.equal(body.totals.llm_calls, 2)
  assert.equal(body.totals.input_tokens, 2000)

  // La vista llm_calls (no una tabla) responde la pregunta del costo.
  const calls = all(env.db, 'SELECT provider, model, modality, input_tokens, output_tokens, cost_usd FROM llm_calls ORDER BY at')
  assert.equal(calls.length, 2)
  assert.deepEqual({ ...calls[0], cost_usd: undefined }, { provider: 'anthropic', model: 'claude-haiku-5-5', modality: 'text', input_tokens: 1000, output_tokens: 200, cost_usd: undefined })
  assert.ok(Math.abs(calls[0].cost_usd - (1000 * 0.10 + 200 * 0.50) / 1e6) < 1e-12) // 0,10 y 0,50 USD por millón (MS §3)
  assert.equal(get(env.db, "SELECT type FROM sqlite_master WHERE name = 'llm_calls'").type, 'view')

  // Publicar y cerrar un mensaje también abren su span.
  const v = (await env.app.inject({ url: `/api/inputs/${inputId}`, headers: { cookie: ana } })).json()
  const pub = await env.app.inject({ method: 'POST', url: `/api/inputs/${inputId}/publish`, headers: { cookie: ana, 'x-team-request': 'panel' }, payload: { messages: v.proposal.messages } })
  const messageId = pub.json().message_ids[0]
  await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/close`, headers: { cookie: ana, 'x-team-request': 'panel' } })
  await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/reopen`, headers: { cookie: ana, 'x-team-request': 'panel' } })
  await env.telemetry.flush()
  const names = all(env.db, 'SELECT DISTINCT name FROM spans').map((r) => r.name)
  for (const n of ['input.publish', 'message.close', 'message.reopen']) assert.ok(names.includes(n), `falta el span ${n}`)

  // Un trabajo que no existe no deja árbol: 404.
  assert.equal((await env.app.inject({ url: '/api/jobs/9999/trace', headers: { cookie: ana } })).statusCode, 404)
  await env.close()
})
