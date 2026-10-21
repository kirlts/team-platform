// Cliente de la API: fetch a /api con la cookie de sesión. En métodos no seguros
// agrega la cabecera propia de CSRF (el servidor además mira Sec-Fetch-Site y Origin).

export const API_BASE = '/api'
export const CSRF_HEADER = 'X-Team-Request'
const CSRF_VALUE = 'panel'

/**
 * Error de la API: `{ code, message }` con el código estable que el panel traduce a su catálogo
 * (`error.<code>`); `message` es el texto del servidor y sólo se muestra si el código no tiene
 * traducción. `status` 0 es un fallo de red.
 */
export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, message: string, code = '') {
    super(message)
    this.status = status
    this.code = code
  }
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

async function errorBody(res: Response): Promise<{ message: string; code: string }> {
  try {
    const data = await res.json()
    const code = data && typeof data.code === 'string' ? data.code : ''
    if (data && typeof data.message === 'string') return { message: data.message, code }
    if (data && typeof data.error === 'string') return { message: data.error, code }
    return { message: '', code }
  } catch {
    // Cuerpo vacío o no JSON: sólo queda el estado HTTP.
  }
  return { message: '', code: '' }
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal } = {},
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (!SAFE.has(method)) headers[CSRF_HEADER] = CSRF_VALUE
  let body: string | FormData | undefined
  if (options.form) {
    body = options.form // el navegador pone el límite del multipart
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body, credentials: 'include', signal: options.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, '', 'network')
  }
  if (!res.ok) {
    const { message, code } = await errorBody(res)
    throw new ApiError(res.status, message, code || `http_${res.status}`)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** Las listas pueden llegar como arreglo o como `{ items }`. */
export function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items
  }
  return []
}

/** Archivo adjunto a una respuesta: tiene sus propios ids y su propia ruta. */
export function replyAttachmentUrl(id: string): string {
  return `${API_BASE}/replies/attachments/${encodeURIComponent(id)}`
}

export function attachmentUrl(id: string): string {
  return `${API_BASE}/attachments/${encodeURIComponent(id)}`
}
