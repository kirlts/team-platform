// H-1200: the gallery's selection, keyboard, single medium, mixed kinds and failure, without layout (jsdom has none).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EventsStore } from '@team-platform/client'
import { EventsProvider } from '@team-platform/client/react'
import { I18nProvider } from '@/i18n'
import { stepIndex, toGalleryItems, type GalleryItem } from '@/lib/gallery'
import { MediaGallery } from './MediaGallery'

const wrap = (ui: ReactNode) => render(<I18nProvider language="es-419">{ui}</I18nProvider>)
afterEach(cleanup)

const photo = (n: number): GalleryItem => ({ id: `p${n}`, kind: 'image', src: `/api/attachments/p${n}`, name: `foto-${n}.png` })
const photos = [1, 2, 3, 4].map(photo)
const marked = () => [...document.querySelectorAll<HTMLElement>('[data-gallery-thumb] [aria-current="true"]')]
const current = () => marked()[0]

describe('MediaGallery', () => {
  it('starts on the first medium, marks one thumbnail and says «1 de 4»', () => {
    wrap(<MediaGallery items={photos} />)
    expect(screen.getByText('1 de 4', { selector: '[data-gallery-count]' })).toBeTruthy()
    expect(marked()).toHaveLength(1)
    expect(current().getAttribute('aria-label')).toContain('foto-1.png')
  })

  it('moves by thumbnail, by arrows and by keyboard, and does not loop at the ends', () => {
    wrap(<MediaGallery items={photos} />)
    fireEvent.click(screen.getByRole('button', { name: /Ver 3 de 4/ }))
    expect(screen.getByText('3 de 4', { selector: '[data-gallery-count]' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByText('4 de 4', { selector: '[data-gallery-count]' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Siguiente' }) as HTMLButtonElement).disabled).toBe(true)
    const viewer = document.querySelector('[data-gallery-viewer]') as HTMLElement
    fireEvent.keyDown(viewer, { key: 'ArrowRight' })
    expect(screen.getByText('4 de 4', { selector: '[data-gallery-count]' })).toBeTruthy()
    fireEvent.keyDown(viewer, { key: 'Home' })
    expect(screen.getByText('1 de 4', { selector: '[data-gallery-count]' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Anterior' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(viewer, { key: 'End' })
    fireEvent.keyDown(viewer, { key: 'ArrowLeft' })
    expect(screen.getByText('3 de 4', { selector: '[data-gallery-count]' })).toBeTruthy()
  })

  it('leaves the arrow keys to a control that uses them (a video, a slider)', () => {
    wrap(<MediaGallery items={[{ id: 'v', kind: 'video', src: '/v', name: 'v.webm' }, photo(2)]} />)
    const video = document.querySelector('video') as HTMLElement
    fireEvent.keyDown(video, { key: 'ArrowRight' })
    expect(screen.getByText('1 de 2', { selector: '[data-gallery-count]' })).toBeTruthy()
  })

  it('draws no carousel for one medium: no strip, no arrows, no counter', () => {
    wrap(<MediaGallery items={[photo(1)]} />)
    expect(screen.queryByRole('button', { name: 'Siguiente' })).toBeNull()
    expect(document.querySelector('[data-gallery-count]')).toBeNull()
    expect(document.querySelector('[data-gallery-strip]')).toBeNull()
    expect(document.querySelectorAll('[data-gallery-viewer] img')).toHaveLength(1)
  })

  it('draws nothing without media', () => {
    const { container } = wrap(<MediaGallery items={[]} />)
    expect(container.querySelector('[data-gallery]')).toBeNull()
  })

  it('draws each kind in its own way and loads only the slides next to the current one', () => {
    const items: GalleryItem[] = [
      photo(1),
      { id: 'v', kind: 'video', src: '/v', name: 'grabacion.webm' },
      { id: 'a', kind: 'audio', src: '/a', name: 'nota.wav' },
      { id: 'd', kind: 'document', src: '/d', name: 'informe.pdf' },
      { id: 'l', kind: 'link', name: 'https://www.example.org/caso/12' },
    ]
    wrap(<MediaGallery items={items} />)
    expect(document.querySelectorAll('[data-gallery-viewer] img')).toHaveLength(1) // the thumbnails are outside the viewer
    expect(document.querySelectorAll('[data-gallery-viewer] video')).toHaveLength(1) // the neighbour, without controls
    expect(document.querySelector('[data-gallery-viewer] video')?.hasAttribute('controls')).toBe(false)
    // An audio is always drawn, but it only reads its header when it is next to the current one.
    expect(document.querySelectorAll('[data-gallery-viewer] audio')).toHaveLength(1)
    expect(document.querySelector('[data-gallery-viewer] audio')?.getAttribute('preload')).toBe('none')
    fireEvent.click(screen.getByRole('button', { name: /Ver 2 de 5/ }))
    expect(document.querySelector('[data-gallery-viewer] video')?.hasAttribute('controls')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Ver 3 de 5/ }))
    expect(screen.getByRole('button', { name: /Reproducir nota.wav/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Ver 4 de 5/ }))
    expect(screen.getAllByText('informe.pdf').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Abrir informe.pdf' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Ver 5 de 5/ }))
    expect(screen.getByText('example.org')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Abrir enlace' }).getAttribute('rel')).toContain('noopener')
  })

  it('says a file failed to load, and retrying draws it again', () => {
    wrap(<MediaGallery items={[photo(1), photo(2)]} />)
    const first = document.querySelector('[data-gallery-viewer] img') as HTMLImageElement
    fireEvent.error(first)
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('No se pudo cargar')).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.querySelector('[data-gallery-viewer] img')).not.toBe(first)
  })

  it('enlarges a photo and Escape brings it back to the frame', () => {
    wrap(<MediaGallery items={[photo(1)]} />)
    const img = document.querySelector('[data-gallery-viewer] img') as HTMLImageElement
    fireEvent.load(img)
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar' }))
    expect(document.querySelector('[data-gallery-zoomed]')).not.toBeNull()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(document.querySelector('[data-gallery-zoomed]')).toBeNull()
  })

  it('works controlled: the parent decides the index and hears about each change', () => {
    const seen = vi.fn()
    const { rerender } = wrap(<MediaGallery items={photos} index={2} onIndexChange={seen} />)
    expect(screen.getByText('3 de 4', { selector: '[data-gallery-count]' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    expect(seen).toHaveBeenCalledWith(1)
    rerender(
      <I18nProvider language="es-419">
        <MediaGallery items={photos} index={0} onIndexChange={seen} />
      </I18nProvider>,
    )
    expect(screen.getByText('1 de 4', { selector: '[data-gallery-count]' })).toBeTruthy()
  })

  it('has an accessible name and the selection is not only color: aria-current and a bar', () => {
    wrap(<MediaGallery items={photos} label="Adjuntos del envío" />)
    expect(screen.getByRole('region', { name: 'Adjuntos del envío' })).toBeTruthy()
    expect(current().querySelector('[aria-hidden="true"].bg-accent')).not.toBeNull()
  })
})

describe('gallery helpers', () => {
  it('steps and clamps at the ends', () => {
    expect(stepIndex(0, -1, 5)).toBe(0)
    expect(stepIndex(4, 1, 5)).toBe(4)
    expect(stepIndex(2, 1, 5)).toBe(3)
    expect(stepIndex(0, 1, 0)).toBe(0)
  })

  it('takes the file from the id space of the message or of the reply, and offers a transcript only where the server extracted text', () => {
    const atts = [
      { id: 'a1', kind: 'audio' as const, name: 'n.wav', extracted: true },
      { id: 'a2', kind: 'audio' as const, name: 'm.wav' },
      { id: 'l1', kind: 'link' as const, name: 'https://x.org' },
    ]
    const message = toGalleryItems(atts)
    expect(message[0].src).toBe('/api/attachments/a1')
    expect(message[0].transcriptSrc).toBe('/api/attachments/a1/transcript')
    expect(message[1].transcriptSrc).toBeUndefined()
    expect(message[2].src).toBeUndefined()
    const reply = toGalleryItems(atts, 'reply')
    expect(reply[0].src).toBe('/api/replies/attachments/a1')
    expect(reply[0].transcriptSrc).toBe('/api/replies/attachments/a1/transcript') // a reply's speech is read too (UD-279)
    expect(reply[1].transcriptSrc).toBeUndefined()
  })

  it('offers the text read from a photo, a document or a link as well, and says it is not a transcript', () => {
    const atts = [
      { id: 'i1', kind: 'image' as const, name: 'f.png', extracted: true },
      { id: 'd1', kind: 'document' as const, name: 'a.pdf', extracted: true },
      { id: 'l1', kind: 'link' as const, name: 'https://x.org', extracted: true },
      { id: 'd2', kind: 'document' as const, name: 'b.pdf' },
    ]
    const items = toGalleryItems(atts)
    expect(items.map((i) => i.transcriptSrc)).toEqual(['/api/attachments/i1/transcript', '/api/attachments/d1/transcript', '/api/attachments/l1/transcript', undefined])
    // The text of a photo, a document or a link sits under the viewer, outside the slides: they keep the height of their medium.
    wrap(<MediaGallery items={items} />)
    expect(document.querySelector('[data-gallery-extracted]')).not.toBeNull()
    expect(document.querySelector('[data-gallery-viewer] [data-gallery-transcript]')).toBeNull()
  })

  it('waits for the stream when a file is not readable yet, draws no error, and loads by itself when something is published', () => {
    const store = new EventsStore()
    wrap(
      <QueryClientProvider client={new QueryClient()}>
        <EventsProvider store={store} connect={false}>
          <MediaGallery items={[photo(1)]} />
        </EventsProvider>
      </QueryClientProvider>,
    )
    const first = document.querySelector('[data-gallery-viewer] img') as HTMLImageElement
    fireEvent.error(first)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('No se pudo cargar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
    expect(document.querySelector('[data-gallery-viewer] img')).toBeNull() // no broken image with its alternative text
    expect(document.querySelector('[data-gallery-waiting]')).not.toBeNull()
    act(() => store.newMessage({ message_id: '117', title: 'x', author_id: '3' } as never))
    const again = document.querySelector('[data-gallery-viewer] img') as HTMLImageElement
    expect(again).not.toBeNull()
    expect(again).not.toBe(first)
    // Still unreadable after the event: now it is a failure, with its button.
    fireEvent.error(again)
    expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Reintentar' })).toBeTruthy()
  })

  it('draws no «Abrir en otra pestaña» link: the download icon is the only way out, with its name', () => {
    wrap(<MediaGallery items={[{ ...photo(1), download: '/api/attachments/p1?download=1' }, photo(2)]} />)
    expect(screen.queryByText('Abrir en otra pestaña')).toBeNull()
    expect(document.querySelector('[data-gallery] a[target="_blank"]')).toBeNull()
    expect(screen.getByRole('link', { name: 'Descargar foto-1.png' })).toBeTruthy()
  })

  it('keeps the caption on one line: no wrapping, and the name is the part that is cut', () => {
    wrap(<MediaGallery items={[{ ...photo(1), name: 'una-captura-de-pantalla-con-un-nombre-larguisimo-que-no-cabe.png', size: 149504 }, photo(2)]} />)
    const caption = document.querySelector('[data-gallery-caption]') as HTMLElement
    expect(caption.className).toContain('whitespace-nowrap')
    expect(caption.className).not.toContain('flex-wrap')
    const name = screen.getByText(/una-captura-de-pantalla/)
    expect(name.className).toContain('truncate')
    expect(name.getAttribute('data-ellipsis-ok')).toBe('V5')
    expect(name.getAttribute('title')).toContain('nombre-larguisimo')
    expect(caption.querySelector('[data-gallery-count]')?.className).toContain('shrink-0')
  })

  it('has no height of its own: the viewer takes what the medium needs', () => {
    wrap(<MediaGallery items={photos} />)
    const viewer = document.querySelector('[data-gallery-viewer]') as HTMLElement
    expect(viewer.className).not.toMatch(/(^|\s)h-/)
    expect(viewer.firstElementChild?.className).not.toContain('h-full')
  })

  it('adds a «+» square at the end of the strip that asks for files, also with a single medium', () => {
    const onAdd = vi.fn()
    const { rerender } = wrap(<MediaGallery items={[photo(1)]} onAdd={onAdd} />)
    const strip = document.querySelector('[data-gallery-strip]') as HTMLElement
    expect(strip).not.toBeNull()
    const tile = within(strip).getByRole('button', { name: 'Agregar adjuntos' })
    expect(strip.lastElementChild?.contains(tile)).toBe(true)
    fireEvent.click(tile)
    expect(onAdd).toHaveBeenCalledTimes(1)
    rerender(<I18nProvider language="es-419"><MediaGallery items={photos} onAdd={onAdd} /></I18nProvider>)
    expect(document.querySelectorAll('[data-gallery-thumb]')).toHaveLength(4)
    expect(document.querySelector('[data-gallery-strip]')?.lastElementChild?.querySelector('[data-gallery-add]')).not.toBeNull()
  })

  it('without onAdd there is no «+»', () => {
    wrap(<MediaGallery items={photos} />)
    expect(document.querySelector('[data-gallery-add]')).toBeNull()
  })
})
