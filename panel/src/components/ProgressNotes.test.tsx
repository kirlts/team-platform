// UD-293: the progress notices of Claude are quiet rows of the thread, placed by time between the replies. They are not replies: they do not count in the
// badge, they do not make a short thread fold, and they stay when the final answer arrives.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
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

mockApi(async (path: string) => {
  if (path === '/me') return { id: '1', email: 'm@x.org', name: 'Martín', role: 'editor', language: 'es-419', active: true, provider: 'local' }
  if (path === '/members') return { items: [{ id: '1', name: 'Martín', email: 'm@x.org', role: 'editor', kind: 'person', active: true }, { id: '3', name: 'Claude', email: 'c@x.org', role: 'member', kind: 'agent', active: true }] }
  return { items: [] }
})

function Undo({ children }: { children: React.ReactNode }) {
  const stack = useUndoStack()
  return <UndoProvider stack={stack}>{children}</UndoProvider>
}
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

const reply = (id: string, at: string, body: string) => ({ id, message_id: 'm1', author_id: '3', body, kind: 'answer', created_at: at })
const note = (id: string, at: string, body: string) => ({ id, message_id: 'm1', job_id: '7', author_id: '3', body, minutes: 20, created_at: at })
const thread = (replies: unknown[], notes: unknown[]) =>
  ({
    id: 'm1', area_id: 'a1', author_id: '2', title: 't', body: 'b', status: 'answered', created_at: '2026-10-25T12:00:00Z', updated_at: '2026-10-25T12:00:00Z', assignee_ids: ['3'], attachments: [], reply_count: replies.length,
    replies, progress_notes: notes,
  }) as unknown as MessageDetail

const order = () => [...document.querySelectorAll('ol.thread > li')].map((li) => (li.getAttribute('data-testid') === 'progress-note' ? 'nota' : 'respuesta'))

describe('progress notices in the thread (UD-293)', () => {
  it('draws each notice as a quiet row, by time, between the first reply and the final answer', async () => {
    const m = thread(
      [reply('r1', '2026-10-25T12:00:30Z', 'Recibido. Empiezo ahora.'), reply('r2', '2026-10-25T12:50:00Z', 'Listo, en producción.')],
      [note('n1', '2026-10-25T12:20:00Z', '20 min · 14 turnos · 37 herramientas\nAhora: Orden: Pruebas de la pantalla\nÚltimo commit empujado: a1b2c3d Arregla la agenda'), note('n2', '2026-10-25T12:40:00Z', '40 min · 30 turnos · 80 herramientas')],
    )
    render(<Mount><ReplyThread message={m} /></Mount>)
    await screen.findByText('Listo, en producción.')
    expect(order()).toEqual(['respuesta', 'nota', 'nota', 'respuesta'])
    const first = screen.getAllByTestId('progress-note')[0]!
    expect(first.textContent).toContain('20 min · 14 turnos · 37 herramientas')
    expect(first.textContent).toContain('Ahora: Orden: Pruebas de la pantalla')
    expect(first.textContent).toContain('Último commit empujado: a1b2c3d Arregla la agenda')
    expect(first.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-25T12:20:00Z')
    expect(first.querySelector('button')).toBeNull() // a notice has no control: it is read, not operated
  })

  it('does not count in the badge of replies and keeps a short thread unfolded', async () => {
    const replies = [reply('r1', '2026-10-25T12:00:00Z', 'uno'), reply('r2', '2026-10-25T12:30:00Z', 'dos')]
    const notes = ['12:05', '12:10', '12:15', '12:20', '12:25'].map((h, i) => note(`n${i}`, `2026-10-25T${h}:00Z`, `${(i + 1) * 5} min · 1 turno · 1 herramienta`))
    render(<Mount><ReplyThread message={thread(replies, notes)} /></Mount>)
    await screen.findByText('dos')
    expect(screen.getAllByTestId('progress-note')).toHaveLength(5)
    expect(screen.queryByText(/respuestas? más/)).toBeNull()
    expect(screen.getByRole('region', { name: 'Respuestas' }).querySelector('h2 + span')?.textContent).toBe('2')
  })

  it('a thread with no notices draws as before', async () => {
    render(<Mount><ReplyThread message={thread([reply('r1', '2026-10-25T12:00:00Z', 'uno')], [])} /></Mount>)
    await screen.findByText('uno')
    expect(screen.queryByTestId('progress-note')).toBeNull()
  })
})
