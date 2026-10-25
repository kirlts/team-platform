// UD-275 amended by UD-280: while a change waits for review the sheet shows one line of state and no actions; the review is a reply that mentions Claude.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import { EventsStore, type MessageDetail } from '@team-platform/client'
import { EventsProvider } from '@team-platform/client/react'
import { ReviewPending } from './ReviewPending'

beforeAll(() => {
  Object.assign(window, { matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }) })
  Object.assign(Element.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} })
})
afterEach(cleanup)

const members = [
  { id: '1', name: 'Martín', email: 'm@x.org', role: 'editor', kind: 'person', active: true },
  { id: '2', name: 'Ana', email: 'ana@x.org', role: 'member', kind: 'person', active: true },
  { id: '3', name: 'Claude', email: 'claude@x.org', role: 'member', kind: 'agent', active: true },
]
const message = (pending: Partial<NonNullable<MessageDetail['pending_delivery']>> | null = {}): MessageDetail =>
  ({
    id: 'm1', area_id: 'a1', author_id: '2', title: 'Fotos', body: '', status: 'open', created_at: '2026-10-24T10:00:00Z', assignee_ids: ['1'], attachments: [], reply_count: 0, replies: [],
    pending_delivery: pending === null ? null : { branch: 'tp/1', held_reason: 'Toca datos de personas', job_id: '9', agent_id: '3', delivering_job_id: null, state: 'held', ...pending },
  }) as MessageDetail

let role: 'editor' | 'member' = 'editor'
const calls: { path: string; body: unknown }[] = []
mockApi(async (path: string, request: { method?: string; body?: unknown }) => {
  if (path === '/me') return role === 'editor' ? { id: '1', email: 'm@x.org', name: 'Martín', role: 'editor', language: 'es-419', active: true, provider: 'local' } : { id: '2', email: 'ana@x.org', name: 'Ana', role: 'member', language: 'es-419', active: true, provider: 'local' }
  if (path === '/members') return { items: members }
  if (path === '/areas') return { items: [] }
  if (request.method === 'POST') { calls.push({ path, body: request.body }); return path.endsWith('/deliver') ? { job_id: '77' } : { reply_id: '5' } }
  return { items: [] }
})

const store = new EventsStore()
function Mount({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return (
    <QueryClientProvider client={client}>
      <WithTeamClient>
        <EventsProvider store={store} connect={false}>
          <I18nProvider language="es-419">
            <MemoryRouter>{children}</MemoryRouter>
          </I18nProvider>
        </EventsProvider>
      </WithTeamClient>
    </QueryClientProvider>
  )
}

describe('the line «Cambio listo para revisar» (UD-275, UD-280)', () => {
  it('UD-287: the line comes from the real state of the delivery', () => {
    role = 'editor'
    render(<Mount><ReviewPending message={message({ state: 'failed' })} /></Mount>)
    expect(screen.getByTestId('review-reason').textContent).toBe('La entrega falló')
    expect(screen.queryByText('Cambio listo para revisar')).toBeNull()
    cleanup()
    render(<Mount><ReviewPending message={message({ state: 'held' })} /></Mount>)
    expect(screen.getByTestId('review-reason').textContent).toBe('Cambio listo para revisar')
  })
  it('shows nothing when the message has no held delivery', () => {
    role = 'editor'
    render(<Mount><ReviewPending message={message(null)} /></Mount>)
    expect(screen.queryByTestId('review-pending')).toBeNull()
  })

  for (const who of ['editor', 'member'] as const) {
    it(`a ${who} sees one short line and no buttons or links`, async () => {
      role = who
      calls.length = 0
      render(<Mount><ReviewPending message={message()} /></Mount>)
      const block = await screen.findByTestId('review-pending')
      expect(screen.getByTestId('review-reason').textContent).toBe('Cambio listo para revisar')
      expect(block.querySelectorAll('button, a, input, textarea').length).toBe(0)
      expect(block.textContent).toBe('Cambio listo para revisar')
      expect(calls).toEqual([])
    })
  }

  it('a delivery approved by a reply shows its progress, still without actions', async () => {
    role = 'editor'
    render(<Mount><ReviewPending message={message({ delivering_job_id: '88' })} /></Mount>)
    await screen.findByTestId('review-progress')
    act(() => store.progress({ job_id: '88', percent: 50, phrase: 'Entrega: despliegue' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Entrega: despliegue'))
    expect(screen.getByTestId('review-pending').querySelectorAll('button').length).toBe(0)
  })
})
