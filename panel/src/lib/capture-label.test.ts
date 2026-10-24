import { describe, expect, it } from 'vitest'
import { captureLabel } from './capture-label'

describe('captureLabel', () => {
  it('splits the role from the description of a capture', () => {
    expect(captureLabel('Antes - Lista de mensajes')).toEqual({ label: 'Antes', alt: 'Lista de mensajes' })
    expect(captureLabel('Después - Lista - con filtro')).toEqual({ label: 'Después', alt: 'Lista - con filtro' })
    expect(captureLabel('After - Home')).toEqual({ label: 'After', alt: 'Home' })
  })
  it('leaves any other name alone', () => {
    expect(captureLabel('login.svg')).toBeNull()
    expect(captureLabel('Antes de ayer - nota')).toBeNull()
    expect(captureLabel(undefined)).toBeNull()
  })
})
