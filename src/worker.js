// Queue worker (MASTER-SPEC §7.3). Two ways to run it with the same code:
//   - inside the API (WORKER_MODE=inline, the default): `server.js` calls createWorker().
//   - as a separate process of the same image (WORKER_MODE=external): `node src/worker.js`. This process does NOT migrate
//     or seed: that is the single initialization step (`npm run db:init`) that runs before both.
// Mutual exclusion between workers is provided by SQLite, not by the process (M2: four processes, zero duplicates).

import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { loadConfig, loadEnvFile } from './config.js'
import { openInitialized, run } from './db/index.js'
import { parseJson } from './db/util.js'
import { createEvents } from './events/index.js'
import { createQueue } from './queue/index.js'
import { createLogger } from './log.js'
import { context } from '@opentelemetry/api'
import { errorType, initTelemetry, withSpan } from './domain/tracing.js'
import { contextFromTraceparent, currentTraceparent, linkTo } from './telemetry/api.js'
import { unseenFailures } from './domain/escalation.js'
import { attendPendingMentions } from './domain/mentions.js'
import { createPipeline } from './domain/pipeline.js'
import { createDeliverHandler } from './execute/deliver.js'
import { createExecuteHandler } from './execute/handler.js'
import { loadModules } from './domain/modules.js'
import { sweepOrphans } from './domain/storage.js'
import { runInJobScope, setLimiterLogger } from './providers/limiter.js'

const MAX_TIMEOUT = 2 ** 31 - 1 // declared courtesy: the maximum Node's own setTimeout accepts; it does not govern operation

/**
 * Waits for `work`, but no longer than `graceMs` after `signal` aborts. A handler that listens to the signal ends within the grace and cleans up
 * after itself; one that does not (a call without its own deadline, a process that ignores SIGTERM, a read on a stuck mount) would keep its slot,
 * its lease and the shutdown waiting for as long as it hangs. What it does after the worker gave up is not applied: the job is already closed.
 */
function untilSettledOrGivenUp (work, signal, graceMs) {
  return new Promise((resolve, reject) => {
    let timer = null
    const giveUp = () => { timer = setTimeout(() => reject(Object.assign(new Error(`aborted: ${String(signal.reason)}`), { aborted: true })), graceMs) }
    work.then(resolve, reject).finally(() => { clearTimeout(timer); signal.removeEventListener('abort', giveUp) })
    if (signal.aborted) giveUp()
    else signal.addEventListener('abort', giveUp, { once: true })
  })
}

/**
 * Queue worker. `handlers[kind] = { run(job, ctx) → finalize?, onFailure(job, error, outcome) }`.
 * `pollDataVersionMs`: only for the separate process; wakes the claim when another connection commits a
 * write (the job enqueued by the API).
 */
