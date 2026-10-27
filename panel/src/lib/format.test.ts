import { describe, expect, it } from 'vitest'
import { afterColon } from './format'

describe('afterColon', () => {
  it('lowers the first letter of a sentence', () => {
    expect(afterColon('El documento supera el tamaño máximo')).toBe('el documento supera el tamaño máximo')
    expect(afterColon('The file is too large')).toBe('the file is too large')
  })
  it('leaves acronyms, numbers and lower case alone', () => {
    expect(afterColon('RUT duplicado')).toBe('RUT duplicado')
    expect(afterColon('HTTP 500')).toBe('HTTP 500')
    expect(afterColon('500 del servidor')).toBe('500 del servidor')
    expect(afterColon('error del servidor')).toBe('error del servidor')
  })
})
