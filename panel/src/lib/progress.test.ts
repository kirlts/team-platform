import { describe, expect, it } from 'vitest'
import { sendPercent } from './progress'

describe('percentage of a send (J2-B-09)', () => {
  it('a queued send has no percentage, whatever the record carries', () => {
    expect(sendPercent({ status: 'queued', job: { id: '1', status: 'queued', percent: 18, phrase: null } }, { percent: 18 })).toBe(0)
  })
  it('a running send takes the live event and, without it, the record', () => {
    expect(sendPercent({ status: 'extracting', job: { id: '1', status: 'running', percent: 3, phrase: null } }, { percent: 40 })).toBe(40)
    expect(sendPercent({ status: 'analyzing', job: { id: '1', status: 'running', percent: 62.4, phrase: null } })).toBe(62)
    expect(sendPercent({ status: 'analyzing', job: null })).toBe(0)
  })
})
