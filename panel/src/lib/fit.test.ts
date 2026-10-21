import { describe, expect, it } from 'vitest'
import { fitCount, pageRange, total } from './fit'

describe('fitCount', () => {
  it('counts the rows that add up to the available height', () => {
    expect(fitCount([100, 100, 100, 100], 350)).toBe(3)
    expect(fitCount([100, 100, 100, 100], 400)).toBe(4)
  })

  it('uses each row\'s own height', () => {
    expect(fitCount([200, 60, 60, 60], 330)).toBe(3)
    expect(fitCount([60, 60, 60, 200], 330)).toBe(3)
  })

  it('always gives one row a page, even if it is taller than the frame', () => {
    expect(fitCount([500, 50], 300)).toBe(1)
    expect(fitCount([], 300)).toBe(1)
  })
})

describe('pageRange', () => {
  it('numbers the rows of a page from 1', () => {
    expect(pageRange(0, 3, 11)).toEqual({ from: 1, to: 3, total: 11 })
    expect(pageRange(9, 3, 11)).toEqual({ from: 10, to: 11, total: 11 })
    expect(pageRange(0, 1, 0)).toEqual({ from: 0, to: 0, total: 0 })
  })

  it('sums heights', () => {
    expect(total([1, 2, 3])).toBe(6)
  })
})
