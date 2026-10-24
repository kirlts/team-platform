// UD-272: «Reenviar» opens a window of the kit with the member (every active one but the person who forwards, an agent included) and the reason,
// which is required; the button stays off and says what is missing. In the thread a forward is a notice, not a reply.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { NoticeProvider } from '@/lib/notices'
import { UndoProvider, useUndoStack } from '@/lib/undo'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import type { MessageDetail } from '@team-platform/client'
import { ForwardMessage } from './ForwardMessage'
import { ReplyThread } from './ReplyThread'

beforeAll(() => {
  Object.assign(window, { matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }) })
  Object.assign(Element.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} })
})
afterEach(cleanup)

const members = [
  { id: '1', name: 'Martín', email: 'm@x.org', role: 'editor', kind: 'person', active: true },
  { id: '2', name: 'Ana', email: 'ana@x.org', role: 'member', kind: 'person', active: true },
  { id: '3', name: 'Claude', email: 'claude@x.org', role: 'member', kind: 'agent', active: true },
  { id: '4', name: 'Baja', email: 'baja@x.org', role: 'member', kind: 'person', active: false },
]
const posted: { path: string; body: unknown }[] = []
const api = mockApi(async (path: string, request: { method?: string; body?: unknown }) => {
  if (path === '/me') return { id: '1', email: 'm@x.org', name: 'Martín', role: 'editor', language: 'es-419', active: true, provider: 'local' }
  if (path === '/areas') return { items: [{ id: 'a1', title: 'Error', description: '', color: '#854d0e', position: 1 }] }
  if (path === '/members') return { items: members }
  if (path === '/messages/m1/forward') { posted.push({ path, body: request.body }); return {} }
  return { items: [] }
})

function WithUndo({ children }: { children: React.ReactNode }) {
  const stack = useUndoStack()
  return <UndoProvider stack={stack}>{children}</UndoProvider>
}

function Mount({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return (
    <QueryClientProvider client={client}>
      <WithTeamClient>
        <I18nProvider language="es-419">
          <NoticeProvider>
            <MemoryRouter>
              <WithUndo>{children}</WithUndo>
            </MemoryRouter>
          </NoticeProvider>
        </I18nProvider>
      </WithTeamClient>
    </QueryClientProvider>
  )
}

describe('the window to forward a message (UD-272)', () => {
  it('lists every active member but the one who forwards, an agent included, and keeps the button off saying what is missing', async () => {
    render(<Mount><ForwardMessage messageId="m1" /></Mount>)
    fireEvent.click(screen.getByTestId('forward-open'))
    const select = await screen.findByTestId('forward-member')
    await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Elegir', 'Ana', 'Claude']))
    const submit = screen.getByTestId('forward-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('Faltan el miembro y el motivo')
    fireEvent.change(select, { target: { value: '3' } })
    expect(screen.getByRole('status').textContent).toBe('Falta el motivo')
    fireEvent.change(screen.getByTestId('forward-comment'), { target: { value: '   ' } })
    expect(submit.disabled).toBe(true)
    expect(submit.getAttribute('aria-describedby')).toBe(screen.getByRole('status').id)
    fireEvent.change(screen.getByTestId('forward-comment'), { target: { value: 'Investiga y recomiéndame.' } })
    expect(submit.disabled).toBe(false)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('without a member the button stays off with a reason written', async () => {
    render(<Mount><ForwardMessage messageId="m1" /></Mount>)
    fireEvent.click(screen.getByTestId('forward-open'))
    fireEvent.change(await screen.findByTestId('forward-comment'), { target: { value: 'Mira esto.' } })
    expect((screen.getByTestId('forward-submit') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('Falta el miembro')
  })

  it('sends the member and the trimmed reason, and closes', async () => {
    posted.length = 0
    render(<Mount><ForwardMessage messageId="m1" /></Mount>)
    fireEvent.click(screen.getByTestId('forward-open'))
    const select = await screen.findByTestId('forward-member')
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3))
    fireEvent.change(select, { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('forward-comment'), { target: { value: '  Investiga y recomiéndame.  ' } })
    fireEvent.click(screen.getByTestId('forward-submit'))
    await waitFor(() => expect(posted).toEqual([{ path: '/messages/m1/forward', body: { member_id: '3', comment: 'Investiga y recomiéndame.' } }]))
    await waitFor(() => expect(screen.queryByTestId('forward-member')).toBeNull())
    expect(api).toHaveBeenCalled()
  })
})

describe('a forward in the thread (UD-272)', () => {
  const message = (): MessageDetail =>
    ({
      id: 'm1', area_id: 'a1', author_id: '2', title: 't', body: 'b', status: 'open', created_at: '2026-10-24T12:00:00Z', updated_at: '2026-10-24T12:00:00Z', assignee_ids: ['1', '3'], attachments: [], reply_count: 2,
      replies: [
        { id: 'r1', message_id: 'm1', author_id: '3', body: 'Veo el error en la agenda.', kind: 'answer', created_at: '2026-10-24T12:05:00Z' },
        { id: 'r2', message_id: 'm1', author_id: '1', body: 'Investiga si el cobro duplica la cita.', kind: 'forward', forwarded_to: '3', created_at: '2026-10-24T12:10:00Z' },
      ],
    }) as unknown as MessageDetail
  it('draws a strip with «Reenviado a» the member and the reason under it, and not the card of a reply', async () => {
    render(<Mount><ReplyThread message={message()} /></Mount>)
    const strip = await screen.findByTestId('forward-notice')
    await waitFor(() => expect(strip.textContent).toContain('Reenviado a Claude'))
    expect(strip.textContent).toContain('por Martín')
    expect(strip.textContent).toContain('Investiga si el cobro duplica la cita.')
    expect(strip.className).not.toMatch(/reply-card/)
    expect(strip.className).toContain('bg-[var(--notice-bg)]')
    // The reply next to it keeps its card, and the strip has no controls of a reply (delete, edit).
    expect(within(strip).queryByRole('button')).toBeNull()
    expect(screen.getAllByRole('article').filter((a) => a.className.includes('reply-card'))).toHaveLength(1)
  })
})
