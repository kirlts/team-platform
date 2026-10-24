// Documents the session attaches to its final reply (UD-272, MASTER-SPEC §7.5 «Reenvío»). When the reason of a forward asks for a PDF, the session writes it
// in the job's `attachments/` directory (`$TEAM_ATTACHMENTS_DIR`) and declares it in `attachments` of its structured output: `{ path, name }`. The
// directory is deleted when the job ends, so the worker stores the files in the volume while it exists and the final reply attaches them (also from the
// `deliver` job). Same path as the screenshots (captures.js), with the same discipline: the platform reads no document, it checks the form.
//
// The form: the path is a file inside the directory, the first bytes are `%PDF-`, the size is at most the document cap of an upload
// (UPLOAD_MAX_DOCUMENT_BYTES and the extractor's own cap, as upload.js) and the count is at most UPLOAD_MAX_FILES. Only PDF is accepted.
// What does not comply is left out and the reply says so with the reason, so the person knows the file did not arrive.

import { createReadStream } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { DEFAULTS as EXTRACT_DEFAULTS } from '../extract/config.js'
import { commit, ingest } from '../domain/storage.js'

const PDF_MIME = 'application/pdf'
const PDF_MAGIC = Buffer.from('%PDF-')
const NAME_CHARS = 120 // declared courtesy: the name of the file in the thread, one line

/** The directory of a job where the session leaves its documents. */
export const documentsDir = (workdir) => join(workdir, 'attachments')

/** The size cap of a document: the one an upload has (`upload.js`: the smaller of the configured cap and the extractor's). */
export const documentMaxBytes = (config) => Math.min(config.uploads.maxDocumentBytes, EXTRACT_DEFAULTS.document.maxBytes)

/** The environment the session reads to know where to leave documents and how much fits. */
export function documentsEnv (config, workdir) {
  return { TEAM_ATTACHMENTS_DIR: documentsDir(workdir), TEAM_ATTACHMENTS_MAX: String(config.uploads.maxFiles), TEAM_ATTACHMENTS_MAX_BYTES: String(documentMaxBytes(config)) }
}

/** The name the file gets in the thread: no path characters, one line, always ending in `.pdf`. */
export function documentName (name, fallback) {
  const clean = String(name ?? '').replace(/[\\/\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_CHARS).replace(/\.pdf$/i, '').trim()
  return `${clean || fallback}.pdf`
}

/**
 * Checks the `attachments` of the output. Returns { accepted, rejected }: `accepted` items carry `file` (real path), `name` and `size`; `rejected` items carry
 * `index`, `name` and `reason` (`invalid`, `too_many`, `missing`, `outside`, `too_large`, `not_pdf`).
 */
export async function checkDocuments (list, { dir, max, maxBytes }) {
  const accepted = []
  const rejected = []
  let root = null
  try { if (dir) root = await realpath(resolve(dir)) } catch { /* no directory: every path is rejected below */ }
  for (const [index, d] of (Array.isArray(list) ? list : []).entries()) {
    const name = typeof d?.name === 'string' && d.name.trim() !== '' ? documentName(d.name, `Documento ${index + 1}`) : `Documento ${index + 1}.pdf`
    const no = (reason) => rejected.push({ index, name, reason })
    if (d === null || typeof d !== 'object' || typeof d.path !== 'string' || d.path.trim() === '' || typeof d.name !== 'string' || d.name.trim() === '') { no('invalid'); continue }
    if (accepted.length >= max) { no('too_many'); continue }
    let file
    try { file = await realpath(resolve(root ?? '/', d.path)) } catch { no('missing'); continue }
    const rel = root === null ? null : relative(root, file)
    if (rel === null || rel === '' || rel.startsWith('..') || rel.startsWith(sep)) { no('outside'); continue }
    const info = await stat(file)
    if (!info.isFile()) { no('missing'); continue }
    if (info.size > maxBytes) { no('too_large'); continue }
    const handle = await open(file, 'r')
    try {
      const head = Buffer.alloc(PDF_MAGIC.length)
      const { bytesRead } = await handle.read(head, 0, head.length, 0)
      if (bytesRead < head.length || !head.equals(PDF_MAGIC)) { no('not_pdf'); continue }
    } finally { await handle.close() }
    accepted.push({ index, file, name, size: info.size })
  }
  return { accepted, rejected }
}

/**
 * Checks the `attachments` of the final output and stores the accepted files in the volume. Returns { stored, rejected }; `stored` items are
 * { sha256, size, mime, name }. Never throws for a file that does not comply: it is left out and `rejected` says why.
 */
export async function storeDocuments ({ config, output, workdir }) {
  const list = output?.attachments
  if (!Array.isArray(list) || list.length === 0) return { stored: [], rejected: [] }
  const maxBytes = documentMaxBytes(config)
  const { accepted, rejected } = await checkDocuments(list, { dir: documentsDir(workdir), max: config.uploads.maxFiles, maxBytes })
  const stored = []
  for (const d of accepted) {
    try {
      const { tmp, sha256, size } = await ingest(config, createReadStream(d.file), { maxBytes, tooLargeMessage: 'El documento supera el tamaño máximo.' })
      await commit(config, tmp, sha256)
      stored.push({ sha256, size, mime: PDF_MIME, name: d.name })
    } catch {
      rejected.push({ index: d.index, name: d.name, reason: 'not_stored' })
    }
  }
  return { stored, rejected }
}

/** The attachments of the reply for the stored documents. */
export const documentFiles = (stored) => (stored ?? []).map((d) => ({ kind: 'document', name: d.name, mime: d.mime, size: d.size, sha256: d.sha256 }))

const REASONS = {
  'es-419': {
    invalid: 'faltan el archivo o su nombre', too_many: 'superaba la cantidad máxima de archivos', missing: 'el archivo no existe', outside: 'estaba fuera del directorio de documentos',
    too_large: 'superaba el tamaño máximo', not_pdf: 'no es un PDF', not_stored: 'no se pudo guardar'
  },
  en: {
    invalid: 'the file or its name is missing', too_many: 'it was over the maximum number of files', missing: 'the file does not exist', outside: 'it was outside the documents directory',
    too_large: 'it was over the maximum size', not_pdf: 'it is not a PDF', not_stored: 'it could not be saved'
  }
}
const LEAD = { 'es-419': (name, reason) => `No se adjuntó «${name}»: ${reason}.`, en: (name, reason) => `Not attached: «${name}», ${reason}.` }

/** One line per rejected document, in the language of the sender, to go under the reply. */
export function documentNotes (rejected, language) {
  const lang = LEAD[language] ? language : 'es-419'
  return (rejected ?? []).map((r) => LEAD[lang](r.name, REASONS[lang][r.reason] ?? r.reason))
}
