// J5-message-detail: a .wav drew the icon of a document. The icon says the kind of medium: one for each, and none repeats.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { kindFromMime } from '@/lib/upload'
import type { AttachmentKind } from '@/lib/types'
import { MEDIA_ICON } from './MediaIcon'
import { MediaKinds } from './MediaKinds'
import { Thumb } from './Thumb'

afterEach(cleanup)

const KINDS: AttachmentKind[] = ['audio', 'video', 'image', 'document', 'link']

describe('the icon of a medium', () => {
  it('is a different one for each kind: audio, video, image, document and link', () => {
    expect(new Set(KINDS.map((k) => MEDIA_ICON[k])).size).toBe(KINDS.length)
  })

  it.each(KINDS)('a thumbnail without a picture of its own draws the icon of %s', (kind) => {
    const { container } = render(
      <I18nProvider language="es-419">
        <Thumb item={{ kind, name: 'x' }} />
      </I18nProvider>,
    )
    expect(container.querySelector('[data-media-icon]')?.getAttribute('data-media-icon')).toBe(kind)
  })

  it('the row of kinds and the thumbnail draw the same icon for audio', () => {
    const row = render(
      <I18nProvider language="es-419">
        <MediaKinds of={{ attachment_kinds: ['audio'] }} />
      </I18nProvider>,
    ).container
    expect(row.querySelector('[data-media-icon="audio"]')).not.toBeNull()
    expect(row.querySelector('[data-media-icon="document"]')).toBeNull()
  })
})

describe('the kind of a local file', () => {
  it.each([
    ['audio/wav', 'nota.wav', 'audio'],
    ['', 'nota.wav', 'audio'],
    ['application/octet-stream', 'voz.M4A', 'audio'],
    ['video/webm', 'clip.webm', 'video'],
    ['', 'clip.mov', 'video'],
    ['image/png', 'foto.png', 'image'],
    ['', 'foto.JPG', 'image'],
    ['application/pdf', 'informe.pdf', 'document'],
    ['', 'detalle.docx', 'document'],
  ])('%j %j is %s', (mime, name, kind) => {
    expect(kindFromMime(mime, name)).toBe(kind)
  })
})
