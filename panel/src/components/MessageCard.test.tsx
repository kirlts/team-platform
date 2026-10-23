// UD-241: the extract of a row is one line ended with an ellipsis, with the whole text as its tooltip; the text block and the
// thumbnail column are in every row, with or without media, so every row measures the same.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import type { Message } from '@team-platform/client'
import { MessageCard } from './MessageCard'

mockApi(async (path: string) => {
  if (path === '/me') return { id: 'u1', email: 'ana@x.org', name: 'Ana', role: 'member', language: 'es-419', active: true, provider: 'local' }
  if (path === '/areas') return { items: [{ id: 'a1', title: 'Error', description: '', color: '#854d0e', position: 1 }] }
  if (path === '/members') return { items: [{ id: 'u1', name: 'Ana', email: 'ana@x.org', role: 'member', active: true }] }
  return { items: [] }
})

afterEach(cleanup)

const LONG = 'Párrafo largo del mensaje que en la lista no cabe en una sola línea y por eso termina con puntos suspensivos. '.repeat(4).trim()

const message = (over: Partial<Message> = {}): Message =>
  ({
    id: 'm1',
    area_id: 'a1',
    author_id: 'u1',
    title: 'Corregir el contraste del botón Enviar',
    body: LONG,
    status: 'open',
    created_at: '2026-10-21T12:00:00Z',
    updated_at: '2026-10-21T12:00:00Z',
    assignee_ids: [],
    attachments: [],
    reply_count: 0,
    ...over,
  }) as Message

function mount(m: Message, variant: 'message' | 'reply' = 'message') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WithTeamClient>
      <I18nProvider language="es-419">
        <MemoryRouter>
          <MessageCard message={m} variant={variant} />
        </MemoryRouter>
      </I18nProvider>
    </WithTeamClient>
    </QueryClientProvider>,
  )
}

describe('the extract of a row (UD-241)', () => {
  it('is one line ended with an ellipsis and carries the whole text as its tooltip', () => {
    mount(message())
    const extract = screen.getByTestId('card-extract')
    // `truncate` is `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` in Tailwind: the one cut the interface allows, declared for the detectors.
    expect(extract.className.split(/\s+/)).toContain('truncate')
    expect(extract.getAttribute('title')).toBe(LONG)
    expect(extract.getAttribute('data-ellipsis-ok')).toBe('UD-241')
    expect(extract.textContent).toBe(LONG)
  })

  it('in the reply row names the message it answers, whole, in the tooltip', () => {
    const m = message({ reply_count: 1, last_reply: { id: 'r1', message_id: 'm1', author_id: 'u1', kind: 'answer', body: 'Hecho.', created_at: '2026-10-21T12:30:00Z', attachments: [] } as unknown as Message['last_reply'] })
    mount(m, 'reply')
    const extract = screen.getByTestId('card-extract')
    expect(extract.getAttribute('title')).toContain(m.title)
    expect(extract.className.split(/\s+/)).toContain('truncate')
  })
})

describe('the grid of a row (UD-241)', () => {
  it('draws the text block and the thumbnail column with or without media', () => {
    mount(message())
    expect(screen.getByTestId('card-text').className.split(/\s+/)).toContain('min-h-card-text')
    const thumb = screen.getByTestId('card-thumb')
    expect(thumb.className.split(/\s+/)).toContain('size-10')
    expect(thumb.querySelector('button')).toBeNull()
  })
})
