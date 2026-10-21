import { describe, expect, it } from 'vitest'
import { extensionFor, pickAudioType } from './recorder'

describe('audio type', () => {
  it('picks the first candidate the browser supports', () => {
    expect(pickAudioType(() => true)).toBe('audio/webm;codecs=opus')
    expect(pickAudioType((t) => t === 'audio/mp4')).toBe('audio/mp4')
    expect(pickAudioType((t) => t === 'audio/webm')).toBe('audio/webm')
  })
  it('without support it does not invent one', () => {
    expect(pickAudioType(() => false)).toBeUndefined()
  })
  it('the extension comes from the actual type, not the requested one', () => {
    expect(extensionFor('audio/mp4')).toBe('m4a')
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm')
  })
})
