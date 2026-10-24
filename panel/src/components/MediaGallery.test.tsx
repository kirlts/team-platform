// H-1200: the gallery's selection, keyboard, single medium, mixed kinds and failure, without layout (jsdom has none).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
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
    expect(document.querySelectorAll('[data-gallery-viewer] audio')).toHaveLength(0)
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
    expect(reply[0].transcriptSrc).toBe('/api/replies/attachments/a1/transcript') // a reply's speech is read too (UD-277)
    expect(reply[1].transcriptSrc).toBeUndefined()
  })
})
