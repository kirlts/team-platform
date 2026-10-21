// API client: fetch to /api with the session cookie. On unsafe methods
// it adds its own CSRF header (the server also checks Sec-Fetch-Site and Origin).

import { telemetry } from '@/lib/telemetry'

export const API_BASE = '/api'
export const CSRF_HEADER = 'X-Team-Request'
const CSRF_VALUE = 'panel'

/**
 * API error: `{ code, message }` with the stable code the panel translates to its catalog
 * (`error.<code>`); `message` is the server's text and is shown only if the code has no
 * translation. `status` 0 is a network failure.
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
    // Empty or non-JSON body: only the HTTP status remains.
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
    body = options.form // the browser sets the multipart boundary
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  const settle = telemetry.request(method, path) // interface telemetry (UD-061): counts and durations, never content
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body, credentials: 'include', signal: options.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    settle({ status: 0 })
    throw new ApiError(0, '', 'network')
  }
  if (!res.ok) {
    settle({ status: res.status })
    const { message, code } = await errorBody(res)
    throw new ApiError(res.status, message, code || `http_${res.status}`)
  }
  if (res.status === 204) {
    settle({ status: res.status })
    return undefined as T
  }
  const text = await res.text()
  const data = (text ? JSON.parse(text) : undefined) as T
  settle({ status: res.status, body: data })
  return data
}

/** Lists may arrive as an array or as `{ items }`. */
export function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items
  }
  return []
}

/** File attached to a reply: it has its own ids and its own route. */
export function replyAttachmentUrl(id: string): string {
  return `${API_BASE}/replies/attachments/${encodeURIComponent(id)}`
}

export function attachmentUrl(id: string): string {
  return `${API_BASE}/attachments/${encodeURIComponent(id)}`
}
