// GET /attachments/:id: el archivo, con control de acceso y soporte de rangos (los navegadores piden rangos
// para buscar dentro de un video o un audio).

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { get } from '../../db/index.js'
import { INLINE_MIMES } from '../../domain/attachments.js'
import { canReadAttachment } from '../../domain/messages.js'
import { badRequest, notFound } from '../../domain/errors.js'
import { blobPath } from '../../domain/storage.js'
import { idParams } from '../schemas.js'

/** Interpreta «bytes=a-b» de un solo rango. Devuelve { start, end } o null si no hay rango. */
function parseRange (headerValue, sizeBytes) {
  if (!headerValue) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(headerValue.trim())
  if (!m || (m[1] === '' && m[2] === '')) throw Object.assign(badRequest('Rango inválido.', 'range_invalid'), { status: 416 })
  let start, end
  if (m[1] === '') { // últimos N bytes
    start = Math.max(0, sizeBytes - Number(m[2]))
    end = sizeBytes - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? sizeBytes - 1 : Math.min(Number(m[2]), sizeBytes - 1)
  }
  if (start > end || start >= sizeBytes) throw Object.assign(badRequest('Rango fuera del archivo.', 'range_invalid'), { status: 416 })
  return { start, end }
}

export function registerAttachmentRoutes (app, ctx) {
  const { db, config, requireRole } = ctx

  app.get('/attachments/:id', { onRequest: [requireRole('member')], schema: { params: idParams(), response: {
    200: { type: 'string', format: 'binary', description: 'El archivo.' },
    206: { type: 'string', format: 'binary', description: 'Un rango del archivo (cabecera Range).' }
  } } }, async (request, reply) => {
    const att = get(db, 'SELECT * FROM attachments WHERE id = ?', request.params.id)
    // Un adjunto al que no se tiene acceso no se distingue de uno inexistente.
    if (!att || att.kind === 'link' || !canReadAttachment(db, request.member.id, att.id)) throw notFound('El adjunto no existe.')
    const routePath = blobPath(config, att.sha256)
    let info
    try { info = await stat(routePath) } catch { throw notFound('El archivo del adjunto ya no está en el servidor.') }

    const isInline = INLINE_MIMES.has(att.mime)
    const nameValue = encodeURIComponent(att.name || `adjunto-${att.id}`)
    reply.header('content-type', isInline ? att.mime : 'application/octet-stream')
    reply.header('content-disposition', `${isInline ? 'inline' : 'attachment'}; filename*=UTF-8''${nameValue}`)
    reply.header('accept-ranges', 'bytes')
    // El contenido es inmutable: su nombre es su hash. Privado: lo ven sólo quienes tienen sesión.
    reply.header('cache-control', 'private, max-age=31536000, immutable')
    reply.header('etag', `"${att.sha256}"`)
    reply.header('content-security-policy', "default-src 'none'; sandbox") // un adjunto abierto directo no corre nada

    let rangeSpec
    try {
      rangeSpec = parseRange(request.headers.range, info.size)
    } catch (error) {
      reply.header('content-range', `bytes */${info.size}`)
      return reply.code(416).type('application/json; charset=utf-8').send({ code: error.code, message: error.message })
    }
    if (!rangeSpec) {
      reply.header('content-length', info.size)
      return reply.send(createReadStream(routePath))
    }
    reply.code(206)
    reply.header('content-range', `bytes ${rangeSpec.start}-${rangeSpec.end}/${info.size}`)
    reply.header('content-length', rangeSpec.end - rangeSpec.start + 1)
    return reply.send(createReadStream(routePath, { start: rangeSpec.start, end: rangeSpec.end }))
  })
}
