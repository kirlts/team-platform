// Classification of attachments by declared MIME type (or, if generic, by extension). It is a table of
// file formats, not a reading of people's text. The type declared by the browser cannot be trusted:
// the extractor checks the actual content (src/contracts.md).

import path from 'node:path'

const MIME_TO_KIND = new Map([
  ...['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif'].map((m) => [m, 'image']),
  ...['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/mpeg', 'video/x-m4v'].map((m) => [m, 'video']),
  ...['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/flac', 'audio/x-flac'].map((m) => [m, 'audio']),
  ...[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/markdown', 'text/x-markdown'
  ].map((m) => [m, 'document'])
])

const EXTENSION_TO_MIME = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.gif', 'image/gif'],
  ['.heic', 'image/heic'], ['.heif', 'image/heif'], ['.avif', 'image/avif'],
  ['.mp4', 'video/mp4'], ['.mov', 'video/quicktime'], ['.webm', 'video/webm'], ['.mkv', 'video/x-matroska'], ['.m4v', 'video/x-m4v'],
  ['.mp3', 'audio/mpeg'], ['.m4a', 'audio/mp4'], ['.aac', 'audio/aac'], ['.wav', 'audio/wav'], ['.ogg', 'audio/ogg'], ['.flac', 'audio/flac'],
  ['.pdf', 'application/pdf'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.txt', 'text/plain'], ['.md', 'text/markdown']
])

const GENERIC_MIMES = new Set(['', 'application/octet-stream', 'binary/octet-stream'])

/** Returns { kind, mime } or null if the format is not accepted (SVG is left out on purpose: it can carry scripts). */
export function classify (declaredMime, filename) {
  const base = String(declaredMime ?? '').split(';')[0].trim().toLowerCase()
  let mime = base
  if (GENERIC_MIMES.has(base)) mime = EXTENSION_TO_MIME.get(path.extname(String(filename ?? '')).toLowerCase()) ?? ''
  const kind = MIME_TO_KIND.get(mime)
  return kind ? { kind, mime } : null
}

/** Types the browser can display inline without risk; the rest is downloaded. */
export const INLINE_MIMES = new Set([...MIME_TO_KIND.entries()].filter(([m, k]) => ['image', 'video', 'audio'].includes(k) || m === 'application/pdf').map(([m]) => m))

export function maxBytesFor (kind, uploads) {
  return { image: uploads.maxImageBytes, audio: uploads.maxAudioBytes, document: uploads.maxDocumentBytes, video: uploads.maxVideoBytes }[kind]
}
