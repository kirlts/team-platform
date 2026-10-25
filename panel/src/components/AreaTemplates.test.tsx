// UD-297: the templates of an area are a list where every one is a row (name and three figures), and each opens in a window.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { translate } from '@/i18n/core'
import { es419 } from '@/i18n/es-419'
import { UndoProvider, useUndoStack } from '@/lib/undo'
import { buildTemplate } from '@/lib/template'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import type { Area, Template } from '@team-platform/client'
import { Templates } from './AreaTemplates'

const L = (key: string, vars?: Record<string, string | number>) => translate(es419, 'es-419', key, vars)

const LONG = 'Cada dato que se pide al abrir la ficha de un paciente, con el motivo de cada uno y lo que se hace cuando falta, escrito para quien atiende en recepción y no conoce el sistema por dentro.'
const make = (id: string, name: string, fields: number, outputs: number, minutes: number): Template =>
  ({
    id, area_id: 'a-ficha', name, description: LONG, progress_interval_min: minutes, updated_at: '2026-10-25T12:00:00Z',
    body_markdown: buildTemplate({
      name, description: LONG,
      fields: Array.from({ length: fields }, (_, i) => ({ name: `f${i}`, label: `Campo ${i + 1}`, required: i === 0 })),
      output: outputs === 0 ? null : Array.from({ length: outputs }, (_, i) => ({ name: `o${i}`, label: `Dato ${i + 1}`, type: 'text' as const, required: i === 0 })),
      instructions: '## Método\nLeer y separar.',
    }),
  }) as Template

const TEMPLATES = [make('t1', 'Reporte de error', 3, 2, 20), make('t2', 'Error visual', 1, 0, 0), make('t3', 'Dato de ficha', 4, 1, 45), make('t4', 'Agenda y citas', 0, 0, 20)]
const area = { id: 'a-ficha', title: 'Ficha y agenda', description: 'Ficha del paciente y agenda.', color: '#0f766e' } as Area

mockApi(async (path: string) => {
  if (path === '/me') return { id: '1', email: 'm@x.org', name: 'Martín', role: 'editor', language: 'es-419', active: true, provider: 'local' }
  if (path.startsWith('/areas/a-ficha/templates')) return TEMPLATES
  return []
})

afterEach(cleanup)

function Shell() {
  const stack = useUndoStack()
  return (
    <UndoProvider stack={stack}>
      <Templates area={area} />
    </UndoProvider>
  )
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WithTeamClient>
        <I18nProvider language="es-419">
          <Shell />
        </I18nProvider>
      </WithTeamClient>
    </QueryClientProvider>,
  )
}

const rows = async () => {
  const list = await screen.findByRole('region', { name: L('areas.templates') })
  await waitFor(() => expect(list.querySelectorAll('[data-template-row]').length).toBeGreaterThan(0))
  return [...list.querySelectorAll<HTMLElement>('[data-template-row]')]
}

describe('the templates of an area', () => {
  it('draws the four of them, each with its name and its three figures, and no description or tag in the list', async () => {
    mount()
    const all = await rows()
    expect(all).toHaveLength(4)
    const figures = all.map((r) => [...r.querySelectorAll('[data-figure]')].map((f) => f.textContent?.replace(`${f.getAttribute('data-figure')}`, '').trim()))
    expect(figures).toEqual([['3', '2', '20 min'], ['1', '0', 'Apagado'], ['4', '1', '45 min'], ['0', '0', '20 min']])
    for (const row of all) {
      expect(within(row).queryByText(LONG)).toBeNull()
      expect(row.querySelector('li')).toBeNull()
      expect(within(row).queryByText(L('templates.required'))).toBeNull()
    }
  })

  it('has one header of columns for the figures and every row uses the same grid, so the columns start at one x', async () => {
    mount()
    const all = await rows()
    const header = screen.getByTestId('template-columns')
    expect(header.textContent).toBe([L('areas.fieldName'), L('templates.fields'), L('templates.outputs'), L('templates.columnProgress')].join(''))
    const grid = (el: HTMLElement) => [...el.classList].find((c) => c.startsWith('sm:grid-cols-'))
    expect(grid(header)).toBeTruthy()
    for (const row of all) expect(grid(row)).toBe(grid(header))
  })

  it('every row has the same actions: the name that opens it and the quiet «Eliminar»', async () => {
    mount()
    const all = await rows()
    for (const row of all) {
      expect(within(row).getAllByRole('button').map((b) => b.getAttribute('data-testid') ?? b.textContent?.trim())).toEqual(['template-open', L('areas.deleteShort')])
      expect(within(row).getAllByRole('checkbox')).toHaveLength(1)
    }
  })

  it('opens the window of a template with its whole description, its fields and outputs, and «Obligatorio» as a badge', async () => {
    mount()
    const all = await rows()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(within(all[0]!).getByTestId('template-open'))
    const dialog = await screen.findByRole('dialog', { name: 'Reporte de error' })
    expect(within(dialog).getByText(LONG)).toBeTruthy()
    expect(within(dialog).getByRole('region', { name: L('templates.fields') })).toBeTruthy()
    expect(within(dialog).getByRole('region', { name: L('templates.output') })).toBeTruthy()
    expect(within(dialog).getByRole('region', { name: L('templates.progress') })).toBeTruthy()
    // Three fields and two outputs: each shows «Obligatorio» as a badge, filled for the required one and outline for the rest.
    const required = within(dialog).getAllByText(L('templates.required'))
    expect(required).toHaveLength(5)
    for (const word of required) expect(word.className).toContain('rounded-full')
    expect(required.filter((w) => w.className.includes('bg-accent-soft'))).toHaveLength(2)
  })
})
