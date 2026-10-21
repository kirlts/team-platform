// Punto de entrada: `npm start`. Un contenedor, un proceso: inicialización de la base, API, y el worker de la
// cola en el mismo proceso por omisión (MASTER-SPEC §7.3). Con WORKER_MODE=external el worker corre aparte
// (`npm run worker`) y esta API se entera de sus eventos por `PRAGMA data_version`.
//
// Apagado (informe 03 §4): 1) dejar de reclamar, 2) cerrar los flujos SSE, 3) abortar los trabajos en curso,
// 4) devolverlos a la cola con el intento reembolsado, 5) cerrar la API y la base. No se esperan trabajos largos,
// de modo que SIGTERM cierra bien dentro de los 10 s que Docker concede.

import { pathToFileURL } from 'node:url'
import { loadConfig, loadEnvFile } from './config.js'
import { initializeDatabase, openInitialized } from './db/index.js'
import { bootstrapFirstEditor, seedDefaults } from './db/seed.js'
import { buildApp } from './api/index.js'
import { createEvents } from './events/index.js'
import { createQueue } from './queue/index.js'
import { createLogger } from './log.js'
import { installTemplateWarmup } from './domain/modules.js'
import { initTelemetry, shutdownTelemetry } from './domain/tracing.js'
import { buildWorker } from './worker.js'

export async function start (config, { env = process.env } = {}) {
  const logger = createLogger(config, { process: 'server' })
  const log = (m) => logger.info(m)
  // Paso de inicialización único. Con el worker aparte se hace antes de arrancar ambos procesos
  // (`npm run db:init`); acá se omite con SKIP_DB_INIT=1.
  if (env.SKIP_DB_INIT !== '1') await initializeDatabase(config, { seed: seedDefaults, log })
  const db = openInitialized(config)
  const primero = await bootstrapFirstEditor(db, config)
  if (primero) {
    // La única vez que se ve una contraseña generada: no se guarda en claro en ninguna parte.
    logger.warn({ email: primero.email }, primero.generated
      ? `Primer editor creado con la contraseña ${primero.password} (se muestra una sola vez; cámbiela desde Equipo).`
      : 'Primer editor creado con la contraseña de ADMIN_PASSWORD.')
  }
  await initTelemetry({ db })
  const events = createEvents({ db })
  const queue = createQueue({ db, config, events })

  const { worker, modules } = await buildWorker({ db, config, events, queue, env, logger, pollDataVersionMs: null })
  const { app, domainEvents } = await buildApp({ db, config, queue, events, modules, logger })
  installTemplateWarmup({ domainEvents, modules, db, config, log: (m) => logger.warn(m) })

  if (config.worker.mode === 'external') events.startPolling(config.worker.dataVersionPollMs)
  if (config.worker.mode === 'inline') worker.start()

  await app.listen({ host: config.host, port: config.port })
  const { port } = app.server.address() // con PORT=0 el sistema elige uno libre
  logger.info({ worker: config.worker.mode, prefix: config.apiPrefix, port }, `API escuchando en http://${config.host}:${port}`)

  let apagando = null
  function apagar (senal) {
    apagando ??= (async () => {
      logger.info(`${senal}: apagando`)
      await worker.stop() // pasos 1, 3 y 4; los flujos SSE se cierran en el gancho preClose de la API (paso 2)
      events.stopPolling()
      await app.close() // paso 5
      await shutdownTelemetry()
      db.close()
      logger.info('apagado completo')
    })()
    return apagando
  }
  return { app, db, worker, apagar, logger }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  loadEnvFile()
  let sistema
  try {
    sistema = await start(loadConfig())
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
  const salir = (senal) => sistema.apagar(senal).then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
  process.on('SIGTERM', () => salir('SIGTERM'))
  process.on('SIGINT', () => salir('SIGINT'))
}
