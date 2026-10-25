// UD-297: «Obligatorio» is one control in each mode: a check box with the word as its label while editing, a badge while reading and only when required.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { RequiredMark } from './TemplateEditor'

afterEach(cleanup)
const show = (ui: React.ReactElement) => render(<I18nProvider language="es-419">{ui}</I18nProvider>)

describe('«Obligatorio» of a field', () => {
  for (const required of [true, false]) {
    it(`editing, ${required ? 'required' : 'optional'}: one check box with the word as plain text, and no badge`, () => {
      const onChange = vi.fn()
      const { container } = show(<RequiredMark required={required} onChange={onChange} />)
      const box = screen.getByRole('checkbox', { name: 'Obligatorio' })
      expect(box.getAttribute('aria-checked')).toBe(String(required))
      expect(container.querySelectorAll('[role="checkbox"]')).toHaveLength(1)
      expect(screen.getAllByText('Obligatorio')).toHaveLength(1)
      expect(screen.getByText('Obligatorio').className).not.toContain('rounded-full')
      fireEvent.click(box)
      expect(onChange).toHaveBeenCalledWith(!required)
    })
  }

  it('reading, required: a badge and no control', () => {
    show(<RequiredMark required />)
    expect(screen.getByText('Obligatorio').className).toContain('rounded-full')
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('reading, optional: nothing is drawn', () => {
    const { container } = show(<RequiredMark required={false} />)
    expect(container.textContent).toBe('')
  })
})
