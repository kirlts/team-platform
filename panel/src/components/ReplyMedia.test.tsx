// Two captures that carry the same role would both read «Propuesta»: then each one says what it shows.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import type { Attachment } from '@team-platform/client'
import { ReplyMedia } from './ReplyMedia'

afterEach(cleanup)
const shot = (id: string, name: string) => ({ id, kind: 'image', name, mime: 'image/png', size: 1 }) as unknown as Attachment
const draw = (items: Attachment[]) => render(<I18nProvider language="es-419"><ReplyMedia items={items} /></I18nProvider>)

describe('the role of a capture', () => {
  it('a single capture says only its role', () => {
    draw([shot('1', 'Propuesta - Paso 1 · Abrir la ficha.png')])
    expect(screen.getByText('Propuesta', { selector: '.rotulo' })).toBeTruthy()
  })
  it('two captures of one role say what each shows, so the same word is not drawn twice in a row', () => {
    draw([shot('1', 'Propuesta - Paso 1 · Abrir la ficha.png'), shot('2', 'Propuesta - Paso 2 · Tomar foto.png')])
    expect(screen.getByText('Propuesta · Paso 1 · Abrir la ficha', { selector: '.rotulo' })).toBeTruthy()
    expect(screen.getByText('Propuesta · Paso 2 · Tomar foto', { selector: '.rotulo' })).toBeTruthy()
    expect(screen.queryByText('Propuesta', { selector: '.rotulo' })).toBeNull()
  })
})
