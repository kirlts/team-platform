// Attachments in the volume, named by their SHA-256 (MASTER-SPEC §3). The upload is written to disk with
// `pipeline` while the hash is computed: 500 MB in 1.3 s with 134 to 165 MB of memory (report 03 §7.2).

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

/** Writes `stream` to a temporary file on the volume. Fails with 413 and `tooLargeCode` when it exceeds `maxBytes`. */
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

/** Moves the temporary file to its final name. If the file already exists, the temporary one is discarded. */
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
 * Orphan collection: files in the volume that no attachment references and that are older than `olderThanMs`.
 * Nothing is deleted when an upload is rejected: two in-flight uploads of the same file could overwrite
 * each other (the second sees the first one's file before its row exists). The minimum age is the
 * queue retention (7 days, report 03 §12).
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
