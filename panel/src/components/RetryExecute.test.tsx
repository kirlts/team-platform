// UD-282: «Reintentar» posts to the retry route of the notice.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import type { MessageDetail } from '@team-platform/client'
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
mockApi(async (path: string) => {
  if (path === '/messages/m1/replies/r9/retry') {
    posted.push(path)
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

function Mount({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return (
    <QueryClientProvider client={client}>
      <WithTeamClient>
        <I18nProvider language="es-419"><NoticeProvider><MemoryRouter><Undo>{children}</Undo></MemoryRouter></NoticeProvider></I18nProvider>
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
