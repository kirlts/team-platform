// scripts/vaciar.mjs works directly on the database: it prints what it would delete, deletes with --si and keeps the editor named by --conservar.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { all, get } from '../src/db/index.js'
import { addMember, login, makeEnv, postInput } from '../src/testing/helpers.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const run = (dir, ...args) => promisify(execFile)('node', ['scripts/vaciar.mjs', ...args], { cwd: root, env: { ...process.env, DATA_DIR: dir } }).catch((e) => e)

async function populated () {
  const env = await makeEnv()
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  const ana = await login(env, 'ana@x.org')
  assert.equal((await postInput(env, ana, { text: 'un envío' }, [{ name: 'f.png', type: 'image/png', content: 'PNG' }])).statusCode, 202)
  mkdirSync(env.config.editedTemplatesDir, { recursive: true })
  writeFileSync(path.join(env.config.editedTemplatesDir, 'x.md'), 'mirror')
  return env
}

test('without --si it prints the figures and deletes nothing; with --si it deletes the content', async () => {
  const env = await populated()
  try {
    const dry = await run(env.dir, '--scope', 'content')
    assert.equal(dry.code, undefined, dry.stderr)
    assert.match(dry.stdout, /falta --si/)
    assert.match(dry.stdout, /inputs\s+1/)
    assert.match(dry.stdout, /archivos\s+1 \(/)
    assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM inputs').n, 1)
    const wet = await run(env.dir, '--scope', 'content', '--si')
    assert.equal(wet.code, undefined, wet.stderr)
    assert.match(wet.stdout, /^Borrado \(content\):/)
    assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM inputs').n, 0)
    assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM members').n, 2)
    assert.equal(readdirSync(env.config.attachmentsDir).length, 0)
    assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'data.reset'").n, 1)
  } finally { await env.close() }
})

test('everything needs --conservar with an editor; it keeps that editor and seeds the areas again', async () => {
  const env = await populated()
  try {
    const missing = await run(env.dir, '--scope', 'everything', '--si')
    assert.equal(missing.code, 2)
    assert.match(missing.stderr, /Falta --conservar/)
    assert.match(missing.stderr, /ed@x.org/)
    const member = await run(env.dir, '--scope', 'everything', '--conservar', 'ana@x.org', '--si')
    assert.equal(member.code, 2)
    assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM members').n, 2)
    env.db.exec("UPDATE areas SET title = 'Cambiada' WHERE id = 1")
    const ok = await run(env.dir, '--scope', 'everything', '--conservar', 'ed@x.org', '--si')
    assert.equal(ok.code, undefined, ok.stderr)
    assert.match(ok.stdout, /members\s+1/)
    assert.match(ok.stdout, /Se conserva: ed@x.org/)
    assert.deepEqual(all(env.db, 'SELECT email FROM members').map((m) => m.email), ['ed@x.org'])
    assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM areas WHERE title = 'Cambiada'").n, 0)
    assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM areas').n, 5)
    assert.equal(existsSync(env.config.editedTemplatesDir), false)
  } finally { await env.close() }
})

test('an unknown scope is usage, exit 2', async () => {
  const r = await run('/nonexistent', '--scope', 'all')
  assert.equal(r.code, 2)
})
