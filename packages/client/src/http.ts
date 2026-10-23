// The transport: one `fetch` per call with the headers the server demands, the error mapped to `TeamApiError`.
import { CLIENT_ERROR_CODES, errorFromResponse, TeamApiError } from './errors.js'
import { pathOf, type Route } from './routes.js'

/** Header the server demands of every unsafe request that carries the session cookie (src/identity/csrf.js): its presence, not its value. */
export const REQUEST_HEADER = 'X-Team-Request'

/** What `instrument` receives when the call ends: the status (0 when there was no answer) and the parsed body. */
export interface CallResult {
  status: number
  body?: unknown
}

export interface TeamClientOptions {
  /** Origin of the API, without the path: `https://team.example.org`. Empty (the default) for the same origin as the page. */
  baseUrl?: string
  /** Where the API lives under `baseUrl` (`API_PREFIX` of the server). Default `/api`. */
  apiPrefix?: string
  /** Headers added to every request, or a function that returns them each time (a token that rotates). */
  headers?: Record<string, string> | (() => Record<string, string>)
  /** The `fetch` to use. By default the global one, looked up at each call. */
  fetch?: typeof fetch
  /** Value of the `X-Team-Request` header on unsafe requests. Default `client`; the server only checks that it is there. */
  requestMarker?: string
  /** `COOKIE_MODE` of the server. `cross-origin` sends the session cookie to another origin (`credentials: 'include'`). Default `same-origin`. */
  cookieMode?: 'same-origin' | 'cross-origin'
  /** Overrides what `cookieMode` decides for `fetch`, the upload and the event stream. */
  credentials?: RequestCredentials
  /**
   * Called before each request with the method and the path relative to the prefix; returns the function that receives the
   * result. It is how an interface counts and times its calls (UD-091) without the client knowing about it.
   */
  instrument?: (method: string, path: string) => (result: CallResult) => void
  /** Creates the `EventSource` of the event stream. By default the global one, with the credentials of the client. */
  eventSource?: (url: string) => EventSourceLike
  /** Creates the `XMLHttpRequest` of the upload with progress. By default the global one. */
  xhr?: () => XMLHttpRequest
}

/** The part of `EventSource` the stream uses; a test or another runtime supplies its own. */
export interface EventSourceLike {
  readyState: number
  close(): void
  addEventListener(type: string, listener: (e: MessageEvent) => void): void
  onopen: ((e: Event) => void) | null
  onerror: ((e: Event) => void) | null
  onmessage: ((e: MessageEvent) => void) | null
}

export interface RequestOptions {
  method?: string
  body?: unknown
  /** A body that is already serialized JSON; sent as it is, with the JSON content type. */
  json?: string
  form?: FormData
  signal?: AbortSignal
  /** Lets the request outlive the page (interface telemetry on closing). */
  keepalive?: boolean
}

/** What a call to a contract route takes. `search` is the query string already serialized, without the `?`. */
export interface CallArgs {
  params?: Readonly<Record<string, string | number>>
  search?: string
  body?: unknown
  json?: string
  form?: FormData
  signal?: AbortSignal
  keepalive?: boolean
}

/** The settings the transport and the upload share. */
export interface Transport {
  readonly baseUrl: string
  readonly apiPrefix: string
  readonly credentials: RequestCredentials
  readonly requestMarker: string
  readonly instrument: TeamClientOptions['instrument']
  readonly eventSource: TeamClientOptions['eventSource']
  readonly xhr: TeamClientOptions['xhr']
  /** Absolute (or origin-relative) address of an API path: `baseUrl` + `apiPrefix` + path. */
  url(path: string): string
  /** The headers of a request: `Accept`, the marker if the method is unsafe, and the extra ones. */
  headersFor(method: string): Record<string, string>
  request<T = unknown>(path: string, options?: RequestOptions): Promise<T>
  call<T = unknown>(route: Route, args?: CallArgs): Promise<T>
  /** An authenticated request to an address the API gave (a transcript, a file); returns the raw response. */
  raw(url: string, init?: { signal?: AbortSignal }): Promise<Response>
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

const trimEnd = (s: string) => s.replace(/\/+$/, '')

/** `''`, `/api` and `api/` all mean the same prefix; an absolute address is kept as it is. */
export function normalizePrefix(raw: string): string {
  const trimmed = trimEnd(raw.trim())
  if (!trimmed) return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

const isAbort = (err: unknown) => !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError'

export function createTransport(options: TeamClientOptions = {}): Transport {
  const baseUrl = trimEnd((options.baseUrl ?? '').trim())
  const apiPrefix = normalizePrefix(options.apiPrefix ?? '/api')
  const requestMarker = options.requestMarker ?? 'client'
  const credentials: RequestCredentials = options.credentials ?? (options.cookieMode === 'cross-origin' ? 'include' : 'same-origin')
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))

  const url = (path: string) => `${baseUrl}${apiPrefix}${path}`

  const headersFor = (method: string) => {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (!SAFE.has(method.toUpperCase())) headers[REQUEST_HEADER] = requestMarker
    const extra = typeof options.headers === 'function' ? options.headers() : options.headers
    return { ...headers, ...extra }
  }

  async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = (opts.method ?? 'GET').toUpperCase()
    const headers = headersFor(method)
    let body: string | FormData | undefined
    if (opts.form) {
      body = opts.form // the runtime sets the multipart boundary
    } else if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = opts.json
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }
    const settle = options.instrument?.(method, path) ?? (() => undefined)
    let res: Response
    try {
      res = await doFetch(url(path), { method, headers, body, credentials, signal: opts.signal, ...(opts.keepalive ? { keepalive: true } : {}) })
    } catch (err) {
      if (isAbort(err)) throw err
      settle({ status: 0 })
      throw new TeamApiError(0, '', CLIENT_ERROR_CODES.network)
    }
    if (!res.ok) {
      settle({ status: res.status })
      throw await errorFromResponse(res)
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

  return {
    baseUrl,
    apiPrefix,
    credentials,
    requestMarker,
    instrument: options.instrument,
    eventSource: options.eventSource,
    xhr: options.xhr,
    url,
    headersFor,
    request,
    call: (route, args = {}) => {
      const path = pathOf(route, args.params) + (args.search ? `?${args.search}` : '')
      return request(path, { method: route.method, body: args.body, json: args.json, form: args.form, signal: args.signal, keepalive: args.keepalive })
    },
    raw: (address, init = {}) => doFetch(address, { credentials, headers: headersFor('GET'), signal: init.signal }),
  }
}
