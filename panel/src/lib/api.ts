// Cliente de la API: fetch a /api con la cookie de sesión. En métodos no seguros
// agrega la cabecera propia de CSRF (el servidor además mira Sec-Fetch-Site y Origin).

export const API_BASE = '/api'
export const CSRF_HEADER = 'X-Team-Request'
const CSRF_VALUE = 'panel'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

async function errorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json()
    if (data && typeof data.message === 'string') return data.message
    if (data && typeof data.error === 'string') return data.error
  } catch {
    // Cuerpo vacío o no JSON: se usa el estado HTTP.
  }
  return `Error ${res.status}`
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (!SAFE.has(method)) headers[CSRF_HEADER] = CSRF_VALUE
  let body: string | undefined
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body,
    credentials: 'include',
    signal: options.signal,
  })
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
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

export function attachmentUrl(id: string): string {
  return `${API_BASE}/attachments/${encodeURIComponent(id)}`
}
