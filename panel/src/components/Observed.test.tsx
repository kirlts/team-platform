// `observed`: what a video frame shows and nobody says. Folded by default, outside the body, and absent when empty.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { Observed } from './Observed'

afterEach(cleanup)

const mount = (items?: string[]) =>
  render(
    <I18nProvider language="es-419">
      <Observed items={items} />
    </I18nProvider>,
  )

describe('Observed', () => {
  it('draws a folded section, one line per observation, when there are observations', () => {
    mount(['La pantalla muestra un error 500', 'El botón Guardar está gris'])
    const section = screen.getByTestId('observed') as HTMLDetailsElement
    expect(section.tagName).toBe('DETAILS')
    expect(section.open).toBe(false)
    expect(screen.getByText('Observaciones')).toBeTruthy()
    expect(section.querySelectorAll('li')).toHaveLength(2)
    fireEvent.click(screen.getByText('Observaciones'))
    expect(screen.getByText('El botón Guardar está gris')).toBeTruthy()
  })

  it('draws nothing without observations', () => {
    mount([])
    expect(screen.queryByTestId('observed')).toBeNull()
    cleanup()
    mount(undefined)
    expect(screen.queryByTestId('observed')).toBeNull()
  })
})
