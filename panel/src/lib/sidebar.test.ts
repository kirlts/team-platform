import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSidebarHidden, saveSidebarHidden, sidebarKey } from './sidebar'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('side panel preference', () => {
  it('is remembered per person and starts shown', () => {
    expect(readSidebarHidden('u1')).toBe(false)
    saveSidebarHidden('u1', true)
    expect(readSidebarHidden('u1')).toBe(true)
    expect(readSidebarHidden('u2')).toBe(false)
    expect(sidebarKey('u1')).not.toBe(sidebarKey('u2'))
    saveSidebarHidden('u1', false)
    expect(readSidebarHidden('u1')).toBe(false)
  })

  it('does not fail when the storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readSidebarHidden('u1')).toBe(false)
    expect(() => saveSidebarHidden('u1', true)).not.toThrow()
  })
})
