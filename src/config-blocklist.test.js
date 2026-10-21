// Where the password blocklist comes from (HALLAZGOS H-43): the variable, else the file that scripts/install.sh leaves
// in the data directory, else none.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { loadConfig } from './config.js'

const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'team-platform-blocklist-'))
after(() => rmSync(dir, { recursive: true, force: true }))
const blocklistOf = (env) => loadConfig({ DATA_DIR: dir, ...env }).identity.password.blocklistFile

test('H-43: without the variable nor the installed file there is no list', () => {
  assert.equal(blocklistOf({}), '')
})

test('H-43: the file that install.sh leaves in the data directory is used without touching .env, and the variable wins over it', () => {
  const installed = path.join(dir, 'password-blocklist.txt')
  writeFileSync(installed, '1qaz2wsx3edc4rfv\n')
  assert.equal(blocklistOf({}), installed)
  assert.equal(blocklistOf({ PASSWORD_BLOCKLIST_FILE: '/otra/lista.txt' }), '/otra/lista.txt')
})
