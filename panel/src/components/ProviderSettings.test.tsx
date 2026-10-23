// UD-120: the section of providers of Configuración. The server is a small in-memory double behind a mocked `api`;
// texts are read from the Spanish catalogue so a rewording does not break a test.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import { translate } from '@/i18n/core'
import { es419 } from '@/i18n/es-419'
import { TeamApiError, type Cause, type Connection, type ProviderSlot } from '@team-platform/client'
import { ProviderSettings } from './ProviderSettings'

const L = (key: string, vars?: Record<string, string | number>) => translate(es419, 'es-419', key, vars)

interface Conn {
  name: string
  label: string
  kind: Connection['kind']
  custom: boolean
  base_url: string | null
  source: 'stored' | 'environment' | null
  last4: string | null
  last: Connection['last_check']
}
interface Slot {
  slot: ProviderSlot
  provider: string
  model: string
}

const server = {
  conns: [] as Conn[],
  slots: [] as Slot[],
  sent: [] as { method: string; path: string; body: unknown }[],
}

const PRESETS = [
  { name: 'deepseek', label: 'DeepSeek', kind: 'openai-compatible', base_url: 'https://api.deepseek.com/v1', suggested_model: 'deepseek-chat', structured: 'json_object' },
  { name: 'other', label: 'Other', kind: 'openai-compatible', base_url: null, suggested_model: null, structured: 'json_schema' },
]

function seed() {
  server.conns = [
    { name: 'anthropic', label: 'Anthropic', kind: 'anthropic', custom: false, base_url: null, source: 'stored', last4: '1111', last: { at: new Date().toISOString(), ok: true, cause: null, duration_ms: 212 } },
    { name: 'gateway', label: 'Gateway', kind: 'openai-compatible', custom: true, base_url: 'https://llm.example.invalid/v1', source: 'stored', last4: '9f2a', last: { at: new Date().toISOString(), ok: false, cause: 'no_quota', duration_ms: 190 } },
    { name: 'groq-speech', label: 'Groq speech', kind: 'groq-speech', custom: false, base_url: null, source: 'stored', last4: '5678', last: null },
    { name: 'envonly', label: 'Env only', kind: 'openai-compatible', custom: false, base_url: null, source: 'environment', last4: '0000', last: null },
    { name: 'blank', label: 'Blank', kind: 'openai-compatible', custom: true, base_url: 'https://blank.example.invalid/v1', source: null, last4: null, last: null },
  ]
  server.slots = [
    { slot: 'text', provider: 'anthropic', model: 'model-text' },
    { slot: 'vision', provider: 'anthropic', model: 'model-vision' },
    { slot: 'speech', provider: 'groq-speech', model: 'model-speech' },
  ]
  server.sent = []
}

const usedBy = (name: string) => server.slots.filter((s) => s.provider === name).map((s) => s.slot)
const statusOf = (c: Conn): Connection['status'] => (!c.source ? 'no_key' : c.last && !c.last.ok ? 'failing' : 'configured')
const viewOf = (c: Conn): Connection => ({ name: c.name, label: c.label, kind: c.kind, custom: c.custom, base_url: c.base_url, structured: null, status: statusOf(c), key: { source: c.source, last4: c.last4, updated_at: null }, used_by: usedBy(c.name), last_check: c.last })
const okCheck = (model: string | null) => ({ ok: true, cause: null, status: 200, duration_ms: 42, model, models: ['model-a', 'model-b', 'model-c'], model_listed: true, checked_at: new Date().toISOString() })

