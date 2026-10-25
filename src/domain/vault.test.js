// Tests of the vault (UD-121): sealing, authentication, master key sources and rotation.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { initializeDatabase, openInitialized, all } from '../db/index.js'
import { tempDir, testConfig } from '../testing/helpers.js'
import { loadConnections, resealAll, storeKey } from './connections.js'
import { createVault, generateMasterKey, keyId, KEY_FILE_NAME, loadMasterKey, parseMasterKey, replaceKeyFile, VaultError } from './vault.js'

const vaultUrl = pathToFileURL(fileURLToPath(new URL('./vault.js', import.meta.url))).href
const newVault = () => {
  const key = generateMasterKey()
  return createVault({ key, id: keyId(key), source: 'test' })
}
const SECRET = 'sk-test-0123456789abcdef-WXYZ'

test('seal and open give back the same text, including non-ASCII characters', () => {
  const vault = newVault()
  for (const text of [SECRET, 'ñandú-clave-ü', 'x'.repeat(512), '']) {
    assert.equal(vault.open(vault.seal(text, 'anthropic'), 'anthropic'), text)
  }
})

test('the sealed text has the documented shape and does not contain the plain value', () => {
  const vault = newVault()
  const sealed = vault.seal(SECRET, 'anthropic')
  const parts = sealed.split(':')
  assert.equal(parts.length, 5)
  assert.equal(parts[0], 'v1')
  assert.equal(parts[1], vault.id)
  assert.ok(!sealed.includes(SECRET))
  assert.ok(!Buffer.from(sealed).includes(Buffer.from(SECRET)))
})

test('every seal uses a different nonce, so the same value never seals to the same text', () => {
  const vault = newVault()
  const sealed = Array.from({ length: 200 }, () => vault.seal(SECRET, 'anthropic'))
  assert.equal(new Set(sealed).size, sealed.length)
  assert.equal(new Set(sealed.map((s) => s.split(':')[2])).size, sealed.length)
})

test('changing one byte of the nonce, the body or the tag makes opening fail as unreadable', () => {
  const vault = newVault()
  const parts = vault.seal(SECRET, 'anthropic').split(':')
  for (const index of [2, 3, 4]) {
    const raw = Buffer.from(parts[index], 'base64url')
    raw[0] ^= 0x01
    const tampered = [...parts]
    tampered[index] = raw.toString('base64url')
    assert.throws(() => vault.open(tampered.join(':'), 'anthropic'), (error) => error instanceof VaultError && error.code === 'secrets_unreadable', `part ${index}`)
  }
})

test('malformed sealed text is unreadable, never a crash of another kind', () => {
  const vault = newVault()
  for (const bad of [null, undefined, '', 'plain-key', 'v2:a:b:c:d', 'v1:only:three', 'v1::::']) {
    assert.throws(() => vault.open(bad, 'anthropic'), (error) => error instanceof VaultError && ['secrets_unreadable', 'secrets_key_mismatch'].includes(error.code), String(bad))
  }
})

test('the connection name is authenticated: a value moved to another connection does not open', () => {
  const vault = newVault()
  const sealed = vault.seal(SECRET, 'anthropic')
  assert.equal(vault.open(sealed, 'anthropic'), SECRET)
  assert.throws(() => vault.open(sealed, 'deepseek'), (error) => error.code === 'secrets_unreadable')
})

test('another master key fails with secrets_key_mismatch and a message that asks for the key again', () => {
  const first = newVault()
  const second = newVault()
  const sealed = first.seal(SECRET, 'anthropic')
  assert.throws(() => second.open(sealed, 'anthropic'), (error) => {
    assert.equal(error.code, 'secrets_key_mismatch')
    assert.match(error.message, /ingresar la clave de API de nuevo/)
    assert.ok(!error.message.includes(SECRET))
    return true
  })
})

