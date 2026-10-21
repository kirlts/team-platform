// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { en } from '@/i18n/en'
import { es419 } from '@/i18n/es-419'
import { progressText } from './progress-text'

const translator = (catalog: Record<string, unknown>) => (key: string, vars: Record<string, number> = {}) => {
  const message = catalog[key]
  const text = typeof message === 'string' ? message : (message as { one: string; other: string })[vars.n === 1 ? 'one' : 'other']
  return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]))
}

describe('progressText', () => {
  it('shows a server phrase in the language of the account, with its numbers', () => {
    expect(progressText('Lectura de adjunto 2 de 3', translator(en) as never)).toBe('Attachment 2 of 3: reading')
    expect(progressText('Lectura de adjunto 2 de 3', translator(es419) as never)).toBe('Lectura de adjunto 2 de 3')
    expect(progressText('Transcripción: 1 trozo', translator(en) as never)).toBe('Transcription: 1 chunk')
  })

  it('leaves an unknown phrase as the server wrote it', () => {
    expect(progressText('Frase nueva', translator(en) as never)).toBe('Frase nueva')
  })
})
