// Worker de la cola (MASTER-SPEC §7.3). Dos formas de correrlo con el mismo código:
//   - dentro de la API (WORKER_MODE=inline, la omisión): `server.js` llama a createWorker().
//   - como proceso aparte de la misma imagen (WORKER_MODE=external): `node src/worker.js`. Este proceso NO migra
//     ni siembra: eso es el paso de inicialización único (`npm run db:init`) que corre antes de los dos.
// La exclusión entre workers la pone SQLite, no el proceso (M2: cuatro procesos, cero duplicados).

import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { loadConfig, loadEnvFile } from './config.js'
import { openInitialized } from './db/index.js'
import { parseJson } from './db/util.js'
import { createEvents } from './events/index.js'
import { createQueue } from './queue/index.js'
import { createLogger } from './log.js'
import { context, ROOT_CONTEXT } from '@opentelemetry/api'
import { errorType, initTelemetry, withSpan } from './domain/tracing.js'
import { createPipeline } from './domain/pipeline.js'
import { loadModules } from './domain/modules.js'
import { sweepOrphans } from './domain/storage.js'
import { runInJobScope, setLimiterLogger } from './providers/limiter.js'

const MAX_TIMEOUT = 2 ** 31 - 1 // cortesía declarada: the maximum Node's own setTimeout accepts; it does not govern operation

/**
 * Worker de la cola. `handlers[kind] = { run(job, ctx) → finalize?, onFailure(job, error, outcome) }`.
 * `pollDataVersionMs`: sólo para el proceso aparte; despierta el reclamo cuando otra conexión confirma una
 * escritura (el trabajo encolado por la API).
 */
