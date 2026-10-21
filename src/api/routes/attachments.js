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
function leerRango (cabecera, tamano) {
  if (!cabecera) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(cabecera.trim())
  if (!m || (m[1] === '' && m[2] === '')) throw Object.assign(badRequest('Rango inválido.', 'range_invalid'), { status: 416 })
  let start, end
  if (m[1] === '') { // últimos N bytes
    start = Math.max(0, tamano - Number(m[2]))
    end = tamano - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? tamano - 1 : Math.min(Number(m[2]), tamano - 1)
  }
  if (start > end || start >= tamano) throw Object.assign(badRequest('Rango fuera del archivo.', 'range_invalid'), { status: 416 })
  return { start, end }
}

export function registerAttachmentRoutes (app, ctx) {
  const { db, config, requireRole } = ctx

  app.get('/attachments/:id', { onRequest: [requireRole('member')], schema: { params: idParams() } }, async (request, reply) => {
    const adjunto = get(db, 'SELECT * FROM attachments WHERE id = ?', request.params.id)
    // Un adjunto al que no se tiene acceso no se distingue de uno inexistente.
    if (!adjunto || adjunto.kind === 'link' || !canReadAttachment(db, request.member.id, adjunto.id)) throw notFound('El adjunto no existe.')
    const ruta = blobPath(config, adjunto.sha256)
    let info
    try { info = await stat(ruta) } catch { throw notFound('El archivo del adjunto ya no está en el servidor.') }

    const enLinea = INLINE_MIMES.has(adjunto.mime)
    const nombre = encodeURIComponent(adjunto.name || `adjunto-${adjunto.id}`)
    reply.header('content-type', enLinea ? adjunto.mime : 'application/octet-stream')
    reply.header('content-disposition', `${enLinea ? 'inline' : 'attachment'}; filename*=UTF-8''${nombre}`)
    reply.header('accept-ranges', 'bytes')
    // El contenido es inmutable: su nombre es su hash. Privado: lo ven sólo quienes tienen sesión.
    reply.header('cache-control', 'private, max-age=31536000, immutable')
    reply.header('etag', `"${adjunto.sha256}"`)
    reply.header('content-security-policy', "default-src 'none'; sandbox") // un adjunto abierto directo no corre nada

    let rango
    try {
      rango = leerRango(request.headers.range, info.size)
    } catch (error) {
      reply.header('content-range', `bytes */${info.size}`)
      return reply.code(416).send({ code: error.code, message: error.message })
    }
    if (!rango) {
      reply.header('content-length', info.size)
      return reply.send(createReadStream(ruta))
    }
    reply.code(206)
    reply.header('content-range', `bytes ${rango.start}-${rango.end}/${info.size}`)
    reply.header('content-length', rango.end - rango.start + 1)
    return reply.send(createReadStream(ruta, { start: rango.start, end: rango.end }))
  })
}
