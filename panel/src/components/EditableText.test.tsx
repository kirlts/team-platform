// TP-16 (soft-lock study 2026-11-04): a field left open with an error had Escape as its only way out, which a phone has not. While the
// error shows there is a «Cancelar» button that closes the field and keeps the saved value.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { EditableText } from './EditableText'

afterEach(cleanup)

const mount = (props: Partial<React.ComponentProps<typeof EditableText>> = {}) =>
  render(
    <I18nProvider language="es-419">
      <EditableText value="Título" label="Título del mensaje" validate={(v) => (v ? null : 'Obligatorio')} onSave={props.onSave ?? (() => {})} {...props} />
    </I18nProvider>,
  )

describe('leaving an in-place edit that has an error without a keyboard (TP-16)', () => {
  it('an empty value shows the error and a «Cancelar» button that restores the text', async () => {
    const onSave = vi.fn()
    mount({ onSave })
    fireEvent.click(screen.getByRole('button', { name: /Título del mensaje/ }))
    const field = await screen.findByLabelText('Título del mensaje')
    fireEvent.change(field, { target: { value: '' } })
    expect((await screen.findByRole('alert')).textContent).toContain('Obligatorio')
    const cancel = screen.getByRole('button', { name: 'Cancelar' })
    fireEvent.mouseDown(cancel)
    fireEvent.click(cancel)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('button', { name: /Título del mensaje: Título/ })).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('a failed save also offers «Cancelar»', async () => {
    mount({ onSave: () => Promise.reject(new Error('Sesión vencida')) })
    fireEvent.click(screen.getByRole('button', { name: /Título del mensaje/ }))
    const field = await screen.findByLabelText('Título del mensaje')
    fireEvent.change(field, { target: { value: 'Otro' } })
    fireEvent.blur(field)
    expect((await screen.findByRole('alert')).textContent).toContain('Sesión vencida')
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy()
  })

  it('there is no «Cancelar» while the field has no error', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Título del mensaje/ }))
    await screen.findByLabelText('Título del mensaje')
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
  })
})