export function createWorker ({ db, queue, events, config, handlers, workerId = `worker-${randomUUID()}`, logger = createLogger({ logLevel: 'silent' }), now = Date.now, pollDataVersionMs = null, onSweep = null }) {
  const w = config.worker
  setLimiterLogger(logger) // the cap reductions of the provider limiters go to the worker's log (H-83)
  const runningJobs = new Map() // job.id → { controller, promise }
  let stopped = true
  let tickTimer = null
  let nextTimer = null
  let emptyClaimAt = 0 // instant of the last claim that found nothing it could take
  const timers = []
  let version = null

  function armNextWake () {
    clearTimeout(nextTimer)
    if (stopped) return
    const nextAt = queue.nextRunAt()
    if (nextAt === null) return
    // A job already due that the last claim could not take waits for a free slot or lane: the end of a running job wakes the claim (`kick` in its `finally`).
    // Arming a timer for it re-read the queue every millisecond for as long as the slots were full (304 reads in 500 ms with one job running and two waiting).
    // A job that became due after that claim is not blocked, it is late: it gets its timer.
    if (runningJobs.size >= w.concurrency || nextAt <= emptyClaimAt) return
    // Sleeps exactly until the next `run_at` (retries with backoff): there is no clock polling.
    nextTimer = setTimeout(kick, Math.min(MAX_TIMEOUT, Math.max(0, nextAt - now())))
    nextTimer.unref?.()
  }

  function kick () {
    if (stopped || tickTimer) return
    tickTimer = setImmediate(() => { tickTimer = null; tick() })
  }

  function tick () {
    if (stopped) return
    while (runningJobs.size < w.concurrency) {
      let job
      const askedAt = now() // before the claim: a job that became due while it ran is late, not blocked
      try { job = queue.claim(workerId, undefined, { running: [...runningJobs.keys()] }) } catch (error) { logger.error({ err: error }, 'error while claiming'); break }
      if (!job) { emptyClaimAt = askedAt; break }
      execute(job)
    }
    armNextWake()
  }

  function execute (job) {
    // Every line of the job carries job_id and input_id.
    const jobLog = logger.child({ job_id: job.id, input_id: parseJson(job.payload_json, {}).input_id ?? null, kind: job.kind, attempt: job.attempts, worker_id: workerId })
    jobLog.info('job claimed')
    const controller = new AbortController()
    const abortJob = (abortReason) => { if (!controller.signal.aborted) controller.abort(abortReason) }
    const ctx = { signal: controller.signal, abort: abortJob, workerId }
    // A beat that cannot write (the database busy or full) is not the end of the process: the lease holds two more beats, and the next one tries again.
    const heartbeatTimer = setInterval(() => {
      try { if (!queue.heartbeat(job)) abortJob('lost') } catch (error) { jobLog.warn({ err: error }, 'could not renew the lease; the next beat tries again') }
    }, w.heartbeatMs)
    // A handler may declare its own cap (`execute`: EXECUTE_TIMEOUT_MS); the others use QUEUE_MAX_RUNTIME_MS.
    const capMs = handlers[job.kind]?.maxRuntimeMs ?? w.maxRuntimeMs
    const cap = setTimeout(() => abortJob('timeout'), capMs)

    const inputId = parseJson(job.payload_json, {}).input_id ?? null
    // Every queue job is a span (UD-014): the extractors and providers hang from it.
    // Each attempt joins the trace of its message; with no stored trace it is the root of its own, never a child of the job that woke it.
    // The provider calls of this job wait for their slot as this job (round-robin across jobs) and stop waiting if the job is aborted.
    const running = runInJobScope({ jobId: job.id, signal: controller.signal }, () => context.with(contextFromTraceparent(job.traceparent), () => withSpan('job', { 'team.job_id': String(job.id), 'team.input_id': inputId === null ? '' : String(inputId), 'team.step': 'job', 'team.job_kind': job.kind, 'team.attempt': job.attempts }, async (span) => {
      // The attempt keeps the trace of its message and links the previous attempt (or the previous job of the same message, UD-262).
      try { run(db, 'UPDATE jobs SET last_span = ? WHERE id = ?', currentTraceparent(), job.id) } catch (e) { jobLog.warn({ err: e }, 'could not store the span context of the job') }
      const handlerObj = handlers[job.kind]
      try {
        if (!handlerObj) {
          queue.fail(job, new Error(`No hay manejador para trabajos «${job.kind}».`), { permanent: true })
          return
        }
        const finalize = await untilSettledOrGivenUp(handlerObj.run(job, ctx), controller.signal, w.abortGraceMs)
        controller.signal.throwIfAborted()
        // Closes the job and applies the final writes in a single transaction, under the attempt barrier.
        events.transaction(() => {
          if (!queue.complete(job)) throw Object.assign(new Error('Se perdió el arriendo antes de terminar.'), { lost: true })
          finalize?.()
          attendMentions(job) // UD-277: a mention that arrived while the agent worked this message is attended now
        })
        span.setAttribute('team.outcome', 'done')
        jobLog.info('job finished')
      } catch (error) {
        // A database that refuses to write how the job ended (busy past its timeout, a full disk) must not leave a rejection nobody awaits, which
        // takes the whole process down: the job keeps its `running` row, its heartbeat stops with this attempt, and its lease expires and recovers it.
        try {
          await handleError(job, handlerObj, controller, error, jobLog, span, capMs)
        } catch (writeError) {
          jobLog.error({ err: writeError }, 'could not record how the job ended; its lease will expire and the queue will recover it')
        }
      } finally {
        clearInterval(heartbeatTimer)
        clearTimeout(cap)
        runningJobs.delete(job.id)
        kick()
      }
    }, { links: [linkTo(job.last_span, { 'team.link': 'previous_attempt' }), linkTo(job.link_traceparent, { 'team.link': 'previous_job' })].filter(Boolean) })))
    runningJobs.set(job.id, { controller, running })
  }

  async function handleError (job, handlerObj, controller, error, jobLog, span, capMs = w.maxRuntimeMs) {
    const abortReason = controller.signal.aborted ? controller.signal.reason : null
    if (error?.lost || abortReason === 'lost') { span.setAttribute('team.outcome', 'lost'); jobLog.warn('job cancelled or lease lost; nothing is applied'); return } // the state is no longer ours
    if (abortReason === 'shutdown') { queue.release(job); span.setAttribute('team.outcome', 'released'); jobLog.info('shutdown: the job goes back to the queue and the attempt is refunded'); return }
    if (error?.deferMs !== undefined) {
      // No quota left (audio budget): goes back to the queue for later and the attempt is not spent.
      if (queue.defer(job, error.deferMs)) {
        span.setAttribute('team.outcome', 'deferred')
        try { handlerObj?.onDeferred?.(job, error) } catch (e) { jobLog.error({ err: e }, 'error while recording the deferral') }
        jobLog.info({ delay_ms: error.deferMs }, `job deferred: ${error.phrase}`)
      }
      return
    }
    const failureCause = abortReason === 'timeout' ? new Error(`El trabajo superó el tiempo máximo de ${Math.round(capMs / 1000)} s.`) : error
    const result = queue.fail(job, failureCause)
    span.setAttribute('team.outcome', result.state === 'lost' ? 'lost' : result.state)
    span.setAttribute('error.type', errorType(failureCause))
    if (result.state === 'lost') return
    try { handlerObj?.onFailure?.(job, failureCause, result) } catch (e) { jobLog.error({ err: e }, 'error while recording the failure') }
    if (result.state === 'failed') { try { events.transaction(() => attendMentions(job)) } catch (e) { jobLog.error({ err: e }, 'error while attending the pending mentions') } }
    jobLog.warn({ outcome: result.state, delay_ms: result.delayMs, error_code: failureCause.code ?? null }, `job failed: ${failureCause.message}`)
  }

  // A job whose lease expired with no attempts left is failed by the queue itself, with no handler running: the handler hears about it here
  // (the message of an `execute` that died with its worker went unanswered and unseen, 2026-10-23, job 99). The queue announces them as `leaseFailed`
  // from every place that recovers leases: the sweep, the start and the claim (which used to drop them).
  function reportExpired (failedIds) {
    for (const id of failedIds ?? []) {
      try {
        const job = queue.getJob(id)
        const error = Object.assign(new Error(job.last_error ?? 'El arriendo venció sin que el trabajo terminara.'), { code: 'lease_expired' })
        handlers[job.kind]?.onFailure?.(job, error, { state: 'failed' })
      } catch (e) { logger.error({ err: e, job_id: id }, 'error while recording the expired lease') }
    }
  }

  // The safety net under every handler: a job that failed and left its message with no person (a restart between the failure and its handler, a handler
  // that threw, a path that none covers) is handed to the handler again with `job_failed_unseen`, once. `unseenFailures` only lists messages that have
  // someone to hand them to, so a message nobody can take is not retried every cycle.
  function sweepUnseen () {
    for (const { job_id: id } of unseenFailures(db, { now: now(), graceMs: w.heartbeatMs })) {
      try {
        const job = queue.getJob(id)
        const error = Object.assign(new Error(job.last_error ?? 'El trabajo falló y nadie recibió el mensaje.'), { code: 'job_failed_unseen' })
        handlers[job.kind]?.onFailure?.(job, error, { state: 'failed' })
        logger.warn({ job_id: id, kind: job.kind }, 'a failed job had left its message with nobody: handed to a person')
      } catch (e) { logger.error({ err: e, job_id: id }, 'error while handing an unseen failure to a person') }
    }
  }

  // The safety net of each handler that keeps one (`sweep`): what a restart or a crash between two writes left without a job to move it.
  function sweepHandlers () {
    for (const [kind, handlerObj] of Object.entries(handlers)) {
      try { if (handlerObj.sweep?.() > 0) logger.warn({ kind }, 'a record had been left with no job alive: settled') } catch (e) { logger.error({ err: e, kind }, 'error while settling the records of a kind') }
    }
  }

  /**
   * The end of an `execute` or `deliver` job of a message frees its agent, and the end of the reading of a reply's audio (`extract`, UD-278) frees its thread: the mentions that waited for it (UD-277) get their job now. Safe to call at any
   * time: an agent that is still busy keeps them pending.
   */
  function attendMentions (job) {
    if ((job.kind === 'execute' || job.kind === 'deliver' || job.kind === 'extract') && job.message_id) attendPendingMentions(db, { now, messageId: job.message_id })
  }

  function sweepLeases () {
    try {
      queue.recoverExpiredLeases({ spare: workerId, running: [...runningJobs.keys()] })
      sweepUnseen()
      events.transaction(() => attendPendingMentions(db, { now })) // safety net: a restart between the end of a job and the hook above
      sweepHandlers()
      kick()
    } catch (error) { logger.error({ err: error }, 'error while recovering leases') }
  }

  async function sweepRetentionJob () {
    try {
      const r = queue.sweepRetention()
      const orphans = onSweep ? await onSweep() : 0
      if (r.jobs || r.events || r.sessions || r.spans || r.runs || orphans) logger.info({ ...r, orphans }, 'retention')
    } catch (error) { logger.error({ err: error }, 'error in retention') }
  }

  const onCancelled = (jobId) => runningJobs.get(jobId)?.controller.abort('lost')
  const onLeaseFailed = (ids) => reportExpired(ids)

  function start () {
    if (!stopped) return
    stopped = false
    queue.signals.on('enqueued', kick)
    queue.signals.on('cancelled', onCancelled)
    queue.signals.on('leaseFailed', onLeaseFailed)
    queue.recoverExpiredLeases({ spare: workerId, running: [] }) // at startup (MS §7.3): this worker holds nothing yet
    sweepUnseen()
    sweepHandlers()
    timers.push(setInterval(sweepLeases, w.heartbeatMs)) // per cycle, at the heartbeat's cadence
    timers.push(setInterval(sweepRetentionJob, w.retentionSweepMs))
    if (pollDataVersionMs) {
      version = db.prepare('PRAGMA data_version').get().data_version
      timers.push(setInterval(() => {
        const current = db.prepare('PRAGMA data_version').get().data_version
        if (current !== version) { version = current; kick() }
      }, pollDataVersionMs))
    }
    for (const t of timers) t.unref?.()
    sweepRetentionJob()
    kick()
  }

  /** Orderly shutdown: stops claiming, aborts what is running and returns those jobs to the queue (without waiting). */
  async function stop () {
    stopped = true
    clearTimeout(nextTimer)
    clearImmediate(tickTimer)
    for (const t of timers.splice(0)) clearInterval(t)
    queue.signals.removeListener('enqueued', kick)
    queue.signals.removeListener('cancelled', onCancelled)
    queue.signals.removeListener('leaseFailed', onLeaseFailed)
    for (const { controller } of runningJobs.values()) controller.abort('shutdown')
    await Promise.allSettled([...runningJobs.values()].map((a) => a.running))
  }

  return { start, stop, wake: kick, get active () { return runningJobs.size }, workerId }
}

