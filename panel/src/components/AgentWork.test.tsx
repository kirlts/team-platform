// B7: the sheet of a message worked by an agent shows its work by stretch (machine, session, delivery) while it waits, runs or fails, and says what «Reintentar» repeats.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
const posted: string[] = []
mockApi(async (path: string, request: { method?: string }) => {
  if (request.method === 'POST') { posted.push(path); return { job_id: '9' } }
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

  it('a queued job says so in its first stretch, and shows the ones that follow as pending', async () => {
    answer = () => timing({ job_status: 'queued', machine: true, delivers: true })
    render(<Mount><AgentWork message={message()} /></Mount>)
    await screen.findByTestId('agent-work')
    expect(steps()).toEqual(['machine:pending', 'session:pending', 'deliver:pending'])
    const [machine, session, deliver] = screen.getAllByRole('listitem')
    expect(within(machine!).getByText('En cola')).toBeTruthy()
    // UD-041: a stretch that has not started carries no word, only its mark and its muted name.
    expect(session!.textContent).toBe('Sesión')
    expect(deliver!.textContent).toBe('Entrega')
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

  it('the bar goes under the stretch that runs, with a height of its own', async () => {
    answer = () => timing({ phase: 'create', elapsed_ms: 38000 })
    render(<Mount><AgentWork message={message()} /></Mount>)
    await screen.findByTestId('agent-work')
    const [machine, session] = screen.getAllByRole('listitem')
    expect(within(machine!).getByRole('progressbar').className).toContain('h-2.5')
    expect(within(session!).queryByRole('progressbar')).toBeNull()
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
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

  it('a failed stretch says «Falló» besides its mark, and what the retry does goes under the name: the time column holds still', async () => {
    answer = () => timing({ job_status: 'failed', phases: [phase('create', 1000), phase('run', 2000, 'error')] })
    const replies = [{ id: 'r1', retryable: true, retry_action: 'work' }] as unknown as MessageDetail['replies']
    render(<Mount><AgentWork message={message({ replies })} /></Mount>)
    await screen.findByTestId('agent-work')
    const [machine, session] = screen.getAllByRole('listitem')
    expect(within(session!).getByText('Falló')).toBeTruthy()
    // mark and word say it; the name keeps its own color
    expect(within(session!).getByText('Sesión').className).not.toContain('text-danger')
    expect(within(machine!).queryByText('Falló')).toBeNull()
    // the retry repeats everything: no row says so, the button does; the time is the last cell of the first line whatever the row adds under its name
    expect(document.querySelector('[data-work-repeats]')).toBeNull()
    expect(machine!.children).toHaveLength(3)
    for (const li of [machine!, session!]) expect(li.children[2]!.textContent).toMatch(/\d+ s/)
  })

  it('a retry that leaves some stretch as it is says what each row does, and the time column holds still', async () => {
    answer = () => timing({ job_status: 'done', phases: [phase('create', 1000), phase('run', 2000), phase('deliver', 900, 'error')], deliver: { job_id: '4', job_status: 'failed', phase: null, attempts: 1 } })
    const replies = [{ id: 'r1', retryable: true, retry_action: 'publish' }] as unknown as MessageDetail['replies']
    render(<Mount><AgentWork message={message({ replies })} /></Mount>)
    await screen.findByTestId('agent-work')
    for (const li of screen.getAllByRole('listitem')) {
      expect(li.children[2]!.textContent).toMatch(/\d+ m?s/)
      expect(li.children[3]!.querySelector('[data-work-repeats]')).not.toBeNull()
    }
  })

  it('the button of the thread is also in the panel for a phone, and it retries the same notice', async () => {
    answer = () => timing({ job_status: 'done', phases: [phase('create', 1000), phase('run', 2000), phase('deliver', 900, 'error')], deliver: { job_id: '4', job_status: 'failed', phase: null, attempts: 1 } })
    const replies = [{ id: 'r1', retryable: true, retry_action: 'publish' }] as unknown as MessageDetail['replies']
    render(<Mount><AgentWork message={message({ replies })} /></Mount>)
    const button = await screen.findByTestId('work-retry')
    expect(button.textContent).toContain('Reintentar publicación')
    expect(button.closest('div')!.className).toContain('md:hidden')
    fireEvent.click(button)
    await waitFor(() => expect(posted).toEqual(['/messages/m1/replies/r1/retry']))
  })

  it('without a retry no row says anything about repeating', async () => {
    answer = () => timing({ job_status: 'failed', phases: [phase('create', 1000), phase('run', 2000, 'error')] })
    const replies = [{ id: 'r1', retryable: true, retry_action: 'work' }] as unknown as MessageDetail['replies']
    const { unmount } = render(<Mount><AgentWork message={message({ replies })} /></Mount>)
    await screen.findByTestId('agent-work')
    expect(await screen.findByTestId('work-retry')).toBeTruthy()
    expect(screen.getByTestId('work-retry').textContent).toContain('Reintentar trabajo')
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
