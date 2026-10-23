// @vitest-environment jsdom
// The hooks against the real API: the cache keys, the writes of the saved answer, the invalidations and the optimistic language.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { queryKeys, TeamApiError, type MessageDetail, type TeamClient } from '../src/index.js'
import {
  EventsProvider,
  TeamClientProvider,
  useDeleteMessage,
  useEventsSnapshot,
  useMe,
  useMessage,
  useMessages,
  usePatchMessage,
  useRestoreMessage,
  useSaveLanguage,
  useTeamClient,
} from '../src/react/index.js'
import { publishedMessage, startServerProcess, type TestServer } from './server.js'

let server: TestServer

beforeAll(async () => {
  server = await startServerProcess()
})
afterAll(async () => {
  await server.close()
})

/** A client that counts the requests it makes, by `METHOD /path`. */
async function counting(email: string, extra: Parameters<TestServer['as']>[1] = {}) {
  const requests: string[] = []
  const client = await server.as(email, { ...extra, instrument: (method, path) => (requests.push(`${method} ${path.split('?')[0]}`), () => undefined) })
  return { client, requests }
}

function harness(client: TeamClient, children: (qc: QueryClient) => void = () => undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  children(qc)
  const wrapper = ({ children: c }: { children?: ReactNode }) => createElement(QueryClientProvider, { client: qc }, createElement(TeamClientProvider, { client }, c))
  return { qc, wrapper }
}

