// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { en } from '@/i18n/en'
import { es419 } from '@/i18n/es-419'
import { PROGRESS_CODES, renderPhrase } from '../../../src/domain/progress-phrases.js'
import { PROGRESS_KEYS, progressText } from './progress-text'

const translator = (catalog: Record<string, unknown>) => (key: string, vars: Record<string, number> = {}) => {
  const message = catalog[key]
  const text = typeof message === 'string' ? message : (message as { one: string; other: string })[vars.n === 1 ? 'one' : 'other']
  return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]))
}

describe('progressText', () => {
  it('translates by code into the language of the account, with its numbers, whatever the phrase says', () => {
    const notice = { code: 'attachmentN', vars: { n: 2, total: 3 }, phrase: 'Lectura de adjunto 2 de 3' }
    expect(progressText(notice, translator(en) as never)).toBe('Attachment 2 of 3: reading')
    expect(progressText(notice, translator(es419) as never)).toBe('Lectura de adjunto 2 de 3')
    expect(progressText({ code: 'transcribeN', vars: { n: 1 }, phrase: 'x' }, translator(en) as never)).toBe('Transcription: 1 chunk')
    // The phrase is not read: a code wins over any text.
    expect(progressText({ code: 'done', phrase: 'Frase cualquiera' }, translator(en) as never)).toBe('Done')
  })

  it('an event without a known code (an older server, a third party) is shown as the server wrote it', () => {
    expect(progressText({ phrase: 'Lectura de adjunto 2 de 3' }, translator(en) as never)).toBe('Lectura de adjunto 2 de 3')
    expect(progressText({ code: 'unknownCode', phrase: 'Frase nueva' }, translator(en) as never)).toBe('Frase nueva')
    expect(progressText({}, translator(en) as never)).toBe('')
  })

  it('the panel and the server say the same thing for every code, in both languages', () => {
    for (const code of PROGRESS_CODES) {
      expect(PROGRESS_KEYS[code], code).toBeTruthy()
      for (const [catalog, language] of [[es419, 'es-419'], [en, 'en']] as const) {
        for (const vars of [{ n: 1, total: 4 }, { n: 3, total: 4 }]) {
          expect(progressText({ code, vars }, translator(catalog) as never), `${code} ${language}`).toBe(renderPhrase(code, vars, language))
        }
      }
    }
  })
})
