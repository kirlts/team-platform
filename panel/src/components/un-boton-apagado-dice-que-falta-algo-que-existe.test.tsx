// TP-06 (soft-locks 2026-11-04). A button that is off must say something that exists: «Enviar» went off for a missing required field, the message that
// lacked it was removed, and the button stayed off with «Falta 1 campo obligatorio» over nothing to fill. Every check is a prohibition.
// Fails on the tree before the change: `missingTotal` summed every entry of `missing`, including the one of the row that left.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { buildTemplate } from '@/lib/template'
import { UndoProvider, useUndoStack } from '@/lib/undo'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import { EventsStore, type InputRecord } from '@team-platform/client'
import { EventsProvider } from '@team-platform/client/react'
import { AnalysisPanel } from './AnalysisPanel'

beforeAll(() => {
  Object.assign(window, { matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }) })
  Object.assign(Element.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} })
})
afterEach(cleanup)

const body = buildTemplate({ name: 'Capacidad', description: 'd', fields: [{ name: 'must', label: 'Obligado', required: true }], instructions: 'x' })
mockApi(async (path: string, request: { method?: string; body?: unknown }) => {
  if (path === '/me') return { id: 'u1', email: 'ana@x.org', name: 'Ana', role: 'editor', language: 'es-419', active: true, provider: 'local' }
  if (path === '/members') return { items: [{ id: 'u1', name: 'Ana', email: 'ana@x.org', role: 'editor', kind: 'person', active: true }] }
  if (path === '/areas') return { items: [{ id: 'a1', title: 'Producto', description: '', color: '#854d0e', position: 1, guards: [] }] }
  if (path.endsWith('/templates')) return { items: [{ id: 't1', area_id: 'a1', name: 'Capacidad', description: '', body_markdown: body }] }
  if (request.method === 'PUT' || request.method === 'PATCH') return request.body
  return { items: [] }
})

const input = (): InputRecord =>
  ({
    id: 'i1', author_id: 'u1', text: 'dos cosas', status: 'proposed', created_at: '2026-11-04T10:00:00Z', attachments: [],
    proposal: {
      discarded: [],
      messages: [
        { area_id: 'a1', template_id: 't1', title: 'Primero', body: 'uno', fields: { must: 'listo' }, assignee_ids: [], attachment_ids: [], unit_ids: [] },
        { area_id: 'a1', template_id: 't1', title: 'Segundo', body: 'dos', fields: null, assignee_ids: [], attachment_ids: [], unit_ids: [] },
      ],
    },
  }) as InputRecord

function Screen() {
  const stack = useUndoStack()
  return (
    <UndoProvider stack={stack}>
      <AnalysisPanel input={input()} onClose={() => {}} />
    </UndoProvider>
  )
}

const store = new EventsStore()
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WithTeamClient>
        <EventsProvider store={store} connect={false}>
          <I18nProvider language="es-419">
            <MemoryRouter>
              <Screen />
            </MemoryRouter>
          </I18nProvider>
        </EventsProvider>
      </WithTeamClient>
    </QueryClientProvider>,
  )
}

describe('«Enviar» does not stay off for a field that no longer exists', () => {
  it('is off while the second message lacks its required field', async () => {
    mount()
    await waitFor(() => expect(screen.getByText(/Falta 1 campo obligatorio/)).toBeTruthy())
    expect((screen.getByTestId('proposal-send') as HTMLButtonElement).disabled).toBe(true)
  })

  it('is on again, and says nothing is missing, once the message that lacked it is removed', async () => {
    mount()
    await waitFor(() => expect(screen.getByText(/Falta 1 campo obligatorio/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Segundo/ })) // opens the second row
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar el mensaje Segundo' }))
    await waitFor(() => expect(screen.queryByText(/Falta 1 campo obligatorio/)).toBeNull())
    await waitFor(() => expect((screen.getByTestId('proposal-send') as HTMLButtonElement).disabled).toBe(false))
  })
})
