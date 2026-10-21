import { describe, expect, it } from 'vitest'
import { missingRequired, parseTemplateFields, remapFields } from './template'

const BUG = `---
name: Reporte de error
description: Algo que falla.
fields:
  - { name: steps,    label: Pasos para reproducir, required: true }
  - { name: expected, label: Qué se esperaba,       required: true }
  - { name: where,    label: "Dónde (pantalla, URL, versión o dispositivo)", required: false }
---
## Método
texto
`

describe('parseTemplateFields', () => {
  it('reads the fields of the frontmatter, with quoted labels that hold commas', () => {
    expect(parseTemplateFields(BUG)).toEqual([
      { name: 'steps', label: 'Pasos para reproducir', required: true },
      { name: 'expected', label: 'Qué se esperaba', required: true },
      { name: 'where', label: 'Dónde (pantalla, URL, versión o dispositivo)', required: false },
    ])
  })

  it('returns nothing for a file without frontmatter or without fields', () => {
    expect(parseTemplateFields('## Método')).toEqual([])
    expect(parseTemplateFields('---\nname: x\n---\ncuerpo')).toEqual([])
  })
})

describe('remapFields', () => {
  const next = parseTemplateFields(BUG)

  it('keeps the values whose names match, drops the rest and starts the new fields empty', () => {
    expect(remapFields({ steps: 'abrir', need: 'x', request: 'y' }, next)).toEqual({ steps: 'abrir', expected: '', where: '' })
  })

  it('starts every field empty when there is nothing to keep', () => {
    expect(remapFields(null, next)).toEqual({ steps: '', expected: '', where: '' })
  })
})

describe('missingRequired', () => {
  it('lists the required fields that are empty', () => {
    expect(missingRequired({ steps: 'abrir', expected: '  ' }, parseTemplateFields(BUG))).toEqual(['expected'])
  })
})
