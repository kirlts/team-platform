import assert from 'node:assert/strict'
import { test } from 'node:test'
import { get, run } from '../db/index.js'
import { openDatabase } from '../db/index.js'
import { addMember, login, makeEnv, openSse } from '../testing/helpers.js'
import { createEvents, toWire } from './index.js'

const noIpLimit = { identity: { login: { ipMax: 1000 } } }

async function team (opts = {}) {
  const env = await makeEnv({ config: noIpLimit, ...opts })
  await addMember(env, { email: 'ana@x.org' })
  await addMember(env, { email: 'beto@x.org' })
  env.c = { ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  return env
}

/** An input of Ana's with a job, so that its events belong to her. */
function anasInput (env) {
  run(env.db, "INSERT INTO inputs (author_id, content_hash, status, created_at, updated_at) VALUES (1, 'h', 'analyzing', 1, 1)")
  return env.queue.enqueue('analyze', {}, { inputId: 1 })
}

test('events travel with a text id and the names progress, done and message', async () => {
  const env = await team()
  const jobId = anasInput(env)
  const s = await openSse(env, '/api/events', { cookie: env.c.ana })
  assert.equal(s.status, 200)
  assert.equal(s.headers.get('content-type'), 'text/event-stream')
  assert.match(s.headers.get('content-security-policy'), /connect-src 'self'/) // the security headers reach the stream too
  env.events.publishForJob(jobId, { kind: 'progress', percent: 40, phrase: 'leyendo' })
  env.events.publishForJob(jobId, { kind: 'done', data: { status: 'done' } })
  env.events.publish({ kind: 'message', data: { message_id: 7, title: 'Hola', author_id: 2 } })
  const [p, d, m] = await s.next(3)
  assert.equal(p.event, 'progress')
  assert.deepEqual({ ...p.data, at: undefined }, { job_id: String(jobId), input_id: '1', percent: 40, phrase: 'leyendo', at: undefined })
  assert.match(p.id, /^\d+$/)
  assert.equal(d.event, 'done')
  assert.equal(d.data.done, true)
  assert.equal(d.data.job_id, String(jobId))
  assert.equal(d.data.input_id, '1')
  assert.equal(m.event, 'message')
  assert.equal(m.data.message_id, '7')
  assert.equal(m.data.author_id, '2')
  assert.equal(m.data.title, 'Hola')
  assert.ok(Number(m.id) > Number(p.id)) // increasing ids
  s.close()
  await env.close()
})

test('progress reaches only its author; message notices reach the whole team', async () => {
  const env = await team()
  const jobId = anasInput(env)
  const ana = await openSse(env, '/api/events', { cookie: env.c.ana })
  const beto = await openSse(env, '/api/events', { cookie: env.c.beto })
  env.events.publishForJob(jobId, { kind: 'progress', percent: 10, phrase: 'x' })
  env.events.publish({ kind: 'message', data: { message_id: 1, title: 't', author_id: 1 } })
  assert.deepEqual((await ana.next(2)).map((e) => e.event), ['progress', 'message'])
  assert.deepEqual((await beto.next(2, 600)).map((e) => e.event), ['message'])
  ana.close(); beto.close()
  await env.close()
})

test('without a session the stream answers 401 (not an empty 200)', async () => {
  const env = await team()
  const s = await openSse(env, '/api/events', {})
  assert.equal(s.status, 401)
  await env.close()
})

test('Last-Event-ID replays what came after without repeating or leaving gaps', async () => {
  const env = await team()
  const jobId = anasInput(env)
  const seqs = []
  for (let i = 1; i <= 5; i++) seqs.push(env.events.publishForJob(jobId, { kind: 'progress', percent: i * 10, phrase: `p${i}` }))
  const s = await openSse(env, '/api/events', { cookie: env.c.ana, headers: { 'last-event-id': String(seqs[1]) } })
  const received = await s.next(3)
  assert.deepEqual(received.map((e) => Number(e.id)), seqs.slice(2))
  // A new event keeps arriving after the replay.
  const fresh = env.events.publishForJob(jobId, { kind: 'progress', percent: 99, phrase: 'último' })
  assert.equal(Number((await s.next(4))[3].id), fresh)
  s.close()
  await env.close()
})

test('subscribing before replaying: with events being published during the connection, each stream is contiguous and has no repeats', async () => {
  const env = await team()
  const jobId = anasInput(env)
  const total = 120
  let publishedCount = 0
  const publishIt = () => new Promise((resolve) => {
    const stepFn = () => {
      env.events.publishForJob(jobId, { kind: 'progress', percent: publishedCount % 100, phrase: `p${publishedCount}` })
      if (++publishedCount < total) setImmediate(stepFn)
      else resolve()
    }
    stepFn()
  })
  const producer = publishIt()
  // Several connections opened with Last-Event-ID 0 while publishing.
  const streams = await Promise.all(Array.from({ length: 6 }, () => openSse(env, '/api/events', { cookie: env.c.ana, headers: { 'last-event-id': '0' } })))
  await producer
  const lastSeqValue = get(env.db, 'SELECT MAX(seq) AS m FROM job_events').m
  for (const f of streams) {
    const cap = Date.now() + 5000
    while (Date.now() < cap && !(f.eventList.length && Number(f.eventList.at(-1).id) === lastSeqValue)) await new Promise((r) => setTimeout(r, 25))
    const ids = f.eventList.map((e) => Number(e.id))
    assert.equal(new Set(ids).size, ids.length, 'no repeats')
    for (let i = 1; i < ids.length; i++) assert.equal(ids[i], ids[i - 1] + 1, `gap between ${ids[i - 1]} and ${ids[i]}`)
    assert.equal(ids[0], 1)
    assert.equal(ids.at(-1), lastSeqValue)
    f.close()
  }
  await env.close()
})

test('a new connection receives the latest progress of each running job (the bar where it stands)', async () => {
  const env = await team()
  const jobId = anasInput(env)
  env.events.publishForJob(jobId, { kind: 'progress', percent: 10, phrase: 'a' })
  env.events.publishForJob(jobId, { kind: 'progress', percent: 55, phrase: 'b' })
  const s = await openSse(env, '/api/events', { cookie: env.c.ana })
  const [e] = await s.next(1)
  assert.equal(e.data.percent, 55)
  assert.equal((await s.next(2, 300)).length, 1) // only that one
  s.close()
  await env.close()
})

test('?job_id: a finished job with nothing to replay answers 204; with what was missed it replays and closes after done', async () => {
  const env = await team()
  const jobId = anasInput(env)
  const firstEditor = env.events.publishForJob(jobId, { kind: 'progress', percent: 50, phrase: 'x' })
  const endSeq = env.events.publishForJob(jobId, { kind: 'done', data: { status: 'done' } })
  env.queue.claim('w'); env.queue.complete(env.queue.getJob(jobId)) // the job has already finished
  run(env.db, "UPDATE jobs SET status = 'done' WHERE id = ?", jobId)

  const upToDate = await openSse(env, `/api/events?job_id=${jobId}`, { cookie: env.c.ana, headers: { 'last-event-id': String(endSeq) } })
  assert.equal(upToDate.status, 204) // the browser stops reconnecting

  const missed = await openSse(env, `/api/events?job_id=${jobId}`, { cookie: env.c.ana, headers: { 'last-event-id': String(firstEditor) } })
  assert.equal(missed.status, 200)
  const [d] = await missed.next(1)
  assert.equal(d.event, 'done')
  assert.equal(await missed.untilClosed(), true) // the server closes after done

  assert.equal((await openSse(env, `/api/events?job_id=${jobId}`, { cookie: env.c.beto })).status, 404) // not his job
  assert.equal((await openSse(env, '/api/events?job_id=abc', { cookie: env.c.ana })).status, 400)
  await env.close()
})

test('the heartbeat arrives as a comment at the configured cadence', async () => {
  const env = await team({ config: { ...noIpLimit, sse: { heartbeatMs: 40 } } })
  const s = await openSse(env, '/api/events', { cookie: env.c.ana })
  const cap = Date.now() + 2000
  while (s.comments.filter((c) => c === 'heartbeat').length < 2 && Date.now() < cap) await new Promise((r) => setTimeout(r, 20))
  assert.ok(s.comments.filter((c) => c === 'heartbeat').length >= 2)
  s.close()
  await env.close()
})

test('app.close() with an open stream finishes right away (forceCloseConnections and close in preClose)', async () => {
  const env = await team()
  const s = await openSse(env, '/api/events', { cookie: env.c.ana })
  assert.equal(s.status, 200)
  const t0 = Date.now()
  await env.close()
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`)
  assert.equal(await s.untilClosed(), true)
})

test('with the worker in another process, PRAGMA data_version wakes the dispatcher', async () => {
  const env = await team()
  const received = []
  env.events.subscribe(1, (dbRow) => received.push(dbRow))
  env.events.startPolling(10)
  // Another connection (as the worker process would) writes without going through the API bus.
  const other = openDatabase(env.config.dbFile)
  const foreign = createEvents({ db: other })
  foreign.publish({ kind: 'message', data: { message_id: 3, title: 't', author_id: 2 } })
  const cap = Date.now() + 2000
  while (received.length === 0 && Date.now() < cap) await new Promise((r) => setTimeout(r, 10))
  assert.equal(received.length, 1)
  assert.equal(toWire(received[0]).data.message_id, '3')
  other.close()
  await env.close()
})

test('retention deletes old events and keeps recent ones', async () => {
  const env = await team()
  env.events.publish({ kind: 'message', data: {} })
  const cutPoint = Date.now() + 1000
  env.events.publish({ kind: 'message', data: {} })
  run(env.db, 'UPDATE job_events SET at = ? WHERE seq = 2', cutPoint + 5000)
  assert.equal(env.events.purge(cutPoint), 1)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM job_events').n, 1)
  await env.close()
})
