// GET /api/ops/execute-runs and /summary (UD-262): the Editor reads the history of runs; filters, pages and the contract.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recordExecuteRun } from '../telemetry/execute-runs.js'
import { addMember, login, makeEnv } from '../testing/helpers.js'

const at = (d, h = 10) => new Date(2026, 9, d, h).getTime()

async function team () {
  const env = await makeEnv({ config: { instanceName: 'esta.example' } })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org') }
  env.api = (url, cookie) => env.app.inject({ method: 'GET', url: `/api${url}`, headers: cookie ? { cookie } : {} })
  const base = { attempt: 1, runner: 'machine', model: 'claude-sonnet-5-5', delivered: null }
  recordExecuteRun(env.db, { ...base, job_id: 1, message_id: 31, instance: 'otra.example', started_at: at(2), finished_at: at(2, 11), total_ms: 9e6, cost_usd: 50, outcome: 'done' })
  recordExecuteRun(env.db, { ...base, job_id: 2, message_id: 40, instance: 'esta.example', started_at: at(20), finished_at: at(20, 11), total_ms: 600000, queue_wait_ms: 4000, cost_usd: 1, outcome: 'done', delivered: true, transcript_ref: 't/2.jsonl', slowest_tools: [{ name: 'Bash', summary: 'Orden: npm test', duration_ms: 90000, success: true }] })
  recordExecuteRun(env.db, { ...base, job_id: 3, message_id: 41, instance: 'esta.example', started_at: at(21), finished_at: at(21, 11), total_ms: 1200000, cost_usd: 3, outcome: 'investigated' })
  recordExecuteRun(env.db, { ...base, job_id: 4, message_id: 40, instance: 'esta.example', attempt: 2, started_at: at(22), finished_at: at(22, 11), total_ms: 100000, outcome: 'failed', error_code: 'execute_timeout' })
  return env
}

test('the Editor lists the runs of this instance, newest first, with ids as text and dates as ISO', async () => {
  const env = await team()
  const res = await env.api('/ops/execute-runs', env.c.ed)
  assert.equal(res.statusCode, 200, res.body)
  const body = res.json()
  assert.equal(body.total, 3, 'the run of another instance is left out')
  assert.deepEqual(body.items.map((r) => r.job_id), ['4', '3', '2'])
  const r = body.items[2]
  assert.equal(r.message_id, '40')
  assert.equal(r.delivered, true)
  assert.equal(r.transcript_ref, 't/2.jsonl')
  assert.equal(r.slowest_tools[0].duration_ms, 90000)
  assert.match(r.started_at, /^2026-10-20T\d\d:\d\d:\d\d\.\d{3}Z$/)
  assert.equal(body.items[0].delivered, null)
  assert.equal(body.items[0].error_code, 'execute_timeout')
  await env.close()
})

test('filters: message, outcome, period, instance and page', async () => {
  const env = await team()
  const ids = async (q) => (await env.api(`/ops/execute-runs${q}`, env.c.ed)).json().items.map((r) => r.job_id)
  assert.deepEqual(await ids('?message_id=40'), ['4', '2'])
  assert.deepEqual(await ids('?outcome=investigated'), ['3'])
  assert.deepEqual(await ids('?since=2026-10-21'), ['4', '3'])
  assert.deepEqual(await ids('?since=2026-10-21&until=2026-10-21'), ['3'])
  assert.deepEqual(await ids('?instance=*'), ['4', '3', '2', '1'])
  assert.deepEqual(await ids('?instance=otra.example'), ['1'])
  const page = (await env.api('/ops/execute-runs?limit=2&page=2', env.c.ed)).json()
  assert.deepEqual([page.items.map((r) => r.job_id), page.total, page.page], [['2'], 3, 2])
  const bad = await env.api('/ops/execute-runs?since=ayer', env.c.ed)
  assert.equal(bad.statusCode, 400)
  const impossible = await env.api('/ops/execute-runs?since=2026-02-31', env.c.ed)
  assert.equal(impossible.json().code, 'invalid_date')
  await env.close()
})

test('the summary gives phases, cost, delivery, resolved rate and the slowest tools', async () => {
  const env = await team()
  const res = await env.api('/ops/execute-runs/summary', env.c.ed)
  assert.equal(res.statusCode, 200, res.body)
  const s = res.json()
  assert.deepEqual([s.runs, s.failed], [3, 1])
  assert.deepEqual(s.phases.total_ms, { n: 3, avg: 633333, p50: 600000, p95: 1200000 })
  assert.deepEqual(s.phases.queue_wait_ms, { n: 1, avg: 4000, p50: 4000, p95: 4000 })
  assert.deepEqual(s.cost, { n: 2, avg_usd: 2, total_usd: 4 })
  assert.deepEqual(s.delivery, { known: 1, delivered: 1, rate: 1 })
  assert.deepEqual(s.resolved, { runs: 3, investigated: 1, rate: 1 / 3 })
  assert.deepEqual(s.slowest_tools.map((t) => [t.summary, t.job_id, t.message_id]), [['Orden: npm test', '2', '40']])
  assert.match(s.from, /^2026-10-20T/)
  const all = (await env.api('/ops/execute-runs/summary?instance=*', env.c.ed)).json()
  assert.equal(all.runs, 4)
  const empty = (await env.api('/ops/execute-runs/summary?since=2027-01-01', env.c.ed)).json()
  assert.deepEqual([empty.runs, empty.from, empty.cost.total_usd], [0, null, 0])
  await env.close()
})

test('a member gets 403 and no session gets 401', async () => {
  const env = await team()
  for (const url of ['/ops/execute-runs', '/ops/execute-runs/summary']) {
    assert.equal((await env.api(url, env.c.ana)).statusCode, 403, url)
    assert.equal((await env.api(url, undefined)).statusCode, 401, url)
  }
  await env.close()
})
