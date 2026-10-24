// Reading of the multipart upload of `POST /inputs` (MASTER-SPEC §7.1, §7.8). Each file is written to disk with
// `pipeline` while its SHA-256 is computed, with the cap of its type; nothing accumulates in memory (report 03 §7.2).

import { rm } from 'node:fs/promises'
import { classify, maxBytesFor } from '../domain/attachments.js'
import { AppError, badRequest, tooLarge, unsupported } from '../domain/errors.js'
import { DEFAULTS as EXTRACT_DEFAULTS } from '../extract/config.js'
import { probe } from '../extract/lib/ffmpeg.js'
import { commit, holdBlob, ingest, releaseBlobs, volumeError } from '../domain/storage.js'

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
 * HP-018: a video longer than the extractor's limit (MASTER-SPEC §7.4, 20 minutes) is refused at upload with the
 * extractor's code, so the person sees the rejection at once. ffprobe reads the container header, which is cheap.
 * If ffprobe is missing or cannot read the file the upload goes on: the job reports that with its own code.
 */
async function rejectLongVideo (tmp, filename) {
  let info
  try { info = await probe(tmp) } catch { return }
  const max = EXTRACT_DEFAULTS.video.maxSeconds
  if (info.durationSeconds > max) {
    throw new AppError(422, 'video_too_long', `El video «${filename || 'archivo'}» dura ${Math.ceil(info.durationSeconds / 60)} minutos y el máximo es ${max / 60}.`)
  }
}

/** Reads the multipart body of a new input: text, files[], links[], auto_publish and as_member_id (UD-255). */
export async function readInputUpload (request, config, db) {
  if (!request.isMultipart()) return readInputJson(request, config)
  const { text, links, files, extra } = await readUpload(request, config, db, {
    textField: 'text', extraFields: ['auto_publish', 'as_member_id'], emptyMessage: 'El envío está vacío: falta texto, archivo o enlace.', emptyCode: 'input_empty'
  })
  return { text, links, files, keepDraft: extra.auto_publish === 'false', asMemberId: extra.as_member_id }
}

/** A send with no files as JSON: { text, links?, auto_publish?, as_member_id? }. Same limits and the same errors as the multipart one. */
function readInputJson (request, config) {
  const body = request.body
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw unsupported('Se esperaba un envío multipart/form-data o un JSON.')
  const allowed = new Set(['text', 'links', 'auto_publish', 'as_member_id'])
  const unknown = Object.keys(body).find((k) => !allowed.has(k))
  if (unknown) throw badRequest(`El campo «${unknown}» no existe.`, 'validation')
  const u = config.uploads
  const text = body.text === undefined ? '' : body.text
  if (typeof text !== 'string') throw badRequest('El campo «text» debe ser texto.', 'validation')
  if (body.auto_publish !== undefined && typeof body.auto_publish !== 'boolean') throw badRequest('`auto_publish` es «true» o «false».', 'auto_publish_invalid')
  const rawLinks = body.links === undefined ? [] : body.links
  if (!Array.isArray(rawLinks)) throw badRequest('El campo «links» debe ser una lista.', 'validation')
  const links = [...new Set(rawLinks.filter((l) => String(l).trim() !== '').map((l) => normalizeLink(l, u)))]
  if (links.length > u.maxLinks) throw tooLarge(`Se admiten hasta ${u.maxLinks} enlaces por envío.`)
  if (Buffer.byteLength(text) > u.maxTextBytes) throw tooLarge('El texto supera el tamaño máximo permitido.')
  if (text.trim() === '' && links.length === 0) throw badRequest('El envío está vacío: falta texto, archivo o enlace.', 'input_empty')
  const as = body.as_member_id
  if (as !== undefined && as !== null && typeof as !== 'string' && typeof as !== 'number') throw badRequest('`as_member_id` es el id de un miembro.', 'send_as_invalid')
  return { text, links, files: [], keepDraft: body.auto_publish === false, asMemberId: as === undefined || as === null ? undefined : String(as) }
}

/** Reads the multipart body of a reply: body, kind, files[] and links[]. Same limits and storage as an input. */
export async function readReplyUpload (request, config, db) {
  const { text, links, files, extra } = await readUpload(request, config, db, {
    textField: 'body', extraFields: ['kind', 'mention_ids'], emptyMessage: 'La respuesta está vacía: falta texto, archivo o enlace.', emptyCode: 'reply_empty'
  })
  return { body: text, kind: extra.kind, links, files, mentionIds: extra.mention_ids ?? [] }
}

/** Reads the multipart body that adds attachments to a published message: `version`, files[] and links[] (UD-071). */
export async function readMessageAttachmentUpload (request, config, db) {
  const { text, links, files } = await readUpload(request, config, db, {
    textField: 'version', extraFields: [], emptyMessage: 'Falta un archivo o un enlace.', emptyCode: 'attachments_empty', textOptional: true
  })
  return { version: Number(text), links, files }
}

/**
 * Returns { text, links, files, extra } with the files already moved to their final name on the volume.
 * `extra` carries the additional text fields requested. On any error it deletes the temporary files it managed to write.
 */
