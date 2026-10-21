// Paso de inicialización único (MASTER-SPEC §3): WAL, migraciones y siembra. Corre antes de la API y del
// worker. Con dos procesos (API y `node src/worker.js`) se ejecuta una vez, antes de ambos:
//   npm run db:init && (npm start & npm run worker)

import { pathToFileURL } from 'node:url'
import { loadConfig, loadEnvFile } from '../config.js'
import { initializeDatabase } from './index.js'
import { seedDefaults } from './seed.js'

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  loadEnvFile()
  const config = loadConfig()
  try {
    const r = await initializeDatabase(config, { seed: seedDefaults, log: (m) => console.log(m) })
    console.log(`Base lista en ${config.dbFile} (versión ${r.hasta}).`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
