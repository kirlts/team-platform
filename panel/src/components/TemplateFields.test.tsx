// 2026-10-25 (Martín, on message #123): a field the analyzer left empty or with «No indicado» is not drawn; what is not asked of a person lives in
// «Evaluación», not among the fields. Every check is a prohibition.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { buildTemplate, isStated, retiredValues } from '@/lib/template'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import type { MessageDetail, Template } from '@team-platform/client'
import { Assessment } from './Assessment'
import { TemplateFields } from './TemplateFields'

const api = mockApi(async (path: string) => {
  if (path === '/me') return { id: 'u1', email: 'ana@x.org', name: 'Ana', role: 'member', language: 'es-419', active: true, provider: 'local' }
  if (path === '/areas') return { items: [{ id: 'a1', title: 'Producto', description: '', color: '#854d0e', position: 1, guards: [] }] }
  return { items: [] }
})
afterEach(() => {
  cleanup()
  api.mockClear()
})

const template = (fields: { name: string; label: string; required: boolean }[]): Template =>
  ({ id: 't1', area_id: 'a1', name: 'Capacidad nueva', description: '', body_markdown: buildTemplate({ name: 'Capacidad nueva', description: 'd', fields, instructions: 'x' }) }) as unknown as Template

const noop = () => {}

const FIELDS = [
  { name: 'need', label: 'Contexto', required: false },
  { name: 'users', label: 'Quién', required: false },
  { name: 'must', label: 'Obligado', required: true },
]

function mount(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WithTeamClient>
        <I18nProvider language="es-419">
          <MemoryRouter>{ui}</MemoryRouter>
        </I18nProvider>
      </WithTeamClient>
    </QueryClientProvider>,
  )
}

describe('a field with no data is not drawn', () => {
  it('draws the one with content and neither the empty one nor the one that says «No indicado»', () => {
    mount(<TemplateFields onSave={noop} template={template(FIELDS)} values={{ need: 'Para quién y por qué', users: 'No indicado', must: 'dato' }} canEdit={false} />)
    expect(screen.getByText('Contexto')).toBeTruthy()
    expect(screen.queryByText('Quién')).toBeNull()
    expect(screen.queryByText(/No indicado/)).toBeNull()
    expect(screen.queryByText('Completar')).toBeNull()
    expect(screen.queryByText('Sin dato')).toBeNull()
  })

  it('draws nothing at all when nothing has content and the person cannot edit', () => {
    const { container } = mount(<TemplateFields onSave={noop} template={template(FIELDS.slice(0, 2))} values={{ need: '', users: 'No indicado.' }} canEdit={false} />)
    expect(container.querySelector('dl')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('whoever cannot edit is not asked for an empty required field: it is neither flagged nor drawn', () => {
    const { container } = mount(<TemplateFields onSave={noop} template={template(FIELDS)} values={{ must: '' }} canEdit={false} />)
    expect(screen.queryByText('Obligatorio')).toBeNull()
    expect(container.querySelector('dl')).toBeNull()
  })

  it('an empty required field is drawn and says so; closed, it is not asked for', () => {
    const { rerender } = mount(<TemplateFields onSave={noop} template={template(FIELDS)} values={{ must: '' }} canEdit />)
    expect(screen.getAllByText('Obligatorio').length).toBeGreaterThan(0)
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <WithTeamClient>
          <I18nProvider language="es-419">
            <MemoryRouter>
              <TemplateFields onSave={noop} template={template(FIELDS)} values={{ must: '' }} canEdit closed />
            </MemoryRouter>
          </I18nProvider>
        </WithTeamClient>
      </QueryClientProvider>,
    )
    expect(screen.queryByText('Obligatorio')).toBeNull()
  })
})

describe('whoever edits adds an absent field from the row of names', () => {
  it('lists the absent ones by name, opens one in edition and saves it', () => {
    const save = vi.fn()
    mount(<TemplateFields template={template(FIELDS.slice(0, 2))} values={{ need: 'algo' }} onSave={save} />)
    expect(screen.getByTestId('add-field-users')).toBeTruthy()
    expect(screen.queryByTestId('add-field-need')).toBeNull()
    fireEvent.click(screen.getByTestId('add-field-users'))
    const box = screen.getByRole('textbox', { name: 'Quién' })
    fireEvent.change(box, { target: { value: 'la doctora' } })
    fireEvent.blur(box)
    expect(save).toHaveBeenCalledWith('users', 'la doctora')
  })

  it('does not offer them to someone who cannot edit', () => {
    mount(<TemplateFields onSave={noop} template={template(FIELDS.slice(0, 2))} values={{ need: 'algo' }} canEdit={false} />)
    expect(screen.queryByTestId('add-fields')).toBeNull()
  })
})

describe('what the template no longer asks for', () => {
  it('«No indicado» is not data, in any capitalization or with a final period', () => {
    expect(['No indicado', 'no indicado.', ' NO INDICADO ', '', null, undefined].some((v) => isStated(v))).toBe(false)
    expect(isStated('Nadie lo dijo')).toBe(true)
  })

  it('a stored value under a retired name is found, only when it has content', () => {
    const found = retiredValues({ need: 'a', request: 'El modal debe permitir descargar.', value_missing: 'No indicado', limits: '' }, [{ name: 'need', label: 'Contexto', required: false }])
    expect(found).toEqual([{ name: 'request', value: 'El modal debe permitir descargar.' }])
  })

  it('goes to «Evaluación» as read-only rows, never among the fields of the text', () => {
    const m = { id: 'm1', area_id: 'a1', author_id: 'u1', status: 'open', fields: { need: 'ctx', request: 'Pedido viejo', limits: 'No indicado' }, assessment: { expectation: '', guards: [], estimates: null } } as unknown as MessageDetail
    mount(<Assessment message={m} template={template([{ name: 'need', label: 'Contexto', required: false }])} />)
    fireEvent.click(screen.getByText('Evaluación'))
    const rows = screen.getByTestId('retired-fields')
    expect(rows.textContent).toContain('Pedido: Pedido viejo')
    expect(rows.textContent).not.toContain('ctx')
    expect(rows.textContent).not.toContain('Límites')
  })
})
