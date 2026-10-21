// Upload of an input with progress. `fetch` does not give upload progress portably
// (report 07, §6.3), so XMLHttpRequest is used. The retry resends everything: it is safe
// because POST /inputs is idempotent by hash (MASTER-SPEC §1.3).
import { API_BASE, CSRF_HEADER } from './api'
import { telemetry } from './telemetry'

export interface NewInput {
  text: string
  files: File[]
  links: string[]
}

export interface CreatedInput {
  input_id: string
  job_id: string
}

export class UploadError extends Error {
  status: number
  /** Stable API code (`{ code, message }`); the panel translates it. */
  code: string
  constructor(status: number, message: string, code = '') {
    super(message)
    this.status = status
    this.code = code
  }
}

export function uploadInput(
  input: NewInput,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<CreatedInput> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('text', input.text)
    for (const file of input.files) form.append('files', file, file.name)
    for (const link of input.links) form.append('links', link)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/inputs`)
    xhr.withCredentials = true
    xhr.setRequestHeader(CSRF_HEADER, 'panel')
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total)
    }
    const settle = telemetry.request('POST', '/inputs') // interface telemetry (UD-091): the send begins here
    xhr.onload = () => {
      settle({ status: xhr.status })
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as CreatedInput)
        } catch {
          reject(new UploadError(xhr.status, '', 'invalid_response'))
        }
        return
      }
      let message = ''
      let code = `http_${xhr.status}`
      try {
        const body = JSON.parse(xhr.responseText)
        if (typeof body?.message === 'string') message = body.message
        if (typeof body?.code === 'string') code = body.code
      } catch {
        // No JSON body: the HTTP status remains.
      }
      reject(new UploadError(xhr.status, message, code))
    }
    xhr.onerror = () => {
      settle({ status: 0 })
      reject(new UploadError(0, '', 'network'))
    }
    xhr.onabort = () => reject(new UploadError(0, '', 'cancelled'))
    signal?.addEventListener('abort', () => xhr.abort())
    xhr.send(form)
  })
}

const EXTENSION_KIND: Record<string, 'image' | 'video' | 'audio'> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', heic: 'image', heif: 'image', avif: 'image',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', m4v: 'video',
  mp3: 'audio', m4a: 'audio', aac: 'audio', wav: 'audio', wave: 'audio', ogg: 'audio', flac: 'audio',
}

/** Kind of a local file: by its declared type and, when the system declares none (a .wav often arrives empty), by its extension. */
export function kindFromMime(mime: string, name = ''): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === '' || mime === 'application/octet-stream') return EXTENSION_KIND[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'document'
  return 'document'
}
