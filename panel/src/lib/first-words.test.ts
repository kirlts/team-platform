import { describe, expect, it } from 'vitest'
import { firstWords, plainText } from './first-words'

describe('firstWords', () => {
  it('keeps the first words, collapses whitespace and adds no ellipsis', () => {
    expect(firstWords('  Corregir   el\n\ndesalineado del sidebar en la vista', 4)).toBe('Corregir el desalineado del')
    expect(firstWords('Una sola', 12)).toBe('Una sola')
    expect(firstWords('', 5)).toBe('')
  })
})

describe('plainText', () => {
  it('drops the marks of Markdown and keeps the words', () => {
    expect(plainText('**Antes**: botón. [la regla](https://example.com)\n- uno')).toBe('Antes: botón. la regla\nuno')
  })
})
