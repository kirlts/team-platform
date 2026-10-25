// UD-293: «Avisos de progreso» in the window of a template: the minutes between two notices, edited in place; 0 reads «Apagado».
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { TemplateContentEditor } from './TemplateEditor'

const FILE = '---\nname: Reporte\ndescription: d\nfields:\n  - { name: steps, label: Pasos, required: true }\n---\n## Método\nLeer.\n'

afterEach(() => cleanup())

const show = (interval: number | undefined, onInterval = vi.fn(async () => undefined)) => {
  render(
    <I18nProvider language="es-419">
      <TemplateContentEditor name="Reporte" description="d" markdown={FILE} onSave={async () => undefined} progressInterval={interval} onProgressInterval={interval === undefined ? undefined : onInterval} />
    </I18nProvider>,
  )
  return onInterval
}
const section = () => screen.getByRole('region', { name: 'Avisos de progreso' })

describe('«Avisos de progreso» in a template', () => {
  it('shows the interval with its unit', () => {
    show(20)
    expect(within(section()).getByText('20')).toBeTruthy()
    expect(within(section()).getByText('min')).toBeTruthy()
  })

  it('0 reads «Apagado» and carries no unit', () => {
    show(0)
    expect(within(section()).getByText('Apagado')).toBeTruthy()
    expect(within(section()).queryByText('min')).toBeNull()
  })

  it('editing saves the number; a value that is not a whole number from 0 to 1440 stays open with the reason', async () => {
    const onInterval = show(20)
    const open = () => fireEvent.click(within(section()).getByText('20'))
    open()
    const field = within(section()).getByRole('textbox', { name: 'Avisos de progreso' })
    fireEvent.change(field, { target: { value: '2,5' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect((await within(section()).findByRole('alert')).textContent).toBe('Entero de 0 a 1440')
    expect(onInterval).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '0' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(onInterval).toHaveBeenCalledWith(0))
  })

  it('without a handler the section is not drawn', () => {
    show(undefined)
    expect(screen.queryByRole('region', { name: 'Avisos de progreso' })).toBeNull()
  })
})