/** A text containing `fail-<cause>` fails the test of the provider with that cause. */
const probe = (text: string) => {
  const m = /fail-([a-z_]+)/.exec(text)
  if (m) throw new TeamApiError(422, 'server sentence', 'provider_check_failed', { cause: m[1], status_code: 401, duration_ms: 17 })
}
mockApi(async (path: string, options: { method?: string; body?: Record<string, unknown> } = {}) => {
  const method = options.method ?? 'GET'
  server.sent.push({ method, path, body: options.body })
  if (path === '/settings/providers' && method === 'GET') {
    return { items: server.slots.map((s) => { const c = server.conns.find((x) => x.name === s.provider)!; return { ...s, available: !!c.source, key_last4: c.last4, status: statusOf(c) } }) }
  }
  if (path === '/settings/providers' && method === 'PATCH') {
    const body = options.body as { slot: ProviderSlot; provider?: string; model?: string }
    probe(`${body.provider ?? ''} ${body.model ?? ''}`)
    const slot = server.slots.find((s) => s.slot === body.slot)!
    if (body.provider) slot.provider = body.provider
    if (body.model) slot.model = body.model
    return { items: [] }
  }
  let m = /^\/settings\/providers\/(\w+)\/check$/.exec(path)
  if (m) {
    const slot = server.slots.find((s) => s.slot === m![1])!
    return { check: okCheck(slot.model), slot: slot.slot, provider: slot.provider, model: slot.model }
  }
  if (path === '/settings/connections' && method === 'GET') return { items: server.conns.map(viewOf), presets: PRESETS }
  if (path === '/settings/connections' && method === 'POST') {
    const body = options.body as { preset?: string; name?: string; base_url?: string; api_key: string }
    probe(body.api_key)
    const preset = PRESETS.find((p) => p.name === body.preset)
    const name = body.preset ?? body.name!
    server.conns.push({ name, label: preset?.label ?? name, kind: 'openai-compatible', custom: !body.preset, base_url: body.base_url ?? preset?.base_url ?? null, source: 'stored', last4: body.api_key.slice(-4), last: null })
    return { connection: viewOf(server.conns.find((c) => c.name === name)!), check: okCheck(null) }
  }
  m = /^\/settings\/connections\/([^/]+)(\/key|\/check)?$/.exec(path)
  if (m) {
    const conn = server.conns.find((c) => c.name === decodeURIComponent(m![1]))!
    if (m[2] === '/key' && method === 'PUT') {
      const body = options.body as { api_key: string }
      probe(body.api_key)
      conn.source = 'stored'
      conn.last4 = body.api_key.slice(-4)
      conn.last = { at: new Date().toISOString(), ok: true, cause: null, duration_ms: 42 }
      return { connection: viewOf(conn), check: okCheck(null) }
    }
    if (m[2] === '/key' && method === 'DELETE') {
      if (usedBy(conn.name).length) throw new TeamApiError(409, 'in use', 'provider_in_use', { used_by: usedBy(conn.name) })
      if (conn.source === 'environment') throw new TeamApiError(409, 'env', 'key_from_environment')
      conn.source = null
      conn.last4 = null
      conn.last = null
      return { connection: viewOf(conn) }
    }
    if (m[2] === '/check') return { check: okCheck(null) }
    if (!m[2] && method === 'DELETE') {
      server.conns = server.conns.filter((c) => c !== conn)
      return { deleted: true }
    }
  }
  throw new Error(`unexpected ${method} ${path}`)
})

let client: QueryClient
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WithTeamClient>
      <I18nProvider language="es-419">
        <ProviderSettings />
      </I18nProvider>
    </WithTeamClient>
    </QueryClientProvider>,
  )
}

const row = (name: string) => within(document.querySelector(`[data-connection="${name}"]`) as HTMLElement)
const slotRow = (slot: ProviderSlot) => within(screen.getByRole('group', { name: L(`settings.slot.${slot}`) }))
const SECRET = 'sk-test-SECRET-4321'

const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}))

beforeEach(async () => {
  seed()
  consoleSpies.forEach((s) => s.mockClear())
})
afterEach(cleanup)

async function ready() {
  mount()
  await screen.findByRole('group', { name: 'Anthropic' })
}

describe('connection rows', () => {
  it('show state as icon and word, key origin, last four characters, functions and last diagnosis', async () => {
    await ready()
    const anthropic = row('anthropic')
    expect(anthropic.getByText(L('providers.status.configured'))).toBeTruthy()
    expect(anthropic.getByText(L('providers.source.stored'))).toBeTruthy()
    expect(anthropic.getByText(new RegExp(L('providers.endsIn', { last4: '1111' })))).toBeTruthy()
    expect(anthropic.getByText(`${L('settings.slot.text')}, ${L('settings.slot.vision')}`)).toBeTruthy()
    expect(anthropic.getByText(L('providers.checkOk'))).toBeTruthy()
    expect(row('gateway').getByText(L('providers.status.failing'))).toBeTruthy()
    expect(row('gateway').getByText(L('cause.no_quota'))).toBeTruthy()
    expect(row('blank').getByText(L('providers.neverChecked'))).toBeTruthy()
    expect(row('envonly').getByText(L('providers.source.environment'))).toBeTruthy()
    // No key: «Agregar clave» is the main action and there is nothing to diagnose.
    expect(row('blank').getByRole('button', { name: L('providers.addKey') })).toBeTruthy()
    expect(row('blank').queryByRole('button', { name: L('providers.diagnose') })).toBeNull()
    expect(row('anthropic').getByRole('button', { name: L('providers.diagnose') })).toBeTruthy()
    // Only the providers added by the Editor can be deleted.
    expect(row('gateway').getByRole('button', { name: L('providers.delete') })).toBeTruthy()
    expect(row('anthropic').queryByRole('button', { name: L('providers.delete') })).toBeNull()
  })

  it('diagnose shows the result with its models folded and offers them to the model field', async () => {
    await ready()
    fireEvent.click(row('gateway').getByRole('button', { name: L('providers.diagnose') }))
    const result = await waitFor(() => {
      const el = document.querySelector('[data-check-result="ok"]') as HTMLElement
      expect(el).toBeTruthy()
      return within(el)
    })
    expect(result.getByText(L('providers.ms', { ms: 42 }), { exact: false })).toBeTruthy()
    expect(result.queryByText('model-a')).toBeNull()
    fireEvent.click(result.getByRole('button', { name: L('providers.models', { n: 3 }) }))
    expect(result.getByText('model-b')).toBeTruthy()
  })
})

