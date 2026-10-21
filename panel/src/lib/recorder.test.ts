import { describe, expect, it } from 'vitest'
import { extensionFor, pickAudioType } from './recorder'

describe('tipo de audio', () => {
  it('elige el primer candidato que el navegador soporta', () => {
    expect(pickAudioType(() => true)).toBe('audio/webm;codecs=opus')
    expect(pickAudioType((t) => t === 'audio/mp4')).toBe('audio/mp4')
    expect(pickAudioType((t) => t === 'audio/webm')).toBe('audio/webm')
  })
  it('sin soporte no inventa uno', () => {
    expect(pickAudioType(() => false)).toBeUndefined()
  })
  it('la extensión sale del tipo real, no del pedido', () => {
    expect(extensionFor('audio/mp4')).toBe('m4a')
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm')
  })
})
