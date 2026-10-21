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
import { createPipeline } from './domain/pipeline.js'
import { loadModules } from './domain/modules.js'
import { sweepOrphans } from './domain/storage.js'

const MAX_TIMEOUT = 2 ** 31 - 1 // límite de setTimeout

/**
 * Worker de la cola. `handlers[kind] = { run(job, ctx) → finalize?, onFailure(job, error, outcome) }`.
 * `pollDataVersionMs`: sólo para el proceso aparte; despierta el reclamo cuando otra conexión confirma una
 * escritura (el trabajo encolado por la API).
 */
export function createWorker ({ db, queue, events, config, handlers, workerId = `worker-${randomUUID()}`, logger = createLogger({ logLevel: 'silent' }), now = Date.now, pollDataVersionMs = null, onSweep = null }) {
  const w = config.worker
  const activos = new Map() // job.id → { controller, promesa }
  let detenido = true
  let marcaTick = null
  let temporizadorProximo = null
  const temporizadores = []
  let version = null

  function programarProximo () {
    clearTimeout(temporizadorProximo)
    if (detenido) return
    const proximo = queue.nextRunAt()
    if (proximo === null) return
    // Duerme exactamente hasta el próximo `run_at` (reintentos con retroceso): no hay sondeo de reloj.
    temporizadorProximo = setTimeout(despertar, Math.min(MAX_TIMEOUT, Math.max(0, proximo - now())))
    temporizadorProximo.unref?.()
  }

  function despertar () {
    if (detenido || marcaTick) return
    marcaTick = setImmediate(() => { marcaTick = null; tick() })
  }

  function tick () {
    if (detenido) return
    while (activos.size < w.concurrency) {
      let job
      try { job = queue.claim(workerId) } catch (error) { logger.error({ err: error }, 'error al reclamar'); break }
      if (!job) break
      ejecutar(job)
    }
    programarProximo()
  }

  function ejecutar (job) {
    // Toda línea del trabajo lleva job_id e input_id.
    const jlog = logger.child({ job_id: job.id, input_id: parseJson(job.payload_json, {}).input_id ?? null, kind: job.kind, attempt: job.attempts, worker_id: workerId })
    jlog.info('trabajo reclamado')
    const controller = new AbortController()
    const abortar = (razon) => { if (!controller.signal.aborted) controller.abort(razon) }
    const ctx = { signal: controller.signal, abort: abortar, workerId }
    const latido = setInterval(() => { if (!queue.heartbeat(job)) abortar('lost') }, w.heartbeatMs)
    const limite = setTimeout(() => abortar('timeout'), w.maxRuntimeMs)

    const promesa = (async () => {
      const manejador = handlers[job.kind]
      try {
        if (!manejador) {
          queue.fail(job, new Error(`No hay manejador para trabajos «${job.kind}».`), { permanent: true })
          return
        }
        const finalizar = await manejador.run(job, ctx)
        controller.signal.throwIfAborted()
        // Cierra el trabajo y aplica las escrituras finales en una sola transacción, bajo la barrera de intento.
        events.transaction(() => {
          if (!queue.complete(job)) throw Object.assign(new Error('Se perdió el arriendo antes de terminar.'), { lost: true })
          finalizar?.()
        })
        jlog.info('trabajo terminado')
      } catch (error) {
        await manejarError(job, manejador, controller, error, jlog)
      } finally {
        clearInterval(latido)
        clearTimeout(limite)
        activos.delete(job.id)
        despertar()
      }
    })()
    activos.set(job.id, { controller, promesa })
  }

  async function manejarError (job, manejador, controller, error, jlog) {
    const razon = controller.signal.aborted ? controller.signal.reason : null
    if (error?.lost || razon === 'lost') { jlog.warn('trabajo cancelado o arriendo perdido; no se aplica nada'); return } // el estado ya no es nuestro
    if (razon === 'shutdown') { queue.release(job); jlog.info('apagado: el trabajo vuelve a la cola y el intento se reembolsa'); return }
    if (error?.deferMs !== undefined) {
      // Sin cupo (presupuesto de audio): vuelve a la cola para más tarde y el intento no se gasta.
      if (queue.defer(job, error.deferMs)) {
        try { manejador?.onDeferred?.(job, error) } catch (e) { jlog.error({ err: e }, 'error al registrar el aplazamiento') }
        jlog.info({ delay_ms: error.deferMs }, `trabajo aplazado: ${error.phrase}`)
      }
      return
    }
    const causa = razon === 'timeout' ? new Error(`El trabajo superó el tiempo máximo de ${Math.round(w.maxRuntimeMs / 1000)} s.`) : error
    const resultado = queue.fail(job, causa)
    if (resultado.state === 'lost') return
    try { manejador?.onFailure?.(job, causa, resultado) } catch (e) { jlog.error({ err: e }, 'error al registrar el fallo') }
    jlog.warn({ outcome: resultado.state, delay_ms: resultado.delayMs, error_code: causa.code ?? null }, `trabajo fallido: ${causa.message}`)
  }

  function barrer () {
    try {
      queue.recoverExpiredLeases()
      despertar()
    } catch (error) { logger.error({ err: error }, 'error al recuperar arriendos') }
  }

  async function barrerRetencion () {
    try {
      const r = queue.sweepRetention()
      const huerfanos = onSweep ? await onSweep() : 0
      if (r.trabajos || r.eventos || r.sesiones || huerfanos) logger.info({ ...r, huerfanos }, 'retención')
    } catch (error) { logger.error({ err: error }, 'error en la retención') }
  }

  const alCancelar = (jobId) => activos.get(jobId)?.controller.abort('lost')

  function start () {
    if (!detenido) return
    detenido = false
    queue.señales.on('enqueued', despertar)
    queue.señales.on('cancelled', alCancelar)
    queue.recoverExpiredLeases() // al arrancar (MS §7.3)
    temporizadores.push(setInterval(barrer, w.heartbeatMs)) // por ciclo, a la cadencia del latido
    temporizadores.push(setInterval(barrerRetencion, w.retentionSweepMs))
    if (pollDataVersionMs) {
      version = db.prepare('PRAGMA data_version').get().data_version
      temporizadores.push(setInterval(() => {
        const actual = db.prepare('PRAGMA data_version').get().data_version
        if (actual !== version) { version = actual; despertar() }
      }, pollDataVersionMs))
    }
    for (const t of temporizadores) t.unref?.()
    barrerRetencion()
    despertar()
  }

  /** Apagado ordenado: deja de reclamar, aborta lo que corre y devuelve esos trabajos a la cola (sin esperar). */
  async function stop () {
    detenido = true
    clearTimeout(temporizadorProximo)
    clearImmediate(marcaTick)
    for (const t of temporizadores.splice(0)) clearInterval(t)
    queue.señales.removeListener('enqueued', despertar)
    queue.señales.removeListener('cancelled', alCancelar)
    for (const { controller } of activos.values()) controller.abort('shutdown')
    await Promise.allSettled([...activos.values()].map((a) => a.promesa))
  }

  return { start, stop, wake: despertar, get active () { return activos.size }, workerId }
}

/** Arma el worker con sus dependencias reales. Lo usan `server.js` y el modo proceso aparte. */
export async function buildWorker ({ db, config, events, queue = null, env = process.env, logger = createLogger(config), pollDataVersionMs = null }) {
  const cola = queue ?? createQueue({ db, config, events })
  const modules = await loadModules(config, { db, env, log: (m) => logger.warn(m) })
  const handlers = createPipeline({ db, config, queue: cola, events, modules })
  const worker = createWorker({
    db, queue: cola, events, config, handlers, logger, pollDataVersionMs,
    onSweep: () => sweepOrphans(db, config, config.worker.retentionDays * 24 * 3600 * 1000)
  })
  return { worker, queue: cola, modules }
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
  const { worker } = await buildWorker({ db, config, events, logger, pollDataVersionMs: config.worker.dataVersionPollMs })
  worker.start()
  logger.info({ worker_id: worker.workerId, concurrency: config.worker.concurrency }, 'worker en marcha')
  const apagar = async (senal) => {
    logger.info(`${senal}: devolviendo los trabajos en curso a la cola`)
    await worker.stop()
    db.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => apagar('SIGTERM'))
  process.on('SIGINT', () => apagar('SIGINT'))
}

