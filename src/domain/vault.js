// Encryption at rest of the provider keys (UD-121, report 11 §6 points 13 to 15).
//
// AES-256-GCM with a random 96-bit nonce per operation (NIST SP 800-38D) and the name of the connection as additional
// authenticated data, so a sealed value cannot be moved to another row without failing authentication. The sealed text
// is `v1:<key id>:<nonce>:<ciphertext>:<tag>` (base64url parts): the version and the key id allow a rotation to
// re-seal row by row and let an old key be told apart from a damaged value.
//
// The master key is 32 random bytes. It comes from `SECRETS_KEY` (64 hex characters or base64 of 32 bytes) when the
// environment declares it, and otherwise from `<DATA_DIR>/secrets.key`, created with mode 600 at the first start. The file
// is published with an atomic hard link of a complete temporary file, so two processes starting together (API and
// worker) end up with the same key and none of them ever reads a file that is still empty.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const VERSION = 'v1'
const KEY_BYTES = 32 // AES-256
const NONCE_BYTES = 12 // NIST SP 800-38D §8.2: 96-bit nonce
const TAG_BYTES = 16 // NIST SP 800-38D §5.2.1.2: 128-bit tag
export const KEY_FILE_NAME = 'secrets.key'

export class VaultError extends Error {
  constructor (message, code) {
    super(message)
    this.name = 'VaultError'
    this.code = code
  }
}

/** Parses the textual form of a master key. Throws if it is not 32 bytes. */
export function parseMasterKey (text) {
  const value = String(text ?? '').trim()
  let bytes = null
  if (/^[0-9a-fA-F]{64}$/.test(value)) bytes = Buffer.from(value, 'hex')
  else if (/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) bytes = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  if (!bytes || bytes.length !== KEY_BYTES) throw new VaultError('SECRETS_KEY debe ser de 32 bytes: 64 caracteres hexadecimales o 44 en base64.', 'secrets_key_invalid')
  return bytes
}

export const generateMasterKey = () => randomBytes(KEY_BYTES)
export const keyId = (key) => createHash('sha256').update(key).digest('hex').slice(0, 8)

/**
 * Writes a key file with mode 600 through a temporary name, so a reader never sees half a key.
 * With `exclusive`, the file appears only if it does not exist yet, already complete: the temporary file is linked
 * to its final name (link(2) is atomic and fails with EEXIST), never created empty and filled afterwards.
 */
function writeKeyFile (file, key, { exclusive }) {
  mkdirSync(path.dirname(file), { recursive: true })
  const text = `${key.toString('base64')}\n`
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, text, { mode: 0o600 })
  if (!exclusive) {
    renameSync(temporary, file)
    return
  }
  try {
    linkSync(temporary, file)
  } finally {
    unlinkSync(temporary)
  }
}

/**
 * Loads (or creates) the master key. Returns { key, id, source }, `source` being 'environment' or 'file'.
 * An existing file with permissions for group or others is tightened to 600.
 */
export function loadMasterKey ({ env = process.env, dataDir }) {
  const fromEnv = env.SECRETS_KEY
  if (fromEnv) {
    const key = parseMasterKey(fromEnv)
    return { key, id: keyId(key), source: 'environment' }
  }
  const file = path.join(dataDir, KEY_FILE_NAME)
  if (!existsSync(file)) {
    try {
      writeKeyFile(file, generateMasterKey(), { exclusive: true })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error // another process created it first: it is read below
    }
  }
  if ((statSync(file).mode & 0o077) !== 0) chmodSync(file, 0o600)
  const key = parseMasterKey(readFileSync(file, 'utf8'))
  return { key, id: keyId(key), source: 'file', file }
}

/** Replaces the key file (rotation). The previous one stays next to it as `secrets.key.prev` with mode 600. */
export function replaceKeyFile (dataDir, key) {
  const file = path.join(dataDir, KEY_FILE_NAME)
  if (existsSync(file)) writeKeyFile(`${file}.prev`, parseMasterKey(readFileSync(file, 'utf8')), { exclusive: false })
  writeKeyFile(file, key, { exclusive: false })
}

const b64 = (buffer) => buffer.toString('base64url')

/** Builds the vault over a master key. */
export function createVault (master) {
  const { key, id } = master
  const aad = (name) => Buffer.from(`team-platform:connection:${name}`)

  function seal (plain, name) {
    const nonce = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES })
    cipher.setAAD(aad(name))
    const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
    return [VERSION, id, b64(nonce), b64(body), b64(cipher.getAuthTag())].join(':')
  }

  function open (sealed, name) {
    const parts = String(sealed ?? '').split(':')
    if (parts.length !== 5 || parts[0] !== VERSION) throw new VaultError('El valor guardado no tiene un formato conocido.', 'secrets_unreadable')
    if (parts[1] !== id) {
      throw new VaultError('La clave maestra de esta instalación no es la que cifró este valor; hay que ingresar la clave de API de nuevo.', 'secrets_key_mismatch')
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[2], 'base64url'), { authTagLength: TAG_BYTES })
      decipher.setAAD(aad(name))
      decipher.setAuthTag(Buffer.from(parts[4], 'base64url'))
      return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8')
    } catch {
      throw new VaultError('No se pudo descifrar el valor guardado; hay que ingresar la clave de API de nuevo.', 'secrets_unreadable')
    }
  }

  return { id, source: master.source, seal, open }
}
