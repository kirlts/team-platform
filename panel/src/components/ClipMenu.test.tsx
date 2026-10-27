// H-901: «Enlace» leaves the focus in its field because of the order of events (the menu gives the focus back, and the choice
// takes it), not because of the value some render happened to hold. The draft below never reports the field as open, which is the
// stale value a late render would show: the choice alone has to decide where the focus lands.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import type { MediaDraft } from '@/lib/useMediaDraft'
import { ClipMenu, LinkRow, MediaDraftList } from './MediaDraft'

beforeAll(() => {
  Object.assign(Element.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} })
})

afterEach(cleanup)

const staleDraft = { linkOpen: false, setLinkOpen: () => {}, addFiles: () => {} } as unknown as MediaDraft

describe('ClipMenu', () => {
  it('hands the focus to the link field when «Enlace» is chosen, whatever the draft says', async () => {
    render(
      <I18nProvider language="es-419">
        <ClipMenu draft={staleDraft} />
        <input id="compose-link" aria-label="campo" />
      </I18nProvider>,
    )
    const trigger = screen.getByRole('button', { name: 'Adjuntar' })
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    })
    const item = await screen.findByRole('menuitem', { name: 'Enlace' })
    await act(async () => {
      fireEvent.click(item)
    })
    // The menu leaves on the next event loop turn; the focus must end in the field once it has.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByLabelText('campo'))
    expect(document.activeElement).not.toBe(trigger)
  })

  it('draws the link field already focused, in the same commit, with no timer', () => {
    render(
      <I18nProvider language="es-419">
        <LinkRow draft={staleDraft} />
      </I18nProvider>,
    )
    expect(document.activeElement).toBe(screen.getByLabelText('Enlace'))
  })
})

describe('the link row', () => {
  const invalidDraft = { ...staleDraft, problem: 'link', setProblem: () => {}, addLink: () => false } as unknown as MediaDraft

  it('says «Dirección inválida» under its own field, tied to it, and the list of attachments does not repeat it', () => {
    render(
      <I18nProvider language="es-419">
        <LinkRow draft={invalidDraft} />
        <MediaDraftList draft={{ ...invalidDraft, linkOpen: false, empty: true, locals: [], links: [] } as unknown as MediaDraft} />
      </I18nProvider>,
    )
    const field = screen.getByLabelText('Enlace')
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.textContent).toBe('Dirección inválida')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.getAttribute('aria-describedby')).toBe(alerts[0]!.id)
    expect(field.closest('div.border-t')?.contains(alerts[0]!)).toBe(true)
  })

  it('«Agregar» is glass, not gel: the gel is the action of the screen', () => {
    render(
      <I18nProvider language="es-419">
        <LinkRow draft={staleDraft} />
      </I18nProvider>,
    )
    const add = screen.getByRole('button', { name: 'Agregar' })
    expect(add.className).toContain('btn-glass')
    expect(add.className).not.toContain('btn-gel')
  })

  it('shows weight and the length of a recording in the chip of an audio', () => {
    const file = new File([new Uint8Array(2048)], 'nota.webm', { type: 'audio/webm' })
    const draft = { ...staleDraft, empty: false, links: [], problem: null, locals: [{ key: 'a', file, url: 'blob:x', seconds: 2 }], removeLocal: () => {} } as unknown as MediaDraft
    render(
      <I18nProvider language="es-419">
        <MediaDraftList draft={draft} />
      </I18nProvider>,
    )
    expect(screen.getByText('00:02 · 2 KB')).toBeTruthy()
  })

  it('takes the error away as soon as the text is corrected', () => {
    let problem: string | null = 'link'
    const draft = { ...staleDraft, problem, setProblem: (p: string | null) => { problem = p }, addLink: () => false } as unknown as MediaDraft
    render(
      <I18nProvider language="es-419">
        <LinkRow draft={draft} />
      </I18nProvider>,
    )
    fireEvent.change(screen.getByLabelText('Enlace'), { target: { value: 'https://a.b/c' } })
    expect(problem).toBeNull()
  })
})
