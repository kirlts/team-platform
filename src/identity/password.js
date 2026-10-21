// Passwords: Argon2id with Node's `crypto.argon2` (Node ≥ 24.7), no native compilation (report 04 §1.2).
// This file writes and reads the PHC format; it is the same one @node-rs/argon2 uses (interoperability measured).

import { argon2 as argon2Callback, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { badRequest } from '../domain/errors.js'

const argon2 = promisify(argon2Callback)
const VERSION = 19 // 0x13, the only current Argon2 version

const b64 = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '')
const deB64 = (textValue) => Buffer.from(textValue, 'base64')

async function derive (password, salt, { memoryKib, passes, parallelism, tagBytes, pepper }) {
  return argon2('argon2id', {
    message: Buffer.from(password.normalize('NFKC'), 'utf8'), // NFKC before hashing (report 04 §1.5)
    nonce: salt,
    parallelism,
    tagLength: tagBytes,
    memory: memoryKib,
    passes,
    ...(pepper ? { secret: Buffer.from(pepper, 'utf8') } : {})
  })
}

/** PHC hash: $argon2id$v=19$m=…,t=…,p=…$salt$tag */
export async function hashPassword (password, params) {
  const salt = randomBytes(params.saltBytes)
  const tagBytesValue = await derive(password, salt, params)
  return `$argon2id$v=${VERSION}$m=${params.memoryKib},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(tagBytesValue)}`
}

function parsePhc (phc) {
  const m = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(phc)
  if (!m || Number(m[1]) !== VERSION) return null
  return { memoryKib: Number(m[2]), passes: Number(m[3]), parallelism: Number(m[4]), salt: deB64(m[5]), tagBytesValue: deB64(m[6]) }
}

/** Compares in constant time. `rehash` is true if the stored parameters differ from the current ones. */
export async function verifyPassword (password, phc, params) {
  const p = parsePhc(phc)
  if (!p) return { ok: false, rehash: false }
  const computed = await derive(password, p.salt, { ...params, memoryKib: p.memoryKib, passes: p.passes, parallelism: p.parallelism, tagBytes: p.tagBytesValue.length })
  const ok = computed.length === p.tagBytesValue.length && timingSafeEqual(computed, p.tagBytesValue)
  const rehash = ok && (p.memoryKib !== params.memoryKib || p.passes !== params.passes || p.parallelism !== params.parallelism || p.tagBytesValue.length !== params.tagBytes)
  return { ok, rehash }
}

/**
 * NIST SP 800-63B-4 policy (report 04 §1.5): minimum and maximum length, no composition rules.
 * Counts Unicode characters after normalizing with NFKC.
 */
export function validatePassword (password, { minLength, maxLength }, blocklist = null) {
  if (typeof password !== 'string') throw badRequest('La contraseña es obligatoria.', 'password_invalid')
  const len = [...password.normalize('NFKC')].length
  if (len < minLength) throw badRequest(`La contraseña debe tener al menos ${minLength} caracteres.`, 'password_too_short')
  if (len > maxLength) throw badRequest(`La contraseña admite hasta ${maxLength} caracteres.`, 'password_too_long')
  // Local blocklist, compared against the whole password (querying an external service
  // contradicts MASTER-SPEC §4.1). Whoever installs provides the list: report 04 §8 leaves its source open.
  if (blocklist?.has(password.normalize('NFKC'))) throw badRequest('Esa contraseña figura en la lista de contraseñas no permitidas.', 'password_blocked')
}

/** Reads the blocklist: one password per line, exact comparison. */
export function loadBlocklist (file) {
  if (!file) return null
  return new Set(readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.normalize('NFKC')))
}

let fillerHash = null
/** Filler hash to equalize response time when the email does not exist (OWASP Authentication). */
export async function dummyVerify (password, params) {
  fillerHash ??= await hashPassword(randomBytes(16).toString('hex'), params)
  return verifyPassword(password, fillerHash, params)
}
