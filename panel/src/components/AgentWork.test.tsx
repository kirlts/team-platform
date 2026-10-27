// B7: the sheet of a message worked by an agent shows its work by stretch (machine, session, delivery) while it waits, runs or fails, and says what «Reintentar» repeats.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import { EventsStore, type MessageDetail } from '@team-platform/client'
import { EventsProvider } from '@team-platform/client/react'
import { AgentWork } from './AgentWork'

afterEach(cleanup)

const members = [
  { id: '1', name: 'Martín', email: 'm@x.org', role: 'editor', kind: 'person', active: true },
  { id: '3', name: 'Claude', email: 'claude@x.org', role: 'member', kind: 'agent', active: true },
]
const message = (over: Partial<MessageDetail> = {}, assignee = '3'): MessageDetail =>
  ({ id: 'm1', area_id: 'a1', author_id: '1', title: 'Cambio', body: '', status: 'open', created_at: '2026-10-24T10:00:00Z', assignee_ids: [assignee], attachments: [], reply_count: 0, replies: [], ...over }) as MessageDetail
const phase = (name: string, duration_ms: number, status = 'unset') => ({ name, duration_ms, offset_ms: null, status })
const timing = (over: Record<string, unknown>) => ({
  message_id: 'm1', job_id: '3', job_status: 'running', trace_id: null, phase: null, elapsed_ms: null, first_reply_ms: null, final_reply_ms: null, total_ms: null, queue_wait_ms: null, phases: [], slowest: [], tree: null, ...over,
})
let answer: () => unknown = () => timing({})
mockApi(async (path: string) => {
  if (path === '/members') return { items: members }
  if (path.endsWith('/timing')) return answer()
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
const steps = () => screen.getAllByRole('listitem').map((li) => `${li.getAttribute('data-work-step')}:${li.getAttribute('data-state')}`)

describe('the work of the agent in the sheet', () => {
  it('draws nothing when no agent works the message', async () => {
    answer = () => timing({})
    const { container } = render(<Mount><AgentWork message={message({}, '1')} /></Mount>)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('[data-testid="agent-work"]')).toBeNull()
  })

  it('a queued job says so', async () => {
    answer = () => timing({ job_status: 'queued' })
    render(<Mount><AgentWork message={message()} /></Mount>)
    expect((await screen.findByTestId('work-queued')).textContent).toContain('En cola')
  })

  it('a running job shows the stretch it is in, with its time, and the bar', async () => {
    answer = () => timing({ phase: 'run', elapsed_ms: 12000, phases: [phase('create', 95000)] })
    render(<Mount><AgentWork message={message()} /></Mount>)
    await screen.findByTestId('agent-work')
    expect(steps()).toEqual(['machine:done', 'session:running'])
    const [machine, session] = screen.getAllByRole('listitem')
    expect(within(machine!).getByText('1 min 35 s')).toBeTruthy()
    expect(within(session!).getByText('12 s')).toBeTruthy()
    expect(screen.getByRole('progressbar')).toBeTruthy()
  })

  it('a failed delivery says the work is not repeated and the delivery is', async () => {
    answer = () => timing({ job_status: 'done', phases: [phase('create', 1000), phase('run', 2000), phase('deliver', 900, 'error')], deliver: { job_id: '4', job_status: 'failed', phase: null, attempts: 1 } })
    const replies = [{ id: 'r1', retryable: true, retry_action: 'publish' }] as unknown as MessageDetail['replies']
    render(<Mount><AgentWork message={message({ replies })} /></Mount>)
    await screen.findByTestId('agent-work')
    expect(steps()).toEqual(['machine:done', 'session:done', 'deliver:failed'])
    expect(screen.getAllByRole('listitem').map((li) => li.querySelector('[data-work-repeats]')?.textContent)).toEqual(['No se repite', 'No se repite', 'Se repite'])
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('a failed session with a work retry repeats every stretch; without a retry it says nothing about repeating', async () => {
    answer = () => timing({ job_status: 'failed', phases: [phase('create', 1000), phase('run', 2000, 'error')] })
    const replies = [{ id: 'r1', retryable: true, retry_action: 'work' }] as unknown as MessageDetail['replies']
    const { unmount } = render(<Mount><AgentWork message={message({ replies })} /></Mount>)
    await screen.findByTestId('agent-work')
    expect(screen.getAllByRole('listitem').map((li) => li.querySelector('[data-work-repeats]')?.textContent)).toEqual(['Se repite', 'Se repite'])
    unmount()
    render(<Mount><AgentWork message={message()} /></Mount>)
    await waitFor(() => expect(screen.getByTestId('agent-work')).toBeTruthy())
    expect(document.querySelector('[data-work-repeats]')).toBeNull()
  })

  it('a finished job draws nothing: its stretches are in «Detalles»', async () => {
    answer = () => timing({ job_status: 'done', phases: [phase('create', 1000), phase('run', 2000)] })
    const { container } = render(<Mount><AgentWork message={message()} /></Mount>)
    await new Promise((r) => setTimeout(r, 20))
    expect(container.querySelector('[data-testid="agent-work"]')).toBeNull()
  })
})
