// Adjuntos en el volumen, nombrados por su SHA-256 (MASTER-SPEC §3). La subida se escribe a disco con
// `pipeline` mientras se calcula el hash: 500 MB en 1,3 s con 134 a 165 MB de memoria (informe 03 §7.2).

import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { get } from '../db/index.js'
import { AppError } from './errors.js'

export function blobPath (config, sha256) {
  return path.join(config.attachmentsDir, sha256)
}

/** Escribe `stream` a un temporal en el volumen. Falla con 413 y `tooLargeCode` al pasar de `maxBytes`. */
export async function ingest (config, stream, { maxBytes, tooLargeMessage, tooLargeCode = 'too_large' }) {
  const tooLarge = (message) => new AppError(413, tooLargeCode, message)
  await mkdir(config.tmpDir, { recursive: true })
  const tmp = path.join(config.tmpDir, `${randomUUID()}.parcial`)
  const hash = createHash('sha256')
  let size = 0
  const counter = new Transform({
    transform (chunk, _enc, cb) {
      size += chunk.length
      if (size > maxBytes) return cb(tooLarge(tooLargeMessage))
      hash.update(chunk)
      cb(null, chunk)
    }
  })
  try {
    await pipeline(stream, counter, createWriteStream(tmp))
  } catch (error) {
    await rm(tmp, { force: true })
    if (error?.code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge(tooLargeMessage)
    throw error
  }
  return { tmp, sha256: hash.digest('hex'), size }
}

/** Mueve el temporal a su nombre definitivo. Si el archivo ya existe se descarta el temporal. */
export async function commit (config, tmp, sha256) {
  await mkdir(config.attachmentsDir, { recursive: true })
  const target = blobPath(config, sha256)
  if (existsSync(target)) {
    await rm(tmp, { force: true })
    return { existed: true }
  }
  await rename(tmp, target)
  return { existed: false }
}

/**
 * Recolección de huérfanos: archivos del volumen que ningún adjunto referencia y con más de `olderThanMs`
 * de antigüedad. Nunca se borra al rechazar una subida: dos subidas del mismo archivo en curso podrían
 * pisarse (el segundo ve el archivo del primero antes de que exista su fila). La antigüedad mínima es la
 * retención de la cola (7 días, informe 03 §12).
 */
export async function sweepOrphans (db, config, olderThanMs, now = Date.now()) {
  let removedRows = 0
  for (const dir of [config.attachmentsDir, config.tmpDir]) {
    if (!existsSync(dir)) continue
    for (const nameValue of await readdir(dir)) {
      const routePath = path.join(dir, nameValue)
      const info = await stat(routePath)
      if (!info.isFile() || now - info.mtimeMs < olderThanMs) continue
      if (dir === config.attachmentsDir && (get(db, "SELECT 1 AS u FROM attachments WHERE sha256 = ? AND kind <> 'link' LIMIT 1", nameValue) ||
        get(db, "SELECT 1 AS u FROM reply_attachments WHERE sha256 = ? AND kind <> 'link' LIMIT 1", nameValue))) continue
      await rm(routePath, { force: true })
      removedRows++
    }
  }
  return removedRows
}