async function readUpload (request, config, db, { textField, extraFields, emptyMessage, emptyCode, textOptional = false }) {
  if (!request.isMultipart()) throw unsupported('Se esperaba un envío multipart/form-data.')
  const u = config.uploads
  let text = ''
  const extra = {}
  const links = []
  const ingested = []
  const held = []

  try {
    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (part.valueTruncated) throw tooLarge('El texto supera el tamaño máximo permitido.')
        if (part.fieldname === textField) text = String(part.value)
        else if ((part.fieldname === 'mention_ids' || part.fieldname === 'mention_ids[]') && extraFields.includes('mention_ids')) {
          // UD-275: one field per member picked in the list of the mention; each one is an id.
          if (!/^[0-9]{1,15}$/.test(String(part.value).trim())) throw badRequest('`mention_ids` lleva ids de miembros.', 'mention_invalid')
          ;(extra.mention_ids ??= []).push(Number(String(part.value).trim()))
        }
        else if (extraFields.includes(part.fieldname)) {
          if (part.fieldname === 'auto_publish' && !['true', 'false'].includes(String(part.value))) throw badRequest('`auto_publish` es «true» o «false».', 'auto_publish_invalid')
          extra[part.fieldname] = String(part.value)
        }
        else if (part.fieldname === 'links' || part.fieldname === 'links[]') {
          if (String(part.value).trim() === '') continue
          links.push(normalizeLink(part.value, u))
          if (links.length > u.maxLinks) throw tooLarge(`Se admiten hasta ${u.maxLinks} enlaces por envío.`)
        }
        continue
      }
      // File
      const kindInfo = classify(part.mimetype, part.filename)
      if (!kindInfo && !part.filename) {
        // A form with no file chosen sends an empty part with no name: nothing was attached, nothing is refused.
        let bytes = 0
        for await (const chunk of part.file) bytes += chunk.length
        if (bytes === 0) continue
        throw unsupported('El formato de «archivo» no se admite.')
      }
      if (!kindInfo) {
        part.file.resume()
        throw unsupported(`El formato de «${part.filename || 'archivo'}» no se admite.`)
      }
      // HP-018: the cap is the smaller of the upload's and the extractor's (a document of 24 to 25 MiB would upload and
      // then fail at extraction, DT-005), and it is refused here with the extractor's own code, before anything is queued.
      const cap = Math.min(maxBytesFor(kindInfo.kind, u), EXTRACT_DEFAULTS[kindInfo.kind].maxBytes)
      const r = await ingest(config, part.file, {
        maxBytes: cap, tooLargeCode: `${kindInfo.kind}_too_large`,
        tooLargeMessage: `«${part.filename || 'archivo'}» supera el máximo de ${MB(cap)} para ese tipo de archivo.`
      })
      ingested.push({ ...r, kind: kindInfo.kind, mime: kindInfo.mime, name: part.filename || '' })
      if (r.size === 0) throw badRequest(`«${part.filename || 'archivo'}» está vacío.`, 'file_empty')
      if (kindInfo.kind === 'video') await rejectLongVideo(r.tmp, part.filename)
    }
    if (Buffer.byteLength(text) > u.maxTextBytes) throw tooLarge('El texto supera el tamaño máximo permitido.')
    if ((textOptional || text.trim() === '') && ingested.length === 0 && links.length === 0) {
      throw badRequest(emptyMessage, emptyCode)
    }
    // Everything validated: the temporary files move to their final name (the hash).
    for (const f of ingested) { holdBlob(f.sha256); held.push(f); await commit(config, f.tmp, f.sha256) }
    return { text, links: [...new Set(links)], files: ingested.map(({ tmp, ...rest }) => rest), extra }
  } catch (error) {
    await Promise.all(ingested.map((f) => rm(f.tmp, { force: true })))
    await releaseBlobs(db, config, held, { discard: true }) // what this refused upload wrote leaves with it (UD-072)
    throw volumeError(error) ?? error
  }
}

/**
 * Reads the multipart body of PATCH /settings/project (UD-024): a `file` part (.md) or a `description` field, both
 * capped at `maxChars` characters. The file is read into memory only up to 4 bytes per allowed character (the UTF-8
 * worst case), so an oversized upload is refused without being stored.
 */
export async function readProjectUpload (request, maxChars) {
  if (!request.isMultipart()) throw unsupported('Se esperaba un envío multipart/form-data.')
  const tooBig = () => tooLarge(`La descripción del proyecto supera el máximo de ${maxChars} caracteres.`)
  let description
  for await (const part of request.parts()) {
    if (part.type === 'field') {
      if (part.fieldname !== 'description') continue
      if (part.valueTruncated) throw tooBig()
      description = String(part.value)
      continue
    }
    if (part.fieldname !== 'file') { part.file.resume(); continue }
    if (!/\.md$/i.test(part.filename || '')) {
      part.file.resume()
      throw unsupported(`«${part.filename || 'archivo'}» no es un archivo .md.`)
    }
    const chunks = []
    let size = 0
    for await (const chunk of part.file) {
      size += chunk.length
      if (size > maxChars * 4) { part.file.resume(); throw tooBig() }
      chunks.push(chunk)
    }
    try { description = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)).replace(/^\uFEFF/, '') } catch {
      throw badRequest(`«${part.filename}» no está codificado en UTF-8.`, 'file_encoding')
    }
  }
  if (description === undefined) throw badRequest('Falta el archivo .md o el campo «description».', 'description_required')
  if ([...description].length > maxChars) throw tooBig()
  return description
}
