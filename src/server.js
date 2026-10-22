// Entry point: `npm start`. One container, one process: database initialization, API, and the queue worker in
// the same process by default (MASTER-SPEC §7.3). With WORKER_MODE=external the worker runs separately
// (`npm run worker`) and this API learns of its events through `PRAGMA data_version`.
//
// Shutdown (report 03 §4): 1) stop claiming, 2) close the SSE streams, 3) abort the jobs in progress,
// 4) return them to the queue with the attempt refunded, 5) close the API and the database. Long jobs are not awaited,
// so SIGTERM finishes well within the 10 s that Docker allows.

import { pathToFileURL } from 'node:url'
import { loadConfig, loadEnvFile } from './config.js'
import { initializeDatabase, openInitialized } from './db/index.js'
import { bootstrapFirstEditor, seedDefaults } from './db/seed.js'
import { buildApp } from './api/index.js'
import { createEvents } from './events/index.js'
import { createQueue } from './queue/index.js'
import { createLogger } from './log.js'
import { installTemplateWarmup } from './domain/modules.js'
import { getFraming, getProject } from './domain/settings.js'
import { DEFAULT_LANGUAGE } from './domain/language.js'
import { initTelemetry } from './domain/tracing.js'
import { buildWorker } from './worker.js'

export async function start (config, { env = process.env } = {}) {
  const logger = createLogger(config, { process: 'server' })
  const log = (m) => logger.info(m)
  // Single initialization step. With a separate worker it is done before starting both processes
  // (`npm run db:init`); here it is skipped with SKIP_DB_INIT=1.
  if (env.SKIP_DB_INIT !== '1') await initializeDatabase(config, { seed: seedDefaults, log })
  const db = openInitialized(config)
  const firstEditor = await bootstrapFirstEditor(db, config)
  if (firstEditor) {
    // The only time a generated password is seen: it is not stored in plain text anywhere.
    logger.warn({ email: firstEditor.email }, firstEditor.generated
      ? `First editor created with password ${firstEditor.password} (shown only once; change it from Equipo).`
      : 'First editor created with the ADMIN_PASSWORD password.')
  }
  const telemetry = initTelemetry({ db, serviceVersion: config.version }) // after migrating and before the API and the worker
  const events = createEvents({ db })
  const queue = createQueue({ db, config, events })

  const { worker, modules } = await buildWorker({ db, config, events, queue, env, logger, pollDataVersionMs: null })
  const { app, domainEvents } = await buildApp({ db, config, queue, events, modules, logger, telemetry })
  installTemplateWarmup({ domainEvents, modules, getProject: () => getProject(db, config), getFraming: () => getFraming(db, DEFAULT_LANGUAGE), log: (m) => logger.warn(m) })

  if (config.worker.mode === 'external') events.startPolling(config.worker.dataVersionPollMs)
  if (config.worker.mode === 'inline') worker.start()

  await app.listen({ host: config.host, port: config.port })
  const { port } = app.server.address() // with PORT=0 the system picks a free one
  logger.info({ worker: config.worker.mode, prefix: config.apiPrefix, port }, `API listening on http://${config.host}:${port}`)

  let shuttingDown = null
  function shutDown (signalName) {
    shuttingDown ??= (async () => {
      logger.info(`${signalName}: shutting down`)
      await worker.stop() // steps 1, 3 and 4; the SSE streams are closed in the API's preClose hook (step 2)
      events.stopPolling()
      await app.close() // step 5
      await telemetry.shutdown() // flushes the pending span batches
      db.close()
      logger.info('shutdown complete')
    })()
    return shuttingDown
  }
  return { app, db, worker, shutDown, logger }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  loadEnvFile()
  let system
  try {
    system = await start(loadConfig())
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
  const exitNow = (signalName) => system.shutDown(signalName).then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
  process.on('SIGTERM', () => exitNow('SIGTERM'))
  process.on('SIGINT', () => exitNow('SIGINT'))
}
