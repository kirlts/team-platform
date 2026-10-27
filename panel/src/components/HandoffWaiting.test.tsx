// UD-269: a handoff to a person is a state that shows: one line, nothing to press, saying who the question waits for.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import type { MessageDetail } from '@team-platform/client'
import { HandoffWaiting } from './HandoffWaiting'

mockApi(async (path: string) => {
  if (path === '/members') return { items: [{ id: '2', name: 'Ana Prueba', email: 'a@x.org', role: 'member', kind: 'person', active: true }, { id: '3', name: 'Claude', email: 'c@x.org', role: 'member', kind: 'agent', active: true }] }
  return { items: [] }
})
afterEach(cleanup)

const message = (over: Partial<MessageDetail> = {}, kind = 'clarification', author = '3'): MessageDetail =>
  ({ id: 'm1', area_id: 'a1', author_id: '1', title: 'Resumen', body: '', status: 'open', assignee_ids: ['2'], attachments: [], replies: [{ id: 'r1', author_id: author, kind, body: 'Necesito una decisión' }], pending_delivery: null, ...over }) as unknown as MessageDetail

function mount(m: MessageDetail) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WithTeamClient>
        <I18nProvider language="es-419"><HandoffWaiting message={m} /></I18nProvider>
      </WithTeamClient>
    </QueryClientProvider>,
  )
}

describe('HandoffWaiting', () => {
  it('says who the question of the agent waits for, with nothing to press', async () => {
    const { container } = mount(message())
    expect((await screen.findByTestId('handoff-waiting')).textContent).toBe('Decide: Ana Prueba')
    expect(container.querySelectorAll('button, a, input, textarea')).toHaveLength(0)
  })

  it('draws nothing when the last reply is not a question of an agent, when the message is closed or when a held delivery has its own line', async () => {
    for (const m of [message({}, 'answer'), message({}, 'clarification', '2'), message({ status: 'closed' }), message({ pending_delivery: { branch: 'b', held_reason: 'x', job_id: '1', agent_id: '3', delivering_job_id: null, state: 'held' } })]) {
      const { container, unmount } = mount(m)
      await waitFor(() => expect(container.querySelector('[data-testid="handoff-waiting"]')).toBeNull())
      unmount()
    }
  })
})