describe('replace key', () => {
  it('a failing test keeps the previous key and says the cause', async () => {
    await ready()
    fireEvent.click(row('anthropic').getByRole('button', { name: L('providers.replaceKey') }))
    fireEvent.change(screen.getByLabelText(L('providers.apiKey')), { target: { value: 'sk-fail-invalid_key-9999' } })
    fireEvent.click(screen.getByRole('button', { name: L('providers.testAndSave') }))
    const message = await screen.findByText(L('providers.keyFailed', { cause: L('cause.invalid_key') }))
    expect(message).toBeTruthy()
    expect(screen.getByText(L('providers.http', { status: 401 }), { exact: false })).toBeTruthy()
    // The stored key did not change and the field no longer holds what was typed.
    expect(row('anthropic').getByText(new RegExp(L('providers.endsIn', { last4: '1111' })))).toBeTruthy()
    expect((screen.getByLabelText(L('providers.apiKey')) as HTMLInputElement).value).toBe('')
  })

  it('a passing test replaces the key and reports the duration', async () => {
    await ready()
    fireEvent.click(row('anthropic').getByRole('button', { name: L('providers.replaceKey') }))
    fireEvent.change(screen.getByLabelText(L('providers.apiKey')), { target: { value: SECRET } })
    fireEvent.click(screen.getByRole('button', { name: L('providers.testAndSave') }))
    await screen.findByText(L('providers.keyReplaced', { ms: 42 }))
    await waitFor(() => expect(row('anthropic').getByText(new RegExp(L('providers.endsIn', { last4: '4321' })))).toBeTruthy())
    expect(screen.queryByLabelText(L('providers.apiKey'))).toBeNull()
  })

  it('the key field is a password field that the browser does not remember', async () => {
    await ready()
    fireEvent.click(row('blank').getByRole('button', { name: L('providers.addKey') }))
    const field = screen.getByLabelText(L('providers.apiKey')) as HTMLInputElement
    expect(field.type).toBe('password')
    expect(field.getAttribute('autocomplete')).toBe('off')
  })

  it('no key value stays in the page, in the request cache or in the console after sending', async () => {
    await ready()
    fireEvent.click(row('anthropic').getByRole('button', { name: L('providers.replaceKey') }))
    fireEvent.change(screen.getByLabelText(L('providers.apiKey')), { target: { value: SECRET } })
    fireEvent.click(screen.getByRole('button', { name: L('providers.testAndSave') }))
    await screen.findByText(L('providers.keyReplaced', { ms: 42 }))
    // The failing path too.
    fireEvent.click(row('anthropic').getByRole('button', { name: L('providers.replaceKey') }))
    fireEvent.change(screen.getByLabelText(L('providers.apiKey')), { target: { value: `${SECRET}-fail-no_quota` } })
    fireEvent.click(screen.getByRole('button', { name: L('providers.testAndSave') }))
    await screen.findByText(L('providers.keyFailed', { cause: L('cause.no_quota') }))
    expect(document.body.innerHTML).not.toContain('SECRET')
    for (const input of document.querySelectorAll('input')) expect((input as HTMLInputElement).value).not.toContain('SECRET')
    expect(JSON.stringify(client.getMutationCache().getAll().map((m) => m.state.variables ?? null))).not.toContain('SECRET')
    for (const spy of consoleSpies) expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET')
  })
})

