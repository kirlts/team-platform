// H-901: «Enlace» leaves the focus in its field because of the order of events (the menu gives the focus back, and the choice
// takes it), not because of the value some render happened to hold. The draft below never reports the field as open, which is the
// stale value a late render would show: the choice alone has to decide where the focus lands.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import type { MediaDraft } from '@/lib/useMediaDraft'
import { ClipMenu, LinkRow } from './MediaDraft'

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
