// UD-262: «Ejecuciones» draws the figures of the summary, hides the phases nobody reported and asks only once it is open.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { TeamApiError } from '@team-platform/client'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import { ExecutionRuns } from './ExecutionRuns'

const none = { n: 0, avg: null, p50: null, p95: null }
const summary = {
  runs: 4, failed: 1,
  phases: {
    queue_wait_ms: { n: 4, avg: 20000, p50: 15000, p95: 60000 }, first_reply_ms: none, final_reply_ms: none,
    total_ms: { n: 4, avg: 1_180_000, p50: 1_110_000, p95: 1_380_000 }, create_ms: none, run_ms: none, destroy_ms: none,
    tools_ms: { n: 2, avg: 90000, p50: 90000, p95: 94000 }, judge_ms: none, delivery_ms: none, wait_ms: none,
  },
  cost: { n: 3, avg_usd: 1.5, total_usd: 4.5 },
  delivery: { known: 2, delivered: 1, held: 0, rate: 0.5 },
  resolved: { runs: 4, investigated: 1, rate: 0.25 },
  slowest_tools: [{ kind: 'tool', name: 'Bash', summary: 'Orden: npm test', duration_ms: 94000, success: false }],
}
const calls: string[] = []
let answer: () => unknown
mockApi(async (path: string) => { calls.push(path); return answer() })
afterEach(() => { cleanup(); calls.length = 0 })

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WithTeamClient>
      <I18nProvider language="es-419">
        <ExecutionRuns />
      </I18nProvider>
    </WithTeamClient>
    </QueryClientProvider>,
  )
}

describe('ExecutionRuns', () => {
  it('asks for nothing while it is folded and draws the figures when it opens', async () => {
    answer = () => summary
    wrap()
    expect(calls).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Ejecuciones' }))
    expect(await screen.findByText('US$ 1.50')).toBeTruthy()
    expect(calls[0]).toMatch(/^\/ops\/execute-runs\/summary\?since=\d{4}-\d{2}-\d{2}$/)
    expect(document.querySelector('[data-runs-figure="Entrega"]')?.textContent).toBe('50 %')
    expect(document.querySelector('[data-runs-figure="Resueltas"]')?.textContent).toBe('25 %')
    expect(document.querySelector('[data-runs-figure="Con error"]')?.textContent).toBe('1')
    expect([...document.querySelectorAll('[data-runs-phase]')].map((e) => e.getAttribute('data-runs-phase'))).toEqual(['queue_wait_ms', 'total_ms', 'tools_ms'])
    expect(document.querySelector('[data-runs-phase="total_ms"]')?.textContent).toContain('19 min 40 s')
    expect(document.querySelector('[data-runs-slow]')?.textContent).toContain('1 min 34 s')
  })

  it('"Todo" asks without a start date; no runs says so', async () => {
    answer = () => ({ ...summary, runs: 0 })
    wrap()
    fireEvent.click(screen.getByRole('button', { name: 'Ejecuciones' }))
    expect(await screen.findByText('Sin respuestas en curso')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Período' }), { target: { value: '0' } })
    await screen.findByText('Sin respuestas en curso')
    expect(calls.at(-1)).toBe('/ops/execute-runs/summary')
  })

  it('an error shows its text', async () => {
    answer = () => { throw new TeamApiError(500, 'Falló la lectura.', 'read_failed') }
    wrap()
    fireEvent.click(screen.getByRole('button', { name: 'Ejecuciones' }))
    expect(await screen.findByText('Falló la lectura.')).toBeTruthy()
  })
})
