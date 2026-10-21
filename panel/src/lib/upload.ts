// Subida de un input con progreso. `fetch` no da progreso de subida de forma portable
// (informe 07, §6.3), así que se usa XMLHttpRequest. El reintento reenvía todo: es seguro
// porque POST /inputs es idempotente por hash (MASTER-SPEC §1.3).
import { API_BASE, CSRF_HEADER } from './api'

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
  /** Código estable de la API (`{ code, message }`); el panel lo traduce. */
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
    xhr.onload = () => {
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
        // Sin cuerpo JSON: queda el estado HTTP.
      }
      reject(new UploadError(xhr.status, message, code))
    }
    xhr.onerror = () => reject(new UploadError(0, '', 'network'))
    xhr.onabort = () => reject(new UploadError(0, '', 'cancelled'))
    signal?.addEventListener('abort', () => xhr.abort())
    xhr.send(form)
  })
}

export function kindFromMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}
