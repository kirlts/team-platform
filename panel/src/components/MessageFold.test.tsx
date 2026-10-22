// UD-257: the messages of a send open with their count, by area when there are several, and each one is a folded row of one line that opens
// in place on a click and folds again on another.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { MessageFoldRow, MessageTally } from './MessageFold'

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: vi.fn(async (path: string) => {
      if (path === '/areas') return { items: [{ id: 'a1', title: 'Error', description: '', color: '#854d0e', position: 1 }, { id: 'a2', title: 'Idea', description: '', color: '#1d4ed8', position: 2 }] }
      if (path === '/members') return { items: [{ id: 'u1', name: 'Ana', email: 'ana@x.org', role: 'member', active: true }] }
      return { items: [] }
    }),
  }
})

afterEach(cleanup)

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider language="es-419">{node}</I18nProvider>
    </QueryClientProvider>,
  )
}

function Row() {
  const [open, setOpen] = useState(false)
  return (
    <ul>
      <MessageFoldRow index={1} areaId="a1" title="El botón de guardar no responde" assigneeIds={['u1']} open={open} onToggle={() => setOpen((v) => !v)}>
        <p>Texto completo del mensaje</p>
      </MessageFoldRow>
    </ul>
  )
}

describe('MessageTally', () => {
  it('says how many messages and, with several areas, how many in each', () => {
    wrap(<MessageTally areaIds={['a1', 'a2', 'a1', 'a1']} />)
    const tally = screen.getByTestId('message-tally')
    expect(tally.textContent).toMatch(/^4 mensajes/)
    expect(tally.querySelectorAll('[data-testid="area-chip"]')).toHaveLength(2)
    expect(tally.textContent).toMatch(/3/)
  })

  it('names no area when every message falls in one', () => {
    wrap(<MessageTally areaIds={['a1']} />)
    const tally = screen.getByTestId('message-tally')
    expect(tally.textContent).toBe('1 mensaje')
    expect(tally.querySelectorAll('[data-testid="area-chip"]')).toHaveLength(0)
  })
})

describe('MessageFoldRow', () => {
  it('starts folded with the title in one line, opens on a click and folds on another', () => {
    wrap(<Row />)
    const head = screen.getByRole('button', { name: 'Abrir el mensaje 2: El botón de guardar no responde' })
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByTestId('fold-title').className).toMatch(/\btruncate\b/)
    expect(screen.queryByText('Texto completo del mensaje')).toBeNull()

    fireEvent.click(head)
    expect(screen.getByText('Texto completo del mensaje')).toBeTruthy()
    const fold = screen.getByRole('button', { name: 'Plegar el mensaje 2: El botón de guardar no responde' })
    expect(fold.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(fold)
    expect(screen.queryByText('Texto completo del mensaje')).toBeNull()
  })

  it('marks a message without recipients', () => {
    wrap(
      <ul>
        <MessageFoldRow index={0} areaId="a1" title="Sin nadie" assigneeIds={[]} open={false} onToggle={() => {}}>
          <p>x</p>
        </MessageFoldRow>
      </ul>,
    )
    expect(screen.getByText('sin destinatarios')).toBeTruthy()
  })
})
