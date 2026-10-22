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

// Blobs written by an upload that has not yet reached its database row. A failed upload deletes what it wrote, but
// never a blob another in-flight upload of the same file is about to reference (UD-072): the count decides, not a clock.
const inFlight = new Map()

/** Marks a blob as owned by an upload in flight. Call before `commit`. */
export function holdBlob (sha256) {
  inFlight.set(sha256, (inFlight.get(sha256) ?? 0) + 1)
}

const referenced = (db, sha256) => Boolean(
  get(db, "SELECT 1 AS u FROM attachments WHERE sha256 = ? AND kind <> 'link' LIMIT 1", sha256) ||
  get(db, "SELECT 1 AS u FROM reply_attachments WHERE sha256 = ? AND kind <> 'link' LIMIT 1", sha256))

/**
 * Ends the hold of an upload. With `discard` (the upload failed or was refused) each blob it wrote is deleted when no
 * row references it and no other upload holds it. Without it the rows exist and nothing is deleted.
 */
export async function releaseBlobs (db, config, files, { discard }) {
  for (const f of files) {
    const left = (inFlight.get(f.sha256) ?? 1) - 1
    if (left > 0) inFlight.set(f.sha256, left)
    else inFlight.delete(f.sha256)
    if (discard && left <= 0 && !referenced(db, f.sha256)) await rm(blobPath(config, f.sha256), { force: true })
  }
}

/**
 * Frees the files of `hashes` that nothing references any more (UD-240): neither an attachment row, nor a reply
 * attachment, nor an upload in flight that holds the blob. Same discipline as `releaseBlobs`: the count decides. Call
 * after the rows are gone and the transaction committed. Returns the bytes removed from the volume.
 */
export async function freeBlobs (db, config, hashes) {
  let freed = 0
  for (const sha256 of new Set(hashes)) {
    if ((inFlight.get(sha256) ?? 0) > 0 || referenced(db, sha256)) continue
    const file = blobPath(config, sha256)
    try {
      const info = await stat(file)
      await rm(file, { force: true })
      freed += info.size
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return freed
}

/**
 * Orphan collection: files in the volume that no attachment references and that are older than `olderThanMs`.
 * It is the safety net for a crash between writing a file and its row; an upload that is refused or fails cleans up
 * after itself through `releaseBlobs`. The minimum age is the queue retention (7 days, report 03 §12).
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
