// Lectura de la subida multipart de `POST /inputs` (MASTER-SPEC §7.1, §7.8). Cada archivo se escribe a disco con
// `pipeline` mientras se calcula su SHA-256, con el tope de su tipo; nada se acumula en memoria (informe 03 §7.2).

import { rm } from 'node:fs/promises'
import { classify, maxBytesFor } from '../domain/attachments.js'
import { AppError, badRequest, tooLarge, unsupported } from '../domain/errors.js'
import { DEFAULTS as EXTRACT_DEFAULTS } from '../extract/config.js'
import { probe } from '../extract/lib/ffmpeg.js'
import { commit, ingest } from '../domain/storage.js'

const MB = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`

/** Valida una URL de enlace: sólo http(s), con el largo máximo configurado. */
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

/** Reads the multipart body of a new input: text, files[] and links[]. */
export const readInputUpload = (request, config) => readUpload(request, config, {
  textField: 'text', extraFields: [], emptyMessage: 'El envío está vacío: falta texto, archivo o enlace.', emptyCode: 'input_empty'
})

/** Reads the multipart body of a reply: body, kind, files[] and links[]. Same limits and storage as an input. */
export async function readReplyUpload (request, config) {
  const { text, links, files, extra } = await readUpload(request, config, {
    textField: 'body', extraFields: ['kind'], emptyMessage: 'La respuesta está vacía: falta texto, archivo o enlace.', emptyCode: 'reply_empty'
  })
  return { body: text, kind: extra.kind, links, files }
}

/**
 * Devuelve { text, links, files, extra } con los archivos ya movidos a su nombre definitivo en el volumen.
 * `extra` trae los campos de texto adicionales pedidos. Ante cualquier error borra los temporales que alcanzó a escribir.
 */
async function readUpload (request, config, { textField, extraFields, emptyMessage, emptyCode }) {
  if (!request.isMultipart()) throw unsupported('Se esperaba un envío multipart/form-data.')
  const u = config.uploads
  let text = ''
  const extra = {}
  const links = []
  const ingested = []

  try {
    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (part.valueTruncated) throw tooLarge('El texto supera el tamaño máximo permitido.')
        if (part.fieldname === textField) text = String(part.value)
        else if (extraFields.includes(part.fieldname)) extra[part.fieldname] = String(part.value)
        else if (part.fieldname === 'links' || part.fieldname === 'links[]') {
          if (String(part.value).trim() === '') continue
          links.push(normalizeLink(part.value, u))
          if (links.length > u.maxLinks) throw tooLarge(`Se admiten hasta ${u.maxLinks} enlaces por envío.`)
        }
        continue
      }
      // Archivo
      const kindInfo = classify(part.mimetype, part.filename)
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
    if (text.trim() === '' && ingested.length === 0 && links.length === 0) {
      throw badRequest(emptyMessage, emptyCode)
    }
    // Todo validado: los temporales pasan a su nombre definitivo (el hash).
    for (const f of ingested) await commit(config, f.tmp, f.sha256)
    return { text, links: [...new Set(links)], files: ingested.map(({ tmp, ...rest }) => rest), extra }
  } catch (error) {
    await Promise.all(ingested.map((f) => rm(f.tmp, { force: true })))
    throw error
  }
}