describe('retire key and delete', () => {
  it('one click retires an unused key, with no window and no step that confirms it (UD-253)', async () => {
    await ready()
    expect(server.conns.find((c) => c.name === 'gateway')!.source).toBe('stored')
    fireEvent.click(row('gateway').getByRole('button', { name: L('providers.retireKey') }))
    await screen.findByText(L('providers.retired'))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(row('gateway').getByText(L('providers.status.no_key'), { selector: '[data-status]' })).toBeTruthy())
  })

  it('a key in use is refused: the row names the functions, switches each one and retries', async () => {
    await ready()
    fireEvent.click(row('anthropic').getByRole('button', { name: L('providers.retireKey') }))
    const list = await row('anthropic').findByRole('group', { name: L('providers.inUse') })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(server.conns.find((c) => c.name === 'anthropic')!.source).not.toBeNull()
    expect(within(list).getByText(L('settings.slot.text'))).toBeTruthy()
    expect(within(list).getByText(L('settings.slot.vision'))).toBeTruthy()
    expect(within(list).queryByText(L('settings.slot.speech'))).toBeNull()
    expect((within(list).getByRole('button', { name: L('providers.retry') }) as HTMLButtonElement).disabled).toBe(true)
    for (const slot of ['text', 'vision'] as const) {
      const group = within(document.querySelector(`[data-switch="${slot}"]`) as HTMLElement)
      fireEvent.change(group.getByLabelText(`${L('providers.switchTo')}: ${L(`settings.slot.${slot}`)}`), { target: { value: 'gateway' } })
      fireEvent.change(group.getByLabelText(L('settings.modelOf', { slot: L(`settings.slot.${slot}`) })), { target: { value: 'model-new' } })
      fireEvent.click(group.getByRole('button', { name: `${L('providers.apply')}: ${L(`settings.slot.${slot}`)}` }))
      await waitFor(() => expect(document.querySelector(`[data-switch="${slot}"]`)).toBeNull())
    }
    await waitFor(() => expect((within(list).getByRole('button', { name: L('providers.retry') }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(list).getByRole('button', { name: L('providers.retry') }))
    await screen.findByText(L('providers.retired'))
    expect(server.slots.filter((s) => s.provider === 'gateway').map((s) => s.slot)).toEqual(['text', 'vision'])
  })

  it('a key from the environment is explained', async () => {
    await ready()
    fireEvent.click(row('envonly').getByRole('button', { name: L('providers.retireKey') }))
    expect((await screen.findByRole('alert')).textContent).toBe(L('error.key_from_environment'))
  })

  it('one click deletes a provider of the Editor', async () => {
    await ready()
    fireEvent.click(row('blank').getByRole('button', { name: L('providers.delete') }))
    await waitFor(() => expect(document.querySelector('[data-connection="blank"]')).toBeNull())
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('add provider', () => {
  it('from a preset, with the key tested first', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: L('providers.addProvider') }))
    const form = within(screen.getByRole('form', { name: L('providers.addProvider') }))
    fireEvent.change(form.getByLabelText(L('providers.preset')), { target: { value: 'deepseek' } })
    fireEvent.change(form.getByLabelText(L('providers.apiKey')), { target: { value: SECRET } })
    fireEvent.click(form.getByRole('button', { name: L('providers.testAndSave') }))
    await screen.findByText(L('providers.providerAdded', { ms: 42 }))
    expect(server.sent.find((r) => r.method === 'POST' && r.path === '/settings/connections')!.body).toMatchObject({ preset: 'deepseek' })
    await waitFor(() => expect(document.querySelector('[data-connection="deepseek"]')).toBeTruthy())
  })

  it('with «Otro»: name, base address, mode and key', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: L('providers.addProvider') }))
    const form = within(screen.getByRole('form', { name: L('providers.addProvider') }))
    fireEvent.change(form.getByLabelText(L('providers.preset')), { target: { value: 'other' } })
    fireEvent.change(form.getByLabelText(L('providers.name')), { target: { value: 'my-gateway' } })
    fireEvent.change(form.getByLabelText(L('providers.baseUrl')), { target: { value: 'https://gw.example.invalid/v1' } })
    fireEvent.click(form.getByRole('radio', { name: L('providers.structured.tool') }))
    fireEvent.change(form.getByLabelText(L('providers.apiKey')), { target: { value: SECRET } })
    fireEvent.click(form.getByRole('button', { name: L('providers.testAndSave') }))
    await screen.findByText(L('providers.providerAdded', { ms: 42 }))
    expect(server.sent.find((r) => r.method === 'POST' && r.path === '/settings/connections')!.body).toMatchObject({ name: 'my-gateway', base_url: 'https://gw.example.invalid/v1', structured: 'tool' })
  })

  it('a failing test saves nothing and says so', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: L('providers.addProvider') }))
    const form = within(screen.getByRole('form', { name: L('providers.addProvider') }))
    fireEvent.change(form.getByLabelText(L('providers.preset')), { target: { value: 'deepseek' } })
    fireEvent.change(form.getByLabelText(L('providers.apiKey')), { target: { value: 'sk-fail-invalid_key' } })
    fireEvent.click(form.getByRole('button', { name: L('providers.testAndSave') }))
    await screen.findByText(L('providers.addFailed', { cause: L('cause.invalid_key') }))
    expect(server.conns.some((c) => c.name === 'deepseek')).toBe(false)
  })
})

