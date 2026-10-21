// Clasificación de adjuntos por tipo MIME declarado (o, si es genérico, por extensión). Es una tabla de
// formatos de archivo, no una lectura de texto de personas. El tipo declarado por el navegador no es de
// fiar: el extractor revisa el contenido real (src/contracts.md).

import path from 'node:path'

const MIME_A_TIPO = new Map([
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

const EXTENSION_A_MIME = new Map([
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

const GENERICOS = new Set(['', 'application/octet-stream', 'binary/octet-stream'])

/** Devuelve { kind, mime } o null si el formato no se admite (SVG queda fuera a propósito: puede llevar scripts). */
export function classify (declaredMime, filename) {
  const base = String(declaredMime ?? '').split(';')[0].trim().toLowerCase()
  let mime = base
  if (GENERICOS.has(base)) mime = EXTENSION_A_MIME.get(path.extname(String(filename ?? '')).toLowerCase()) ?? ''
  const kind = MIME_A_TIPO.get(mime)
  return kind ? { kind, mime } : null
}

/** Tipos que el navegador puede mostrar en línea sin riesgo; el resto se descarga. */
export const INLINE_MIMES = new Set([...MIME_A_TIPO.entries()].filter(([m, k]) => ['image', 'video', 'audio'].includes(k) || m === 'application/pdf').map(([m]) => m))

export function maxBytesFor (kind, uploads) {
  return { image: uploads.maxImageBytes, audio: uploads.maxAudioBytes, document: uploads.maxDocumentBytes, video: uploads.maxVideoBytes }[kind]
}
