// A video thumbnail on the server is not read: the browser asked for megabytes of each video to find its first frame, on every
// Inicio and Mensajes load. A file still on the person's computer (blob:) is read for free and keeps its first frame.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { Thumb } from './Thumb'

afterEach(cleanup)

const mount = (src: string) =>
  render(
    <I18nProvider language="es-419">
      <Thumb item={{ kind: 'video', src, name: 'pantalla.mp4' }} px={40} />
    </I18nProvider>,
  )

describe('the video thumbnail', () => {
  it('does not create a video element for a file on the server, and still shows the play mark', () => {
    const { container } = mount('/api/attachments/11')
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('[role="img"][aria-label="pantalla.mp4"]')).not.toBeNull()
  })

  it('keeps the first frame of a file that is still on the person’s computer', () => {
    const { container } = mount('blob:http://localhost/1234')
    expect(container.querySelector('video')?.getAttribute('src')).toBe('blob:http://localhost/1234#t=0.1')
  })
})