export function createWorker ({ db, queue, events, config, handlers, workerId = `worker-${randomUUID()}`, logger = createLogger({ logLevel: 'silent' }), now = Date.now, pollDataVersionMs = null, onSweep = null }) {
  const w = config.worker
  setLimiterLogger(logger) // the cap reductions of the provider limiters go to the worker's log (H-83)
  const runningJobs = new Map() // job.id → { controller, promesa }
  let stopped = true
  let tickTimer = null
  let nextTimer = null
  const timers = []
  let version = null

  function armNextWake () {
    clearTimeout(nextTimer)
    if (stopped) return
    const nextAt = queue.nextRunAt()
    if (nextAt === null) return
    // Duerme exactamente hasta el próximo `run_at` (reintentos con retroceso): no hay sondeo de reloj.
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
      try { job = queue.claim(workerId) } catch (error) { logger.error({ err: error }, 'error al reclamar'); break }
      if (!job) break
      execute(job)
    }
    armNextWake()
  }

  function execute (job) {
    // Toda línea del trabajo lleva job_id e input_id.
    const jobLog = logger.child({ job_id: job.id, input_id: parseJson(job.payload_json, {}).input_id ?? null, kind: job.kind, attempt: job.attempts, worker_id: workerId })
    jobLog.info('trabajo reclamado')
    const controller = new AbortController()
    const abortJob = (abortReason) => { if (!controller.signal.aborted) controller.abort(abortReason) }
    const ctx = { signal: controller.signal, abort: abortJob, workerId }
    const heartbeatTimer = setInterval(() => { if (!queue.heartbeat(job)) abortJob('lost') }, w.heartbeatMs)
    const cap = setTimeout(() => abortJob('timeout'), w.maxRuntimeMs)

    const inputId = parseJson(job.payload_json, {}).input_id ?? null
    // Cada trabajo de la cola es un span (UD-014): los extractores y proveedores cuelgan de él.
    // Cada intento es la raíz de su propio árbol: sin ROOT_CONTEXT el span heredaría el del trabajo que lo despertó.
    // The provider calls of this job wait for their slot as this job (round-robin across jobs) and stop waiting if the job is aborted.
    const running = runInJobScope({ jobId: job.id, signal: controller.signal }, () => context.with(ROOT_CONTEXT, () => withSpan('job', { 'team.job_id': String(job.id), 'team.input_id': inputId === null ? '' : String(inputId), 'team.step': 'job', 'team.job_kind': job.kind, 'team.attempt': job.attempts }, async (span) => {
      const handlerObj = handlers[job.kind]
      try {
        if (!handlerObj) {
          queue.fail(job, new Error(`No hay manejador para trabajos «${job.kind}».`), { permanent: true })
          return
        }
        const finalize = await handlerObj.run(job, ctx)
        controller.signal.throwIfAborted()
        // Cierra el trabajo y aplica las escrituras finales en una sola transacción, bajo la barrera de intento.
        events.transaction(() => {
          if (!queue.complete(job)) throw Object.assign(new Error('Se perdió el arriendo antes de terminar.'), { lost: true })
          finalize?.()
        })
        span.setAttribute('team.outcome', 'done')
        jobLog.info('trabajo terminado')
      } catch (error) {
        await handleError(job, handlerObj, controller, error, jobLog, span)
      } finally {
        clearInterval(heartbeatTimer)
        clearTimeout(cap)
        runningJobs.delete(job.id)
        kick()
      }
    })))
    runningJobs.set(job.id, { controller, running })
  }

  async function handleError (job, handlerObj, controller, error, jobLog, span) {
    const abortReason = controller.signal.aborted ? controller.signal.reason : null
    if (error?.lost || abortReason === 'lost') { span.setAttribute('team.outcome', 'lost'); jobLog.warn('trabajo cancelado o arriendo perdido; no se aplica nada'); return } // el estado ya no es nuestro
    if (abortReason === 'shutdown') { queue.release(job); span.setAttribute('team.outcome', 'released'); jobLog.info('apagado: el trabajo vuelve a la cola y el intento se reembolsa'); return }
    if (error?.deferMs !== undefined) {
      // Sin cupo (presupuesto de audio): vuelve a la cola para más tarde y el intento no se gasta.
      if (queue.defer(job, error.deferMs)) {
        span.setAttribute('team.outcome', 'deferred')
        try { handlerObj?.onDeferred?.(job, error) } catch (e) { jobLog.error({ err: e }, 'error al registrar el aplazamiento') }
        jobLog.info({ delay_ms: error.deferMs }, `trabajo aplazado: ${error.phrase}`)
      }
      return
    }
    const failureCause = abortReason === 'timeout' ? new Error(`El trabajo superó el tiempo máximo de ${Math.round(w.maxRuntimeMs / 1000)} s.`) : error
    const result = queue.fail(job, failureCause)
    span.setAttribute('team.outcome', result.state === 'lost' ? 'lost' : result.state)
    span.setAttribute('error.type', errorType(failureCause))
    if (result.state === 'lost') return
    try { handlerObj?.onFailure?.(job, failureCause, result) } catch (e) { jobLog.error({ err: e }, 'error al registrar el fallo') }
    jobLog.warn({ outcome: result.state, delay_ms: result.delayMs, error_code: failureCause.code ?? null }, `trabajo fallido: ${failureCause.message}`)
  }

  function sweepLeases () {
    try {
      queue.recoverExpiredLeases()
      kick()
    } catch (error) { logger.error({ err: error }, 'error al recuperar arriendos') }
  }

  async function sweepRetentionJob () {
    try {
      const r = queue.sweepRetention()
      const orphans = onSweep ? await onSweep() : 0
      if (r.jobs || r.events || r.sessions || r.spans || orphans) logger.info({ ...r, orphans }, 'retención')
    } catch (error) { logger.error({ err: error }, 'error en la retención') }
  }

  const onCancelled = (jobId) => runningJobs.get(jobId)?.controller.abort('lost')

  function start () {
    if (!stopped) return
    stopped = false
    queue.signals.on('enqueued', kick)
    queue.signals.on('cancelled', onCancelled)
    queue.recoverExpiredLeases() // al arrancar (MS §7.3)
    timers.push(setInterval(sweepLeases, w.heartbeatMs)) // por ciclo, a la cadencia del latido
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

  /** Apagado ordenado: deja de reclamar, aborta lo que corre y devuelve esos trabajos a la cola (sin esperar). */
  async function stop () {
    stopped = true
    clearTimeout(nextTimer)
    clearImmediate(tickTimer)
    for (const t of timers.splice(0)) clearInterval(t)
    queue.signals.removeListener('enqueued', kick)
    queue.signals.removeListener('cancelled', onCancelled)
    for (const { controller } of runningJobs.values()) controller.abort('shutdown')
    await Promise.allSettled([...runningJobs.values()].map((a) => a.running))
  }

  return { start, stop, wake: kick, get active () { return runningJobs.size }, workerId }
}

/** Arma el worker con sus dependencias reales. Lo usan `server.js` y el modo proceso aparte. */
export async function buildWorker ({ db, config, events, queue = null, env = process.env, logger = createLogger(config), pollDataVersionMs = null }) {
  const outbox = queue ?? createQueue({ db, config, events })
  const modules = await loadModules(config, { db, env, log: (m) => logger.warn(m) })
  const handlers = createPipeline({ db, config, queue: outbox, events, modules })
  const worker = createWorker({
    db, queue: outbox, events, config, handlers, logger, pollDataVersionMs,
    onSweep: () => sweepOrphans(db, config, config.worker.retentionDays * 24 * 3600 * 1000)
  })
  return { worker, queue: outbox, modules }
}

// ---- Proceso aparte
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
  logger.info({ worker_id: worker.workerId, concurrency: config.worker.concurrency }, 'worker en marcha')
  const shutDown = async (signalName) => {
    logger.info(`${signalName}: devolviendo los trabajos en curso a la cola`)
    await worker.stop()
    await telemetry.shutdown()
    db.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => shutDown('SIGTERM'))
  process.on('SIGINT', () => shutDown('SIGINT'))
}