describe('functions', () => {
  it('lists the three functions, each with its explanation and named controls', async () => {
    await ready()
    for (const slot of ['text', 'vision', 'speech'] as const) {
      const name = L(`settings.slot.${slot}`)
      const group = slotRow(slot)
      expect(group.getByText(L(`hint.slot.${slot}`))).toBeTruthy()
      expect(group.getByRole('combobox', { name: L('settings.providerOf', { slot: name }) })).toBeTruthy()
      // A field with suggestions is a combobox for assistive technology.
      expect(group.getByRole('combobox', { name: L('settings.modelOf', { slot: name }) })).toBeTruthy()
      expect(group.getByRole('button', { name: L('providers.apply') })).toBeTruthy()
      expect(group.getByRole('button', { name: L('providers.diagnose') })).toBeTruthy()
    }
    // Transcripción only offers the transcription provider.
    const options = [...(screen.getAllByRole('combobox', { name: L('settings.providerOf', { slot: L('settings.slot.speech') }) })[0] as HTMLSelectElement).options].map((o) => o.value)
    expect(options).toEqual(['groq-speech'])
  })

  it('Aplicar saves a change that passes', async () => {
    await ready()
    const text = slotRow('text')
    const apply = text.getByRole('button', { name: L('providers.apply') }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    fireEvent.change(text.getByRole('combobox', { name: L('settings.providerOf', { slot: L('settings.slot.text') }) }), { target: { value: 'gateway' } })
    fireEvent.change(text.getByRole('combobox', { name: L('settings.modelOf', { slot: L('settings.slot.text') }) }), { target: { value: 'model-ok' } })
    fireEvent.click(apply)
    await text.findByText(L('providers.applied'))
    expect(server.slots.find((s) => s.slot === 'text')).toMatchObject({ provider: 'gateway', model: 'model-ok' })
  })

  it('a change that fails goes back to what was saved and says the cause', async () => {
    await ready()
    const text = slotRow('text')
    fireEvent.change(text.getByRole('combobox', { name: L('settings.providerOf', { slot: L('settings.slot.text') }) }), { target: { value: 'gateway' } })
    fireEvent.change(text.getByRole('combobox', { name: L('settings.modelOf', { slot: L('settings.slot.text') }) }), { target: { value: 'model-fail-no_quota' } })
    fireEvent.click(text.getByRole('button', { name: L('providers.apply') }))
    await text.findByText(L('providers.failedKept', { cause: L('cause.no_quota') }))
    expect((text.getByRole('combobox', { name: L('settings.providerOf', { slot: L('settings.slot.text') }) }) as HTMLSelectElement).value).toBe('anthropic')
    expect((text.getByRole('combobox', { name: L('settings.modelOf', { slot: L('settings.slot.text') }) }) as HTMLInputElement).value).toBe('model-text')
    expect(server.slots.find((s) => s.slot === 'text')).toMatchObject({ provider: 'anthropic', model: 'model-text' })
  })

  it('diagnose shows the result of the function and remembers the models for the field', async () => {
    await ready()
    const text = slotRow('text')
    fireEvent.click(text.getByRole('button', { name: L('providers.diagnose') }))
    await text.findByText(L('providers.checkOk'))
    fireEvent.click(text.getByRole('button', { name: L('providers.models', { n: 3 }) }))
    expect(text.getByText('model-c')).toBeTruthy()
    await waitFor(() => expect([...document.querySelectorAll('datalist option')].map((o) => (o as HTMLOptionElement).value)).toEqual(expect.arrayContaining(['model-a', 'model-b', 'model-c'])))
  })
})

describe('causes', () => {
  it('every cause has a line in the catalogue', () => {
    const causes: Cause[] = ['invalid_key', 'no_quota', 'model_not_found', 'no_network', 'rate_limited', 'timeout', 'bad_address', 'provider_error', 'unknown']
    for (const c of causes) expect(L(`cause.${c}`)).not.toBe(`cause.${c}`)
  })
})
