// Test double of the server for component tests: `fetch` is replaced by a function that answers like the API. The component
// goes through the real client (@team-platform/client) and the real hooks; only the network is faked. A handler returns the
// body of a 200 (or nothing, for a 204) and signals an error by throwing: a `TeamApiError` keeps its status, code and details;
// any other error becomes a 400 that carries its `code` and message.
import { TeamApiError } from '@team-platform/client'
import { TeamClientProvider } from '@team-platform/client/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { client } from '@/lib/client'
import { API_BASE } from '@/lib/base'

export interface MockRequest {
  method?: string
  body?: any // eslint-disable-line @typescript-eslint/no-explicit-any
  form?: FormData
}

export type MockHandler = (path: string, request: MockRequest) => unknown | Promise<unknown>

/** Installs the double and returns the handler as a spy, so a test can read the calls it received. */
export function mockApi<H extends MockHandler>(handler: H) {
  const spy = vi.fn(handler)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const path = url.startsWith(API_BASE) ? url.slice(API_BASE.length) : url
    const method = (init.method ?? 'GET').toUpperCase()
    const request: MockRequest = { method }
    if (typeof init.body === 'string') request.body = JSON.parse(init.body)
    else if (init.body instanceof FormData) request.form = init.body
    try {
      const data = await spy(path, request)
      if (data === undefined) return new Response(null, { status: 204 })
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } catch (err) {
      const e = err as { code?: string; message?: string }
      const body = err instanceof TeamApiError ? { ...err.details, code: err.code, message: err.message } : { code: e.code ?? '', message: e.message ?? '' }
      return new Response(JSON.stringify(body), { status: err instanceof TeamApiError ? err.status : 400, headers: { 'Content-Type': 'application/json' } })
    }
  })
  return spy
}

/** The panel's client for the hooks under test. */
export function WithTeamClient({ children }: { children?: ReactNode }) {
  return <TeamClientProvider client={client}>{children}</TeamClientProvider>
}
