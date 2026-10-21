// Single initialization step (MASTER-SPEC §3): WAL, migrations and seeding. It runs before the API and the
// worker. With two processes (API and `node src/worker.js`) it runs once, before both:
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
    console.log(`Base lista en ${config.dbFile} (versión ${r.toVersion}).`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
