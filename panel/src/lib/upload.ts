// Upload of an input with progress. `fetch` does not give upload progress in a portable way
// (report 07, §6.3), so XMLHttpRequest is used. The retry resends everything: it is safe
// because POST /inputs is idempotent by hash (MASTER-SPEC §1.3).
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
  constructor(status: number, message: string) {
    super(message)
    this.status = status
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
          reject(new UploadError(xhr.status, 'Respuesta inválida'))
        }
        return
      }
      let message = `Error ${xhr.status}`
      try {
        const body = JSON.parse(xhr.responseText)
        if (typeof body?.message === 'string') message = body.message
        else if (typeof body?.error === 'string') message = body.error
      } catch {
        // Without a JSON body: the HTTP status remains.
      }
      reject(new UploadError(xhr.status, message))
    }
    xhr.onerror = () => reject(new UploadError(0, 'Sin conexión'))
    xhr.onabort = () => reject(new UploadError(0, 'Cancelado'))
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
