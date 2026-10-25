// UD-282: «Reintentar» posts to the retry route of the notice.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import { EventsStore, type MessageDetail } from '@team-platform/client'
import { EventsProvider } from '@team-platform/client/react'
import { MemoryRouter } from 'react-router'
import { NoticeProvider } from '@/lib/notices'
import { UndoProvider, useUndoStack } from '@/lib/undo'
import { ReplyThread } from './ReplyThread'

beforeAll(() => {
  Object.assign(window, { matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }) })
  Object.assign(Element.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} })
})
afterEach(cleanup)

const posted: string[] = []
let gate: Promise<void> | null = null
let refuse = false
mockApi(async (path: string) => {
  if (path === '/messages/m1/replies/r9/retry') {
    posted.push(path)
    if (gate) await gate
    if (refuse) throw Object.assign(new Error('retry_stale'), { status: 409, code: 'retry_stale' })
    return { job_id: '7' }
  }
  if (path === '/me') return { id: '1', email: 'm@x.org', name: 'Martín', role: 'editor', language: 'es-419', active: true, provider: 'local' }
  if (path === '/members') return { items: [{ id: '1', name: 'Martín', email: 'm@x.org', role: 'editor', kind: 'person', active: true }, { id: '3', name: 'Claude', email: 'c@x.org', role: 'member', kind: 'agent', active: true }] }
  return { items: [] }
})

function Undo({ children }: { children: React.ReactNode }) {
  const stack = useUndoStack()
  return <UndoProvider stack={stack}>{children}</UndoProvider>
}
const thread = (retryable: boolean | undefined, status = 'open') =>
  ({
    id: 'm1', area_id: 'a1', author_id: '2', title: 't', body: 'b', status, created_at: '2026-10-24T12:00:00Z', updated_at: '2026-10-24T12:00:00Z', assignee_ids: ['1'], attachments: [], reply_count: 1,
    replies: [{ id: 'r9', message_id: 'm1', author_id: '3', body: 'Claude no pudo responder: se acabó el tiempo.', kind: 'answer', created_at: '2026-10-24T12:05:00Z', retryable }],
  }) as unknown as MessageDetail

const store = new EventsStore()
function Mount({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return (
    <QueryClientProvider client={client}>
      <WithTeamClient>
        <EventsProvider store={store} connect={false}>
          <I18nProvider language="es-419"><NoticeProvider><MemoryRouter><Undo>{children}</Undo></MemoryRouter></NoticeProvider></I18nProvider>
        </EventsProvider>
      </WithTeamClient>
    </QueryClientProvider>
  )
}

describe('Reintentar under the notice of a failed session (UD-282)', () => {
  it('posts to the retry route of that reply', async () => {
    render(<Mount><ReplyThread message={thread(true)} /></Mount>)
    fireEvent.click(await screen.findByTestId('retry-execute'))
    await waitFor(() => expect(posted).toEqual(['/messages/m1/replies/r9/retry']))
  })
  it('shows only when the server says the reply is retryable', async () => {
    render(<Mount><ReplyThread message={thread(true)} /></Mount>)
    expect((await screen.findByTestId('retry-execute')).textContent).toContain('Reintentar')
    cleanup()
    render(<Mount><ReplyThread message={thread(false)} /></Mount>)
    await screen.findByText(/no pudo responder/)
    expect(screen.queryByTestId('retry-execute')).toBeNull()
    cleanup()
    render(<Mount><ReplyThread message={thread(undefined)} /></Mount>)
    await screen.findByText(/no pudo responder/)
    expect(screen.queryByTestId('retry-execute')).toBeNull()
    cleanup()
    render(<Mount><ReplyThread message={thread(true, 'closed')} /></Mount>)
    await screen.findByText(/no pudo responder/)
    expect(screen.queryByTestId('retry-execute')).toBeNull()
  })
})

describe('a reply carries no label of its type (UD-289)', () => {
  const asked = (kind: string) =>
    ({
      id: 'm1', area_id: 'a1', author_id: '2', title: 't', body: 'b', status: 'open', created_at: '2026-10-24T12:00:00Z', updated_at: '2026-10-24T12:00:00Z', assignee_ids: ['1'], attachments: [], reply_count: 1,
      replies: [{ id: 'r9', message_id: 'm1', author_id: '3', body: 'Listo, ya está en producción.', kind, created_at: '2026-10-24T12:05:00Z' }],
    }) as unknown as MessageDetail
  it.each(['answer', 'fix', 'clarification'])('a reply of kind %s from an agent draws no badge', async (kind) => {
    render(<Mount><ReplyThread message={asked(kind)} /></Mount>)
    await screen.findByText('Listo, ya está en producción.')
    for (const label of ['Pregunta', 'Question', 'Solución', 'Aclaración', 'Respuesta']) expect(screen.queryByText(label)).toBeNull()
  })
  it('the catalogue has no label of a reply type', async () => {
    const { es419 } = await import('@/i18n/es-419')
    expect(Object.keys(es419).filter((k) => /^replies\.(question|kind|type|fix|answer|clarification)/.test(k))).toEqual([])
  })
})

describe('Reintentar answers at the click (UD-290)', () => {
  it('replaces the notice by «Reintentando» before the server answers', async () => {
    let open!: () => void
    gate = new Promise<void>((r) => { open = r })
    refuse = false
    render(<Mount><ReplyThread message={thread(true)} /></Mount>)
    fireEvent.click(await screen.findByTestId('retry-execute'))
    expect((await screen.findByTestId('retrying')).textContent).toContain('Reintentando')
    expect(screen.queryByText(/no pudo responder/)).toBeNull()
    expect(screen.queryByTestId('retry-execute')).toBeNull()
    open()
    gate = null
  })
  it('a reply the server already marks as retrying draws the state and no button', async () => {
    const m = thread(false) as unknown as { replies: Array<Record<string, unknown>> }
    Object.assign(m.replies[0], { replaced_by_job_id: '7', retrying: true })
    render(<Mount><ReplyThread message={m as unknown as MessageDetail} /></Mount>)
    expect((await screen.findByTestId('retrying')).textContent).toContain('Reintentando')
    expect(screen.queryByTestId('retry-execute')).toBeNull()
    act(() => store.progress({ job_id: '7', percent: 40, phrase: 'Leyendo el hilo' }))
    expect((await screen.findByTestId('retrying-phrase')).textContent).toBe('Leyendo el hilo')
  })
  it('a notice replaced by a retry that already ended is not drawn', async () => {
    const m = thread(false) as unknown as { replies: Array<Record<string, unknown>> }
    Object.assign(m.replies[0], { replaced_by_job_id: '7', retrying: false })
    render(<Mount><ReplyThread message={m as unknown as MessageDetail} /></Mount>)
    await screen.findByLabelText('Respuestas')
    expect(screen.queryByText(/no pudo responder/)).toBeNull()
    expect(screen.queryByTestId('retrying')).toBeNull()
  })
  it('when the server refuses, the notice comes back with the reason and the button', async () => {
    refuse = true
    gate = null
    render(<Mount><ReplyThread message={thread(true)} /></Mount>)
    fireEvent.click(await screen.findByTestId('retry-execute'))
    await screen.findByRole('alert')
    expect(screen.getByText(/no pudo responder/)).toBeTruthy()
    expect(screen.getByTestId('retry-execute')).toBeTruthy()
    expect(screen.queryByTestId('retrying')).toBeNull()
    refuse = false
  })
})
