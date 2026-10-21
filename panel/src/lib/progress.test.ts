import { describe, expect, it } from 'vitest'
import { sendPercent } from './progress'

describe('porcentaje de un envío (J2-B-09)', () => {
  it('en cola no hay porcentaje, venga lo que venga en el registro', () => {
    expect(sendPercent({ status: 'queued', job: { id: '1', status: 'queued', percent: 18, phrase: null } }, { percent: 18 })).toBe(0)
  })
  it('en marcha manda el evento en vivo y, sin él, el registro', () => {
    expect(sendPercent({ status: 'extracting', job: { id: '1', status: 'running', percent: 3, phrase: null } }, { percent: 40 })).toBe(40)
    expect(sendPercent({ status: 'analyzing', job: { id: '1', status: 'running', percent: 62.4, phrase: null } })).toBe(62)
    expect(sendPercent({ status: 'analyzing', job: null })).toBe(0)
  })
})
