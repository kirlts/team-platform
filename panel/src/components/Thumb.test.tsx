// A photo that does not load is the tile of its kind with its icon, never the browser's broken image with its alternative text.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { Thumb } from './Thumb'

afterEach(cleanup)

it('draws the tile of its kind when the photo fails', () => {
  render(
    <I18nProvider language="es-419">
      <Thumb item={{ kind: 'image', src: '/api/attachments/16', name: 'captura.png' }} />
    </I18nProvider>,
  )
  fireEvent.error(document.querySelector('img') as HTMLImageElement)
  expect(document.querySelector('img')).toBeNull()
  expect(document.querySelector('[data-media-icon="image"]')).not.toBeNull()
  expect(screen.getByRole('img', { name: 'captura.png' })).toBeTruthy()
})
