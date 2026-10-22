// The sample set of `ejemplos/` (UD-240, UD-252): one send per loose file or per subfolder. `scripts/sembrar.mjs` reads it
// through `readExamples` and sends it over HTTP; `POST /ops/seed` sends it in process with `submitExamples`.

import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.webm': 'video/webm', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}
const TEXT = new Set(['.md', '.txt'])

/** One send: { name, text, files: [{ name, path, mime }] }. `.md` and `.txt` are the text, the rest are attachments. */
function sendOf (name, paths, warn) {
  const texts = []
  const files = []
  for (const p of [...paths].sort()) {
    const ext = extname(p).toLowerCase()
    if (TEXT.has(ext)) texts.push(readFileSync(p, 'utf8').trim())
    else if (MIME[ext]) files.push({ name: basename(p), path: p, mime: MIME[ext] })
    else warn(`Se omite ${basename(p)}: extensión sin tipo conocido`)
  }
  return { name, text: texts.join('\n\n'), files }
}

/** The sends of a folder, sorted by name. */
export function readExamples (folder, { limit = Infinity, warn = () => {} } = {}) {
  return readdirSync(folder).sort().filter((n) => !n.startsWith('.')).map((n) => {
    const p = join(folder, n)
    if (statSync(p).isDirectory()) return sendOf(n, readdirSync(p).filter((f) => !f.startsWith('.')).map((f) => join(p, f)), warn)
    return sendOf(n, [p], warn)
  }).filter((s) => s.text || s.files.length).slice(0, limit)
}

/**
 * Sends every example in process, in the name of `authorId`, through the same path as `POST /inputs`: the files go to the
 * volume, the input is registered and its analysis is queued. Returns { created, existing }; a send already there counts as existing.
 */
export async function submitExamples ({ db, config, queue, events }, { authorId, folder = config.examplesDir }) {
  const { classify } = await import('./attachments.js')
  const { ingest, commit, holdBlob, releaseBlobs } = await import('./storage.js')
  const { submitInput } = await import('./inputs.js')
  let created = 0
  let existing = 0
  for (const send of readExamples(folder)) {
    const held = []
    try {
      for (const f of send.files) {
        const info = classify(f.mime, f.name)
        if (!info) continue
        const r = await ingest(config, createReadStream(f.path), { maxBytes: Infinity, tooLargeCode: `${info.kind}_too_large`, tooLargeMessage: `«${f.name}» es demasiado grande.` })
        held.push({ ...r, kind: info.kind, mime: info.mime, name: f.name })
      }
      for (const f of held) { holdBlob(f.sha256); await commit(config, f.tmp, f.sha256) }
      const r = submitInput({ db, queue, events }, { authorId, text: send.text, files: held.map(({ tmp, ...rest }) => rest), links: [] })
      if (r.created || r.restarted) created++
      else existing++
      await releaseBlobs(db, config, held, { discard: false })
    } catch (error) {
      await releaseBlobs(db, config, held, { discard: true })
      throw error
    }
  }
  return { created, existing }
}
