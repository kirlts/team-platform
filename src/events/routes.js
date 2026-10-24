// GET /events (MASTER-SPEC §7.10): one SSE stream per member with progress, job completion and message notices.
//  - `id` of each event = job_events.seq; the browser resends `Last-Event-ID` on reconnect.
//  - It subscribes BEFORE replaying and discards what was already sent: zero repeats and zero gaps (I03 §5.1, M4).
//  - Comment heartbeat every `sse.heartbeatMs` (15 s, suggestion of the HTML standard).
//  - `?job_id=N` narrows the stream to one job, closes it after its `done`, and answers 204 if that job has already
//    finished and there is nothing to replay: the standard sets 204 so the browser stops reconnecting.
//  - Without `Last-Event-ID`, a new connection receives the latest progress of each of the member's running jobs.
//  - The first event of every connection is `replay`: `{ complete, from }`. It has no `id` when history follows (the last event
//    replayed sets `Last-Event-ID`); with nothing to replay its `id` is the last `seq` issued, so a tab that saw no event has one.
//    `complete: true` means the replayed events are everything the client missed; `false` (no `Last-Event-ID`, or retention
//    already removed events after it) means they are not, and the client must read its lists again.

import fastifySse from '@fastify/sse'
import { get } from '../db/index.js'
import { toWire } from './index.js'
import { notFound } from '../domain/errors.js'

const TERMINAL_STATES = new Set(['done', 'failed', 'cancelled'])

export async function registerEventRoutes (app, { db, config, events, requireRole }) {
  // Exact version pinned in package.json: it is a 0.x (I07 §5.2).
  await app.register(fastifySse, { heartbeatInterval: config.sse.heartbeatMs })
  const openStreams = new Set()

  app.get('/events', {
    onRequest: [requireRole('member')],
    sse: 'manual',
    schema: {
      querystring: { type: 'object', properties: { job_id: { type: 'integer', minimum: 1 } }, additionalProperties: false },
      response: {
        200: { type: 'string', description: 'text/event-stream flow. Events: replay (first: `{ complete, from }`), progress, done, message. The id is job_events.seq (Last-Event-ID).' },
        204: { type: 'null', description: 'With job_id: the job has already finished and there is nothing to replay; the browser stops reconnecting.' }
      }
    }
  }, async (request, reply) => {
    const memberRow = request.member.id
    const jobId = request.query.job_id ?? null
    const rawValue = request.headers['last-event-id']
    const lastSeqValue = rawValue !== undefined && /^\d+$/.test(rawValue) ? Number(rawValue) : null

    let jobRow = null
    if (jobId !== null) {
      jobRow = get(db, 'SELECT j.id, j.status FROM jobs j JOIN inputs i ON i.id = j.input_id WHERE j.id = ? AND (i.author_id = ? OR i.sent_by_member_id = ?)', jobId, memberRow, memberRow)
      if (!jobRow) throw notFound('El trabajo no existe.')
    }

    // Initial replay (after subscribing).
    const pending = []
    let replaying = true
    const sentSeqs = new Set()
    const outbox = { chain: Promise.resolve() }

    const submit = (dbRow) => submitWire(toWire(dbRow), dbRow)
    const submitWire = (wire, dbRow = null) => {
      outbox.chain = outbox.chain.then(async () => {
        if (!reply.sse.isConnected) return
        await reply.sse.send(wire)
        if (jobId !== null && dbRow?.kind === 'done') reply.sse.close() // the client closes its EventSource on receiving it
      }).catch(() => {})
    }
    const dispatch = (dbRow) => {
      if (jobId !== null && dbRow.job_id !== jobId) return
      if (replaying) pending.push(dbRow)
      else submit(dbRow)
    }
    const unsubscribe = events.subscribe(memberRow, dispatch)

    const history = lastSeqValue !== null
      ? events.replay(memberRow, lastSeqValue, { jobId })
      : jobId !== null ? events.replay(memberRow, 0, { jobId }) : events.snapshot(memberRow)

    // 204: the job has already finished and the client missed nothing. Without these conditions the connection stays open.
    if (jobRow && TERMINAL_STATES.has(jobRow.status) && history.length === 0) {
      unsubscribe()
      return reply.code(204).send()
    }

    reply.sse.sendHeaders()
    reply.raw.write(': connected\n\n') // forces the first byte through buffering proxies
    // Before the history, so the client knows whether what follows is all it missed.
    // With nothing to replay it carries the last `seq` issued as its `id`, so a quiet tab still has a `Last-Event-ID` to come back with.
    const replayWire = { event: 'replay', data: lastSeqValue !== null ? events.replayCoverage(lastSeqValue) : { complete: false, from: null } }
    if (history.length === 0) replayWire.id = String(events.lastIssued())
    submitWire(replayWire)
    for (const dbRow of history) { sentSeqs.add(dbRow.seq); submit(dbRow) }
    replaying = false
    for (const dbRow of pending) if (!sentSeqs.has(dbRow.seq)) submit(dbRow)

    const loginResponse = { close: () => reply.sse.close() }
    openStreams.add(loginResponse)
    await new Promise((resolver) => {
      reply.sse.onClose(resolver)
    })
    unsubscribe()
    openStreams.delete(loginResponse)
  })

  // Shutdown (I03 §4, step 2): close the streams before `app.close()`.
  return { closeAll () { for (const e of [...openStreams]) e.close() } }
}
