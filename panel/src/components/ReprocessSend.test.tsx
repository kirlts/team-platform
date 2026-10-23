// UD-258: «Reprocesar» on a published send. Only the Editor has it; one click posts the reprocess with no step before, and the notice
// says how many messages were set aside with the way to «Borrados».
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import type { InputRecord } from '@team-platform/client'
import { ReprocessSend } from './ReprocessSend'

const shown = vi.fn()
vi.mock('@/lib/notices', () => ({ useNotices: () => ({ current: null, show: shown, dismiss: () => undefined }) }))

let role = 'editor'
const calls: string[] = []
mockApi(async (path: string, init?: { method?: string }) => {
  calls.push(`${init?.method ?? 'GET'} ${path}`)
  if (path === '/me') return { id: 'u1', name: 'Ana', email: 'ana@x.org', role, language: 'es-419' }
  if (path === '/inputs/i1/reprocess') return { input_id: 'i1', job_id: 'j1', set_aside: { messages: 3, replies: 2 } }
  return { items: [] }
})

afterEach(() => {
  cleanup()
  shown.mockClear()
  calls.length = 0
  role = 'editor'
})

const input = { id: 'i1', status: 'published', author_id: 'u2', message_ids: ['m1', 'm2', 'm3'] } as unknown as InputRecord

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WithTeamClient>
      <I18nProvider language="es-419">
        <ReprocessSend input={input} />
      </I18nProvider>
    </WithTeamClient>
    </QueryClientProvider>,
  )
}

describe('ReprocessSend', () => {
  it('posts the reprocess on one click and says how many messages were set aside, with the link to Borrados', async () => {
    wrap()
    fireEvent.click(await screen.findByRole('button', { name: 'Reprocesar' }))
    await waitFor(() => expect(shown).toHaveBeenCalled())
    expect(calls).toContain('POST /inputs/i1/reprocess')
    const notice = shown.mock.calls[0]![0]
    expect(notice.text).toBe('3 mensajes apartados')
    expect(notice.link.label).toBe('Borrados')
    expect(notice.link.to).toBe('/messages?f=deleted:eq:si')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is not there for a member', async () => {
    role = 'member'
    wrap()
    await waitFor(() => expect(calls).toContain('GET /me'))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('button', { name: 'Reprocesar' })).toBeNull()
  })
})
