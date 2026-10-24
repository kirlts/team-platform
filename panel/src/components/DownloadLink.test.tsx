// The icon that saves an attachment: accessible name «Descargar <nombre>», the original name in `download`, and a row of a reply with name, size and icon.
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import type { Attachment } from '@team-platform/client'
import { I18nProvider } from '@/i18n'
import { toGalleryItems } from '@/lib/gallery'
import { AttachmentStrip } from './AttachmentStrip'
import { DownloadLink } from './DownloadLink'

const wrap = (ui: ReactNode) => render(<I18nProvider language="es-419">{ui}</I18nProvider>)
afterEach(cleanup)

const NAME = 'Subir fotos clínicas desde el teléfono.pdf'
const pdf = { id: '7', kind: 'document', mime: 'application/pdf', name: NAME, size: 20480 } as unknown as Attachment
const note = { id: '8', kind: 'document', mime: 'text/plain', name: 'nota.txt', size: 12 } as unknown as Attachment

describe('DownloadLink', () => {
  it('is a link named «Descargar <nombre>» that keeps the original name', () => {
    wrap(<DownloadLink href="/api/replies/attachments/7?download=1" name={NAME} />)
    const link = screen.getByRole('link', { name: `Descargar ${NAME}` })
    expect(link.getAttribute('href')).toBe('/api/replies/attachments/7?download=1')
    expect(link.getAttribute('download')).toBe(NAME)
  })

  it('draws nothing without an address (a link is not a file)', () => {
    const { container } = wrap(<DownloadLink name="x" />)
    expect(container.innerHTML).toBe('')
  })
})

describe('attachments of a reply', () => {
  it('a gallery item points to the download of its own scope; a link has none', () => {
    const items = toGalleryItems([pdf, { id: '9', kind: 'link', name: 'https://example.org' } as unknown as Attachment], 'reply')
    expect(items[0].download).toMatch(/\/replies\/attachments\/7\?download=1$/)
    expect(items[1].download).toBeUndefined()
    expect(toGalleryItems([pdf])[0].download).toMatch(/\/attachments\/7\?download=1$/)
  })

  it('each named row shows its name, its size and the icon; the PDF opens in a new tab and a text file opens the gallery', () => {
    wrap(<AttachmentStrip items={[pdf, note]} scope="reply" named />)
    const rows = screen.getAllByRole('listitem')
    const first = within(rows[0])
    expect(first.getByText(new RegExp(`${NAME.replace('.', '\\.')} · 20`))).toBeTruthy()
    expect(first.getByRole('link', { name: `Descargar ${NAME}` }).getAttribute('href')).toContain('/replies/attachments/7?download=1')
    const open = first.getByRole('link', { name: `Abrir ${NAME}` })
    expect(open.getAttribute('target')).toBe('_blank')
    expect(open.getAttribute('href')).toMatch(/\/replies\/attachments\/7$/)
    const second = within(rows[1])
    expect(second.getByRole('button', { name: /nota\.txt/ })).toBeTruthy()
    expect(second.getByRole('link', { name: 'Descargar nota.txt' })).toBeTruthy()
  })
})
