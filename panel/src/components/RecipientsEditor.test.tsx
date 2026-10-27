// UD-300: a message is not sent to whoever writes it. The «Para» control of the new message bar and the assignee control of a message never offer its author,
// and when the author changes (SendAs) the new author leaves «Para».
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
const defaultApi = async (path: string) => {
  if (path === '/me') return { id: '1', email: 'm@x.org', name: 'Martín', role: 'editor', language: 'es-419', active: true, provider: 'local' }
  if (path === '/members') return { items: members }
  return { items: [] }
}
mockApi(defaultApi)
beforeEach(() => mockApi(defaultApi))

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
    if (!found || within(found).queryAllByRole('option').length === 0) throw new Error('members not loaded')
    return found
  })
  return within(list).getAllByRole('option').map((x) => x.querySelector('span.flex-1')?.textContent)
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

describe('the picker of «Para» is a listbox with the keyboard of one', () => {
  it('has no menu roles, its search uses the muted marker token, and the arrows move the focus between the field and the rows', async () => {
    render(<Mount><RecipientsEditor ids={[]} onChange={() => {}} /></Mount>)
    fireEvent.click(await screen.findByRole('button', { name: /./ }))
    await offered()
    const search = document.querySelector('input[type=search]') as HTMLInputElement
    expect(search.className).toContain('placeholder:text-faint')
    expect(screen.queryAllByRole('menuitemcheckbox')).toHaveLength(0)
    const listbox = screen.getByRole('listbox')
    expect(listbox.getAttribute('aria-multiselectable')).toBe('true')
    const rows = within(listbox).getAllByRole('option')
    search.focus()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
    fireEvent.keyDown(rows[1]!, { key: 'End' })
    expect(document.activeElement).toBe(rows.at(-1))
    fireEvent.keyDown(rows.at(-1)!, { key: 'Home' })
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(rows[0]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(search)
  })

  it('a row says it is chosen with aria-selected', async () => {
    function Holder() {
      const [ids, setIds] = useState<string[]>([])
      return <RecipientsEditor ids={ids} onChange={setIds} max={3} />
    }
    render(<Mount><Holder /></Mount>)
    fireEvent.click(await screen.findByRole('button', { name: /./ }))
    await offered()
    const ana = within(screen.getByRole('listbox')).getByRole('option', { name: /Ana/ })
    expect(ana.getAttribute('aria-selected')).toBe('false')
    fireEvent.click(ana)
    expect(ana.getAttribute('aria-selected')).toBe('true')
  })

  it('past the row the fold reads as a control: a bordered «+N» with an arrow', async () => {
    render(<Mount><RecipientsEditor ids={['1', '2', '3']} onChange={() => {}} max={1} /></Mount>)
    const fold = await screen.findByRole('button', { name: 'Destinatarios: 2 más' })
    expect(fold.textContent).toContain('+2')
    expect(fold.className).toContain('border')
    expect(fold.querySelector('svg')).not.toBeNull()
  })
})

describe('changing «Enviar como» to someone in «Para» says so under the controls and offers the way back', () => {
  it('names the member in a status line next to the control, and Deshacer restores both fields', async () => {
    render(<Mount><ComposeBar onSubmit={() => {}} /></Mount>)
    const to = await screen.findByTestId('compose-to')
    fireEvent.click(within(to).getByRole('button'))
    await offered()
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Ana/ }))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(within(to).getByRole('button', { name: 'Quitar a Ana' })).toBeTruthy())
    const select = screen.getByTestId('compose-send-as') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '2' } })
    const line = await screen.findByTestId('compose-left-to')
    expect(line.textContent).toContain('Ana sale de Para')
    // It sits in the row of the control that caused it, never floating over another one.
    expect(line.parentElement?.contains(select)).toBe(true)
    expect(within(to).queryByRole('button', { name: 'Quitar a Ana' })).toBeNull()
    fireEvent.click(within(line).getByRole('button', { name: 'Deshacer' }))
    await waitFor(() => expect(within(to).getByRole('button', { name: 'Quitar a Ana' })).toBeTruthy())
    expect(select.value).toBe('1')
    expect(screen.queryByTestId('compose-left-to')).toBeNull()
  })

  it('leaves with the next thing the person does', async () => {
    render(<Mount><ComposeBar onSubmit={() => {}} /></Mount>)
    const to = await screen.findByTestId('compose-to')
    fireEvent.click(within(to).getByRole('button'))
    await offered()
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Ana/ }))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(within(to).getByRole('button', { name: 'Quitar a Ana' })).toBeTruthy())
    fireEvent.change(screen.getByTestId('compose-send-as'), { target: { value: '2' } })
    await screen.findByTestId('compose-left-to')
    fireEvent.change(screen.getByTestId('compose-text'), { target: { value: 'hola' } })
    expect(screen.queryByTestId('compose-left-to')).toBeNull()
  })
})

describe('chips of «Para» say the first name, and the whole one when another member shares it', () => {
  it('Ana and Ana María are told apart', async () => {
    mockApi(async (path: string) => {
      if (path === '/me') return { id: '1', email: 'm@x.org', name: 'Martín', role: 'editor', language: 'es-419', active: true, provider: 'local' }
      if (path === '/members') return { items: [...members, { id: '4', name: 'Ana Sofía Rojas', email: 'as@x.org', role: 'member', kind: 'person', active: true }] }
      return { items: [] }
    })
    render(<Mount><RecipientsEditor ids={['2', '4', '3']} onChange={() => {}} max={3} to="Para" /></Mount>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Quitar a Ana Sofía Rojas' })).toBeTruthy())
    const chips = screen.getAllByRole('listitem').map((x) => x.getAttribute('title'))
    expect(chips).toContain('Ana')
    expect(screen.getByText('Ana Sofía Rojas', { exact: false, selector: 'li' })).toBeTruthy()
    expect(screen.getByText('Claude', { selector: 'li' })).toBeTruthy()
  })
})

describe('«Enviar como» goes back to whoever writes after a send in the name of someone', () => {
  it('the next send is written by the session member, as «Para» is emptied', async () => {
    const sent: { asMemberId?: string }[] = []
    render(<Mount><ComposeBar onSubmit={(d) => sent.push(d)} /></Mount>)
    const select = (await screen.findByTestId('compose-send-as')) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('1'))
    fireEvent.change(select, { target: { value: '2' } })
    fireEvent.change(screen.getByTestId('compose-text'), { target: { value: 'uno' } })
    fireEvent.click(screen.getByTestId('compose-send'))
    expect(sent[0]?.asMemberId).toBe('2')
    expect(select.value).toBe('1')
    fireEvent.change(screen.getByTestId('compose-text'), { target: { value: 'dos' } })
    fireEvent.click(screen.getByTestId('compose-send'))
    expect(sent[1]?.asMemberId).toBeUndefined()
  })

  it('the note of a change of author is not an edit: it does not dim the page', async () => {
    render(<Mount><ComposeBar onSubmit={() => {}} /></Mount>)
    const to = await screen.findByTestId('compose-to')
    fireEvent.click(within(to).getByRole('button'))
    await offered()
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Ana/ }))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(within(to).getByRole('button', { name: 'Quitar a Ana' })).toBeTruthy())
    fireEvent.change(screen.getByTestId('compose-send-as'), { target: { value: '2' } })
    const line = await screen.findByTestId('compose-left-to')
    expect(document.querySelector('[data-compose-scrim]')).toBeNull()
    expect(document.querySelector('[data-compose-box]')?.getAttribute('data-expanded')).toBe('true')
    expect(within(line).getByRole('button', { name: 'Deshacer' }).className).toContain('shrink-0')
  })
})

