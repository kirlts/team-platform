// UD-123: the project description is an editor that grows with its text, shows how much it has saved and how much it has left, and every save can be undone.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import { UndoProvider, useUndoStack } from '@/lib/undo'
import { UndoButtons } from './UndoButtons'
import { ProjectEditor } from './ProjectEditor'

const server = { description: 'Texto inicial', max_chars: 100, failNext: false }
const calls: { description: string }[] = []

mockApi(async (path: string, options: { method?: string; body?: { description: string } } = {}) => {
  if (path !== '/settings/project') throw new Error(`unexpected ${path}`)
  if (options.method === 'PATCH') {
    if (server.failNext) {
      server.failNext = false
      throw Object.assign(new Error('La descripción del proyecto supera el máximo.'), { code: 'too_large' })
    }
    calls.push(options.body as { description: string })
    server.description = (options.body as { description: string }).description
  }
  return { name: 'Proyecto', description: server.description, max_chars: server.max_chars }
})

function Harness({ editor = true }: { editor?: boolean }) {
  const stack = useUndoStack()
  return (
    <UndoProvider stack={stack}>
      <UndoButtons stack={stack} />
      <ProjectEditor editor={editor} describedBy="hint-project" />
    </UndoProvider>
  )
}

const wrap = (node: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WithTeamClient>
        <I18nProvider language="es-419">{node}</I18nProvider>
      </WithTeamClient>
    </QueryClientProvider>,
  )
}

/** jsdom has no layout: a line of text is 20 px tall, and an empty field is as tall as its rows. */
beforeEach(() => {
  server.description = 'Texto inicial'
  server.max_chars = 100
  server.failNext = false
  calls.length = 0
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this instanceof HTMLTextAreaElement ? Math.max(this.rows, this.value.split('\n').length) * 20 : 0
    },
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const field = async () => (await screen.findByRole('textbox', { name: 'Proyecto' })) as HTMLTextAreaElement
const status = () => screen.getByRole('status')

describe('ProjectEditor', () => {
  it('has 16 rows at least and grows with its text, with no scroll of its own and no cap on its height', async () => {
    wrap(<Harness />)
    const box = await field()
    expect(box.rows).toBe(16)
    expect(box.className).toContain('overflow-y-hidden')
    expect(box.className).toContain('resize-y')
    expect(box.className).not.toMatch(/max-h|overflow-y-(auto|scroll)/)
    expect(box.style.height).toBe('320px')
    fireEvent.change(box, { target: { value: Array.from({ length: 60 }, (_, i) => `línea ${i}`).join('\n') } })
    expect(box.style.height).toBe('1200px')
    fireEvent.change(box, { target: { value: 'corto' } })
    expect(box.style.height).toBe('320px')
  })

  it('counts the characters against the cap of the server, warns from 90 % and fails above it, with an icon and a word', async () => {
    wrap(<Harness />)
    const box = await field()
    const counter = () => document.querySelector('[data-project-counter]') as HTMLElement
    expect(counter().textContent).toBe('13 de 100 caracteres')
    expect(counter().querySelector('svg')).toBeNull()
    fireEvent.change(box, { target: { value: 'a'.repeat(90) } })
    expect(counter().textContent).toContain('90 de 100 caracteres')
    expect(counter().textContent).toContain('Cerca del tope')
    expect(counter().querySelector('svg')).not.toBeNull()
    fireEvent.change(box, { target: { value: 'a'.repeat(101) } })
    expect(counter().textContent).toContain('Tope superado')
    expect(box.getAttribute('aria-invalid')).toBe('true')
    // Over the cap nothing is sent: the text stays unsaved.
    fireEvent.blur(box)
    expect(calls).toEqual([])
    expect(status().textContent).toBe('Sin guardar')
  })

  it('shows its state: saved, unsaved, saving and the translated cause of a failure', async () => {
    wrap(<Harness />)
    const box = await field()
    expect(status().textContent).toBe('Guardado')
    fireEvent.change(box, { target: { value: 'Otro texto' } })
    expect(status().textContent).toBe('Sin guardar')
    server.failNext = true
    await act(async () => {
      fireEvent.blur(box)
    })
    await waitFor(() => expect(status().textContent).toContain('Error al guardar'))
    expect(status().textContent).toContain('supera')
    expect((await field()).value).toBe('Otro texto') // what was typed is not lost
    await act(async () => {
      fireEvent.blur(box)
    })
    await waitFor(() => expect(status().textContent).toBe('Guardado'))
    expect(calls).toEqual([{ description: 'Otro texto' }])
  })

  it('saves on leaving the field and with Ctrl+S, never by a clock', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] })
    wrap(<Harness />)
    vi.useRealTimers()
    const box = await field()
    fireEvent.change(box, { target: { value: 'Primero' } })
    await new Promise((r) => setTimeout(r, 1500))
    expect(calls).toEqual([]) // 1.5 s without typing: still nothing sent
    await act(async () => {
      fireEvent.keyDown(box, { key: 's', ctrlKey: true })
    })
    await waitFor(() => expect(calls).toEqual([{ description: 'Primero' }]))
    fireEvent.change(box, { target: { value: 'Segundo' } })
    await act(async () => {
      fireEvent.blur(box)
    })
    await waitFor(() => expect(calls).toHaveLength(2))
  })

  it('every save is undone and redone with the buttons of the screen', async () => {
    wrap(<Harness />)
    const box = await field()
    fireEvent.change(box, { target: { value: 'Nuevo texto' } })
    await act(async () => {
      fireEvent.blur(box)
    })
    const undo = await screen.findByRole('button', { name: 'Deshacer' })
    await waitFor(() => expect((undo as HTMLButtonElement).disabled).toBe(false))
    await act(async () => {
      fireEvent.click(undo)
    })
    await waitFor(() => expect(box.value).toBe('Texto inicial'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Rehacer' }))
    })
    await waitFor(() => expect(box.value).toBe('Nuevo texto'))
  })

  it('Ctrl+Z inside the field is not taken by the stack of the screen', async () => {
    wrap(<Harness />)
    const box = await field()
    fireEvent.change(box, { target: { value: 'Guardado antes' } })
    await act(async () => {
      fireEvent.blur(box)
    })
    fireEvent.change(box, { target: { value: 'Sin guardar aún' } })
    const prevented = vi.fn()
    box.addEventListener('keydown', (e) => e.defaultPrevented && prevented())
    fireEvent.keyDown(box, { key: 'z', ctrlKey: true })
    expect(prevented).not.toHaveBeenCalled() // the browser's own undo of the field is left alone
    expect(box.value).toBe('Sin guardar aún')
    expect(calls).toHaveLength(1)
  })

  it('downloads the current text as proyecto.md without a server', async () => {
    const created: Blob[] = []
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      created.push(blob as Blob)
      return 'blob:x'
    })
    URL.revokeObjectURL = vi.fn()
    let name = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download
    })
    wrap(<Harness />)
    const box = await field()
    fireEvent.change(box, { target: { value: '# Borrador' } })
    fireEvent.click(screen.getByRole('button', { name: 'Descargar .md' }))
    expect(name).toBe('proyecto.md')
    expect(await created[0].text()).toBe('# Borrador')
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('the member reads the text rendered and whole, without a field, a frame with scroll or controls', async () => {
    server.description = '# Título\n\nPárrafo con **fuerza**.'
    wrap(<Harness editor={false} />)
    await screen.findByText('Título')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /md$/ })).toBeNull()
    const reading = document.querySelector('[data-project-reading]') as HTMLElement
    expect(reading.className).not.toMatch(/max-h|overflow/)
  })
})
