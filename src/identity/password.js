// Contraseñas: Argon2id con `crypto.argon2` de Node ≥ 24.7, sin compilación nativa (informe 04 §1.2).
// El formato PHC lo escribe y lo lee este archivo; es el mismo de @node-rs/argon2 (interoperabilidad medida).

import { argon2 as argon2Callback, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { badRequest } from '../domain/errors.js'

const argon2 = promisify(argon2Callback)
const VERSION = 19 // 0x13, la única versión vigente de Argon2

const b64 = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '')
const deB64 = (textValue) => Buffer.from(textValue, 'base64')

async function derive (password, salt, { memoryKib, passes, parallelism, tagBytes, pepper }) {
  return argon2('argon2id', {
    message: Buffer.from(password.normalize('NFKC'), 'utf8'), // NFKC antes de hashear (informe 04 §1.5)
    nonce: salt,
    parallelism,
    tagLength: tagBytes,
    memory: memoryKib,
    passes,
    ...(pepper ? { secret: Buffer.from(pepper, 'utf8') } : {})
  })
}

/** Hash PHC: $argon2id$v=19$m=…,t=…,p=…$sal$etiqueta */
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

/** Compara en tiempo constante. `rehash` es true si los parámetros guardados difieren de los vigentes. */
export async function verifyPassword (password, phc, params) {
  const p = parsePhc(phc)
  if (!p) return { ok: false, rehash: false }
  const computed = await derive(password, p.salt, { ...params, memoryKib: p.memoryKib, passes: p.passes, parallelism: p.parallelism, tagBytes: p.tagBytesValue.length })
  const ok = computed.length === p.tagBytesValue.length && timingSafeEqual(computed, p.tagBytesValue)
  const rehash = ok && (p.memoryKib !== params.memoryKib || p.passes !== params.passes || p.parallelism !== params.parallelism || p.tagBytesValue.length !== params.tagBytes)
  return { ok, rehash }
}

/**
 * Política de NIST SP 800-63B-4 (informe 04 §1.5): longitud mínima y máxima, ninguna regla de composición.
 * Cuenta caracteres Unicode tras normalizar con NFKC.
 */
export function validatePassword (password, { minLength, maxLength }, blocklist = null) {
  if (typeof password !== 'string') throw badRequest('La contraseña es obligatoria.', 'password_invalid')
  const len = [...password.normalize('NFKC')].length
  if (len < minLength) throw badRequest(`La contraseña debe tener al menos ${minLength} caracteres.`, 'password_too_short')
  if (len > maxLength) throw badRequest(`La contraseña admite hasta ${maxLength} caracteres.`, 'password_too_long')
  // Lista de bloqueo local, comparada contra la contraseña completa (la consulta a un servicio externo
  // contradice MASTER-SPEC §4.1). La lista la provee quien instala: informe 04 §8 deja sin fuente su origen.
  if (blocklist?.has(password.normalize('NFKC'))) throw badRequest('Esa contraseña figura en la lista de contraseñas no permitidas.', 'password_blocked')
}

/** Lee la lista de bloqueo: una contraseña por línea, comparación exacta. */
export function loadBlocklist (file) {
  if (!file) return null
  return new Set(readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.normalize('NFKC')))
}

let fillerHash = null
/** Hash de relleno para igualar el tiempo de respuesta cuando el correo no existe (OWASP Authentication). */
export async function dummyVerify (password, params) {
  fillerHash ??= await hashPassword(randomBytes(16).toString('hex'), params)
  return verifyPassword(password, fillerHash, params)
}
