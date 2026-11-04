// TP-15 (soft-lock study 2026-11-04): Escape with the focus on the first field of a window closed nothing, because the window
// swallowed Escape for every `textarea, input` (ui/dialog.tsx, onEscapeKeyDown). The exception belongs only to a field that owns an
// edit of its own (`data-owns-escape`: the in-place text). Any other window closes with Escape wherever the focus is.
// TP-19: a window with typed text does not close with a click outside; one without it does.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { NoticeProvider } from '@/lib/notices'
import { mockApi, WithTeamClient } from '@/test/mock-api'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { EditableText } from '@/components/EditableText'
import { FormDialog } from '@/components/FormDialog'
import { NewTemplateDialog } from '@/components/TemplateEditor'

beforeAll(() => {
  Object.assign(window, { matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }) })
  Object.assign(Element.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} })
})
afterEach(cleanup)
mockApi(async () => ({ items: [] }))

function Mount({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return (
    <QueryClientProvider client={client}>
      <WithTeamClient>
        <I18nProvider language="es-419">
          <NoticeProvider>
            <MemoryRouter>{children}</MemoryRouter>
          </NoticeProvider>
        </I18nProvider>
      </WithTeamClient>
    </QueryClientProvider>
  )
}

function Host({ render: draw }: { render: (open: boolean, set: (v: boolean) => void) => React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <Mount>
      <div data-testid="outside">page</div>
      {draw(open, setOpen)}
      <output data-testid="state">{open ? 'open' : 'closed'}</output>
    </Mount>
  )
}

const state = () => screen.getByTestId('state').textContent

const FIELDS = [
  { name: 'title', label: 'Título', required: true },
  { name: 'description', label: 'Descripción', multiline: true },
]

describe('Escape closes the window that was opened (TP-15)', () => {
  it('a FormDialog closes with Escape while the focus is on its first field', async () => {
    render(<Host render={(open, set) => <FormDialog open={open} onOpenChange={set} title="Nueva área" fields={FIELDS} submitLabel="Crear" onSubmit={async () => {}} />} />)
    const first = await screen.findByLabelText('Título')
    first.focus()
    fireEvent.keyDown(first, { key: 'Escape' })
    await waitFor(() => expect(state()).toBe('closed'))
  })

  it('the window to create a template closes with Escape on its first field', async () => {
    render(<Host render={(open, set) => <NewTemplateDialog open={open} onOpenChange={set} onCreate={async () => {}} />} />)
    const first = (await screen.findAllByRole('textbox'))[0]
    first.focus()
    fireEvent.keyDown(first, { key: 'Escape' })
    await waitFor(() => expect(state()).toBe('closed'))
  })

  it('a field that owns an edit keeps Escape for itself: the first one cancels the edit, the window stays', async () => {
    render(
      <Host
        render={(open, set) => (
          <Dialog open={open} onOpenChange={set}>
            <DialogContent title="Perfil">
              <EditableText value="Ana" label="Nombre" onSave={() => {}} startEditing />
            </DialogContent>
          </Dialog>
        )}
      />,
    )
    const field = await screen.findByLabelText('Nombre')
    expect(field.hasAttribute('data-owns-escape')).toBe(true)
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(state()).toBe('open')
  })
})

describe('a click outside does not drop what was typed (TP-19)', () => {
  const outside = () => {
    const overlay = document.querySelector('[data-state="open"][data-aria-hidden], [data-radix-dialog-overlay], .fixed.inset-0') as HTMLElement
    fireEvent.pointerDown(overlay ?? document.body)
    fireEvent.mouseDown(overlay ?? document.body)
    fireEvent.click(overlay ?? document.body)
  }

  it('a FormDialog with a modified field stays open, and one without changes closes', async () => {
    const { unmount } = render(<Host render={(open, set) => <FormDialog open={open} onOpenChange={set} title="Nueva área" fields={FIELDS} submitLabel="Crear" onSubmit={async () => {}} />} />)
    const description = await screen.findByLabelText('Descripción')
    fireEvent.change(description, { target: { value: 'Un texto largo escrito a mano' } })
    outside()
    await new Promise((r) => setTimeout(r, 30))
    expect(state()).toBe('open')
    expect((screen.getByLabelText('Descripción') as HTMLTextAreaElement).value).toBe('Un texto largo escrito a mano')
    unmount()

    render(<Host render={(open, set) => <FormDialog open={open} onOpenChange={set} title="Nueva área" fields={FIELDS} submitLabel="Crear" onSubmit={async () => {}} />} />)
    await screen.findByLabelText('Descripción')
    outside()
    await waitFor(() => expect(state()).toBe('closed'))
  })

  it('the window to create a template stays open once a field is filled', async () => {
    render(<Host render={(open, set) => <NewTemplateDialog open={open} onOpenChange={set} onCreate={async () => {}} />} />)
    const first = (await screen.findAllByRole('textbox'))[0]
    fireEvent.change(first, { target: { value: 'Informe' } })
    outside()
    await new Promise((r) => setTimeout(r, 30))
    expect(state()).toBe('open')
  })

  it('DialogContent takes `dirty` and cancels the outside interaction itself', async () => {
    render(
      <Host
        render={(open, set) => (
          <Dialog open={open} onOpenChange={set}>
            <DialogContent title="Ventana" dirty>
              <p>cuerpo</p>
            </DialogContent>
          </Dialog>
        )}
      />,
    )
    await screen.findByText('cuerpo')
    outside()
    await new Promise((r) => setTimeout(r, 30))
    expect(state()).toBe('open')
  })
})