/** Builds the worker with its real dependencies. Used by `server.js` and the separate-process mode. */
export async function buildWorker ({ db, config, events, queue = null, env = process.env, logger = createLogger(config), pollDataVersionMs = null }) {
  const outbox = queue ?? createQueue({ db, config, events })
  const modules = await loadModules(config, { db, env, log: (m) => logger.warn(m) })
  const handlers = { ...createPipeline({ db, config, queue: outbox, events, modules }), execute: createExecuteHandler({ db, config, queue: outbox, events, vault: modules.vault, logger }), deliver: createDeliverHandler({ db, config, queue: outbox, events, logger }) }
  const worker = createWorker({
    db, queue: outbox, events, config, handlers, logger, pollDataVersionMs,
    onSweep: () => sweepOrphans(db, config, config.worker.retentionDays * 24 * 3600 * 1000)
  })
  return { worker, queue: outbox, modules }
}

// ---- Separate process
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  loadEnvFile()
  const config = loadConfig()
  const logger = createLogger(config, { process: 'worker' })
  let db
  try {
    db = openInitialized(config)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
  const events = createEvents({ db })
  const telemetry = initTelemetry({ db, serviceVersion: config.version })
  const { worker } = await buildWorker({ db, config, events, logger, pollDataVersionMs: config.worker.dataVersionPollMs })
  worker.start()
  logger.info({ worker_id: worker.workerId, concurrency: config.worker.concurrency }, 'worker running')
  // Every timer of the worker is unref'd, so nothing holds this process open (inside the API the HTTP server does) and it
  // exited with code 0 right after starting. This timer, at the longest delay Node accepts, is the one that keeps it alive until a signal.
  const keepAlive = setInterval(() => {}, MAX_TIMEOUT)
  const shutDown = async (signalName) => {
    clearInterval(keepAlive)
    logger.info(`${signalName}: returning the jobs in progress to the queue`)
    await worker.stop()
    await telemetry.shutdown()
    db.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => shutDown('SIGTERM'))
  process.on('SIGINT', () => shutDown('SIGINT'))
}

