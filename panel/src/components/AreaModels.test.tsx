// UD-297: the models of an area («Ligero» and «Mayor») are changed only by the Editor; anyone else reads the value as text.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { translate } from '@/i18n/core'
import { es419 } from '@/i18n/es-419'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import type { Area } from '@team-platform/client'
import { AreaModels } from './AreaModels'

const L = (key: string) => translate(es419, 'es-419', key)
const area = { id: 'a-ficha', title: 'Ficha y agenda', description: 'd', color: '#0f766e', execute_model: 'claude-sonnet-5-5', execute_model_light: 'claude-haiku-5-5' } as Area

let role: 'editor' | 'member' = 'editor'
mockApi(async (path: string) => {
  if (path === '/me') return { id: '1', email: 'm@x.org', name: 'Martín', role, language: 'es-419', active: true, provider: 'local' }
  return []
})

afterEach(cleanup)

function mount(onChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <WithTeamClient>
        <I18nProvider language="es-419">
          <div>
            <AreaModels area={area} onChange={onChange} />
          </div>
        </I18nProvider>
      </WithTeamClient>
    </QueryClientProvider>,
  )
  return onChange
}

describe('the models of an area', () => {
  it('the Editor gets one select for each and a change goes out with the field and the model', async () => {
    role = 'editor'
    const onChange = mount()
    const light = await screen.findByRole('combobox', { name: L('areas.modelLight') })
    expect(screen.getByRole('combobox', { name: L('areas.modelMajor') })).toBeTruthy()
    fireEvent.change(light, { target: { value: 'claude-sonnet-5-5' } })
    expect(onChange).toHaveBeenCalledWith('execute_model_light', 'claude-sonnet-5-5')
  })

  it('anyone else sees both values as text and no control to change them', async () => {
    role = 'member'
    mount()
    await waitFor(() => expect(screen.getByText(L('areas.modelLight'))).toBeTruthy())
    await waitFor(() => expect(screen.queryAllByRole('combobox')).toHaveLength(0))
    expect(screen.getByText('Haiku 5.5')).toBeTruthy()
    expect(screen.getByText('Sonnet 5.5')).toBeTruthy()
  })
})
