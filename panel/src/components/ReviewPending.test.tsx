// UD-275: «Revisión» in the sheet of a message. An Editor sees «Entregar» (primary, with a confirmation that says what happens), «Pedir cambios»
// (focus on the reply field) and «Descartar» (a reason is required); another member sees the block without buttons and who approves.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    pending_delivery: pending === null ? null : { branch: 'tp/1', held_reason: 'Toca datos de personas', job_id: '9', agent_id: '3', delivering_job_id: null, ...pending },
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

describe('the «Revisión» of a held change (UD-275)', () => {
  it('shows nothing when the message has no held delivery', () => {
    role = 'editor'
    render(<Mount><ReviewPending message={message(null)} /></Mount>)
    expect(screen.queryByTestId('review-pending')).toBeNull()
  })

  it('an Editor sees the reason in one line and the three actions, «Entregar» first and primary', async () => {
    role = 'editor'
    render(<Mount><ReviewPending message={message()} /></Mount>)
    expect(screen.getByTestId('review-reason').textContent).toBe('Toca datos de personas')
    await waitFor(() => expect(screen.getByTestId('review-deliver')).toBeTruthy())
    const labels = [...screen.getByTestId('review-pending').querySelectorAll('button')].map((b) => b.textContent)
    expect(labels).toEqual(['Entregar', 'Pedir cambios', 'Descartar'])
  })

  it('«Entregar» asks first, says what happens, and on «Entregar» queues the delivery and shows its progress', async () => {
    role = 'editor'
    calls.length = 0
    render(<Mount><ReviewPending message={message()} /></Mount>)
    fireEvent.click(await screen.findByTestId('review-deliver'))
    expect(await screen.findByText('Se publica en producción')).toBeTruthy()
    expect(calls).toEqual([])
    fireEvent.click(screen.getByTestId('review-confirm'))
    await waitFor(() => expect(calls).toEqual([{ path: '/messages/m1/deliver', body: undefined }]))
    await screen.findByTestId('review-progress')
    act(() => store.progress({ job_id: '77', percent: 50, phrase: 'Entrega: despliegue' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Entrega: despliegue'))
    expect(screen.queryByTestId('review-deliver')).toBeNull()
  })

  it('«Pedir cambios» takes the focus to the reply field and names who to address', async () => {
    role = 'editor'
    render(
      <Mount>
        <textarea id="reply-field" aria-label="Respuesta" />
        <ReviewPending message={message()} />
      </Mount>,
    )
    fireEvent.click(await screen.findByTestId('review-changes'))
    expect(document.activeElement?.id).toBe('reply-field')
    await waitFor(() => expect(screen.getByTestId('review-hint').textContent).toBe('Escribir los cambios abajo para Claude'))
  })

  it('«Descartar» needs a reason and sends it', async () => {
    role = 'editor'
    calls.length = 0
    render(<Mount><ReviewPending message={message()} /></Mount>)
    fireEvent.click(await screen.findByTestId('review-discard'))
    const confirm = (await screen.findByTestId('review-discard-confirm')) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(screen.getByText('Falta el motivo')).toBeTruthy()
    fireEvent.change(screen.getByTestId('review-discard-reason'), { target: { value: '  No va a la ficha.  ' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(calls).toEqual([{ path: '/messages/m1/discard-delivery', body: { reason: 'No va a la ficha.' } }]))
  })

  it('a member who is not an Editor sees the block without buttons and who approves', async () => {
    role = 'member'
    render(<Mount><ReviewPending message={message()} /></Mount>)
    await waitFor(() => expect(screen.getByTestId('review-approvers').textContent).toBe('Lo aprueba: Martín'))
    expect(screen.getByTestId('review-pending').querySelectorAll('button').length).toBe(0)
  })

  it('a delivery already running when the sheet opens shows its progress, not the buttons', async () => {
    role = 'editor'
    render(<Mount><ReviewPending message={message({ delivering_job_id: '88' })} /></Mount>)
    await screen.findByTestId('review-progress')
    expect(screen.queryByTestId('review-deliver')).toBeNull()
  })
})
