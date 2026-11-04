// TP-05 (soft-locks 2026-11-04): a send that is going up outlives the screen that started it. Its failure after leaving Inicio is not silent: the
// upload keeps its text and says so by a notice, and the row stays in the list for Inicio and for the bell.
// Fails on the tree before the change: the uploads were state of `Home`, and a failure after unmounting it changed nothing anyone could see.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { NoticeProvider, useNotices } from '@/lib/notices'
import { TeamClientProvider } from '@team-platform/client/react'
import { UploadsProvider, useUploads } from './uploads'

afterEach(cleanup)

let fail: () => void = () => {}
let finish: () => void = () => {}
const fake = {
  me: { get: async () => ({ id: 'u1', email: 'ana@x.org', name: 'Ana', role: 'member', language: 'es-419', active: true, provider: 'local' }) },
  inputs: {
    upload: vi.fn(
      () =>
        new Promise((resolve, reject) => {
          fail = () => reject(new Error('sin red'))
          finish = () => resolve({ input_id: 'i9' })
        }),
    ),
  },
} as never

function Starter() {
  const { start } = useUploads()
  return <button onClick={() => start({ text: 'texto largo del envío', files: [], links: [] })}>start</button>
}
/** Stands for Inicio: it starts the send and goes away while it is still going up. */
function Screen() {
  const [shown, setShown] = useState(true)
  return shown ? (
    <>
      <Starter />
      <button onClick={() => setShown(false)}>leave</button>
    </>
  ) : null
}
/** Stands for the shell: it stays mounted on every screen. */
function Always() {
  const { uploads } = useUploads()
  const notices = useNotices()
  return (
    <>
      <p data-testid="rows">{uploads.map((u) => `${u.draft.text}|${u.error ?? ''}|${u.landed ?? ''}`).join(';')}</p>
      <p data-testid="notice">{notices.current?.text ?? ''}</p>
    </>
  )
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TeamClientProvider client={fake}>
        <I18nProvider language="es-419">
          <NoticeProvider>
            <UploadsProvider>
              <Screen />
              <Always />
            </UploadsProvider>
          </NoticeProvider>
        </I18nProvider>
      </TeamClientProvider>
    </QueryClientProvider>,
  )
}

describe('a send that fails after leaving Inicio', () => {
  it('keeps its text in the list and says it by a notice', async () => {
    mount()
    fireEvent.click(screen.getByText('start'))
    fireEvent.click(screen.getByText('leave'))
    expect(screen.queryByText('start')).toBeNull()
    await act(async () => fail())
    expect(screen.getByTestId('rows').textContent).toBe('texto largo del envío|sin red|')
    expect(screen.getByTestId('notice').textContent).toMatch(/No se pudo enviar/)
  })

  it('says nothing while the screen is watching it, and the row still has its error', async () => {
    function Watcher() {
      const { watching } = useUploads()
      watching.current = true
      return null
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <TeamClientProvider client={fake}>
          <I18nProvider language="es-419">
            <NoticeProvider>
              <UploadsProvider>
                <Watcher />
                <Screen />
                <Always />
              </UploadsProvider>
            </NoticeProvider>
          </I18nProvider>
        </TeamClientProvider>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByText('start'))
    await act(async () => fail())
    expect(screen.getByTestId('rows').textContent).toBe('texto largo del envío|sin red|')
    expect(screen.getByTestId('notice').textContent).toBe('')
  })

  it('a send that lands leaves the list', async () => {
    mount()
    fireEvent.click(screen.getByText('start'))
    await act(async () => finish())
    expect(screen.getByTestId('rows').textContent).toBe('')
  })
})
