// UD-300: a message is not sent to whoever writes it. The «Para» control of the new message bar and the assignee control of a message never offer its author,
// and when the author changes (SendAs) the new author leaves «Para».
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { NoticeProvider } from '@/lib/notices'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import { ComposeBar } from './ComposeBar'
import { RecipientsEditor } from './RecipientsEditor'

beforeAll(() => {
  Object.assign(window, { matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }) })
  Object.assign(window, { ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } })
  Object.assign(Element.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} })
})
afterEach(cleanup)

const members = [
  { id: '1', name: 'Martín', email: 'm@x.org', role: 'editor', kind: 'person', active: true },
  { id: '2', name: 'Ana', email: 'ana@x.org', role: 'member', kind: 'person', active: true },
  { id: '3', name: 'Claude', email: 'claude@x.org', role: 'member', kind: 'agent', active: true },
]
const api = mockApi(async (path: string) => {
  if (path === '/me') return { id: '1', email: 'm@x.org', name: 'Martín', role: 'editor', language: 'es-419', active: true, provider: 'local' }
  if (path === '/members') return { items: members }
  return { items: [] }
})

function Mount({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return (
    <QueryClientProvider client={client}>
      <WithTeamClient>
        <I18nProvider language="es-419">
          <NoticeProvider>
            <MemoryRouter>{children}</MemoryRouter>
          </NoticeProvider>
        </I18nProvider>
      </WithTeamClient>
    </QueryClientProvider>
  )
}

/** The names the open picker offers, once the members have loaded. */
async function offered() {
  const list = await waitFor(() => {
    const found = document.querySelector('[data-lane="member-picker"]') as HTMLElement | null
    if (!found || within(found).queryAllByRole('menuitemcheckbox').length === 0) throw new Error('members not loaded')
    return found
  })
  return within(list).getAllByRole('menuitemcheckbox').map((x) => x.querySelector('span.flex-1')?.textContent)
}

describe('a message is not sent to whoever writes it (UD-300)', () => {
  it('«Para» of the new message bar offers every active member but the one who writes', async () => {
    render(<Mount><ComposeBar onSubmit={() => {}} /></Mount>)
    await screen.findByTestId('compose-to')
    fireEvent.click(within(screen.getByTestId('compose-to')).getByRole('button'))
    expect(await offered()).toEqual(['Ana', 'Claude'])
  })

  it('the assignee control of a message does not offer its author, and keeps the others', async () => {
    render(<Mount><RecipientsEditor ids={[]} onChange={() => {}} authorId="2" /></Mount>)
    fireEvent.click(await screen.findByRole('button', { name: /./ }))
    expect(await offered()).toEqual(['Martín', 'Claude'])
  })

  it('without an author every member is offered (a control that is not about a message)', async () => {
    render(<Mount><RecipientsEditor ids={[]} onChange={() => {}} /></Mount>)
    fireEvent.click(await screen.findByRole('button', { name: /./ }))
    expect(await offered()).toEqual(['Martín', 'Ana', 'Claude'])
  })
})
