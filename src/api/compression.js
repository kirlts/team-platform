// Response compression for what the server builds in memory (JSON of the API, the mounted index.html, the host's theme).
// The panel's own files are compressed once at build time (`panel/scripts/precompress.mjs`) and served as they are
// (`preCompressed` of @fastify/static), so this hook never sees them. Streams are left alone: attachments are
// already-compressed media and the event stream (`text/event-stream`) must leave without accumulating.
//
// No dependency: `node:zlib` compresses off the event loop (the callback API runs in the libuv pool), so a 260 kB
// answer does not hold the other requests while it is compressed. Brotli goes first, gzip second, as the browser's
// `Accept-Encoding` allows (RFC 9110 §12.5.3).

import { brotliCompress, gzip, constants } from 'node:zlib'
import { promisify } from 'node:util'

const brotli = promisify(brotliCompress)
const gz = promisify(gzip)

// What is compressible: text formats. Images, audio, video and PDFs travel as they are.
const COMPRESSIBLE = /^(application\/json|application\/javascript|text\/(html|css|plain|javascript)|image\/svg\+xml)\b/i

// Quality 5 of Brotli and level 6 of gzip: bench/results/2026-10-24-compression.json, seeded answers of the API. Brotli 5 is smaller than gzip 6 on 5 of
// the 7 answers and 4 to 12 % larger on the two long lists, and it takes less time on those two (4.2 against 7.7 ms for 260 kB). Brotli 11 takes 60 to 280 ms
// on a list: it is for the files compressed once at build time, never for an answer.
const BROTLI_PARAMS = { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }
const GZIP_OPTIONS = { level: 6 }

/** The encoding to use for an `Accept-Encoding` header: `br`, `gzip` or null. A `q=0` refuses that coding. */
export function negotiate (header) {
  if (!header) return null
  const accepted = new Map()
  for (const part of String(header).split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';')
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
    accepted.set(name.trim(), q ? Number(q.slice(2)) : 1)
  }
  const ok = (name) => (accepted.get(name) ?? accepted.get('*') ?? 0) > 0
  if (ok('br')) return 'br'
  if (ok('gzip')) return 'gzip'
  return null
}

export function installCompression (app, { minBytes }) {
  app.addHook('onSend', async (request, reply, payload) => {
    const type = String(reply.getHeader('content-type') ?? '')
    if (!COMPRESSIBLE.test(type)) return payload
    // The answer depends on the request's Accept-Encoding even when it is not compressed (a shared cache must keep both).
    const vary = String(reply.getHeader('vary') ?? '')
    if (!/\baccept-encoding\b/i.test(vary)) reply.header('vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding')
    if (reply.getHeader('content-encoding') || reply.statusCode < 200 || reply.statusCode === 204 || reply.statusCode === 304) return payload
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload
    const size = Buffer.byteLength(payload)
    if (size < minBytes) return payload
    const encoding = negotiate(request.headers['accept-encoding'])
    if (!encoding) return payload
    const body = Buffer.from(payload)
    const compressed = encoding === 'br' ? await brotli(body, BROTLI_PARAMS) : await gz(body, GZIP_OPTIONS)
    if (compressed.length >= size) return payload
    reply.header('content-encoding', encoding)
    reply.header('content-length', compressed.length)
    return compressed
  })
}
