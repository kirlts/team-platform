#!/usr/bin/env node
// Empties the test data directly on the database, without a server (UD-240, H-3704). Same two scopes as
// POST /api/ops/reset. Reads DATA_DIR (or .env) like the other scripts.
//
//   node scripts/vaciar.mjs --scope content                       prints what it would delete
//   node scripts/vaciar.mjs --scope content --si                  deletes
//   node scripts/vaciar.mjs --scope everything --conservar <email> --si
//
// In the container of the VPS: docker compose exec team-platform node scripts/vaciar.mjs --scope content --si

import { loadConfig, loadEnvFile } from '../src/config.js'
import { openInitialized } from '../src/db/index.js'
import { readSeedSet } from '../src/db/seed.js'
import { findMemberByEmail, listEditors, previewReset, resetData, SCOPES } from '../src/domain/reset.js'

const args = process.argv.slice(2)
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const scope = option('--scope')
const yes = args.includes('--si')
const keepEmail = option('--conservar')

if (!SCOPES.includes(scope)) {
  console.error(`Uso: node scripts/vaciar.mjs --scope ${SCOPES.join('|')} [--conservar <correo>] [--si]`)
  process.exit(2)
}

loadEnvFile()
const config = loadConfig()
const db = openInitialized(config)
try {
  let keep = null
  if (scope === 'everything') {
    keep = keepEmail ? findMemberByEmail(db, keepEmail) : null
    if (!keep) {
      const editors = listEditors(db).map((e) => e.email).join(', ')
      console.error(keepEmail ? `No existe un miembro con el correo ${keepEmail}.` : 'Falta --conservar <correo> del Editor que queda.')
      console.error(`Editores: ${editors || 'ninguno'}`)
      process.exit(2)
    }
    if (keep.role !== 'editor') { console.error(`${keep.email} no es Editor.`); process.exit(2) }
  }
  const summary = yes
    ? resetData(db, config, { scope, actorId: keep?.id ?? null, keepMemberId: keep?.id ?? null, seedSet: scope === 'everything' ? await readSeedSet(config) : null })
    : previewReset(db, config, { scope, keepMemberId: keep?.id ?? null })
  console.log(yes ? `Borrado (${scope}):` : `Se borraría (${scope}); nada se borró, falta --si:`)
  const width = Math.max(...Object.keys(summary.deleted).map((k) => k.length), 'archivos'.length)
  for (const [table, n] of Object.entries(summary.deleted)) console.log(`  ${table.padEnd(width)}  ${n}`)
  console.log(`  ${'archivos'.padEnd(width)}  ${summary.files} (${(summary.bytes_freed / 1024 / 1024).toFixed(2)} MB)`)
  if (keep) console.log(`  Se conserva: ${keep.email}`)
} finally {
  db.close()
}
