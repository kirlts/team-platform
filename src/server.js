// Punto de entrada: `npm start`. Un contenedor, un proceso: inicialización de la base, API, y el worker de la
// cola en el mismo proceso por omisión (MASTER-SPEC §7.3). Con WORKER_MODE=external el worker corre aparte
// (`npm run worker`) y esta API se entera de sus eventos por `PRAGMA data_version`.
//
// Apagado (informe 03 §4): 1) dejar de reclamar, 2) cerrar los flujos SSE, 3) abortar los trabajos en curso,
// 4) devolverlos a la cola con el intento reembolsado, 5) cerrar la API y la base. No se esperan trabajos largos.

import { loadConfig, loadEnvFile } from './config.js'
import { initializeDatabase, openInitialized } from './db/index.js'
import { seedDefaults } from './db/seed.js'
import { buildApp } from './api/index.js'
import { createEvents } from './events/index.js'
import { createQueue } from './queue/index.js'
import { buildWorker } from './worker.js'

export async function start (config) {
  const log = (m) => console.log(`[servidor] ${m}`)
  // Paso de inicialización único. Con el worker aparte se hace antes de arrancar ambos procesos
  // (`npm run db:init`); acá se omite con SKIP_DB_INIT=1.
  if (process.env.SKIP_DB_INIT !== '1') initializeDatabase(config, { seed: seedDefaults, log })
  const db = openInitialized(config)
  const events = createEvents({ db })
  const queue = createQueue({ db, config, events })

  const { worker, modules } = await buildWorker({ db, config, events, queue, log, pollDataVersionMs: null })
  const { app } = await buildApp({ db, config, queue, events, modules, logger: true })

  if (config.worker.mode === 'external') events.startPolling(config.worker.dataVersionPollMs)
  if (config.worker.mode === 'inline') worker.start()

  await app.listen({ host: config.host, port: config.port })
  log(`API en http://${config.host}:${config.port}${config.apiPrefix} (worker: ${config.worker.mode}).`)

  let apagando = false
  async function apagar (senal) {
    if (apagando) return
    apagando = true
    log(`${senal}: apagando.`)
    await worker.stop() // pasos 1, 3 y 4; los flujos SSE se cierran en el gancho preClose de la API (paso 2)
    events.stopPolling()
    await app.close() // paso 5
    db.close()
  }
  return { app, db, worker, apagar }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
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
