// UD-262: «Tiempos» draws the figures, the phases and the slowest tools of the API's answer, and a message with no execution says so.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { ApiError } from '@/lib/api'
import { seconds, Timing } from './Timing'

const timing = {
  message_id: '7', job_id: '3', job_status: 'done', trace_id: 'a'.repeat(32), phase: null, elapsed_ms: null,
  first_reply_ms: 41000, final_reply_ms: 1_320_000, total_ms: 1_380_000, queue_wait_ms: 920_000,
  phases: [{ name: 'create', duration_ms: 95000, offset_ms: 0, status: 'unset' }, { name: 'run', duration_ms: 210000, offset_ms: 95000, status: 'unset' }],
  slowest: [
    { kind: 'tool', name: 'Bash', summary: 'Orden: npm test', duration_ms: 94000, success: false },
    { kind: 'tool', name: 'Read', summary: 'Lectura: a.tsx', duration_ms: 800, success: true },
  ],
  tree: { span_id: 's1', name: 'execute', status: 'ok', duration_ms: 1_380_000, attributes: {}, children: [{ span_id: 's2', name: 'execute.machine.run', status: 'ok', duration_ms: 210000, attributes: {}, children: [] }] },
}
let answer: () => unknown
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: vi.fn(async (path: string) => {
      if (path === '/areas') return { items: [] }
      if (path === '/members') return { items: [{ id: 'u1', name: 'Ana', email: 'a@x.org', role: 'member', active: true }, { id: 'u2', name: 'Claude', email: 'c@x.org', role: 'member', active: true, kind: 'agent' }] }
      if (path.endsWith('/timing')) return answer()
      return { items: [] }
    }),
  }
})
afterEach(cleanup)

function wrap(ids: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider language="es-419">
        <Timing messageId="7" assigneeIds={ids} />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

describe('seconds', () => {
  it('writes milliseconds, seconds and minutes', () => {
    expect([seconds(420), seconds(41000), seconds(94000), seconds(1_320_000)]).toEqual(['420 ms', '41 s', '1 min 34 s', '22 min 0 s'])
  })
})

describe('Timing', () => {
  it('shows nothing when no assignee is an agent', async () => {
    answer = () => timing
    const { container } = wrap(['u1'])
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('[data-timing]')).toBeNull()
  })

  it('is folded, and opening it draws the figures, the phases and the slowest tool first', async () => {
    answer = () => timing
    wrap(['u1', 'u2'])
    const toggle = await screen.findByRole('button', { name: 'Tiempos' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Primera respuesta')).toBeNull()
    fireEvent.click(toggle)
    expect((await screen.findByText('Primera respuesta')).nextElementSibling?.textContent).toBe('41 s')
    expect(screen.getByText('Respuesta final').nextElementSibling?.textContent).toBe('22 min 0 s')
    expect(screen.getByText('Total').nextElementSibling?.textContent).toBe('23 min 0 s')
    const slow = screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-timing-slow'))
    expect(slow[0].textContent).toContain('Orden: npm test')
    expect(slow[0].textContent).toContain('1 min 34 s')
    expect(document.querySelector('[data-span="execute.machine.run"]')).not.toBeNull()
  })

  it('says «Sin ejecución» on a 404', async () => {
    answer = () => { throw new ApiError(404, 'not_found', 'x') }
    wrap(['u2'])
    fireEvent.click(await screen.findByRole('button', { name: 'Tiempos' }))
    expect(await screen.findByText('Sin ejecución')).toBeTruthy()
  })
})