describe('provider and reads', () => {
  it('a hook outside a TeamClientProvider says what is missing', () => {
    const qc = new QueryClient()
    const wrapper = ({ children }: { children?: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children)
    expect(() => renderHook(() => useTeamClient(), { wrapper })).toThrow(/TeamClientProvider/)
  })

  it('useMe reads GET /me under [\'me\'] and a missing session is a TeamApiError 401, without retries', async () => {
    const { requests, client } = await counting('ana@x.org')
    const { qc, wrapper } = harness(client)
    const ok = renderHook(() => useMe(), { wrapper })
    await waitFor(() => expect(ok.result.current.data?.email).toBe('ana@x.org'))
    expect(qc.getQueryData(queryKeys.me())).toBeTruthy()
    expect(requests.filter((r) => r !== 'POST /auth/login')).toEqual(['GET /me'])

    const anon = harness(server.anonymous())
    const refused = renderHook(() => useMe(), { wrapper: anon.wrapper })
    await waitFor(() => expect(refused.result.current.isError).toBe(true))
    expect(refused.result.current.error).toBeInstanceOf(TeamApiError)
    expect((refused.result.current.error as TeamApiError).status).toBe(401)
  })
})

describe('edits', () => {
  it('usePatchMessage writes the saved answer into [\'message\', id] and the next edit uses its version without reading', async () => {
    const id = await publishedMessage(await server.as('ana@x.org'), 'por hook')
    const { client, requests } = await counting('ana@x.org')
    const { qc, wrapper } = harness(client)
    const detail = renderHook(() => useMessage(id), { wrapper })
    await waitFor(() => expect(detail.result.current.data?.id).toBe(id))
    const patch = renderHook(() => usePatchMessage(), { wrapper })
    requests.length = 0

    const first = await act(() => patch.result.current.mutateAsync({ id, patch: { title: 'uno' } }))
    const second = await act(() => patch.result.current.mutateAsync({ id, patch: { title: 'dos' } }))
    expect(qc.getQueryData<MessageDetail>(queryKeys.message(id))?.title).toBe('dos')
    // The first edit went out at once with the version in the cache; the second used the one the first left, so neither conflicted.
    expect(requests[0]).toBe('PATCH /messages/' + id)
    expect(second.version).toBe((first.version ?? 0) + 1)
    expect(requests.filter((r) => r.startsWith('PATCH'))).toHaveLength(2)
  })

  it('after another edit got in first, the hook retries once and leaves the fresh copy in the cache', async () => {
    const ana = await server.as('ana@x.org')
    const id = await publishedMessage(ana, 'conflicto por hook')
    const { client } = await counting('ana@x.org')
    const { qc, wrapper } = harness(client)
    const detail = renderHook(() => useMessage(id), { wrapper })
    await waitFor(() => expect(detail.result.current.data?.id).toBe(id))
    const staleVersion = detail.result.current.data!.version!
    await ana.messages.patch(id, { title: 'desde otra pestaña' })

    const patch = renderHook(() => usePatchMessage(), { wrapper })
    const saved = await act(() => patch.result.current.mutateAsync({ id, patch: { body: 'mi cambio' } }))
    expect(saved.version).toBe(staleVersion + 2)
    const cached = qc.getQueryData<MessageDetail>(queryKeys.message(id))!
    expect(cached.title).toBe('desde otra pestaña')
    expect(cached.body).toBe('mi cambio')
  })
})

describe('deletions refresh the lists', () => {
  it('delete and restore of a message change what useMessages shows, through the invalidation of [\'messages\']', async () => {
    const ana = await server.as('ana@x.org')
    const id = await publishedMessage(ana, 'lista viva')
    const { client } = await counting('ana@x.org')
    const { wrapper } = harness(client)
    const query = { filters: [], q: '' }
    const list = renderHook(() => useMessages({ query, meId: server.ids.ana }), { wrapper })
    await waitFor(() => expect(list.result.current.data?.some((m) => m.id === id)).toBe(true))
    const del = renderHook(() => useDeleteMessage(), { wrapper })
    await act(() => del.result.current.mutateAsync(id))
    await waitFor(() => expect(list.result.current.data?.some((m) => m.id === id)).toBe(false))
    const restore = renderHook(() => useRestoreMessage(), { wrapper })
    await act(() => restore.result.current.mutateAsync(id))
    await waitFor(() => expect(list.result.current.data?.some((m) => m.id === id)).toBe(true))
  })
})

describe('language', () => {
  it('is written into [\'me\'] before the server answers and goes back if the server refuses', async () => {
    const { client } = await counting('beto@x.org')
    const { qc, wrapper } = harness(client)
    const me = renderHook(() => useMe(), { wrapper })
    await waitFor(() => expect(me.result.current.data?.language).toBe('es-419'))
    const save = renderHook(() => useSaveLanguage(), { wrapper })

    act(() => void save.result.current.mutate('en'))
    await waitFor(() => expect(qc.getQueryData<{ language: string }>(queryKeys.me())?.language).toBe('en'))
    await waitFor(() => expect(save.result.current.isSuccess).toBe(true))
    expect((await client.me.get()).language).toBe('en')

    act(() => void save.result.current.mutate('klingon' as never))
    await waitFor(() => expect(save.result.current.isError).toBe(true))
    expect(qc.getQueryData<{ language: string }>(queryKeys.me())?.language).toBe('en')
  })
})

describe('the event stream in React', () => {
  it('a message of somebody else makes the lists stale; the progress lives in the store, not in the cache', async () => {
    const listeners = new Map<string, (e: MessageEvent) => void>()
    const source = {
      readyState: 1,
      close() {},
      addEventListener: (type: string, fn: (e: MessageEvent) => void) => void listeners.set(type, fn),
      onopen: null,
      onerror: null,
      onmessage: null,
    }
    const { client } = await counting('ana@x.org', { eventSource: () => source as never })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const marks: string[][] = []
    const original = qc.invalidateQueries.bind(qc)
    qc.invalidateQueries = ((filters: { queryKey?: readonly unknown[] }) => (marks.push([...(filters.queryKey ?? [])] as string[]), original(filters as never))) as typeof qc.invalidateQueries
    const wrapper = ({ children }: { children?: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, createElement(TeamClientProvider, { client }, createElement(EventsProvider, null, children)))
    const snap = renderHook(() => useEventsSnapshot(), { wrapper })

    act(() => listeners.get('message')?.({ data: JSON.stringify({ message_id: 'm9', title: 'Nuevo', author_id: '7' }) } as MessageEvent))
    expect(marks).toEqual([['messages'], ['areas']])
    expect(snap.result.current.unread).toBe(1)
    act(() => listeners.get('progress')?.({ data: JSON.stringify({ job_id: 'j1', percent: 30, phrase: 'x' }) } as MessageEvent))
    expect(snap.result.current.progress.j1.percent).toBe(30)
    expect(qc.getQueryCache().getAll()).toHaveLength(0)
  })
})
