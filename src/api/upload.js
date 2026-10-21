// Reading of the multipart upload of `POST /inputs` (MASTER-SPEC §7.1, §7.8). Each file is written to disk with
// `pipeline` while its SHA-256 is computed, with the cap of its type; nothing accumulates in memory (report 03 §7.2).

import { rm } from 'node:fs/promises'
import { classify, maxBytesFor } from '../domain/attachments.js'
import { badRequest, tooLarge, unsupported } from '../domain/errors.js'
import { commit, ingest } from '../domain/storage.js'

const MB = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`

/** Validates a link URL: http(s) only, with the configured maximum length. */
function normalizeLink (rawValue, uploads) {
  const textValue = String(rawValue).trim()
  if (textValue.length > uploads.maxLinkLength) throw badRequest('Un enlace supera el largo máximo permitido.', 'link_too_long')
  let url
  try { url = new URL(textValue) } catch { throw badRequest(`El enlace «${textValue.slice(0, 80)}» no es una dirección válida.`, 'link_invalid') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw badRequest('Sólo se admiten enlaces http y https.', 'link_invalid')
  return url.toString()
}

/**
 * Returns { text, links, files } with the files already moved to their final name in the volume.
 * On any error it deletes the temporary files it managed to write.
 */
export async function readInputUpload (request, config) {
  if (!request.isMultipart()) throw unsupported('Se esperaba un envío multipart/form-data.')
  const u = config.uploads
  let text = ''
  const links = []
  const ingested = []

  try {
    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (part.valueTruncated) throw tooLarge('El texto supera el tamaño máximo permitido.')
        if (part.fieldname === 'text') text = String(part.value)
        else if (part.fieldname === 'links' || part.fieldname === 'links[]') {
          if (String(part.value).trim() === '') continue
          links.push(normalizeLink(part.value, u))
          if (links.length > u.maxLinks) throw tooLarge(`Se admiten hasta ${u.maxLinks} enlaces por envío.`)
        }
        continue
      }
      // File
      const kindInfo = classify(part.mimetype, part.filename)
      if (!kindInfo) {
        part.file.resume()
        throw unsupported(`El formato de «${part.filename || 'archivo'}» no se admite.`)
      }
      const cap = maxBytesFor(kindInfo.kind, u)
      const r = await ingest(config, part.file, { maxBytes: cap, tooLargeMessage: `«${part.filename || 'archivo'}» supera el máximo de ${MB(cap)} para ese tipo de archivo.` })
      ingested.push({ ...r, kind: kindInfo.kind, mime: kindInfo.mime, name: part.filename || '' })
      if (r.size === 0) throw badRequest(`«${part.filename || 'archivo'}» está vacío.`, 'file_empty')
    }
    if (Buffer.byteLength(text) > u.maxTextBytes) throw tooLarge('El texto supera el tamaño máximo permitido.')
    if (text.trim() === '' && ingested.length === 0 && links.length === 0) {
      throw badRequest('El envío está vacío: falta texto, archivo o enlace.', 'input_empty')
    }
    // Everything validated: the temporary files move to their final name (the hash).
    for (const f of ingested) await commit(config, f.tmp, f.sha256)
    return { text, links: [...new Set(links)], files: ingested.map(({ tmp, ...rest }) => rest) }
  } catch (error) {
    await Promise.all(ingested.map((f) => rm(f.tmp, { force: true })))
    throw error
  }
}
