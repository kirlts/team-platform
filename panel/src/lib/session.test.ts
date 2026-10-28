import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamApiError, queryKeys } from '@team-platform/client'
import { client } from './client'
import { watchSession } from './session'

/** The server of a person whose session ends: `/me` answers while `open` is true, and every other call answers 401 `unauthenticated` from then on. */
function serverWith(state: { open: boolean; asked: string[] }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://panel.test').pathname.replace(/^\/api/, '')
    state.asked.push(path)
    const ended = !state.open && path !== '/auth/login'
    const body = ended || path === '/auth/login' ? { code: 'unauthenticated', message: 'Se requiere iniciar sesión.' } : path === '/me' ? { id: 'ana' } : { items: [] }
    return new Response(JSON.stringify(body), { status: ended || path === '/auth/login' ? 401 : 200, headers: { 'Content-Type': 'application/json' } })
  })
}

/** The cache of the panel with «me» loaded through the real client, as the app holds it. */
async function openSession() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await queryClient.fetchQuery({ queryKey: queryKeys.me(), queryFn: () => client.me.get(), staleTime: 60_000 })
  return queryClient
}

afterEach(() => vi.unstubAllGlobals())

describe('the end of the session (E1, I2)', () => {
  it('a 401 from any other call makes «me» ask again and, answered 401, leaves it failed: the app draws the entry', async () => {
    const state = { open: true, asked: [] as string[] }
    vi.stubGlobal('fetch', serverWith(state))
    const queryClient = await openSession()
    const stop = watchSession(queryClient)
    try {
      state.open = false
      state.asked.length = 0
      await expect(client.members.list()).rejects.toBeInstanceOf(TeamApiError)
      await vi.waitFor(() => expect(queryClient.getQueryState(queryKeys.me())?.status).toBe('error'))
      expect(state.asked).toContain('/me')
      const error = queryClient.getQueryState(queryKeys.me())?.error
      expect(error instanceof TeamApiError && error.status).toBe(401)
    } finally {
      stop()
    }
  })

  it('does it for a change as well, not only for a read', async () => {
    const state = { open: true, asked: [] as string[] }
    vi.stubGlobal('fetch', serverWith(state))
    const queryClient = await openSession()
    const stop = watchSession(queryClient)
    try {
      state.open = false
      await expect(client.inputs.cancel('x')).rejects.toBeInstanceOf(TeamApiError)
      await vi.waitFor(() => expect(queryClient.getQueryState(queryKeys.me())?.status).toBe('error'))
    } finally {
      stop()
    }
  })

  it('does not touch «me» while the session is open', async () => {
    const state = { open: true, asked: [] as string[] }
    vi.stubGlobal('fetch', serverWith(state))
    const queryClient = await openSession()
    const stop = watchSession(queryClient)
    try {
      state.asked.length = 0
      await client.members.list()
      expect(state.asked).toEqual(['/members'])
      expect(queryClient.getQueryState(queryKeys.me())?.status).toBe('success')
    } finally {
      stop()
    }
  })

  it('a wrong password at the entry (401 on «login») does not ask «me» again: the form keeps what was typed', async () => {
    const state = { open: false, asked: [] as string[] }
    vi.stubGlobal('fetch', serverWith(state))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await queryClient.fetchQuery({ queryKey: queryKeys.me(), queryFn: () => client.me.get() }).catch(() => undefined)
    const stop = watchSession(queryClient)
    try {
      state.asked.length = 0
      await expect(client.auth.login({ email: 'a@b.cl', password: 'mala' })).rejects.toBeInstanceOf(TeamApiError)
      expect(state.asked).toEqual(['/auth/login'])
      expect(queryClient.getQueryState(queryKeys.me())?.status).toBe('error')
    } finally {
      stop()
    }
  })
})

describe('what the entry keeps across an ended session belongs to the person it was of', () => {
  it('a draft comes back only to its member, survives another person signing in and goes with the sign-out of its author', async () => {
    const { loadDraftText, saveDraftText, clearDrafts } = await import('./session')
    sessionStorage.clear()
    saveDraftText('texto de Bruno', 'bruno')
    expect(loadDraftText('carla')).toBe('')
    saveDraftText('texto de Carla', 'carla')
    expect(loadDraftText('bruno')).toBe('texto de Bruno')
    clearDrafts('carla')
    expect(loadDraftText('carla')).toBe('')
    expect(loadDraftText('bruno')).toBe('texto de Bruno')
    expect(loadDraftText(undefined)).toBe('')
  })

  it('a change that was on its way is told once, to its own person, with the files that were lost', async () => {
    const { noteStatus, watchSession: watch, settleEndedSession, takeLostAction, noteLostFiles } = await import('./session')
    sessionStorage.clear()
    const state = { open: true, asked: [] as string[] }
    vi.stubGlobal('fetch', serverWith(state))
    const queryClient = await openSession()
    const stop = watch(queryClient)
    try {
      state.open = false
      noteLostFiles(2)
      noteStatus('/inputs', 401, 'POST')
      await vi.waitFor(() => expect(queryClient.getQueryState(queryKeys.me())?.status).toBe('error'))
      settleEndedSession()
      expect(takeLostAction('ana')).toEqual({ files: 2 })
      expect(takeLostAction('ana')).toBeNull() // read once
      noteStatus('/inputs', 401, 'POST')
      settleEndedSession()
      expect(takeLostAction('otra')).toBeNull() // another person does not read it
    } finally {
      stop()
    }
  })
})
