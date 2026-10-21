#!/usr/bin/env node
// Rotation of the master key of the stored API keys (UD-121). Run it with the API and the worker stopped:
//   node scripts/rotate-secrets-key.mjs            generates a new key, re-seals every stored key and replaces secrets.key
//   SECRETS_KEY=<current> node scripts/rotate-secrets-key.mjs --new <64 hex>   when the key comes from the environment
// The previous key file stays as secrets.key.prev (mode 600) until it is deleted by hand. It prints no key.
import { loadConfig, loadEnvFile } from '../src/config.js'
import { openDatabase, tx } from '../src/db/index.js'
import { resealAll } from '../src/domain/connections.js'
import { createVault, generateMasterKey, keyId, loadMasterKey, parseMasterKey, replaceKeyFile } from '../src/domain/vault.js'

loadEnvFile()
const config = loadConfig()
const argIndex = process.argv.indexOf('--new')
const fromEnv = Boolean(process.env.SECRETS_KEY)
try {
  const current = loadMasterKey({ env: process.env, dataDir: config.dataDir })
  const next = argIndex > 0 ? parseMasterKey(process.argv[argIndex + 1]) : generateMasterKey()
  if (fromEnv && argIndex < 0) throw new Error('La clave maestra viene de SECRETS_KEY: indicar la nueva con --new y actualizar la variable después.')
  const db = openDatabase(config.dbFile)
  const count = tx(db, () => resealAll(db, createVault(current), createVault({ key: next, id: keyId(next), source: 'file' })))
  if (!fromEnv) replaceKeyFile(config.dataDir, next)
  console.log(`Claves re-selladas: ${count}. Identificador de la clave nueva: ${keyId(next)}.`)
  if (fromEnv) console.log('Actualizar SECRETS_KEY con la clave nueva antes de iniciar el servidor.')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
