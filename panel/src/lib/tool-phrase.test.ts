import { describe, expect, it } from 'vitest'
import { toolParts } from './tool-phrase'

describe('toolParts', () => {
  it('takes the class and detail the API sends', () => {
    expect(toolParts({ action: 'read', detail: 'a.ts', summary: 'x', name: 'Read' })).toEqual({ action: 'read', detail: 'a.ts' })
  })

  it('recovers the class of a row written before the classes existed', () => {
    expect(toolParts({ summary: 'Orden: npm test', name: 'Bash' })).toEqual({ action: 'command', detail: 'npm test' })
    expect(toolParts({ summary: 'Consulta web', name: 'WebFetch' })).toEqual({ action: 'web', detail: '' })
    expect(toolParts({ summary: 'Plan de trabajo', name: 'TodoWrite' })).toEqual({ action: 'plan', detail: '' })
  })

  it('has nothing for an unknown phrase', () => {
    expect(toolParts({ summary: 'algo', name: 'X' })).toBeNull()
  })
})
