// Lectura de la subida multipart de `POST /inputs` (MASTER-SPEC §7.1, §7.8). Cada archivo se escribe a disco con
// `pipeline` mientras se calcula su SHA-256, con el tope de su tipo; nada se acumula en memoria (informe 03 §7.2).

import { rm } from 'node:fs/promises'
import { classify, maxBytesFor } from '../domain/attachments.js'
import { badRequest, tooLarge, unsupported } from '../domain/errors.js'
import { commit, ingest } from '../domain/storage.js'

const MB = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`

/** Valida una URL de enlace: sólo http(s), con el largo máximo configurado. */
function normalizarEnlace (crudo, uploads) {
  const texto = String(crudo).trim()
  if (texto.length > uploads.maxLinkLength) throw badRequest('Un enlace supera el largo máximo permitido.', 'link_too_long')
  let url
  try { url = new URL(texto) } catch { throw badRequest(`El enlace «${texto.slice(0, 80)}» no es una dirección válida.`, 'link_invalid') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw badRequest('Sólo se admiten enlaces http y https.', 'link_invalid')
  return url.toString()
}

/**
 * Devuelve { text, links, files } con los archivos ya movidos a su nombre definitivo en el volumen.
 * Ante cualquier error borra los temporales que alcanzó a escribir.
 */
export async function readInputUpload (request, config) {
  if (!request.isMultipart()) throw unsupported('Se esperaba un envío multipart/form-data.')
  const u = config.uploads
  let text = ''
  const links = []
  const ingeridos = []

  try {
    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (part.valueTruncated) throw tooLarge('El texto supera el tamaño máximo permitido.')
        if (part.fieldname === 'text') text = String(part.value)
        else if (part.fieldname === 'links' || part.fieldname === 'links[]') {
          if (String(part.value).trim() === '') continue
          links.push(normalizarEnlace(part.value, u))
          if (links.length > u.maxLinks) throw tooLarge(`Se admiten hasta ${u.maxLinks} enlaces por envío.`)
        }
        continue
      }
      // Archivo
      const clase = classify(part.mimetype, part.filename)
      if (!clase) {
        part.file.resume()
        throw unsupported(`El formato de «${part.filename || 'archivo'}» no se admite.`)
      }
      const limite = maxBytesFor(clase.kind, u)
      const r = await ingest(config, part.file, { maxBytes: limite, tooLargeMessage: `«${part.filename || 'archivo'}» supera el máximo de ${MB(limite)} para ese tipo de archivo.` })
      ingeridos.push({ ...r, kind: clase.kind, mime: clase.mime, name: part.filename || '' })
      if (r.size === 0) throw badRequest(`«${part.filename || 'archivo'}» está vacío.`, 'file_empty')
    }
    if (Buffer.byteLength(text) > u.maxTextBytes) throw tooLarge('El texto supera el tamaño máximo permitido.')
    if (text.trim() === '' && ingeridos.length === 0 && links.length === 0) {
      throw badRequest('El envío está vacío: falta texto, archivo o enlace.', 'input_empty')
    }
    // Todo validado: los temporales pasan a su nombre definitivo (el hash).
    for (const f of ingeridos) await commit(config, f.tmp, f.sha256)
    return { text, links: [...new Set(links)], files: ingeridos.map(({ tmp, ...resto }) => resto) }
  } catch (error) {
    await Promise.all(ingeridos.map((f) => rm(f.tmp, { force: true })))
    throw error
  }
}