test('parseMasterKey accepts 64 hex characters and base64 of 32 bytes, and rejects the rest', () => {
  const bytes = generateMasterKey()
  assert.deepEqual(parseMasterKey(bytes.toString('hex')), bytes)
  assert.deepEqual(parseMasterKey(bytes.toString('hex').toUpperCase()), bytes)
  assert.deepEqual(parseMasterKey(`  ${bytes.toString('hex')}\n`), bytes)
  assert.deepEqual(parseMasterKey(bytes.toString('base64')), bytes)
  assert.deepEqual(parseMasterKey(bytes.toString('base64url')), bytes)
  const rejected = ['', null, undefined, 'abc', 'g'.repeat(64), bytes.toString('hex').slice(2), `${bytes.toString('hex')}00`, Buffer.alloc(16, 1).toString('base64'), Buffer.alloc(33, 1).toString('base64'), 'not a key at all, with spaces and punctuation!!!!!!!']
  for (const text of rejected) {
    assert.throws(() => parseMasterKey(text), (error) => error instanceof VaultError && error.code === 'secrets_key_invalid', String(text))
  }
})

test('the first start creates secrets.key with mode 600 and the next start reads the same key', () => {
  const dir = tempDir()
  try {
    const first = loadMasterKey({ env: {}, dataDir: dir })
    const file = path.join(dir, KEY_FILE_NAME)
    assert.equal(first.source, 'file')
    assert.equal(first.key.length, 32)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    const again = loadMasterKey({ env: {}, dataDir: dir })
    assert.deepEqual(again.key, first.key)
    assert.equal(again.id, first.id)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the data directory is created when it does not exist yet', () => {
  const dir = tempDir()
  try {
    const nested = path.join(dir, 'a', 'b')
    loadMasterKey({ env: {}, dataDir: nested })
    assert.ok(existsSync(path.join(nested, KEY_FILE_NAME)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a key file readable by group or others is tightened to 600 when read', () => {
  const dir = tempDir()
  try {
    const { key } = loadMasterKey({ env: {}, dataDir: dir })
    const file = path.join(dir, KEY_FILE_NAME)
    chmodSync(file, 0o664)
    const again = loadMasterKey({ env: {}, dataDir: dir })
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.deepEqual(again.key, key)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SECRETS_KEY wins over the file and creates no file', () => {
  const dir = tempDir()
  try {
    const fromFile = loadMasterKey({ env: {}, dataDir: dir })
    const bytes = generateMasterKey()
    const fromEnv = loadMasterKey({ env: { SECRETS_KEY: bytes.toString('hex') }, dataDir: dir })
    assert.equal(fromEnv.source, 'environment')
    assert.deepEqual(fromEnv.key, bytes)
    assert.notDeepEqual(fromEnv.key, fromFile.key)
    const other = tempDir()
    try {
      loadMasterKey({ env: { SECRETS_KEY: bytes.toString('base64') }, dataDir: other })
      assert.equal(existsSync(path.join(other, KEY_FILE_NAME)), false)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an invalid SECRETS_KEY stops the start instead of falling back to the file', () => {
  const dir = tempDir()
  try {
    assert.throws(() => loadMasterKey({ env: { SECRETS_KEY: 'too-short' }, dataDir: dir }), (error) => error.code === 'secrets_key_invalid')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a damaged key file stops the start with secrets_key_invalid', () => {
  const dir = tempDir()
  try {
    writeFileSync(path.join(dir, KEY_FILE_NAME), 'garbage\n', { mode: 0o600 })
    assert.throws(() => loadMasterKey({ env: {}, dataDir: dir }), (error) => error.code === 'secrets_key_invalid')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** Starts `count` processes that load the master key of one directory at the same instant; resolves their key ids. */
function loadTogether (dir, count) {
  const startAt = Date.now() + 400 // all children spin until this instant, so they hit the file system together
  const script = `
    const { loadMasterKey } = await import(${JSON.stringify(vaultUrl)})
    while (Date.now() < ${startAt}) { /* aligned start */ }
    try { const m = loadMasterKey({ env: {}, dataDir: ${JSON.stringify(dir)} }); console.log(JSON.stringify({ id: m.id })) } catch (e) { console.log(JSON.stringify({ error: e.code ?? e.message })) }
  `
  return Promise.all(Array.from({ length: count }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.on('error', reject)
    child.on('close', () => resolve(JSON.parse(out.trim().split('\n').pop() || '{"error":"no output"}')))
  })))
}

test('simultaneous first starts of several processes end with the same key and no failure', async () => {
  for (let round = 0; round < 3; round++) {
    const dir = tempDir()
    try {
      const results = await loadTogether(dir, 8)
      assert.deepEqual(results.filter((r) => r.error), [], `round ${round}`)
      assert.equal(new Set(results.map((r) => r.id)).size, 1, `round ${round}`)
      assert.equal(statSync(path.join(dir, KEY_FILE_NAME)).mode & 0o777, 0o600)
      assert.deepEqual(readdirSync(dir), [KEY_FILE_NAME], `round ${round}: no temporary file is left behind`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('replaceKeyFile keeps the previous key as secrets.key.prev with mode 600', () => {
  const dir = tempDir()
  try {
    const old = loadMasterKey({ env: {}, dataDir: dir })
    const next = generateMasterKey()
    replaceKeyFile(dir, next)
    assert.deepEqual(loadMasterKey({ env: {}, dataDir: dir }).key, next)
    const prev = path.join(dir, `${KEY_FILE_NAME}.prev`)
    assert.equal(statSync(prev).mode & 0o777, 0o600)
    assert.deepEqual(parseMasterKey(readFileSync(prev, 'utf8')), old.key)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

async function openDb () {
  const dir = tempDir()
  mkdirSync(dir, { recursive: true })
  const config = testConfig(dir)
  await initializeDatabase(config, { seed: null })
  return { db: openInitialized(config), dir }
}

test('resealAll re-seals every stored key under a new master key, and the old key can no longer read them', async () => {
  const { db, dir } = await openDb()
  try {
    const before = newVault()
    const after = newVault()
    storeKey(db, before, 'anthropic', 'key-anthropic-AAAA')
    storeKey(db, before, 'deepseek', 'key-deepseek-BBBB')
    assert.equal(resealAll(db, before, after), 2)
    assert.deepEqual(Object.fromEntries(Object.entries(loadConnections(db, after)).map(([name, c]) => [name, c.apiKey])), { anthropic: 'key-anthropic-AAAA', deepseek: 'key-deepseek-BBBB' })
    assert.deepEqual(Object.values(loadConnections(db, before)).map((c) => c.apiKey), [undefined, undefined])
    for (const row of all(db, 'SELECT sealed_value FROM provider_connections')) assert.equal(row.sealed_value.split(':')[1], after.id)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a value that was not re-sealed stays unreadable under the new key and does not hide the others', async () => {
  const { db, dir } = await openDb()
  try {
    const before = newVault()
    const after = newVault()
    storeKey(db, before, 'anthropic', 'key-anthropic-AAAA')
    resealAll(db, before, after)
    storeKey(db, before, 'deepseek', 'key-deepseek-BBBB') // written by a process that still has the old key
    const loaded = loadConnections(db, after)
    assert.equal(loaded.anthropic.apiKey, 'key-anthropic-AAAA')
    assert.equal(loaded.deepseek.apiKey, undefined)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resealAll stops with an error when a value cannot be opened by the old key, and changes nothing before it matters to the caller transaction', async () => {
  const { db, dir } = await openDb()
  try {
    const before = newVault()
    const stranger = newVault()
    const after = newVault()
    storeKey(db, stranger, 'anthropic', 'key-anthropic-AAAA')
    assert.throws(() => resealAll(db, before, after), (error) => error.code === 'secrets_key_mismatch')
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
