// GET /attachments/:id: the file, with access control and range support (browsers request ranges
// to seek within a video or an audio).

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { get } from '../../db/index.js'
import { INLINE_MIMES } from '../../domain/attachments.js'
import { canReadAttachment, canReadReplyAttachment } from '../../domain/messages.js'
import { badRequest, notFound } from '../../domain/errors.js'
import { blobPath } from '../../domain/storage.js'
import { idParams } from '../schemas.js'

/** Parses a single-range «bytes=a-b». Returns { start, end } or null if there is no range. */
function parseRange (headerValue, sizeBytes) {
  if (!headerValue) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(headerValue.trim())
  if (!m || (m[1] === '' && m[2] === '')) throw Object.assign(badRequest('Rango inválido.', 'range_invalid'), { status: 416 })
  let start, end
  if (m[1] === '') { // last N bytes
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

  /** Streams a stored file with range support. `att` is a row of `attachments` or `reply_attachments`. */
  async function sendFile (att, request, reply) {
    const routePath = blobPath(config, att.sha256)
    let info
    try { info = await stat(routePath) } catch { throw notFound('El archivo del adjunto ya no está en el servidor.') }

    // `?download=1` asks for the file as a download; without it, what a browser can show safely is shown inline.
    const wantsDownload = ['1', 'true'].includes(String(request.query?.download ?? ''))
    const isInline = !wantsDownload && INLINE_MIMES.has(att.mime)
    // RFC 5987: encodeURIComponent leaves ' ( ) * unescaped, and those are not allowed in the extended value.
    const nameValue = encodeURIComponent(att.name || `adjunto-${att.id}`).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    reply.header('content-type', att.mime || 'application/octet-stream') // the stored type is the real one (classified at upload)
    reply.header('content-disposition', `${isInline ? 'inline' : 'attachment'}; filename*=UTF-8''${nameValue}`)
    reply.header('accept-ranges', 'bytes')
    // The content is immutable: its name is its hash. Private: only those with a session see it.
    reply.header('cache-control', 'private, max-age=31536000, immutable')
    reply.header('etag', `"${att.sha256}"`)
    reply.header('content-security-policy', "default-src 'none'; sandbox") // an attachment opened directly runs nothing

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
  }

  const downloadQuery = { type: 'object', properties: { download: { type: 'string', description: 'Con `1`, el archivo llega como descarga (`Content-Disposition: attachment`) con su nombre original.' } } }

  const responses = {
    200: { type: 'string', format: 'binary', description: 'El archivo.' },
    206: { type: 'string', format: 'binary', description: 'Un rango del archivo (cabecera Range).' }
  }

  app.get('/attachments/:id', { onRequest: [requireRole('member')], schema: { params: idParams(), querystring: downloadQuery, response: responses } }, async (request, reply) => {
    const att = get(db, 'SELECT * FROM attachments WHERE id = ?', request.params.id)
    // An attachment the member cannot access is indistinguishable from a nonexistent one.
    if (!att || att.kind === 'link' || !canReadAttachment(db, request.member.id, att.id)) throw notFound('El adjunto no existe.')
    return sendFile(att, request, reply)
  })

  // The text the pipeline extracted from an audio or a video (its transcript), for the gallery. Same access as the file.
  app.get('/attachments/:id/transcript', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'La transcripción de un audio o un video adjunto',
      description: 'El texto que el análisis extrajo del adjunto, con la marca `mm:ss` de cada segmento. 404 si el adjunto no existe, no es audio ni video, o todavía no se extrajo texto.',
      params: idParams(),
      response: { 200: { type: 'object', properties: { text: { type: 'string' } } } }
    }
  }, async (request) => {
    const att = get(db, 'SELECT id, kind, extracted_text FROM attachments WHERE id = ?', request.params.id)
    if (!att || !['audio', 'video'].includes(att.kind) || !att.extracted_text || !canReadAttachment(db, request.member.id, att.id)) throw notFound('El adjunto no tiene transcripción.')
    return { text: att.extracted_text }
  })

  // The transcript of the audio or video of a reply (UD-277). Same access as the file.
  app.get('/replies/attachments/:id/transcript', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'La transcripción de un audio o un video adjunto a una respuesta',
      description: 'El texto que se leyó del adjunto de una respuesta (UD-277). 404 si el adjunto no existe, no es audio ni video, o todavía no se leyó.',
      params: idParams(),
      response: { 200: { type: 'object', properties: { text: { type: 'string' } } } }
    }
  }, async (request) => {
    const att = get(db, 'SELECT id, kind, extracted_text FROM reply_attachments WHERE id = ?', request.params.id)
    if (!att || !['audio', 'video'].includes(att.kind) || !att.extracted_text || !canReadReplyAttachment(db, att.id)) throw notFound('El adjunto no tiene transcripción.')
    return { text: att.extracted_text }
  })

  // Reply files (own id, separate table): the whole team sees them, like the thread.
  app.get('/replies/attachments/:id', {
    onRequest: [requireRole('member')],
    schema: { summary: 'El archivo adjunto a una respuesta, con soporte de rangos', params: idParams(), querystring: downloadQuery, response: responses }
  }, async (request, reply) => {
    const att = get(db, 'SELECT * FROM reply_attachments WHERE id = ?', request.params.id)
    if (!att || att.kind === 'link' || !canReadReplyAttachment(db, att.id)) throw notFound('El adjunto no existe.')
    return sendFile(att, request, reply)
  })
}
