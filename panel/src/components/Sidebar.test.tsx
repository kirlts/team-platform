// H-2605, UD-190: the sign-out row follows the identity provider that /api/me names.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { translate } from '@/i18n/core'
import { es419 } from '@/i18n/es-419'
import { canSignOut } from '@/lib/identity'
import { Sidebar } from './Sidebar'

const L = (key: string) => translate(es419, 'es-419', key)

let provider: string | undefined = 'local'

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: vi.fn(async (path: string) => {
      if (path === '/me') return { id: 'u1', email: 'ana@x.org', name: 'Ana', role: 'member', language: 'es-419', active: true, provider }
      if (path === '/messages/summary') return { mine: { open: 0, answered: 0, total: 0 }, items: [], areas: [] }
      return { items: [] }
    }),
  }
})

afterEach(cleanup)

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider language="es-419">
        <MemoryRouter>
          <Sidebar onLogout={() => {}} />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

describe('sign-out row of the sidebar', () => {
  it('is drawn for the local provider', async () => {
    provider = 'local'
    mount()
    expect(await screen.findByRole('button', { name: L('nav.logout') })).toBeTruthy()
  })

  it('is drawn for sso-redirect, which has a sign-out route', async () => {
    provider = 'delegated:sso-redirect'
    mount()
    expect(await screen.findByRole('button', { name: L('nav.logout') })).toBeTruthy()
  })

  it.each(['delegated:trusted-header', 'delegated:jwt', 'delegated:signed-header'])('is not drawn for %s, where the route answers 404', async (name) => {
    provider = name
    mount()
    await screen.findByText('Ana')
    expect(screen.queryByRole('button', { name: L('nav.logout') })).toBeNull()
    expect(screen.getByRole('link', { name: L('nav.settings') })).toBeTruthy()
  })
})

describe('canSignOut', () => {
  it('keeps the button when the server names no provider', () => {
    expect(canSignOut(undefined)).toBe(true)
    expect(canSignOut('delegated:trusted-header')).toBe(false)
  })
  it('follows a list of sources and the host sign-out (H-3720)', () => {
    expect(canSignOut('local,delegated:jwt')).toBe(true)
    expect(canSignOut('delegated:jwt,delegated:signed-header')).toBe(false)
    expect(canSignOut('delegated:jwt', 'https://anfitrion.example/salir')).toBe(true)
  })
})
